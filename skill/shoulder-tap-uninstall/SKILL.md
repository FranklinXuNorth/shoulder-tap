---
name: shoulder-tap-uninstall
description: 卸载 shoulder-tap。当用户说「卸载 shoulder-tap」「把 shoulder-tap 删了」「不要拍肩了」时使用。
---

# 卸载 shoulder-tap

一条命令，三个平台一样：

```bash
node ~/.claude/skills/shoulder-tap/uninstall.mjs
```

它会：请桌面端退出并取消开机自启、去掉 MCP（Claude Code 和 Codex）、去掉四个钩子、
删掉 CLAUDE.md 里「## 专注」那一节、删掉 skill 目录。

**用户的数据默认留着**（`~/.claude/shoulder-tap/data.json`、`config.json`、Notion 密钥）。
他明确说数据也不要了，再加 `--purge`。Notion 里那个库无论如何不动。

跑完告诉他重开一次会话。不要替他做决定：他只说「先别拍了」，那是退出桌面端（托盘 / 菜单栏「退出」），
不是卸载。
