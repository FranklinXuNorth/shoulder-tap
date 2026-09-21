# shoulder-tap 👀

一个 MCP 服务：你告诉模型今天要做什么，之后你每想干点别的，它先拍你一下肩膀。

不是 todo app。todo app 要你主动打开——而你跑偏的时候恰恰不会打开它。
这个东西挂在你**已经在用**的模型上：你一开口要做别的事，模型在动手之前先问一句。

## 数据在谁手里

服务端**不存任何人的 token，也不存任何人的任务**。

MCP 配置里的 Bearer token 就是**用户自己的 Notion integration secret**。每次调用，
服务器拿着这个 token 去读写**用户自己的** Notion 数据库，返回结果，然后什么都不留。
这台服务器提供的只有两样东西：一份 schema，和一条通路。

换句话说：别人用这个服务，他们的事情落在他们自己的 Notion 里，你看不到，我也看不到。

## 部署（Vercel Hobby，免费）

```bash
cd explorations/shoulder-tap
npm install
npx vercel          # 第一次，跟着提示走
npx vercel --prod
```

环境变量（都是可选的，在 Vercel 项目设置里加）：

| 变量 | 作用 |
| --- | --- |
| `SHOULDER_TAP_KEY` | 设了就必须在 MCP 配置里带 `X-Shoulder-Tap-Key` 头。只用来挡路人蹭你的 Vercel 额度，跟用户数据无关。 |
| `TIMEZONE_OFFSET_HOURS` | 没传 `day` 参数时按这个时区算「今天」。默认 8（北京）。 |

不需要数据库，不需要 Redis，不需要常驻容器。

## 接上

1. <https://www.notion.so/profile/integrations> 建一个 internal integration，拿 `ntn_…` 密钥。
2. 随便挑一个 Notion 页面，⋯ → **Connections** → 把这个 integration 加进去。（漏这步必报 `object_not_found`。）
3. 装 MCP：

   ```bash
   claude mcp add --transport http shoulder-tap https://<你的部署>.vercel.app/api/mcp \
     -s user -H "Authorization: Bearer ntn_你的密钥"
   ```

4. 让模型调用 `setup`，把第 2 步那个页面的链接给它 —— 它会在那底下建好「Shoulder Tap」数据库。
5. 把 `skill/shoulder-tap/` 拷到 `~/.claude/skills/`，把 `skill/CLAUDE.md.snippet` 的内容粘进
   `~/.claude/CLAUDE.md`。**这一步不做，gatekeeping 不会自动发生**（skill 只在被触发时加载）。

## 工具

| 工具 | 干什么 |
| --- | --- |
| `check_focus(activity?)` | **拦路的那个。** 返回今天的清单、当前该做哪条，以及一段给模型的判断规则：相关就放行，不相关就停下来问人。 |
| `set_focus(tasks[])` | 按先后顺序记下今天要做的事，覆盖今天已有的。 |
| `add_focus(task, position?)` | 插一条，可以插队。 |
| `complete_focus(position, dropped?)` | 勾掉，或者放弃。 |
| `setup(notion_page)` | 第一次在用户的 Notion 里建库。 |

语义判断是**调用方的模型**做的，服务端不跑任何模型、不花任何 token。
服务端只负责把「今天说好的事」和一段明确的判断规则摆到模型面前。

## Notion 里的结构

数据库「Shoulder Tap」，一行一条：

| 字段 | 类型 | |
| --- | --- | --- |
| Task | title | 步骤本身 |
| Order | number | 第几条，顺序就是靠它 |
| Status | select | Pending / Done / Dropped |
| Day | date | 哪一天 |
| Note | rich_text | 执行细节 |

建完就是普通的 Notion 数据库，你可以自己加视图、加字段、在手机上改。

## 本地跑

```bash
npm run dev
# 另开一个终端
npx @modelcontextprotocol/inspector
# Streamable HTTP → http://localhost:3000/api/mcp
# Authentication → Bearer Token → 填你的 ntn_ 密钥
```

## 代码

| 文件 | |
| --- | --- |
| `app/api/mcp/route.ts` | 工具定义 + Bearer 鉴权 |
| `lib/render.ts` | **那段给模型看的判断规则**，产品其实就是这个文件 |
| `lib/focus.ts` | Notion 上的读写：建库、查当天、排序、勾掉 |
| `lib/notion.ts` | Notion REST 薄封装（API 版本 2025-09-03） |
| `skill/` | 本地 Claude Code skill（登录入口）+ 全局 CLAUDE.md 片段 |
