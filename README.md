# shoulder-tap 👀

你告诉模型今天要做什么。之后你每想干点别的，它在动手之前先拍你一下肩膀。

不是 todo app——todo app 要你主动打开，而你跑偏的时候恰恰不会打开它。
这个挂在你已经在用的 Claude Code 上。

## 数据在你手里

服务端不存任何人的 token，也不存任何人的任务。

MCP 配置里的 Bearer token 就是**你自己的 Notion integration secret**。每次调用，
服务器拿着它读写**你自己的** Notion 库，返回结果，然后什么都不留。
这里提供的只有一份 schema 和一条通路。

开了跨机器（下面「跨机器」一节）之后，中转服务器会多存这些：账号邮箱、设备 ID（随机值）、
平台、屏幕数、手势类型、时间戳，以及**加密后**的字条。密钥从你的 Notion token 派生，只在你的机器上，
所以字条写了什么、任务是什么，服务端看不到。`.env` 里 `SHOULDER_TAP_TELEMETRY=0` 可以关掉
平台 / 屏幕数 / 手势的上报，跨机器照常能用。

文档：

- [docs/behavior.html](docs/behavior.html) —— 行为契约：它怎么对你、谁说了算、每个决定放弃了什么
- [docs/architecture.html](docs/architecture.html) —— 数据流：哪一跳交出了什么
- [docs/pipeline.html](docs/pipeline.html) —— 数据处理：字段归谁管、ID 什么时候签、手改会怎样
- [docs/rendering.html](docs/rendering.html) —— 渲染流程：那一下「拍肩」怎么落到聊天里
- [docs/cross-machine.html](docs/cross-machine.html) —— 跨机器（提案）：手拍在你眼睛所在的那台机器上
- [docs/ASSETS.md](docs/ASSETS.md) —— 素材需求
- [desktop/README.md](desktop/README.md) —— 桌面端：那一下「拍肩」怎么落到屏幕上（Windows）
- [desktop-mac/ShoulderTap.swift](desktop-mac/ShoulderTap.swift) —— macOS 桌面端：同样两只手、两条道，单文件，每拍一下是一个短命进程

## 安装

需要 Node 20+ 和 Claude Code。桌面端（屏幕上那只手）Windows 版要 .NET 10 SDK，
macOS 版要 Xcode 命令行工具（`xcode-select --install`，提供 `swiftc`）；
没有它们一切照常，拍肩落在聊天里而不是屏幕上。

```bash
git clone https://github.com/FranklinXuNorth/shoulder-tap.git
cd shoulder-tap
node install.mjs
```

脚本把 skill 拷到 `~/.claude/skills/shoulder-tap`、把四个钩子写进 `~/.claude/settings.json`、
把「专注」那一节粘进 `~/.claude/CLAUDE.md`，再把桌面端编译到 `~/.claude/shoulder-tap/app`
（Windows 编 `desktop/`，macOS 编 `desktop-mac/ShoulderTap.swift`）。
可以重复跑，已有的 `.env` 不会被覆盖。

然后两步要你自己的密钥：

