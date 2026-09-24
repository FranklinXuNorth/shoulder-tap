![shoulder-tap：tap tap、pat pat、snap](docs/hands-banner.gif)

[English](README.md) | **中文**

# shoulder-tap 👀

你告诉模型今天要做什么。之后你每想干点别的，它在动手之前先拍你一下肩膀。

不是 todo app——todo app 要你主动打开，而你跑偏的时候恰恰不会打开它。
这个挂在你已经在用的 Claude Code / Codex 上。

> **你的所有习惯 + 要做的事情的数据不上云。**
> shoulder-tap 没有服务器：数据要么在这台机器的一个 JSON 文件里，要么在你自己的 Notion 里（这台机器直接连）。

## 一、装

需要 Node 20+。屏幕上那只手是可选的：Windows 要 .NET 10 SDK，macOS 要 Xcode 命令行工具（`xcode-select --install`）；没有也照常用，拍肩落在聊天里。

```bash
git clone https://github.com/FranklinXuNorth/shoulder-tap.git
cd shoulder-tap
node install.mjs
```

## 二、设置页

装完浏览器会打开设置页（只有本机能访问）。五步，每步都能跳过：

1. **接上编程工具** —— 点「接上」，把 shoulder-tap 接进 Claude Code / Codex。Claude Desktop 也能在这里接，只有工具（见下）。
   不想点按钮：展开「想自己动手」，有一段可以直接复制给你的 coding agent 的说明。
2. **第一个习惯** —— 名字你自己定。**软习惯**是简单、随手就能做的（喝水这种），正因为简单所以不能跳过，到点就提醒到你做了为止；**硬习惯**受当天情况影响大（健身这种），可以说「今天不做」。
3. **今天要做的事** —— 一行一件，按先后顺序。
4. **数据放哪** —— 就放这台机器（默认，什么都不用配），或者你自己的 Notion（手机上也能看）。
5. **手** —— 看三种手势的动作，选一套样式（手套或猫爪），在桌面上真拍一下试试。

之后随时回来：点 Windows 托盘 / macOS 菜单栏的图标，或者：

```bash
node ~/.claude/skills/shoulder-tap/onboard.mjs
```

引导最后一步是「试一下」：几句可以直接贴进 Claude Code 的话，看它怎么反应。

设置完之后，点托盘 / 菜单栏图标打开的是首页：两个按钮，**重新走一遍设置** 和 **选择皮肤**（预览三种手势、桌面上真拍一下）。下面是所有记录：最近两周的待办按天排（今天的能点完成 / 今天不做）、在盯的习惯（记一笔 / 今天不做）、习惯的历史。
右上角可以切中英文。

重开一次 Claude Code 会话，就接上了。`/mcp` 里能看到 `shoulder-tap`，`/hooks` 里能看到四个钩子。

## 三、用

在 Claude Code 里说：

- 「今天要做 A、B、C」 —— 记下清单
- 「每 60 分钟提醒我喝水」 —— 加一个习惯
- 「喝了水」「今天不健身了」 —— 记一笔 / 跳过
- 「这周喝了几次水」 —— 看历史

然后正常干活。你一跑偏，回答末尾会有只手，桌面上也会拍你一下。

## 不跑脚本，手动装

不想让脚本动 `~/.claude` 的话，一步步自己敲：

1. **skill**：把 `skill/shoulder-tap/` 拷到 `~/.claude/skills/shoulder-tap/`。

   ```bash
   mkdir -p ~/.claude/skills && cp -r skill/shoulder-tap ~/.claude/skills/
   ```

