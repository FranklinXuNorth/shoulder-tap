# 跨平台同步（设计稿 v0.1，`sync` 分支）

状态：已部署到 `https://sync.example`。harness 28 个用例对着线上 Worker 全部通过（2026-09-28，从纽约的 Windows 机器跑）。还没在真 Mac、真 OpenClaw 上跑过。

## 要解决什么

main 上的数据只在一台机器上（`~/.claude/shoulder-tap/data.json`），于是：

| 跨越 | 现在的问题 | 同步之后 |
|---|---|---|
| Windows ↔ Mac | 两台各一张单子，在 Mac 上勾掉的，Windows 上还在催 | 同一张单子，任何一台改，别的下一次调用就看到 |
| Claude Code ↔ Codex | 同一台机器上两个 MCP 进程读改写同一个文件，并发时会丢一条 | 文件锁；跨机器时同上 |
| Mac 上的 Claude Code ↔ Discord 里的 OpenClaw | OpenClaw 若跑在服务器上，看不到 Mac 的数据，而且按服务器的 UTC 算「今天」 | 数据同步；服务器按**你的**时区算 |

用 Notion 存储的人不需要这些：几台机器连同一个库就是同步。这条只给本地存储用。

## 架构

```
机器 A（Win / Mac / VPS）                     sync service                          机器 B
  Claude Code / Codex / OpenClaw
    └─ mcp.mjs ─ store.mjs                     Worker /v1/{channel}/push|pull
         锁 data.json                             │
         ├─ 拉：pull?since=cursor ──────────▶  server storage「Vault」（每频道一个）
         ├─ 干活（local.mjs 原样）              · rows(rid, seq, blob, deleted)  ◀── 机器 B 同样的三步
         └─ 推：改过的行加密后 push ─────────▶  · seq 按到达顺序递增
  钩子 watch.mjs --refresh 走同一条路
```

- **一行 = 一个 rid**（随机 UUID）。任务的每一行、习惯的每一次、偏好（时区）各是一行。
- **谁后到服务端谁赢**，按行比。本地改了还没推上去的行，拉下来的旧版不许盖掉它。
- **拉、干活、推**三步整段拿着 `data.json.lock`。同步没开也锁（解决 Claude Code + Codex 并发）。
- **连不上就是单机模式**：拉推各最多 1.5 秒（`SHOULDER_TAP_SYNC_TIMEOUT_MS`），失败只记 `lastSyncError`，没推上去的下次调用补推。
- 本机记账：`data.json` 里的 `sync.cursor`（拉到哪了）和 `sync.hashes`（每行上次同步时的哈希，用来找出改过、删过的行）。

### 合并时的几条确定性规则

每台机器独立算出同一个结果，所以会收敛，不会来回改：

1. **第几条是排出来的**：当天的行按 `(order, sid)` 排，位置 = 下标 + 1。两台离线各往末尾加一条，存下来的 order 一样，排出来的先后在两台上也一样（W3）。
2. **删除也同步**：`set_focus` 删掉旧行，推一个墓碑（W4）。
3. **同一习惯只留一行 pending**：离线时两台各记一次，会出现两行 pending，留激活时间最晚的（W6）。
4. **收尾的习惯行换新 rid**：两台各记一次喝水是两条历史，不因为收的是同一行 pending 就合成一条（W6 抓出来的 bug）。

## 身份和隐私

没有账号。一把同步密钥 `SHOULDER_TAP_SYNC_KEY`（32 字节随机），每台机器的 `.env` 里放同一把：

| 派生 | 用途 | 服务端能看到 |
|---|---|---|
| HKDF(key, "shoulder-tap/sync/channel") 前 16 字节 | 频道 ID，URL 里 | 是（反推不出 key） |
| HKDF(key, "shoulder-tap/sync/auth") | Bearer；服务端首次见到记下 SHA-256，之后对不上就 403（TOFU） | 只有哈希 |
| HKDF(key, "shoulder-tap/sync/key") | AES-256-GCM 加密每一行 | 否 |

