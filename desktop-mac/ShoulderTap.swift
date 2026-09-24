// shoulder-tap 的 macOS 桌面端。一个文件，swiftc 直接编；install.mjs 会把它包成一个
// 只有菜单栏图标的 .app（LSUIElement），并注册成登录时自启的 LaunchAgent。
//
//     swiftc -O desktop-mac/ShoulderTap.swift -o .../ShoulderTap.app/Contents/MacOS/shoulder-tap-tap
//
// 跟 Windows 版同一套命令行（--mode tap|complete|snap|bind|quit，--caption，--text）和同一套行为：
//   · 命令行那一端永远立刻返回：常驻进程在跑就把话交过去，不在就派一个 --daemon 出去再交。
//   · 常驻进程两条道（taptap / 响指在 30% 高，拍拍在 52%），各自排队，可以同时在屏上。
//   · 配了跨机器（.env 里 SHOULDER_TAP_RELAY + SHOULDER_TAP_DEVICE_TOKEN）就挂上中转的 WebSocket：
//     收到密文解开当本机拍肩；本机刚有键鼠输入就上报「我是活跃的那台」；把结论写进 active.json 给钩子看。
//   · 密钥从 Notion token 派生（HKDF-SHA256 空盐，info = shoulder-tap/key），AES-256-GCM，iv(12)|密文|tag(16)，
//     跟 relay.mjs / Relay.cs 一字不差。
//
// 进程间用 NSDistributedNotificationCenter 交话，单实例用 ~/.claude/shoulder-tap/mac.lock 上的 flock。
// 两张（三张）sprite sheet 在 .app 的 Resources 里；不在 .app 里跑时就找可执行文件旁边。

import AppKit
import CryptoKit
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
    var fromRelay = false

    var hasMessage: Bool { mode == "complete" || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

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
let activeFile = stateDir.appendingPathComponent("active.json")
let notificationName = Notification.Name("shoulder-tap.tap")

func log(_ line: String) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    if let h = FileHandle(forWritingAtPath: NSTemporaryDirectory() + "shoulder-tap-tap.log") {
        h.seekToEndOfFile(); h.write("\(stamp) \(line)\n".data(using: .utf8)!); h.closeFile()
    } else {
        FileManager.default.createFile(atPath: NSTemporaryDirectory() + "shoulder-tap-tap.log", contents: "\(stamp) \(line)\n".data(using: .utf8))
    }
}

/// 跟 watch.mjs 同样的三个来源：进程环境、skill 的 .env、状态目录的 .env。
func loadEnv() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    for file in [home.appendingPathComponent(".claude/skills/shoulder-tap/.env"), stateDir.appendingPathComponent(".env")] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#") || line.isEmpty { continue }
            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = line[..<eq].trimmingCharacters(in: .whitespaces)
            var value = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            if value.count >= 2, (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }
            if !key.isEmpty, key.range(of: "^[A-Z_][A-Z0-9_]*$", options: .regularExpression) != nil { env[key] = value }
        }
    }
    return env
}

/// 跟 watch.mjs 共用 state.json 里的 device；谁先跑到谁生成。
func deviceId() -> String {
    let path = stateDir.appendingPathComponent("state.json")
    var state = (try? JSONSerialization.jsonObject(with: Data(contentsOf: path))) as? [String: Any] ?? [:]
    if let d = state["device"] as? String, !d.isEmpty { return d }
    let fresh = UUID().uuidString.lowercased()
    state["device"] = fresh
    try? FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
    if let data = try? JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: path) }
    return fresh
}

// MARK: - 帧

let resourceDir: URL = {
    if let r = Bundle.main.resourceURL, FileManager.default.fileExists(atPath: r.appendingPathComponent("tap-glove-sheet.png").path) { return r }
    return URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
}()

func loadFrames(_ name: String) -> [CGImage] {
    let url = resourceDir.appendingPathComponent(name)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let sheet = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return [] }
    let frames = (0..<9).compactMap { sheet.cropping(to: CGRect(x: $0 * 96, y: 0, width: 96, height: 80)) }
    return frames.count == 9 ? frames : []
}

