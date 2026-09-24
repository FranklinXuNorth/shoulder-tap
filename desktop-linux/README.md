# shoulder-tap Linux 桌面端 —— 接口约定

还没有 Linux 桌面端。这份文档是给动手写它的人的：把下面的约定照做，`watch.mjs` 和 `install.mjs`
都不用改，装上就能用。钩子、本机 MCP、设置页都是 Node，在 Linux 上**已经能用**；缺的只是屏幕上那只手。

先读 [desktop/README.md](../desktop/README.md)（Windows 版，行为的原型）和
[desktop-mac/ShoulderTap.swift](../desktop-mac/ShoulderTap.swift)（单文件，最容易照抄结构）。

## 放在哪、叫什么

- 可执行文件：`~/.claude/shoulder-tap/app/shoulder-tap-tap`。`watch.mjs` 在 Linux 上找这个路径，找不到就安静地只在聊天里拍。
  想放别处，`.env` 里 `SHOULDER_TAP_APP=` 指过去。
- 三张 sprite sheet 从皮肤目录读：`~/.claude/skills/shoulder-tap/ui/sprites/skins/<皮肤>/` 下的
  `tap.png`（taptap）、`pat.png`（拍拍）、`snap.png`（响指）。皮肤名读 `~/.claude/shoulder-tap/config.json` 的 `skin`，
  没有就是 `glove`（[内置那套](../skill/shoulder-tap/ui/sprites/skins/glove/)）。**每次拍之前重读**，用户在设置页换了皮肤不用重启。
  每张 864×80，横排 9 帧，每帧 96×80，只有黑、白、透明。
- 语言随意。X11 上 Python + GTK/Tk 都够；Wayland 上要 layer-shell（gtk4-layer-shell），普通窗口置不了顶也做不了穿透。
  最好一份代码两边都能跑，实在不行先只做 X11，README 里写清楚。

## 命令行（跟 Windows / Mac 一字不差）

```
shoulder-tap-tap --mode tap      --text "..." --caption "..." --session S --source-pid P
shoulder-tap-tap --mode complete              --caption "..." --session S --source-pid P
shoulder-tap-tap --mode snap     --text "..." --caption "..." --session S --source-pid P
shoulder-tap-tap --mode bind     --session S --source-pid P      # 每次用户开口时调一次：把常驻进程拉起来
shoulder-tap-tap --quit
shoulder-tap-tap                                                  # 不带参数 = 常驻，不拍
```

| 参数 | 含义 |
| --- | --- |
| `--mode` | `tap`（taptap，提醒）、`complete`（拍拍，模型弹了问题在等你）、`snap`（响指，这一轮做完了）、`bind`（只是拉起常驻）、不认识的一律忽略 |
| `--text` | 这次拍肩为了什么。**不上屏**。`tap` 没有它就不拍；`complete` 和 `snap` 不需要它 |
| `--caption` | 唯一上屏的字，贴在手左边，最多 160 字，三行封顶超了省略号 |
| `--session` / `--source-pid` | Windows 用来把拍拍锚到发起的窗口；Linux 可以忽略 |
| `--quit` | 让常驻进程退出 |

**永远立刻返回**（0.2 秒内）。调用方是一个等退出码的钩子进程，卡住它就是卡住用户。
常驻在跑就把请求交过去；不在就派一个常驻出去再交（Mac 版用 `flock` 锁 + `DistributedNotificationCenter`，
Linux 用 `flock` 锁 + Unix domain socket 或 D-Bus 都行）。

## 屏幕上长什么样

- 一层透明覆盖层，内容贴屏幕**右缘**。不抢焦点、鼠标穿透、不进任务栏和 Alt+Tab、永远置顶。
- 拍在**前台窗口所在的那块屏**上，不是主屏，也不是鼠标所在的屏。
- 两条道，可以同时在屏上：`tap` 挂在屏幕高度 30% 处，`snap` 和 `complete` 挂在 52% 处。每条道一个队列，一次播一个。
- 手 288×240（96×80 放大三倍，最近邻，不能插值）。字条在手左边，白底黑框 2px，黑字。
- 帧时序（毫秒，每帧的**结束**时刻）：
  - `tap` / `complete`：`250, 340, 430, 580, 670, 760, 910, 1000, 1300`
  - `snap`：`250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250`（两张图来回切）
- 播完停到 3.3 秒（`snap` 到 4.25 秒），0.24 秒淡出，收。系统关了动画就静止显示同样时长。
- 深浅色跟系统：浅色 墨 `#181818` 纸 `#FFFFFF`，深色 墨 `#FAFAFA` 纸 `#171717`。

## 开机自启

写一个 `~/.config/autostart/shoulder-tap.desktop`（`Exec=<可执行文件>`，不带参数 = 常驻不拍）。
`install.mjs` 在 Linux 上现在只打印这份文档的路径，桌面端做好之后再把编译和自启加进去。

## 验收

1. `shoulder-tap-tap --mode tap --text x --caption "你好"` 0.2 秒内返回，屏幕右缘 30% 处出现手和字条，3.5 秒后消失。
2. 连发一个 `complete` 和一个 `snap`，两只手同时在屏上，不重叠。
3. 一次都不抢焦点：正在打字的窗口光标不丢。
