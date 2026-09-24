---
name: shoulder-tap
description: 接上 shoulder-tap（设置页、MCP、存储），以及在用户跑偏时把他拉回来。当用户说「设置 shoulder-tap」「接上 shoulder-tap」「设置一下专注」，或者 shoulder-tap 的工具报 not_set_up 时使用。
---

# shoulder-tap

用户今天说好要做的事、要盯的习惯，存在**他自己机器上**（`~/.claude/shoulder-tap/data.json`），
或者**他自己的 Notion** 里。shoulder-tap 没有服务器替他存任何东西。

## 还没接上时

所有设置都在设置页里点：

```bash
node ~/.claude/skills/shoulder-tap/onboard.mjs
```

它会在浏览器里打开一个只给本机看的页面，四步：接上 Claude Code / Codex 的 MCP → 第一个习惯 →
今天要做的事 → 数据放哪。让用户自己点，不要替他填习惯和任务。

想直接在终端接 MCP（本机 stdio，不经过任何服务器）：

```bash
claude mcp add -s user shoulder-tap -- node ~/.claude/skills/shoulder-tap/mcp.mjs
```

接完告诉他重开一次会话让工具生效。

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
