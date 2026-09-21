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

- [docs/architecture.html](docs/architecture.html) —— 数据流：哪一跳交出了什么
- [docs/pipeline.html](docs/pipeline.html) —— 数据处理：字段归谁管、ID 什么时候签、手改会怎样
- [docs/rendering.html](docs/rendering.html) —— 渲染流程：那一下「拍肩」怎么落到聊天里
- [docs/ASSETS.md](docs/ASSETS.md) —— 素材需求

## 用起来

1. [建一个 Notion integration](https://www.notion.so/profile/integrations)，拿 `ntn_` 开头的密钥。
2. 挑一个 Notion 页面，⋯ → **Connections** → 把这个 integration 加进去。（漏这步必报 `object_not_found`。）
3. ```bash
   claude mcp add --transport http shoulder-tap https://shoulder-tap.vercel.app/mcp \
     -s user -H "Authorization: Bearer ntn_你的密钥"
   ```
4. 让模型调 `setup`，把第 2 步那个页面的链接给它——它会在那底下建好库。
5. 把 `skill/shoulder-tap/` 拷到 `~/.claude/skills/`，`skill/CLAUDE.md.snippet` 的内容粘进
   `~/.claude/CLAUDE.md`。**不做这步，拦截不会自动发生。**

## 工具

| | |
| --- | --- |
| `check_focus(activity?)` | 拦路的那个。返回今天的清单和一段判断规则：相关就放行，不相关就停下来问你。顺带报超时的习惯。 |
| `set_focus` / `add_focus` / `complete_focus` | 按顺序记、插队、勾掉。只有你说完成才算完成。 |
| `add_habit` / `log_habit` | 盯一个习惯（名字你自己定，不预设任何东西）／记一笔刚做了。 |
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
| `Day` | date | 哪一天 | — |
| `EveryMinutes` | number | — | 隔多久提醒一次 |
| `Last` | date | — | 上次做的时间 |
| `Note` | rich_text | 执行细节 | 备注 |

建完就是普通的 Notion 数据库，加视图、改间隔、手机上勾，都随你。

## 自己部署

Vercel 导入本仓库即可，不需要数据库。两个可选环境变量：

- `SHOULDER_TAP_KEY` —— 门禁，挡路人蹭额度。客户端对应带 `X-Shoulder-Tap-Key` 头。不过用回 403
  而不是 401：MCP 客户端把 401 读成「请走 OAuth」，然后整个服务器会显示连不上。
- `JEV_API_KEY` —— 配了才有 `classify_focus`。代价是两行文字会离开这台机器。
- `TIMEZONE_OFFSET_HOURS` —— 算「今天」用，默认 8。

记得在 Settings → Deployment Protection 关掉 Vercel Authentication，否则 MCP 客户端会被重定向到登录页。
