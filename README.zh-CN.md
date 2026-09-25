<div align="center">

<img src="docs/hands-banner.gif" alt="Shoulder Tap：tap tap、pat pat、snap" width="760">

<h1>Shoulder Tap</h1>

<p><b>Go do your thing. We’ll tap you.</b></p>

<a href="README.md"><img alt="English" src="https://img.shields.io/badge/English-6e7681?style=for-the-badge"></a> <a href="README.zh-CN.md"><img alt="中文" src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87-0e7c7b?style=for-the-badge"></a>

</div>

<br>

## 这是什么

你告诉模型今天要做什么。之后你每想干点别的，它在动手之前先拍你一下肩膀。

它每做完一轮，屏幕边上会伸出一只手，用一句话告诉你它刚做了什么。所以它干活的时候你可以走开。

<p align="center"><img src="docs/demo-v3.gif" alt="在打游戏的时候 Claude 做完了，屏幕边上的像素手打个响指，带一句总结" width="640"></p>

<p align="center"><img src="docs/overview.png" alt="左：聊天结尾的响指和 tap tap。右：你在 Photoshop 里干活，屏幕边上弹出喝水提醒和任务总结" width="760"></p>

不是 todo app——todo app 要你主动打开，而你跑偏的时候恰恰不会打开它。
这个挂在你已经在用的 Claude Code / Codex 上。

> **你的所有习惯 + 要做的事情的数据不上云。**
> shoulder-tap 没有服务器：数据要么在这台机器的一个 JSON 文件里，要么在你自己的 Notion 里（这台机器直接连）。

<br>

## 一、装

> [!TIP]
> **建议让你的 coding agent 帮你装。** 把这句贴给 Claude Code 或 Codex：
>
> ```
> 帮我装 https://github.com/FranklinXuNorth/shoulder-tap。照着它的 README 来，脚本跑完后打开设置页，告诉我那五步是什么。
> ```
>
> 它会检查 Node / .NET / Xcode 工具、跑脚本、哪步失败就修哪步。想自己动手就往下看。

需要 Node 20+。屏幕上那只手是可选的：Windows 要 .NET 10 SDK，macOS 要 Xcode 命令行工具（`xcode-select --install`）；没有也照常用，拍肩落在聊天里。

```bash
git clone https://github.com/FranklinXuNorth/shoulder-tap.git
cd shoulder-tap
node install.mjs
```

**脚本只做了一半。** 它装的是 skill、钩子、CLAUDE.md 那一节和桌面端；**MCP 它不接**，习惯和今天的事它也不知道。剩下的都在一个只给本机看的设置页上点：

```
http://127.0.0.1:47823/#setup
```

这一页怎么出来，三个系统不一样：

| | 设置页 | 没自己打开的话 |
| --- | --- | --- |
| **Windows** | 托盘图标起来后自己打开 | 点托盘图标，或直接开上面这个地址 |
| **macOS** | 菜单栏图标起来后自己打开 | 点菜单栏图标，或直接开上面这个地址 |
| **Linux** | 还没有桌面端，`install.mjs` 自己打开 | `node ~/.claude/skills/shoulder-tap/onboard.mjs --setup` |

> **如果是模型在替人装：** 把上面那个地址原样贴进聊天里，并说清这五步是什么，告诉他 Notion 那步可以跳过（跳过就存在本机）。脚本跑完一声不吭，用户会以为已经装好了，其实只装了一半。这五步让他自己点 —— 习惯和今天要做的事别替他填。

<br>

## 二、设置页

装完浏览器会打开设置页（只有本机能访问，地址是 `http://127.0.0.1:47823/#setup`）。五步，每步都能跳过：

1. **接上编程工具** —— 点「接上」，把 shoulder-tap 接进 Claude Code / Codex。Claude Desktop、OpenClaw、Hermes 也能在这里接，只有工具（见下）。
   不想点按钮：展开「想自己动手」，有一段可以直接复制给你的 coding agent 的说明。
   macOS 上显示 Claude Code **没找到**、但你确实装了：设置页由菜单栏那个 app 打开，看不到你 shell 的 PATH。展开「想自己动手」，把那条命令拿到终端里跑。
   然后重开一次 Claude Code 会话：`/mcp` 里能看到 `shoulder-tap`，`/hooks` 里能看到四个钩子。
2. **第一个习惯** —— 名字你自己定。
   **软习惯**（喝水）简单，所以不能跳，提醒到你做了为止。
   **硬习惯**（健身）看当天情况，可以说「今天不做」。
3. **今天要做的事** —— 一行一件，按先后顺序。
4. **数据放哪** —— 就放这台机器（默认，什么都不用配），或者你自己的 Notion（手机上也能看）。**Notion 不是必须的：**跳过这步，数据就存在本机，以后想换再回来设。
5. **手** —— 看三种手势的动作，选一套样式（手套或猫爪），在桌面上真拍一下试试。

之后随时回来：点 Windows 托盘 / macOS 菜单栏的图标，或者：

```bash
node ~/.claude/skills/shoulder-tap/onboard.mjs
```

引导最后一步是「试一下」：几句可以直接贴进 Claude Code 的话，看它怎么反应。

设置完之后，同一个图标打开的是首页：**重新走一遍设置**、**选择皮肤**，下面是你的记录 —— 最近两周的待办、在盯的习惯、习惯的历史。右上角可以切中英文。

<br>

## 三、用

在 Claude Code 里说：

- 「今天要做 A、B、C」 —— 记下清单
- 「每 60 分钟提醒我喝水」 —— 加一个习惯
- 「喝了水」「今天不健身了」 —— 记一笔 / 跳过
- 「这周喝了几次水」 —— 看历史