1. [建一个 Notion integration](https://www.notion.so/profile/integrations)，拿 `ntn_` 开头的密钥。
   写进 `~/.claude/skills/shoulder-tap/.env` 的 `NOTION_TOKEN=`，再接上 Claude Code：
   ```bash
   claude mcp add --transport http shoulder-tap https://shoulder-tap.vercel.app/mcp \
     -s user -H "Authorization: Bearer ntn_你的密钥"
   ```
2. 挑一个 Notion 页面，⋯ → **Connections** → 把这个 integration 加进去。（漏这步必报 `object_not_found`。）
   然后在 Claude Code 里说「接上 shoulder-tap」，把页面链接给它——它会在那底下建好库。

不想跑脚本的话，四步手动做：拷 skill、配钩子（UserPromptSubmit / PostToolUse / Stop，以及 matcher 为 `AskUserQuestion` 的 PreToolUse，都跑 `node "$HOME/.claude/skills/shoulder-tap/watch.mjs"`）、
粘 `skill/CLAUDE.md.snippet`、编桌面端：

```bash
# Windows
dotnet publish desktop -c Release -o ~/.claude/shoulder-tap/app
# macOS：两张 sprite sheet 要放在可执行文件旁边
mkdir -p ~/.claude/shoulder-tap/app
cp skill/shoulder-tap/ui/sprites/{tap-glove,completion-hand}-sheet.png ~/.claude/shoulder-tap/app/
swiftc -O desktop-mac/ShoulderTap.swift -o ~/.claude/shoulder-tap/app/shoulder-tap-tap
```

## 跨机器

开着好几台电脑的时候，agent 在 Mac 上跑完了，而你正盯着 Windows —— 手应该拍在你眼睛所在的那台上。
每一下拍肩（拍拍、taptap、响指）都先经一个中转，送给**最近被你碰过、而且在线**的那台；
谁都不在线就不送，只记进历史。中转是一个 Cloudflare Worker，你自己部署，个人用量在免费档里，
不需要 Tailscale，不用开端口。

### 设置

**1. 部署中转（只做一次）**

需要一个 Cloudflare 账号（免费的就行）。

```bash
cd worker && npm install
npx wrangler login      # 浏览器里授权
npx wrangler deploy     # 第一次会让你起一个 workers.dev 子域名；结束时打印地址
```

打印出来的地址形如 `https://shoulder-tap-relay.<你的子域>.workers.dev`，下面每台机器都要填它。
`npx wrangler deploy` 在 `worker/` 目录里跑，在别处跑会被当成静态站点报错。

**2. 可选：Google 登录**

不配就只有邮箱密码登录。要配的话，在 [Google Cloud Console](https://console.cloud.google.com/)：

- **APIs & Services → OAuth consent screen**：User Type 选 External，填应用名和邮箱。
  应用在「Testing」状态时只有 Test users 里的邮箱能登，把你自己的加进去；要给别人用得发布。
- **Credentials → Create Credentials → OAuth client ID**：类型选 Web application，
  Authorized redirect URIs 填 `https://<你的 Worker 地址>/auth/google/callback`。
- 拿到 Client ID 和 Client secret，在 `worker/` 里塞进 Cloudflare（不进代码，不进仓库）：
  ```bash
  npx wrangler secret put GOOGLE_CLIENT_ID
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  ```
  塞完登录页自动多出「用 Google 登录 / 注册」，不用重新部署。

**3. 每台机器登录**

把中转地址写进 `~/.claude/skills/shoulder-tap/.env` 的 `SHOULDER_TAP_RELAY=`，再跑：

```bash
node install.mjs
```

它会打印一个链接（设备码 10 分钟有效）。浏览器里打开，用邮箱密码（「注册」标签建账号，「登录」标签进已有账号）
或 Google 登录，终端自动拿到设备令牌写进 `.env`，之后就不用管了。
每台机器都这么做一遍，登**同一个账号**，它们就连在一起了。`node install.mjs --login` 重新登。

`.env` 里还有一个开关：`SHOULDER_TAP_TELEMETRY=0` 不上报平台 / 屏幕数 / 手势类型，跨机器照常能用。

### 它怎么知道你在哪台

每台机器的常驻进程每秒看一眼本机有没有键鼠输入。刚有输入、而且（它不是当前活跃的那台，或者前台窗口换了块屏）
就上报一次；中转把「现在是谁」广播给所有机器。不上报坐标、窗口标题，也不上报你在敲什么。
通过远程桌面操作另一台时，那台会把自己算成活跃的，手拍在它的画面里，你透过远程窗口照样看得到。

### 服务端看得到什么

账号邮箱、设备 ID（随机值）、平台、屏幕数、手势类型、时间戳，以及**加密后**的字条。
字条的密钥从你的 Notion token 派生，只在你自己的机器上；服务端和历史记录里都只有密文。
没有登录限速、改密码、找回密码、注销设备 —— 现在的账号只够把机器连起来。

### 现在能做到的

- Windows：能收能发。
- macOS：能发（钩子是同一份 `watch.mjs`），**收不到** —— Mac 桌面端还是每拍一下起一个短命进程，
  挂不住 WebSocket。改成菜单栏常驻 App 是下一步，方案在 [docs/cross-machine.html](docs/cross-machine.html)。
- 中转不通（没配、没登录、超时）时一切照旧：拍在本机。

## 工具

| | |
| --- | --- |
| `check_focus(activity?)` | 拦路的那个。返回今天的清单和一段判断规则：相关就放行，不相关就停下来问你。顺带报超时的习惯。 |
| `set_focus` / `add_focus` / `complete_focus` | 按顺序记、插队、勾掉。只有你说完成才算完成。 |
| `add_habit` / `log_habit` | 盯一个习惯（名字你自己定，不预设任何东西；隔多久一次，或每天几点）／记一笔刚做了，或今天跳过。 |
| `setup` / `ping` | 建库 / 健康检查。 |

语义判断是**调用方的模型**做的，服务端不跑模型、不花 token。

## Notion 里长什么样

一个库 `Shoulder Tap`，靠 `Kind` 区分两种行：

| 字段 | 类型 | `task` 行 | `habit` 行 |
| --- | --- | --- | --- |
| `Name` | title | 步骤本身 | 习惯名 |
| `Kind` | select | `task` | `habit` |
| `ID` | rich_text | `t-a3f91c` | `h-8b12d4` |
| `Order` | number | 第几条，顺序靠它 | — |
| `Status` | select | pending / done / dropped | — |
| `Day` | date | 哪一天（存 UTC，读时按你的时区换算） | — |
| `TZ` | rich_text | 写这行时你在哪个时区 | 同左，`At` 按它算 |
| `EveryMinutes` | number | — | 隔多久提醒一次（和 `At` 二选一） |
| `At` | rich_text | — | 每天几点提醒，`HH:MM` |
| `Last` | date | — | 上次做（或跳过）的时间 |
| `Note` | rich_text | 执行细节 | 备注，跳过的原因也写这 |

建完就是普通的 Notion 数据库，加视图、改间隔、手机上勾，都随你。

## 自己部署

Vercel 导入本仓库即可，不需要数据库。可选环境变量：

- `SHOULDER_TAP_KEY` —— 门禁，挡路人蹭额度。客户端对应带 `X-Shoulder-Tap-Key` 头。不过用回 403
  而不是 401：MCP 客户端把 401 读成「请走 OAuth」，然后整个服务器会显示连不上。
- `JEV_API_KEY` —— 配了才有 `classify_focus`。代价是两行文字会离开这台机器。
- `DAY_STARTS_AT_HOUR` —— 一天从几点开始，默认 4：熬到凌晨的人还在昨天。

记得在 Settings → Deployment Protection 关掉 Vercel Authentication，否则 MCP 客户端会被重定向到登录页。

## 本机直连 Jev（可选）

`watch.mjs` 在 UserPromptSubmit 时可以直接从你机器上请求 Jev 做首轮「相不相关」的比较，不经过 Vercel。
在 `~/.claude/skills/shoulder-tap/.env` 里填 `JEV_API_KEY`（`JEV_BASE_URL` 默认 `https://api.typesafe.ai`）就开了；
不填就由对话模型自己判。请求 2 秒超时，超了或出错都静默退回模型判断。
`SHOULDER_TAP_LOCAL_JEV=0` 可以临时关掉。这条路只发两行文字，不碰 MCP，也不碰 Notion。