func sheetName(for mode: String) -> String {
    switch mode { case "complete": return "completion-hand-sheet.png"; case "snap": return "snap-glove-sheet.png"; default: return "tap-glove-sheet.png" }
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

func screenId(_ s: NSScreen) -> Int { (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0 }

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
        let frames = loadFrames(sheetName(for: req.mode))
        guard !frames.isEmpty else { log("no frames for \(req.mode)"); next(); return }
        playing = true
        play(frames: frames, ends: frameEnds(for: req.mode), caption: req.caption) { [weak self] in
            self?.playing = false
            self?.onDone?()
            self?.next()
        }
    }

    private func play(frames: [CGImage], ends: [Int], caption: String, done: @escaping () -> Void) {
        let hand = NSSize(width: 288, height: 240) // 96×80 三倍，最近邻
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

        // 时间轴：帧动画，停到 3.3 秒，0.24 秒淡出，收。
        let start = Date()
        let last = ends[8]
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let t = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { timer in
                let ms = Int(Date().timeIntervalSince(start) * 1000)
                CATransaction.begin()
                CATransaction.setDisableActions(true)
                handLayer.contents = frames[ends.firstIndex(where: { ms < $0 }) ?? 8]
                CATransaction.commit()
                if ms >= last { timer.invalidate() }
            }
            timers.append(t)
        }
        let hold = max(3.3, Double(last) / 1000 + 2.0)
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

// MARK: - 密钥与封装：跟 relay.mjs / Relay.cs 对齐

enum Crypto {
    static func keyOf(_ notionToken: String) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data(notionToken.utf8)), salt: Data(), info: Data("shoulder-tap/key".utf8), outputByteCount: 32)
    }

    static func seal(_ key: SymmetricKey, _ plain: String) -> String? {
        guard let box = try? AES.GCM.seal(Data(plain.utf8), using: key) else { return nil }
        return (box.nonce.withUnsafeBytes { Data($0) } + box.ciphertext + box.tag).base64EncodedString()
    }

    static func unseal(_ key: SymmetricKey, _ blob: String) -> String? {
        guard let raw = Data(base64Encoded: blob), raw.count > 28,
              let nonce = try? AES.GCM.Nonce(data: raw.prefix(12)),
              let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: raw.subdata(in: 12..<(raw.count - 16)), tag: raw.suffix(16)),
              let plain = try? AES.GCM.open(box, using: key) else { return nil }
        return String(data: plain, encoding: .utf8)
    }
}

// MARK: - 跨机器那条线

final class Relay {
    private let endpoint: URL
    private let token: String
    private let key: SymmetricKey
    private let device: String
    private let telemetry: Bool
    private let deliver: (TapRequest) -> Void
    private var task: URLSessionWebSocketTask?
    private var delay: TimeInterval = 1
    private var active = false
    private var screen = 0
    private var stopped = false

    init?(deliver: @escaping (TapRequest) -> Void) {
        let env = loadEnv()
        guard let relay = env["SHOULDER_TAP_RELAY"]?.trimmingCharacters(in: .whitespacesAndNewlines), !relay.isEmpty,
              let token = env["SHOULDER_TAP_DEVICE_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty,
              let notion = env["NOTION_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines), !notion.isEmpty,
              var comps = URLComponents(string: relay.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)) else { return nil }
        comps.scheme = comps.scheme == "http" ? "ws" : "wss"
        comps.path = comps.path.replacingOccurrences(of: "/+$", with: "", options: .regularExpression) + "/ch"
        guard let url = comps.url else { return nil }
        endpoint = url
        self.token = token
        key = Crypto.keyOf(notion)
        device = deviceId()
        telemetry = env["SHOULDER_TAP_TELEMETRY"]?.trimmingCharacters(in: .whitespaces) != "0"
        self.deliver = deliver
    }

    func start() {
        connect()
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.observe() }
    }

    func stop() {
        stopped = true
        task?.cancel(with: .goingAway, reason: nil)
        writeActive(false)
    }

    private func writeActive(_ value: Bool) {
        active = value
        try? FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
        let json = "{\"active\":\(value),\"at\":\(Int(Date().timeIntervalSince1970 * 1000))}"
        try? json.write(to: activeFile, atomically: true, encoding: .utf8)
    }