然后正常干活。你一跑偏，回答末尾会有只手，桌面上也会拍你一下。

<br>

## 不跑脚本，手动装

不想让脚本动 `~/.claude` 的话，一步步自己敲。

> [!IMPORTANT]
> **路径按你自己的系统写。** 下面的命令是 macOS / Linux 终端的写法。Windows 请在 **Git Bash** 里跑（装 Git for Windows 就有，Windows 上的 Claude Code 本来也要它），别用 PowerShell。配置文件（TOML / JSON / YAML）里要写 `mcp.mjs` 的**完整路径**，三个系统不一样：
>
> | | `mcp.mjs` 的完整路径 |
> | --- | --- |
> | **macOS** | `/Users/你的用户名/.claude/skills/shoulder-tap/mcp.mjs` |
> | **Linux** | `/home/你的用户名/.claude/skills/shoulder-tap/mcp.mjs` |
> | **Windows** | `C:/Users/你的用户名/.claude/skills/shoulder-tap/mcp.mjs`（用正斜杠；要用反斜杠就得写两个：`C:\\Users\\…`） |
>
> 下面的例子用的是 macOS 的路径。

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

   这个文件在哪：macOS `~/Library/Application Support/Claude/`，Windows `%APPDATA%\Claude\`（商店版：`%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\`）。

   OpenClaw（龙虾）：

   ```bash
   openclaw mcp add shoulder-tap --command node --arg /Users/你/.claude/skills/shoulder-tap/mcp.mjs
   ```

   Hermes Agent：在 `~/.hermes/config.yaml` 的 `mcp_servers` 下面加，然后重开 Hermes 或在里面打 `/reload-mcp`：

   ```yaml
   mcp_servers:
     shoulder-tap:
       command: "node"
       args: ["/Users/你/.claude/skills/shoulder-tap/mcp.mjs"]
   ```

   Claude Desktop、OpenClaw、Hermes 都没有钩子、不读 CLAUDE.md，所以只有工具：不会自己拦你、拍你，你说「看下今天的清单」「喝完水了」它们才调。

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

   **Windows**（要 .NET 10 SDK）：

   ```bash
   dotnet publish desktop -c Release -o "$HOME/.claude/shoulder-tap/app"
   ```

   **macOS**（要 Xcode 命令行工具）：

   ```bash
   APP=~/.claude/shoulder-tap/app/ShoulderTap.app
   mkdir -p $APP/Contents/{MacOS,Resources}
   xcrun -sdk macosx swiftc -O desktop-mac/ShoulderTap.swift -o $APP/Contents/MacOS/shoulder-tap-tap
   cp skill/shoulder-tap/ui/sprites/skins/glove/{tap,pat,snap}.png $APP/Contents/Resources/
   cp desktop-mac/Info.plist $APP/Contents/
   ```

   跑一下那个可执行文件，它就常驻在托盘 / 菜单栏了。

6. **设置页** —— 最容易漏、漏了整个东西就不工作：`node ~/.claude/skills/shoulder-tap/onboard.mjs --setup`，或者直接开 `http://127.0.0.1:47823/#setup`。三个系统都一样。

<br>

## 桌面端

屏幕右缘那只手：**响指**（这轮做完了）、**拍拍**（模型在等你回答）、**taptap**（跑偏了 / 习惯到点了）。

- **Windows**：托盘常驻，开机自启。取消自启：
  `Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name shoulder-tap`
- **macOS**：菜单栏常驻，登录自启。取消：
  `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.shoulder-tap.tap.plist`
  手出来了但不动？系统的**减弱动态效果**（系统设置 → 辅助功能 → 显示）开着，这里会尊重它：手停在伸得最远的那一帧，不逐帧播。想照常看动画，在 `~/.claude/shoulder-tap/config.json` 里写 `"motion": "always"`。
- **Linux**：还没有，接口约定在 [desktop-linux/README.md](desktop-linux/README.md)。

三个平台都从 `~/.claude/skills/shoulder-tap/ui/sprites/skins/<样式>/` 读手的图，想画一套自己的看那里的 README。

<br>

## 卸载

```bash
node ~/.claude/skills/shoulder-tap/uninstall.mjs          # 数据留着
node ~/.claude/skills/shoulder-tap/uninstall.mjs --purge  # 数据和密钥也删
```

三个平台一样：桌面端退出并取消自启、MCP（Claude Code、Codex、Claude Desktop、OpenClaw、Hermes）、钩子、CLAUDE.md 那一节、skill，全部还原。Notion 里的库不动。
也可以直接跟 Claude Code 说「卸载 shoulder-tap」，它知道跑这条。

<br>

## 什么会离开这台机器

| 什么 | 去哪 | 什么时候 |
| --- | --- | --- |
| 任务、习惯 | 你自己的 Notion | 只有你选了 Notion |
| 其它一切 | 哪儿也不去 | — |

<br>

## 更多

- 每一块是什么、数据长什么样：[docs/architecture.html](docs/architecture.html)
- 一次拍肩怎么走、三档判断、习惯的规则：[docs/flow.html](docs/flow.html)
- 跨设备（一台机器跑完、拍到你正盯着的另一台上）：[`cross-machine`](../../tree/cross-machine) 分支，还在测，这一版不带

<br>

## 许可

代码是 MIT。手和猫爪的美术（`skill/shoulder-tap/ui/sprites/` 里的图片和 Aseprite 文件，以及 `docs/hands-banner.gif`）是 CC BY-NC-ND 4.0：可以原样、非商用地分享，不能拿去卖，也不能改了再发。「Shoulder Tap」这个名字不在授权范围内，用这份代码做的产品要换自己的名字和美术。详见 [LICENSE](LICENSE)。
