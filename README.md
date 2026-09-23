# shoulder-tap 👀

你告诉模型今天要做什么。之后你每想干点别的，它在动手之前先拍你一下肩膀。

不是 todo app——todo app 要你主动打开，而你跑偏的时候恰恰不会打开它。
这个挂在你已经在用的 Claude Code 上。

## 数据在你手里

服务端不存任何人的 token，也不存任何人的任务。

MCP 配置里的 Bearer token 就是**你自己的 Notion integration secret**。每次调用，
服务器拿着它读写**你自己的** Notion 库，返回结果，然后什么都不留。
这里提供的只有一份 schema 和一条通路。

文档：

- [docs/behavior.html](docs/behavior.html) —— 行为契约：它怎么对你、谁说了算、每个决定放弃了什么
- [docs/architecture.html](docs/architecture.html) —— 数据流：哪一跳交出了什么
- [docs/pipeline.html](docs/pipeline.html) —— 数据处理：字段归谁管、ID 什么时候签、手改会怎样
- [docs/rendering.html](docs/rendering.html) —— 渲染流程：那一下「拍肩」怎么落到聊天里
- [docs/ASSETS.md](docs/ASSETS.md) —— 素材需求
- [desktop/README.md](desktop/README.md) —— 桌面端：那一下「拍肩」怎么落到屏幕上

## 安装

需要 Node 20+ 和 Claude Code。桌面端（屏幕上那只手）Windows 版要 .NET 10 SDK，
macOS 版要 Xcode 命令行工具（`xcode-select --install`，提供 `swiftc`）；
没有它们一切照常，拍肩落在聊天里而不是屏幕上。

```bash
git clone https://github.com/FranklinXuNorth/shoulder-tap.git
cd shoulder-tap
node install.mjs
```

脚本把 skill 拷到 `~/.claude/skills/shoulder-tap`、把三个钩子写进 `~/.claude/settings.json`、
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

不想跑脚本的话，四步手动做：拷 skill、配钩子（三个事件都跑 `node "$HOME/.claude/skills/shoulder-tap/watch.mjs"`）、
粘 `skill/CLAUDE.md.snippet`、`dotnet publish desktop -c Release -o ~/.claude/shoulder-tap/app`。

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