服务端能看到的只有 rid、seq、密文长度、删没删。任务名、习惯名、时区都在密文里（W7 断言过）。

**代价**：密钥丢了，云端那份就解不开了（本地的都还在）。密钥泄露后要换新密钥，也就是换频道：所有机器一起换，第一台推全量上去。

## 时区：有人在跟前的机器 vs 没人的

用户规则是时区永远从机器读、不写死。服务器上的 OpenClaw 读到的是服务器的 UTC，不是你的时区。

- 有人在跟前的机器：每次 `check_focus` 把自己的时区写进偏好行 `prefs.tz`，跟着同步走。
- 没人在跟前的机器（`.env` 里 `SHOULDER_TAP_HEADLESS=1`）：没传 tz 时用 `prefs.tz`，没有才退回本机（O2、O3）。
- 不标 headless 的服务器照旧用 UTC（O4 把这个坑钉住了）。
- 模型明确传了 tz 时一律用传的。

**已知的别扭**：两台有人的机器系统时区不同（比如出差带着 Mac、家里 Windows 还开着），`prefs.tz` 跟着最后开过口的那台走。这就是你所在的地方，符合预期。但两台机器各自的「今天」会按各自系统时区算（W9），要看同一天得显式传同一个 tz。

## 测试 harness

```
cd worker && npm install
node harness/run.mjs                       # 起 deploy tool dev（本地 workerd + DO SQLite），跑 21 个用例，关掉
node harness/run.mjs https://<部署地址>    # 对着真 sync service 跑；每个用例一个随机频道
node harness/run.mjs --test-name-pattern=O  # 只跑某一组
```

每台「机器」有独立的 HOME、TZ 和 `.env` 开关。上面的 agent 都是真的 `mcp.mjs` 子进程，走真 stdio JSON-RPC，只有 `clientInfo.name` 不同。钩子用 `watch.mjs --refresh` 验证，也就是 UserPromptSubmit 在后台起的那个进程。

| 组 | 用例 |
|---|---|
| **W** Windows ↔ Mac | W1 一边 set 另一边看到 · W2 一边勾掉另一边当前条跟着变 · W3 双离线各加一条后顺序一致 · W4 重排删除同步 · W5 一边加习惯另一边记了就不催 · W6 双离线各记一次：一行 pending、两条历史 · W7 服务端只有密文 · W8 错钥匙 403 · W9 不同系统时区 |
| **C** Claude Code ↔ Codex | C1 同机两个常驻进程并发各加 10 条不丢、编号连续（同步开/关各一遍）· C2 同机 Claude Code 定、Codex 勾、钩子缓存跟上 · C3 跨机器同上 · C4 Codex 离线改的联网后补推 |
| **O** Mac Claude Code ↔ Discord OpenClaw | O1 同一台 Mac 直接共用 · O2 服务器 OpenClaw 用你的时区 · O3 还没人记过时区时退回 UTC · O4 不标 headless 用 UTC · O5「喝完水了」后 Mac 钩子不催 · O6「加一条」排最后 · O7「第 1 条今天不做了」 |
| **N** 真网络 | N1 拉推各 50 次的延迟 · N2 一次 check_focus 总耗时 · N3 新频道冷启动 · N4 1200 行分批分页 · N5 超时退回单机、之后补推 · N6 DELETE 清空频道（每个用例收尾都清） |
| **L** 长会话 | L1 真 watch.mjs 按 Claude Code 的方式跑 500 轮（开口 + 说完）：每轮注入都有清单、这轮的话、第一行规则和手；第 250 轮 OpenClaw 勾掉第 1 条，看注入多久跟上；每 100 轮漏一次手看顶回；钩子不随轮数变慢 |

### 线上结果（2026-09-28）

