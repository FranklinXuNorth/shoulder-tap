// shoulder-tap 的 macOS 桌面端。一个文件，swiftc 直接编；install.mjs 会把它包成一个
// 只有菜单栏图标的 .app（LSUIElement），并注册成登录时自启的 LaunchAgent。
//
//     swiftc -O desktop-mac/ShoulderTap.swift -o .../ShoulderTap.app/Contents/MacOS/shoulder-tap-tap
//
// 跟 Windows 版同一套命令行（--mode tap|complete|snap|bind|quit，--caption，--text）和同一套行为：
//   · 命令行那一端永远立刻返回：常驻进程在跑就把话交过去，不在就派一个 --daemon 出去再交。
//   · 常驻进程两条道（taptap 在 30% 高；响指、拍拍在 52%），各自排队，可以同时在屏上。
//
// 进程间用 NSDistributedNotificationCenter 交话，单实例用 ~/.claude/shoulder-tap/mac.lock 上的 flock。
// 两张（三张）sprite sheet 在 .app 的 Resources 里；不在 .app 里跑时就找可执行文件旁边。

import AppKit
import Foundation
import ImageIO

// MARK: - 参数

let args = CommandLine.arguments
func arg(_ name: String) -> String? {
    guard let i = args.firstIndex(of: "--" + name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

struct TapRequest: Codable {
    var mode = "tap"
    var session = ""
    var text = ""
    var caption = ""
    var quit = false

    var hasMessage: Bool { mode == "complete" || mode == "snap" || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    static func fromArgs() -> TapRequest {
        var r = TapRequest()
        r.mode = arg("mode") ?? "tap"
        r.session = arg("session") ?? ""
        r.text = arg("text") ?? arg("t") ?? ""
        r.caption = (arg("caption") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        r.quit = args.contains("--quit") || args.contains("--exit")
        return r
    }
}

// MARK: - 路径与配置

let home = FileManager.default.homeDirectoryForCurrentUser
let stateDir = home.appendingPathComponent(".claude/shoulder-tap")
let lockPath = stateDir.appendingPathComponent("mac.lock").path
let notificationName = Notification.Name("shoulder-tap.tap")

func log(_ line: String) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    if let h = FileHandle(forWritingAtPath: NSTemporaryDirectory() + "shoulder-tap-tap.log") {
        h.seekToEndOfFile(); h.write("\(stamp) \(line)\n".data(using: .utf8)!); h.closeFile()
    } else {
        FileManager.default.createFile(atPath: NSTemporaryDirectory() + "shoulder-tap-tap.log", contents: "\(stamp) \(line)\n".data(using: .utf8))
    }
}

// MARK: - 帧

let resourceDir: URL = {
    if let r = Bundle.main.resourceURL, FileManager.default.fileExists(atPath: r.appendingPathComponent("tap.png").path) { return r }
    return URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
}()

// MARK: - 字 和 配色

/// 说明那一条的字：Resources/Fonts 里的像素字体（Info.plist 的 ATSApplicationFontsPath 已让系统注册），
/// 跟 Windows 端同一份 ttf，中英文都在里面。取不到就退回系统字体 —— 字体的事不该让拍肩消失。
let captionFont: NSFont = NSFont(name: "Fusion Pixel 12px Prop zh_hans", size: 16) ?? .systemFont(ofSize: 14)

/// 深色跟随系统，两个颜色跟 Windows 端 ApplySystemTheme 用同一组 hex。
func captionColors() -> (ink: NSColor, paper: NSColor) {
    let dark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    return dark ? (NSColor(white: 0xFA / 255.0, alpha: 1), NSColor(white: 0x17 / 255.0, alpha: 1))
                : (NSColor(white: 0x18 / 255.0, alpha: 1), NSColor(white: 1, alpha: 1))
}

/// config.json 里一个字符串字段的值。每次读盘：设置页随时会改，常驻进程不重启也要跟上。
func cfgValue(_ key: String) -> String? {
    let cfg = (try? String(contentsOf: home.appendingPathComponent(".claude/shoulder-tap/config.json"), encoding: .utf8)) ?? ""
    guard let r = cfg.range(of: "\"\(key)\": \""), let end = cfg[r.upperBound...].firstIndex(of: "\"") else { return nil }
    return String(cfg[r.upperBound..<end])
}

/// config.json 里一个数字字段的值（"showSec": 8 这种）。
func cfgNumber(_ key: String) -> Double? {
    let cfg = (try? String(contentsOf: home.appendingPathComponent(".claude/shoulder-tap/config.json"), encoding: .utf8)) ?? ""
    guard let r = cfg.range(of: "\"\(key)\": ") else { return nil }
    return Double(cfg[r.upperBound...].prefix(while: { $0.isNumber || $0 == "." }))
}

/// config.json 里的 motion：设成 "always" 就无视系统的「减弱动态效果」照常逐帧播。
/// 默认尊重系统设置，但这只手就是全部内容，停着不动会像坏了 —— 所以那种时候停在伸得最远的那一帧。
func motionAlways() -> Bool { cfgValue("motion") == "always" }

/// config.json 里的 skin（默认 glove）。皮肤在 skill 目录的 sprites/skins/<名字>/，文件不在就退回 .app 里内置的 glove。
func skinDir() -> URL {
    let dir = home.appendingPathComponent(".claude/skills/shoulder-tap/ui/sprites/skins/\(cfgValue("skin") ?? "glove")")
    return FileManager.default.fileExists(atPath: dir.appendingPathComponent("tap.png").path) ? dir : resourceDir
}

/// 九帧，加上「伸得最远的那一帧」是第几帧 —— 不播动画时停在它上面。
struct Sheet {
    let frames: [CGImage]
    let peak: Int
    static let empty = Sheet(frames: [], peak: 0)
}

func loadSheet(_ name: String) -> Sheet {
    let url = skinDir().appendingPathComponent(name)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let sheet = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return .empty }
    let gaps = frameGaps(sheet)
    // 画布右边留的透明列裁掉：伸得最远的那一帧要真的碰到屏幕边，别离着一截。
    let drawn = gaps.enumerated().filter { $0.element < 96 }
    let width = 96 - (drawn.map(\.element).min() ?? 0)
    let frames = (0..<9).compactMap { sheet.cropping(to: CGRect(x: $0 * 96, y: 0, width: width, height: 80)) }
    guard frames.count == 9 else { return .empty }
    return Sheet(frames: frames, peak: drawn.min(by: { $0.element < $1.element })?.offset ?? 0)
}

/// 每一帧右边还空着几列透明像素。整帧都空就是 96。
func frameGaps(_ sheet: CGImage) -> [Int] {
    let w = sheet.width, h = sheet.height
    var px = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return Array(repeating: 0, count: 9) }
    ctx.draw(sheet, in: CGRect(x: 0, y: 0, width: w, height: h))
    return (0..<9).map { f in
        for x in stride(from: 95, through: 0, by: -1) {
            for y in 0..<h where px[(y * w + f * 96 + x) * 4 + 3] > 0 { return 95 - x }
        }
        return 96
    }
}

func sheetName(for mode: String) -> String {
    switch mode { case "complete": return "pat.png"; case "snap": return "snap.png"; default: return "tap.png" }
}

/// 九帧各自的结束时刻（毫秒）。拍拍和 taptap 三次触碰 1.3 秒；响指两张图来回切，4fps。
func frameEnds(for mode: String) -> [Int] {
    mode == "snap" ? [250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250] : [250, 340, 430, 580, 670, 760, 910, 1000, 1300]
}

// MARK: - 摆在哪块屏

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


// MARK: - 一条道：一扇窗、一个队列

final class Lane {
    let fromTop: CGFloat
    private var queue: [TapRequest] = []
    private var playing = false
    private var panel: NSPanel?
    private var timers: [Timer] = []
    var onDone: (() -> Void)?

    init(fromTop: CGFloat) { self.fromTop = fromTop }

    func enqueue(_ req: TapRequest) { queue.append(req); next() }

    private func next() {
        guard !playing, !queue.isEmpty else { return }
        let req = queue.removeFirst()
        let sheet = loadSheet(sheetName(for: req.mode))
        guard !sheet.frames.isEmpty else { log("no frames for \(req.mode)"); next(); return }
        playing = true
        play(sheet: sheet, ends: frameEnds(for: req.mode), caption: req.caption) { [weak self] in
            self?.playing = false
            self?.onDone?()
            self?.next()
        }
    }

    private func play(sheet: Sheet, ends: [Int], caption: String, done: @escaping () -> Void) {
        let frames = sheet.frames
        let hand = NSSize(width: CGFloat(frames[0].width * 3), height: 240) // 裁过的宽 ×3，高 80×3，最近邻
        let captionMax: CGFloat = 440
        let gap: CGFloat = 12
        let width = hand.width + gap + captionMax

        let work = activeScreen().visibleFrame
        let centerY = work.maxY - work.height * fromTop
        let frame = NSRect(x: work.maxX - width, y: centerY - hand.height / 2, width: width, height: hand.height)

        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar
        panel.ignoresMouseEvents = true // 鼠标穿透
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.alphaValue = 1
        self.panel = panel

        let root = NSView(frame: NSRect(origin: .zero, size: frame.size))
        root.wantsLayer = true
        panel.contentView = root

        let handLayer = CALayer()
        handLayer.frame = CGRect(x: width - hand.width, y: 0, width: hand.width, height: hand.height)
        handLayer.magnificationFilter = .nearest
        handLayer.contents = frames[0]
        root.layer?.addSublayer(handLayer)

        // 手左边那一小条字：拍拍放这轮的总结，taptap 放提醒，响指放问题。最多三行，超了省略号。
        if !caption.isEmpty {
            let (ink, paper) = captionColors()
            let label = NSTextField(wrappingLabelWithString: caption)
            label.font = captionFont
            label.textColor = ink
            label.maximumNumberOfLines = 3
            label.lineBreakMode = .byTruncatingTail
            let inner = captionMax - 24
            label.preferredMaxLayoutWidth = inner
            let fit = label.sizeThatFits(NSSize(width: inner, height: 66))
            let w = min(fit.width, inner), h = min(fit.height, 66)
            let box = NSView(frame: NSRect(x: width - hand.width - gap - (w + 24), y: (hand.height - (h + 15)) / 2, width: w + 24, height: h + 15))
            box.wantsLayer = true
            box.layer?.backgroundColor = paper.cgColor
            box.layer?.borderColor = ink.cgColor
            box.layer?.borderWidth = 2
            box.layer?.cornerRadius = 6
            label.frame = NSRect(x: 12, y: 7, width: w, height: h)
            box.addSubview(label)
            root.addSubview(box)
        }

        panel.orderFrontRegardless()

        // 时间轴：帧动画，停到 showSec（设置页「手」里改，默认 8 秒），最后 0.24 秒淡出，收。
        let start = Date()
        let last = ends[8]
        if motionAlways() || !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let t = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { timer in
                let ms = Int(Date().timeIntervalSince(start) * 1000)
                CATransaction.begin()
                CATransaction.setDisableActions(true)
                handLayer.contents = frames[ends.firstIndex(where: { ms < $0 }) ?? 8]
                CATransaction.commit()
                if ms >= last { timer.invalidate() }
            }
            timers.append(t)
        } else {
            handLayer.contents = frames[sheet.peak] // 不动，但至少是手势张开的样子，不是起手第一帧
        }
        let hold = max(Double(last) / 1000 + 0.5, min(cfgNumber("showSec") ?? 8, 60)) - 0.24
        DispatchQueue.main.asyncAfter(deadline: .now() + hold) { [weak self] in
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.24
                panel.animator().alphaValue = 0
            }, completionHandler: {
                panel.orderOut(nil)
                self?.panel = nil
                done()
            })
        }
    }
}

