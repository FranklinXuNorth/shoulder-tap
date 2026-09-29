---
name: shoulder-tap
description: 接上 shoulder-tap（设置页、MCP、存储、跨机器同步登录），以及在用户跑偏时把他拉回来。当用户说「设置 shoulder-tap」「接上 shoulder-tap」「设置一下专注」「更新 shoulder-tap」「登录 shoulder-tap」「跟另一台机器同步」「切到 sync 分支」，或者 shoulder-tap 的工具报 not_set_up 时使用。
---

# shoulder-tap

用户今天说好要做的事、要盯的习惯，存在**他自己机器上**（`~/.claude/shoulder-tap/data.json`），
或者**他自己的 Notion** 里。shoulder-tap 没有服务器替他存任何东西。

## 还没接上时

所有设置都在设置页里点：

```bash
node ~/.claude/skills/shoulder-tap/onboard.mjs --setup
```

它会在浏览器里打开一个只给本机看的页面（`http://127.0.0.1:47823/#setup`），五步：接上 Claude Code / Codex
的 MCP → 第一个习惯 → 今天要做的事 → 数据放哪 → 手的样式。让用户自己点，不要替他填习惯和任务。

**把这个地址原样贴进聊天里**，别只说「浏览器会打开设置页」：Windows 靠托盘图标、macOS 靠菜单栏图标
自己开，Linux 由脚本开 —— 三个系统都可能没开起来（浏览器没起、点了托盘没反应），用户手上就只剩这个地址。
同时说清这一页要他做什么，否则他会以为装完就完事了。

想直接在终端接 MCP（本机 stdio，不经过任何服务器）：

```bash
claude mcp add -s user shoulder-tap -- node ~/.claude/skills/shoulder-tap/mcp.mjs
```

接完 MCP 只是第一步：跑一次上面的 `onboard.mjs` 把设置页打开，让他自己填习惯、今天的事、数据放哪。
然后告诉他重开一次会话让工具生效。

## 更新

用户说「更新 shoulder-tap」，或者钩子提示有新版本、用户说好：跑

```bash
node ~/.claude/skills/shoulder-tap/update.mjs
```

它在装的时候那个仓库里 `git pull`，再重跑 `install.mjs`；数据和设置不动。跑完告诉用户重开一次会话。
报「找不到仓库」就照它说的：重新 clone 再跑 `node install.mjs`。
它拉的是仓库**当前所在的分支**：切到 `sync` 分支之后，以后每次更新都拉 `origin/sync`。

## 跨机器同步（一条龙：更新 → 登录 → 自动同步全部记录）

用户说「登录 shoulder-tap」「跟另一台机器同步」「切到 sync 分支」，或者要在一台新机器上接上他已有的数据时。
三种存数据的方式，按他的意思选，别替他选：只用一台机器 → 本地，什么都不用做；自己用 Notion 同步 →
设置页第 4 步选 Notion；信得过 shoulder-tap → 登录下面这条（登录同一个账号就同步，不用记口令；
数据在云端加密存放，但钥匙由 shoulder-tap 服务端保管，所以不是端到端加密 —— 他在意这个就照实说）。
不登录什么都照常能用：登录只是多开一条同步的路。

**你来做**（仓库位置在 `~/.claude/shoulder-tap/config.json` 的 `repo` 里）：

```bash
git -C "<repo>" fetch origin
git -C "<repo>" switch sync          # 第一次切会自动跟踪 origin/sync；已经在 sync 上就跳过
node ~/.claude/skills/shoulder-tap/update.mjs   # 拉 origin/sync 的最新版，装上新的 skill 和钩子；数据和设置不动
```

别用裸的 `node install.mjs` 更新已经装过的机器：它会接着打开设置页，没有桌面端时还会挂着一个服务，把你的 shell 卡住。
仓库里有没提交的改动、`switch` 失败：照实告诉他，别 stash、别 reset。

**登录**，两种都行：
- 有桌面的机器：告诉他打开设置页 `http://127.0.0.1:47823/`，点**右上角「登录」**，在弹出的浏览器页里用邮箱或 Google 登录。
  回到设置页就已经在同步了，没有第二步。
- 只有终端的机器（服务器上的 OpenClaw 之类），或者他想让你代劳：你在后台跑
  `node ~/.claude/skills/shoulder-tap/login.mjs`，把它打印的链接原样贴给他，让他在浏览器里登录；它等到了就自己接上同步。
  不需要任何输入。**不要**替他填邮箱、密码。

登录之后会自动做完这些：拿到这个账号的同步密钥；这台原来用 Notion 的话，把 Notion 里的全部记录搬到本地
（Notion 里的原样留着）；立刻同步一次；在后台挂上推送监听（`listen.mjs`），别的机器一改这台马上跟上 ——
钩子每次他开口时都会检查它在不在，不用手动起。开着的会话不用重开。

登完你调一次 `check_focus` 确认清单和习惯都在。两台机器以前各有记录也没关系：任务取并集，
同名习惯（两台都有「喝水」）自动并成一个，两边的打卡都留着；两台改了同一条，留最后改的那次。

查看 / 退出：设置页右上角的邮箱菜单（打开云端版 / 立即同步 / 退出登录），或者 `login.mjs --status`、`login.mjs --logout`。退出后本机数据都在。
手机或没装 shoulder-tap 的电脑：云端网页版 https://sync.example/app ，登录同一个账号就是同一份。

## 工具

| 工具 | 什么时候用 |
| --- | --- |
| `check_focus(activity?)` | 动手做实质性的事之前。返回今天的清单、当前那条、该怎么处理他现在想做的事、到点的习惯 |
| `set_focus(tasks)` | 他说「今天要做 A、B、C」或要重排 |
| `add_focus(task, position?)` | 他明确要插一条 |
| `complete_focus(position, dropped?)` | **只有他明确说完成了**才调；你觉得做完了最多问一句 |
| `add_habit(name, kind, every_minutes \| at)` | 他要盯一个习惯。`kind`：`soft` 简单随手就能做，所以不许跳过（喝水）；`hard` 受当天情况影响大，可以说今天不做（健身）。拿不准就问他 |
| `log_habit(habit, skip?, note?)` | 他说做了；说今天不做就带 `skip: true` 和原因。软习惯会被拒绝，照实告诉他 |
| `stop_habit(habit)` | 他明确说以后不用盯了。说「今天不做」不是这个 |
| `habit_history(habit?)` | 他问「这周喝了几次水」「上次健身是什么时候」 |
| `setup(notion_page)` | 只在用了 Notion 存储、而 `check_focus` 报 `not_set_up` 时 |

时区默认读这台机器的，不用传。**不要替他记**：他没说做，就是没做。

## 介入长什么样

判成 unrelated 时：**照做，别拦他**，但把回答压到两句话以内。然后在回答的**最末尾**原样打出那只
ASCII 手（`check_focus` 的返回里有），加一句话点名今天说好的那条还没动。

- 一句就好。不问问题、不等回答、不要他解释 —— 他不欠你一个理由。
- **只要那条没完成，每一轮都提。** 烦在频率，不在长度。
- 他改优先级、说那条做完了、或者说今天不做了，就不用再提。
  他说「别烦我」只管这一轮；说「今天都别提了」才算整天。

习惯提醒用同一只手，语气更轻，在停顿处带一句就走。

拦是为了让他想起来，不是为了教育他。他说「无视」就无视 —— 能被说服是故意的设计，
真锁住他，他下次就不装这个东西了。