| 指标 | 数 |
|---|---|
| 拉 / 推 | p50 34ms / 42ms，p90 38ms / 45ms |
| 一次 `check_focus`（MCP 往返 + 三次拉 + 推） | p50 138ms，p90 149ms |
| 新频道冷启动 | 149–267ms |
| 500 轮会话里的开口钩子 | 前 50 轮中位数 110ms，后 50 轮 133ms；会话记录涨到 177KB 不影响 |
| OpenClaw 勾掉后 Mac 注入跟上 | 1.4 秒（第 257 轮）。最坏情况是后台刷新节流 20 秒再加一轮 |

结论：拉的次数（下一步第 3 条）暂时不用优化，都远在 1.5 秒超时以内。

**500 轮测的是什么、没测什么**：shoulder-tap 不靠模型的上下文记事。每轮开口时，钩子都从本机或同步过来的数据重新读一遍清单塞进去，所以上下文多长、有没有被压缩都不影响。L1 证明的就是这一点。真模型在 500 轮上下文里会不会照规则办事（第一行写结论、结尾打手），要真调模型才测得到，这里没测。漏手的情况由 Stop 钩子兜底，顶回一次。

## 第一行是结论

响指旁边那条字（桌面上的总结）一直取的是回答的第一段（`completion.mjs` 的 `doneLine`），但规则写的是「手前面那句话是总结」，两边对不上，桌面上常常显示开场白。现在统一成：

- 规则：每轮回答的**第一行**是一句话的结论，不超过 60 字、不带 markdown。每轮注入的 `renderDone`、`CLAUDE.md.snippet`、漏手时顶回去的提示，三处说法一致。
- 抓取：`doneLine` 取第一个有字的行，去掉 markdown 壳。
- 安装：`install.mjs` 以前看到已有「## 专注」就整节不动，老用户永远拿不到新规则。现在只插入或替换带标记的块（`<!-- shoulder-tap:first-line -->`），放在标题下第一行，块外一个字不动；再装一次不变；CRLF 文件照样认得（`core/claude-md.mjs`，有测试）。卸载时整节删除，块跟着走。

**模拟不了、要真机跑的**：
- 真 Mac 的文件系统和 `rename` 语义。
- LaunchAgent 起的菜单栏 app 读到的 HOME。
- 真 OpenClaw 网关起 MCP 子进程时带不带 `.env`。
- Codex 到底有没有钩子。

下一步是 live 模式：Windows 和 Mac 两台真机、一个部署好的 Worker、同一把 key，照上表手动过一遍。

## 下一步

1. ~~部署~~：已完成。重新部署用 `cd worker && npx deploy tool deploy`，然后 `node harness/run.mjs https://sync.example`。
2. **设置页**：「跨机器同步」一栏。第一台生成密钥，给别的机器看一个可以复制的配对串（地址 + 密钥）；关掉就是删 `.env` 里那两行。
3. **拉的频率**：现在每次调用都拉，一次 `check_focus` 会拉三回（noteTz、listDay、overdueHabits）。本地 deploy tool 上每次 5ms；真网络上要量，必要时同一进程里 2 秒内只拉一次。
4. **拍肩中转**（旧 `cross-machine` 设计，d1812b4）：跟这个共用 Worker 和同一把密钥，频道 DO 里再挂 WebSocket。等同步在真机上稳了再接回来。
5. 核实 Codex 的钩子；核实 OpenClaw 网关怎么给 MCP 子进程传环境变量。

## 登录（v2）

账号只决定「你是谁、进哪个频道」，能不能读取决于同步口令。两者分开，所以服务端既认得你，又读不了你。