// MARK: - 常驻进程

final class Resident: NSObject, NSApplicationDelegate {
    private let taps = Lane(fromTop: 0.30)   // taptap：提醒
    private let pats = Lane(fromTop: 0.52)   // 响指（这轮做完了）/ 拍拍（在问你话）
    private var status: NSStatusItem?
    private let first: TapRequest

    init(first: TapRequest) { self.first = first }

    func applicationDidFinishLaunching(_ notification: Notification) {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status?.button?.image = trayImage()
        let menu = NSMenu()
        menu.addItem(withTitle: "拍一下试试", action: #selector(testTap), keyEquivalent: "")
        menu.addItem(withTitle: "打开 shoulder-tap", action: #selector(openSettings), keyEquivalent: ",") // 今天、习惯、手、设置都在那一页
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出", action: #selector(quit), keyEquivalent: "q")
        menu.items.forEach { $0.target = self }
        status?.menu = menu

        DistributedNotificationCenter.default().addObserver(self, selector: #selector(incoming(_:)), name: notificationName, object: nil)

        if !onboarded() { openPage(setup: true) } // 第一次打开：直接进引导；之后点图标都是首页
        if first.hasMessage { handle(first) }
    }

    /// 设置页走完会在 config.json 里写 onboarded: true。
    private func onboarded() -> Bool {
        (try? String(contentsOf: stateDir.appendingPathComponent("config.json"), encoding: .utf8))?.contains("\"onboarded\": true") ?? false
    }

    /// 设置页是 skill 里的 onboard.mjs：本机起一个小服务，浏览器打开，设完自己退出。
    /// LaunchAgent 起来的进程 PATH 很短，node 可能不在上面，所以走登录 shell 找。
    @objc private func openSettings() { openPage(setup: false) }
    private func openPage(setup: Bool) {
        let script = home.appendingPathComponent(".claude/skills/shoulder-tap/onboard.mjs").path
        guard FileManager.default.fileExists(atPath: script) else {
            // skill 被删了或只装了桌面端：说出来，别只写日志。
            let a = NSAlert(); a.messageText = "找不到设置页"; a.informativeText = "\(script) 不在。回仓库跑一次 node install.mjs。"; a.runModal(); return
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", "node \"$0\" \"$@\"", script] + (setup ? ["--setup"] : [])
        p.standardOutput = nil; p.standardError = nil
        do { try p.run() } catch { log("open settings: \(error.localizedDescription)") }
    }

    @objc private func incoming(_ note: Notification) {
        guard let json = note.userInfo?["request"] as? String,
              let req = try? JSONDecoder().decode(TapRequest.self, from: Data(json.utf8)) else { return }
        handle(req)
    }

    func handle(_ req: TapRequest) {
        log("handle mode=\(req.mode) caption=\"\(req.caption)\"")
        if req.quit { NSApp.terminate(nil); return }
        if req.mode == "today" { openSettings(); return } // 今天、习惯、手、设置都在浏览器那一页
        if req.mode == "bind" { return } // Mac 上没有要绑的窗口
        if req.mode != "complete" && !req.hasMessage { return }
        (req.mode == "tap" ? taps : pats).enqueue(req) // taptap 自己一条道
    }

    @objc private func testTap() { var r = TapRequest(); r.text = "试拍"; r.caption = "试拍"; handle(r) }
    @objc private func quit() { NSApp.terminate(nil) }

    /// 菜单栏图标：taptap 那张 sheet 的第一帧，缩到 18pt，当模板图用。
    private func trayImage() -> NSImage? {
        guard let frame = loadSheet("tap.png").frames.first else { return NSImage(systemSymbolName: "hand.point.up.left", accessibilityDescription: "shoulder-tap") }
        let image = NSImage(cgImage: frame, size: NSSize(width: 22, height: 18))
        image.isTemplate = true
        return image
    }
}

// MARK: - 单实例

func tryLock() -> Int32? {
    try? FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
    let fd = open(lockPath, O_CREAT | O_RDWR, 0o644)
    guard fd >= 0 else { return nil }
    if flock(fd, LOCK_EX | LOCK_NB) == 0 { return fd }
    close(fd)
    return nil
}

func residentRunning() -> Bool {
    let fd = open(lockPath, O_RDONLY)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    if flock(fd, LOCK_EX | LOCK_NB) == 0 { flock(fd, LOCK_UN); return false }
    return true
}

func post(_ req: TapRequest) {
    let json = String(data: try! JSONEncoder().encode(req), encoding: .utf8)!
    DistributedNotificationCenter.default().postNotificationName(notificationName, object: nil, userInfo: ["request": json], deliverImmediately: true)
}

func launchDaemon() {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    p.arguments = ["--daemon"]
    p.standardInput = nil; p.standardOutput = nil; p.standardError = nil
    try? p.run()
}

// MARK: - 入口

let request = TapRequest.fromArgs()

if args.contains("--daemon") {
    guard tryLock() != nil else { exit(0) } // 有人抢先了
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory) // 不进 Dock，不抢焦点
    log("caption font = \(captionFont.fontName)") // 装没装上像素字体，一眼能看出来
    let resident = Resident(first: request)
    app.delegate = resident
    app.run()
    exit(0)
}

// 命令行那一端：永远立刻返回。
if residentRunning() {
    post(request)
    // 分布式通知是异步投递的，给它一点时间离开这个进程再退。
    RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    exit(0)
}
if request.quit { exit(0) }
launchDaemon()
if request.hasMessage {
    // 等常驻的起来再交，最多两秒；等不到就算了 —— 它起来之后接下来的都能收。
    for _ in 0..<20 {
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        if residentRunning() { post(request); RunLoop.main.run(until: Date().addingTimeInterval(0.15)); break }
    }
}
exit(0)
