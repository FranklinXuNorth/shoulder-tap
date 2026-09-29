# 跨平台同步（设计稿 v0.1，`sync` 分支）

状态：Worker、客户端同步层、本地 harness（21 个用例）已实现，全部对着 `deploy tool dev` 跑通；**还没部署**，还没在真 Mac 上跑过。

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

**模拟不了、要真机跑的**：
- 真 Mac 的文件系统和 `rename` 语义。
- LaunchAgent 起的菜单栏 app 读到的 HOME。
- 真 OpenClaw 网关起 MCP 子进程时带不带 `.env`。
- Codex 到底有没有钩子。

下一步是 live 模式：Windows 和 Mac 两台真机、一个部署好的 Worker、同一把 key，照上表手动过一遍。

## 下一步

1. **部署**：`cd worker && npx deploy tool deploy`，拿到 `*.sync.example` 地址，再用 `node harness/run.mjs <地址>` 在真 sync service 上跑一遍。
2. **设置页**：「跨机器同步」一栏。第一台生成密钥，给别的机器看一个可以复制的配对串（地址 + 密钥）；关掉就是删 `.env` 里那两行。
3. **拉的频率**：现在每次调用都拉，一次 `check_focus` 会拉三回（noteTz、listDay、overdueHabits）。本地 deploy tool 上每次 5ms；真网络上要量，必要时同一进程里 2 秒内只拉一次。
4. **拍肩中转**（旧 `cross-machine` 设计，d1812b4）：跟这个共用 Worker 和同一把密钥，频道 DO 里再挂 WebSocket。等同步在真机上稳了再接回来。
5. 核实 Codex 的钩子；核实 OpenClaw 网关怎么给 MCP 子进程传环境变量。