- `node ~/.claude/skills/shoulder-tap/login.mjs`：终端打印链接并打开浏览器，用邮箱密码或 Google 登录（设备码流程：浏览器绑码，终端拿只有它知道的 secret 换令牌），再在终端输同步口令。
- 第一台机器随机生成同步密钥，用口令加一层（scrypt N=2^15 + AES-256-GCM）存到服务端；之后每台机器登录时拉下来，在本机拆开。口令从不上传。
- 写进 `.env` 的是 `SHOULDER_TAP_SYNC_URL`、`SHOULDER_TAP_DEVICE_TOKEN` 和 `SHOULDER_TAP_VAULT_KEY`（拆开后的密钥，只在本机）。有这三项就走 `/v2`，频道等于账号；v1（手填 `SHOULDER_TAP_SYNC_KEY`）照旧能用。
- `--status` 查看登录状态，`--logout` 注销这台。`DELETE /account` 注销整个账号（设备、密钥、密文全删）。
- 同一个邮箱连错 5 次密码，锁 15 分钟。
- 服务端存的东西：邮箱、PBKDF2 密码哈希、设备令牌、包起来的密钥、密文行。

**Google 登录需要你手动做的三件事**：
1. 把 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 设成 Worker 的 secret：`cd worker && npx deploy tool secret put …`，或者在 sync service 控制台 → Workers → shoulder-tap-sync → Settings → Variables and Secrets 里添加。
2. 在 Google Console 的这个 OAuth client 里加回调地址 `https://sync.example/auth/google/callback`。
3. 应用还在 Testing 状态，只有 consent screen 里列出的 test users 能登录；要给别人用，得发布应用。

测试在 `harness/auth.test.mjs`，共 12 个（A1–A12）：
- 同账号同步；两个账号互相隔离
- 登录密码错与锁定；同步口令错时本机数据不受影响
- 注册时的密码确认；设备码被偷看也拿不走令牌、只能用一次
- 注销单台设备；两台同时当第一台时只生成一把密钥
- 服务端只见密文；注销整个账号
- Google 跳转地址（只测到跳转这一步，登录要真人点）
- `login.mjs` 端到端

线上 40/40 通过（2026-09-28）。

## 别的机器切到 sync 分支

在那台机器的 shoulder-tap 仓库里：

```
git fetch origin
git switch sync                                   # 第一次切：自动跟踪 origin/sync
node ~/.claude/skills/shoulder-tap/update.mjs     # 更新到 sync 最新版（数据和设置不动）
node ~/.claude/skills/shoulder-tap/login.mjs      # 在自己的终端里：浏览器登录 → 同步口令 → 立刻同步一次
```

从没装过 shoulder-tap 的机器，clone 之后 `git switch sync && node install.mjs --login`，一条命令做完。
让 agent 来做的话，它照 `SKILL.md` 的「跨机器同步」一节：切分支和更新它自己跑，`login.mjs` 交给你在自己的终端里跑。
`login.mjs` 发现自己跑在没有终端的 shell 里（比如 agent 的 shell）会直接退出，并提示你自己跑：它要开浏览器、要输口令，口令不能经过聊天。

登录这一步做完这几件事：
- 装好新版的 skill 和钩子。
- 登录，拆开同步密钥。
- 这台原来用 Notion 的话，问一句，然后把 Notion 里的全部记录搬到本地（翻页翻到底，Notion 里的原样留着当备份）。
- 第一次同步用 15 秒超时，最后打印「拉下来几行、推上去几行、这台现在有多少」。

以后更新：`node ~/.claude/skills/shoulder-tap/update.mjs`。它在当前分支上 `git pull`，所以留在 sync 分支就会一直拉 origin/sync。

两台都用了很久、各有记录时（A13 测过）：
- 任务取并集。
- 同名习惯（比如两台都有「喝水」）合并成一个，两边的打卡记录都保留。
- 以前用手填密钥同步过的机器，换成登录时从头对账，一行不落（A14）。
- 两台连着同一个 Notion 时，各自搬一遍也不会变成两份：每行的同步 ID 由 Notion 页面决定（`core/notion-move.test.mjs`）。

**已知**：
- 两台机器同一天各自定过清单，合并后当天会有两张单子的并集。要只留一张，在其中一台上 `set_focus` 重排一次。
- sync service 新建 server storage 偶尔会慢过 1.5 秒（线上见过）。那一次调用会退回单机，下次补推。