2. **MCP**：

   ```bash
   claude mcp add -s user shoulder-tap -- node ~/.claude/skills/shoulder-tap/mcp.mjs
   ```

   Codex 在 `~/.codex/config.toml` 里加：

   ```toml
   [mcp_servers.shoulder-tap]
   command = "node"
   args = ["/Users/你/.claude/skills/shoulder-tap/mcp.mjs"]
   ```

   Claude Desktop（聊天那个 App）：在 `claude_desktop_config.json` 里加（设置 → Developer → Edit Config），然后彻底退出再打开：

   ```json
   "mcpServers": {
     "shoulder-tap": { "command": "node", "args": ["/Users/你/.claude/skills/shoulder-tap/mcp.mjs"] }
   }
   ```

   Claude Desktop 没有钩子、不读 CLAUDE.md，所以只有工具：不会自己拦你、拍你，你说「看下今天的清单」「喝完水了」它才调。

3. **钩子**：在 `~/.claude/settings.json` 里加（文件没有就新建）：

   ```json
   {
     "hooks": {
       "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/shoulder-tap/watch.mjs\"", "timeout": 10 }] }],
       "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/shoulder-tap/watch.mjs\"", "timeout": 10 }] }],
       "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/shoulder-tap/watch.mjs\"", "timeout": 10 }] }],
       "PreToolUse":       [{ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/shoulder-tap/watch.mjs\"", "timeout": 10 }] }]
     }
   }
   ```

4. **CLAUDE.md**：

   ```bash
   cat skill/CLAUDE.md.snippet >> ~/.claude/CLAUDE.md
   ```

5. **桌面端**（可选）：

   ```bash
   # Windows
   dotnet publish desktop -c Release -o "$HOME/.claude/shoulder-tap/app"
   # macOS
   APP=~/.claude/shoulder-tap/app/ShoulderTap.app
   mkdir -p $APP/Contents/{MacOS,Resources}
   xcrun -sdk macosx swiftc -O desktop-mac/ShoulderTap.swift -o $APP/Contents/MacOS/shoulder-tap-tap
   cp skill/shoulder-tap/ui/sprites/skins/glove/{tap,pat,snap}.png $APP/Contents/Resources/
   cp desktop-mac/Info.plist $APP/Contents/
   ```

   跑一下那个可执行文件，它就常驻在托盘 / 菜单栏了。

6. **设置页**：`node ~/.claude/skills/shoulder-tap/onboard.mjs --setup`。

## 桌面端

屏幕右缘那只手：**响指**（这轮做完了）、**拍拍**（模型在等你回答）、**taptap**（跑偏了 / 习惯到点了）。

- **Windows**：托盘常驻，开机自启。取消自启：
  `Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name shoulder-tap`
- **macOS**：菜单栏常驻，登录自启。取消：
  `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.shoulder-tap.tap.plist`
- **Linux**：还没有，接口约定在 [desktop-linux/README.md](desktop-linux/README.md)。

三个平台都从 `~/.claude/skills/shoulder-tap/ui/sprites/skins/<样式>/` 读手的图，想画一套自己的看那里的 README。

## 卸载

```bash
node ~/.claude/skills/shoulder-tap/uninstall.mjs          # 数据留着
node ~/.claude/skills/shoulder-tap/uninstall.mjs --purge  # 数据和密钥也删
```

三个平台一样：桌面端退出并取消自启、MCP（Claude Code、Codex、Claude Desktop）、钩子、CLAUDE.md 那一节、skill，全部还原。Notion 里的库不动。
也可以直接跟 Claude Code 说「卸载 shoulder-tap」，它知道跑这条。

## 什么会离开这台机器

| 什么 | 去哪 | 什么时候 |
| --- | --- | --- |
| 任务、习惯 | 你自己的 Notion | 只有你选了 Notion |
| 其它一切 | 哪儿也不去 | — |

## 更多

- 每一块是什么、数据长什么样：[docs/architecture.html](docs/architecture.html)
- 一次拍肩怎么走、三档判断、习惯的规则：[docs/flow.html](docs/flow.html)
- 跨设备（一台机器跑完、拍到你正盯着的另一台上）：[`cross-machine`](../../tree/cross-machine) 分支，还在测，这一版不带