    private func connect() {
        guard !stopped else { return }
        var comps = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "device", value: device), URLQueryItem(name: "platform", value: "mac"),
            URLQueryItem(name: "screens", value: String(NSScreen.screens.count)), URLQueryItem(name: "t", value: telemetry ? "1" : "0"),
        ]
        var request = URLRequest(url: comps.url!)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let task = URLSession.shared.webSocketTask(with: request)
        self.task = task
        task.resume()
        log("relay connecting")
        receive(task)
    }

    private func receive(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                self.delay = 1
                if case .string(let text) = message { DispatchQueue.main.async { self.handle(text) } }
                self.receive(task)
            case .failure(let error):
                log("relay \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.task = nil
                    self.writeActive(false)
                    // 断了就退避重连，最多半分钟一次。
                    DispatchQueue.main.asyncAfter(deadline: .now() + self.delay) { self.connect() }
                    self.delay = min(self.delay * 2, 30)
                }
            }
        }
    }

    private func handle(_ text: String) {
        guard let msg = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { return }
        switch msg["type"] as? String {
        case "active":
            // 服务端说了算：不是我，下次被碰到就得重新报。
            writeActive((msg["device"] as? String) == device)
        case "tap":
            guard let blob = msg["blob"] as? String, let plain = Crypto.unseal(key, blob),
                  let body = (try? JSONSerialization.jsonObject(with: Data(plain.utf8))) as? [String: Any] else { log("relay unseal failed"); return }
            let host = body["host"] as? String ?? ""
            let gesture = body["gesture"] as? String ?? "tap"
            var caption = body["caption"] as? String ?? ""
            let text = body["text"] as? String ?? ""
            // 别的机器发来的，字条前面带上它的名字。
            let mine = ProcessInfo.processInfo.hostName.split(separator: ".").first.map(String.init) ?? ""
            if host.caseInsensitiveCompare(mine) != .orderedSame && host.caseInsensitiveCompare(ProcessInfo.processInfo.hostName) != .orderedSame {
                caption = caption.isEmpty ? "[\(host)]" : "[\(host)] \(caption)"
            }
            var req = TapRequest()
            req.mode = ["complete", "snap"].contains(gesture) ? gesture : "tap"
            req.text = text.isEmpty ? caption : text
            req.caption = caption
            req.fromRelay = true
            deliver(req)
        default: break
        }
    }

    /// 本机直接拍的那一下也记进频道的历史。连接不在就算了。
    func record(_ req: TapRequest) {
        guard let task = task else { return }
        let host = ProcessInfo.processInfo.hostName.split(separator: ".").first.map(String.init) ?? ProcessInfo.processInfo.hostName
        guard let inner = try? JSONSerialization.data(withJSONObject: ["host": host, "gesture": req.mode, "caption": req.caption, "text": req.text]),
              let blob = Crypto.seal(key, String(data: inner, encoding: .utf8) ?? ""),
              let line = try? JSONSerialization.data(withJSONObject: ["type": "record", "gesture": req.mode, "blob": blob]) else { return }
        task.send(.string(String(data: line, encoding: .utf8)!)) { if let e = $0 { log("relay record \(e.localizedDescription)") } }
    }

    /// 每秒看一眼：刚有键鼠输入，而且（我不是活跃的那台，或者前台窗口换了块屏）→ 报一次。
    /// 只上报「被碰了」和屏幕数，不上报坐标，也不上报窗口。不读键盘内容，不需要辅助功能权限。
    private func observe() {
        guard let task = task else { return }
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
        guard idle < 1.5 else { return }
        let now = screenId(activeScreen())
        if active && now == screen { return }
        screen = now
        writeActive(true) // 先当作是我，服务端广播回来会纠正
        let line = "{\"type\":\"active\",\"screens\":\(NSScreen.screens.count)}"
        task.send(.string(line)) { if let e = $0 { log("relay send \(e.localizedDescription)") } }
    }
}

// MARK: - 常驻进程

final class Resident: NSObject, NSApplicationDelegate {
    private let taps = Lane(fromTop: 0.30)   // taptap / 响指：提醒
    private let pats = Lane(fromTop: 0.52)   // 拍拍：做完了
    private var status: NSStatusItem?
    private var relay: Relay?
    private let first: TapRequest

    init(first: TapRequest) { self.first = first }

    func applicationDidFinishLaunching(_ notification: Notification) {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status?.button?.image = trayImage()
        let menu = NSMenu()
        menu.addItem(withTitle: "拍一下试试", action: #selector(testTap), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出", action: #selector(quit), keyEquivalent: "q")
        menu.items.forEach { $0.target = self }
        status?.menu = menu

        DistributedNotificationCenter.default().addObserver(self, selector: #selector(incoming(_:)), name: notificationName, object: nil)

        relay = Relay { [weak self] req in self?.handle(req) }
        relay?.start()
        log(relay == nil ? "relay off" : "relay on")

        if first.hasMessage { handle(first) }
    }

    @objc private func incoming(_ note: Notification) {
        guard let json = note.userInfo?["request"] as? String,
              let req = try? JSONDecoder().decode(TapRequest.self, from: Data(json.utf8)) else { return }
        handle(req)
    }

    func handle(_ req: TapRequest) {
        log("handle mode=\(req.mode) caption=\"\(req.caption)\" relay=\(req.fromRelay)")
        if req.quit { NSApp.terminate(nil); return }
        if req.mode == "bind" || req.mode == "today" { return } // Mac 上没有要绑的窗口，也没有今日面板
        if req.mode != "complete" && !req.hasMessage { return }
        if !req.fromRelay { relay?.record(req) } // 本机直接拍的，也进频道的历史
        (req.mode == "complete" ? pats : taps).enqueue(req)
    }

    @objc private func testTap() { var r = TapRequest(); r.text = "试拍"; r.caption = "试拍"; handle(r) }
    @objc private func quit() { NSApp.terminate(nil) }

    func applicationWillTerminate(_ notification: Notification) { relay?.stop() }

    /// 菜单栏图标：taptap 那张 sheet 的第一帧，缩到 18pt，当模板图用。
    private func trayImage() -> NSImage? {
        guard let frame = loadFrames("tap-glove-sheet.png").first else { return NSImage(systemSymbolName: "hand.point.up.left", accessibilityDescription: "shoulder-tap") }
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
