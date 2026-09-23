// shoulder-tap 的 macOS 桌面端。一个文件，swiftc 直接编：
//
//     swiftc -O desktop-mac/ShoulderTap.swift -o ~/.claude/shoulder-tap/app/shoulder-tap-tap
//
// 跟 Windows 版同一套参数（--mode tap|complete，--caption），但不常驻：
// 每拍一下就是一个短命进程，播完 3.75 秒自己退出。taptap 和拍拍同时来就是两个进程，
// 各挂各的高度（40% / 62%），天然两条道，不需要单实例和队列。
// 两张 sprite sheet 放在可执行文件旁边。

import AppKit
import ImageIO

let args = CommandLine.arguments
func arg(_ name: String) -> String? {
    guard let i = args.firstIndex(of: "--" + name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

let mode = arg("mode") ?? "tap"
let caption = (arg("caption") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
// bind / today / quit 在 Mac 上没有意义：没有常驻进程可绑、可退。
if args.contains("--quit") || (mode != "tap" && mode != "complete") { exit(0) }

// ---------- 帧 ----------

let here = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
let sheetURL = here.appendingPathComponent(mode == "complete" ? "completion-hand-sheet.png" : "tap-glove-sheet.png")
guard let source = CGImageSourceCreateWithURL(sheetURL as CFURL, nil),
      let sheet = CGImageSourceCreateImageAtIndex(source, 0, nil) else { exit(0) }
let frames = (0..<9).compactMap { sheet.cropping(to: CGRect(x: $0 * 96, y: 0, width: 96, height: 80)) }
guard frames.count == 9 else { exit(0) }
/// 九帧各自的结束时刻（毫秒），和 Windows 版、Aseprite 原稿一致：三次触碰，1.3 秒放完。
let frameEnds = [250, 340, 430, 580, 670, 760, 910, 1000, 1300]

// ---------- 摆在哪块屏 ----------

/// 前台 App 最上面那扇窗所在的屏 —— 你眼睛在的地方，不是鼠标，也不是主屏。
func activeScreen() -> NSScreen {
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    for w in list where (w[kCGWindowLayer as String] as? Int) == 0 && (w[kCGWindowOwnerPID as String] as? Int).map(pid_t.init) == pid {
        guard let dict = w[kCGWindowBounds as String] as? NSDictionary,
              let r = CGRect(dictionaryRepresentation: dict) else { continue }
        // CG 坐标原点在主屏左上角，Cocoa 在左下角，翻一下 y。
        let mid = NSPoint(x: r.midX, y: primaryHeight - r.midY)
        if let s = NSScreen.screens.first(where: { $0.frame.contains(mid) }) { return s }
    }
    return NSScreen.main ?? NSScreen.screens[0]
}

// ---------- 窗口 ----------

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // 不进 Dock，不抢焦点

let hand = NSSize(width: 288, height: 240) // 96×80 三倍，最近邻
let captionMax: CGFloat = 440
let gap: CGFloat = 12
let width = hand.width + gap + captionMax

let work = activeScreen().visibleFrame
let fromTop: CGFloat = mode == "complete" ? 0.62 : 0.40 // 两条道，同时出现也不重叠
let centerY = work.maxY - work.height * fromTop
let frame = NSRect(x: work.maxX - width, y: centerY - hand.height / 2, width: width, height: hand.height)

let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
panel.isOpaque = false
panel.backgroundColor = .clear
panel.hasShadow = false
panel.level = .statusBar
panel.ignoresMouseEvents = true // 鼠标穿透
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

let root = NSView(frame: NSRect(origin: .zero, size: frame.size))
root.wantsLayer = true
panel.contentView = root

let handLayer = CALayer()
handLayer.frame = CGRect(x: width - hand.width, y: 0, width: hand.width, height: hand.height)
handLayer.magnificationFilter = .nearest
handLayer.contents = frames[0]
root.layer?.addSublayer(handLayer)

// 手左边那一小条字：拍拍放这轮的总结，taptap 放提醒。最多三行，超了省略号。
if !caption.isEmpty {
    let label = NSTextField(wrappingLabelWithString: caption)
    label.font = .systemFont(ofSize: 14)
    label.textColor = .black
    label.maximumNumberOfLines = 3
    label.lineBreakMode = .byTruncatingTail
    let inner = captionMax - 24
    label.preferredMaxLayoutWidth = inner
    let fit = label.sizeThatFits(NSSize(width: inner, height: 66))
    let w = min(fit.width, inner), h = min(fit.height, 66)
    let box = NSView(frame: NSRect(x: width - hand.width - gap - (w + 24), y: (hand.height - (h + 15)) / 2, width: w + 24, height: h + 15))
    box.wantsLayer = true
    box.layer?.backgroundColor = NSColor.white.cgColor
    box.layer?.borderColor = NSColor.black.cgColor
    box.layer?.borderWidth = 2
    box.layer?.cornerRadius = 6
    label.frame = NSRect(x: 12, y: 7, width: w, height: h)
    box.addSubview(label)
    root.addSubview(box)
}

panel.orderFrontRegardless()

// ---------- 时间轴：1.3 秒帧动画，停两秒，0.24 秒淡出，退出 ----------

let start = Date()
if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
    Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { timer in
        let ms = Int(Date().timeIntervalSince(start) * 1000)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        handLayer.contents = frames[frameEnds.firstIndex(where: { ms < $0 }) ?? 8]
        CATransaction.commit()
        if ms >= 1300 { timer.invalidate() }
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 3.3) {
    NSAnimationContext.runAnimationGroup({ ctx in
        ctx.duration = 0.24
        panel.animator().alphaValue = 0
    }, completionHandler: { exit(0) })
}
// 兜底：动画回调万一没来，也别留一个进程在后台。
DispatchQueue.main.asyncAfter(deadline: .now() + 5) { exit(0) }

app.run()
