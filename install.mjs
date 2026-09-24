#!/usr/bin/env node
/**
 * 一键装到这台机器上：node install.mjs
 *
 * 做四件事，每件都可以重复跑：
 *   1. skill  → ~/.claude/skills/shoulder-tap（已有的 .env 不动）
 *   2. 钩子   → ~/.claude/settings.json 里的 UserPromptSubmit / PostToolUse / Stop / PreToolUse(AskUserQuestion)
 *   3. CLAUDE.md → 把 skill/CLAUDE.md.snippet 粘进 ~/.claude/CLAUDE.md（已有「## 专注」就跳过）
 *   4. 桌面端 → Windows 用 .NET SDK 编到 ~/.claude/shoulder-tap/app 并注册开机自启；
 *              macOS 用 swiftc 包成 ShoulderTap.app 并注册 LaunchAgent；Linux 只指一下接口文档。没有也不影响文本拍肩
 *   5. 设置页 → 桌面端第一次起来会自己打开它；没有桌面端（Linux）就直接打开。
 *              接 MCP、第一个习惯、今天的事、数据放哪，都在那一页里点。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const claude = path.join(os.homedir(), ".claude");
const skillSrc = path.join(root, "skill", "shoulder-tap");
const skillDst = path.join(claude, "skills", "shoulder-tap");
const appDir = path.join(claude, "shoulder-tap", "app");
const log = (s) => console.log("  " + s);

// 1. skill。先清掉上一版留下的文件（.env 除外）：只覆盖不清理，删掉的旧文件会一直躺在那。
fs.mkdirSync(skillDst, { recursive: true });
for (const name of fs.readdirSync(skillDst)) if (name !== ".env") fs.rmSync(path.join(skillDst, name), { recursive: true, force: true });
for (const name of fs.readdirSync(skillSrc)) {
  if (name === ".env") continue;
  fs.cpSync(path.join(skillSrc, name), path.join(skillDst, name), { recursive: true, force: true, filter: (src) => !src.endsWith(".test.mjs") });
}
const env = path.join(skillDst, ".env");
if (!fs.existsSync(env)) fs.copyFileSync(path.join(skillSrc, ".env.example"), env);
log(`skill → ${skillDst}`);
// 卸载是单独一个 skill：用户说「卸载 shoulder-tap」模型就知道跑 uninstall.mjs。
fs.cpSync(path.join(root, "skill", "shoulder-tap-uninstall"), path.join(claude, "skills", "shoulder-tap-uninstall"), { recursive: true, force: true });

// 2. 钩子。四个事件各挂一次 watch.mjs；已经挂了就不重复。
const settingsPath = path.join(claude, "settings.json");
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
settings.hooks ??= {};
const command = 'node "$HOME/.claude/skills/shoulder-tap/watch.mjs"';
let added = 0;
for (const event of ["UserPromptSubmit", "PostToolUse", "Stop", "PreToolUse"]) {
  const list = (settings.hooks[event] ??= []);
  if (list.some((g) => (g.hooks ?? []).some((h) => String(h.command).includes("shoulder-tap/watch.mjs")))) continue;
  const hook = { type: "command", command, timeout: 10 };
  if (event === "UserPromptSubmit") hook.statusMessage = "看一眼今天说好要做什么";
  const matcher = { PostToolUse: "*", PreToolUse: "AskUserQuestion" }[event]; // PreToolUse 只为问你话那一刻
  list.push(matcher ? { matcher, hooks: [hook] } : { hooks: [hook] });
  added++;
}
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
log(`钩子 → ${settingsPath}（新加 ${added} 个）`);

// 3. CLAUDE.md
const claudeMd = path.join(claude, "CLAUDE.md");
const have = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, "utf8") : "";
if (have.includes("## 专注")) log("CLAUDE.md 已有「## 专注」，不动");
else {
  const snippet = fs.readFileSync(path.join(root, "skill", "CLAUDE.md.snippet"), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  fs.writeFileSync(claudeMd, have.trimEnd() + (have ? "\n\n" : "") + snippet.trimEnd() + "\n");
  log(`CLAUDE.md ← 专注那一节`);
}

// 4. 桌面端
// 桌面端编不出来只是降级（拍肩落在聊天里），不能把整条安装链拖垮：编译一律 try/catch。
const tryBuild = (fn) => { try { fn(); return true; } catch (e) { log(`桌面端没编出来（${e.message?.split("\n")[0]}）。文本拍肩照常用；修好后再跑一次这个脚本`); return false; } };
if (process.platform === "darwin") {
  // 走 xcrun 而不是裸 swiftc：PATH 里可能有 swiftly 之类指向不存在工具链的 shim；xcrun 是 CLT 自带的。
  const swiftc = ["xcrun", "-sdk", "macosx", "swiftc"];
  if (spawnSync(swiftc[0], [...swiftc.slice(1), "--version"], { stdio: "ignore" }).status !== 0)
    log("没找到 swiftc：先跑 xcode-select --install，再跑一次这个脚本");
  else {
    // 包成一个只有菜单栏图标的 .app：LSUIElement 不进 Dock；sprite 放 Resources。
    const bundle = path.join(appDir, "ShoulderTap.app");
    const macos = path.join(bundle, "Contents", "MacOS");
    const res = path.join(bundle, "Contents", "Resources");
    fs.mkdirSync(macos, { recursive: true });
    fs.mkdirSync(res, { recursive: true });
    for (const sheet of ["tap.png", "pat.png", "snap.png"]) // 内置 glove；别的皮肤从 skill 目录按文件读
      fs.copyFileSync(path.join(skillSrc, "ui", "sprites", "skins", "glove", sheet), path.join(res, sheet));
    fs.copyFileSync(path.join(root, "desktop-mac", "Info.plist"), path.join(bundle, "Contents", "Info.plist")); // 手动装也用同一份
    const bin = path.join(macos, "shoulder-tap-tap");
    if (fs.existsSync(bin)) {
      spawnSync(bin, ["--quit"], { stdio: "ignore" }); // 常驻的那个在跑就先请它退出
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
    }
    const built = tryBuild(() => execFileSync(swiftc[0], [...swiftc.slice(1), "-O", path.join(root, "desktop-mac", "ShoulderTap.swift"), "-o", bin], { stdio: "inherit" }));
    if (built) {
    log(`桌面端 → ${bundle}`);
    // 登录时自启：LaunchAgent，不需要管理员。--daemon 起来就是常驻不拍。
    const agents = path.join(os.homedir(), "Library", "LaunchAgents");
    const plist = path.join(agents, "com.shoulder-tap.tap.plist");
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.shoulder-tap.tap</string>
  <key>ProgramArguments</key><array><string>${bin}</string><string>--daemon</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict></plist>
`);
    const uid = process.getuid?.() ?? 501;
    spawnSync("launchctl", ["bootout", `gui/${uid}`, plist], { stdio: "ignore" });
    const boot = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plist], { stdio: "ignore" });
    log(boot.status === 0
      ? `登录自启 → ${plist}（取消：launchctl bootout gui/${uid} ${plist}）`
      : "登录自启没注册上，手动 launchctl bootstrap 一下，或者在系统设置 → 登录项里加上 ShoulderTap.app");
    spawnSync(bin, [], { stdio: "ignore" }); // 现在就拉起来常驻
    }
  }
} else if (process.platform === "linux") {
  log(`Linux 还没有桌面端：接口约定在 ${path.join(root, "desktop-linux", "README.md")}；做好放到 ${path.join(appDir, "shoulder-tap-tap")} 就会被用上。文本拍肩和跨机器发送照常工作`);
} else if (process.platform !== "win32") log("桌面端只有 Windows 和 macOS 版，这台机器跳过；文本拍肩照常工作");
else if (spawnSync("dotnet", ["--version"], { stdio: "ignore" }).status !== 0)
  log(`没找到 dotnet：装 .NET 10 SDK 后再跑一次，或把 Release 里的 exe 解压到 ${appDir}`);
else {
  const exe = path.join(appDir, "shoulder-tap-tap.exe");
  if (fs.existsSync(exe)) {
    spawnSync(exe, ["--quit"], { stdio: "ignore" }); // 常驻的那个占着 dll，先请它退出
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  if (tryBuild(() => execFileSync("dotnet", ["publish", path.join(root, "desktop"), "-c", "Release", "-o", appDir, "--nologo", "-v", "q"], { stdio: "inherit" }))) {
  log(`桌面端 → ${exe}`);
  // 开机自启：HKCU 的 Run 键，不要管理员。不带参数启动就是常驻不拍。
  // 不常驻的话，Claude Code 没开时别的机器发来的拍肩就没人接。
  // 走 PowerShell 而不是 reg.exe：从 Node 传给 reg.exe 的参数在这台机器上怎么都过不了它的解析。
  const runKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const script = `Set-ItemProperty -Path '${runKey}' -Name 'shoulder-tap' -Value '"${exe.replace(/'/g, "''")}"'`;
  // -EncodedCommand：命令走 base64，反斜杠和引号都不经过任何一层 shell 解析。
  const run = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdio: "ignore" });
  log(run.status === 0
    ? "开机自启 → 已注册（取消：Remove-ItemProperty -Path '" + runKey + "' -Name shoulder-tap）"
    : "开机自启没注册上，手动把 exe 的快捷方式放进 shell:startup 也行");
  spawnSync(exe, [], { stdio: "ignore" }); // 现在就拉起来常驻
  }
}

// 5. 设置页。桌面端在跑的话它已经打开了（第一次启动会自己开）；没有桌面端就在这里开，开着直到你点完成。
console.log(`
装好了。设置页会在浏览器里打开（没开的话：node "${path.join(skillDst, "onboard.mjs")}"）：
接上 Claude Code / Codex、定第一个习惯、写下今天要做的事、选数据放哪。
`);
const hasDesktop = fs.existsSync(path.join(appDir, "shoulder-tap-tap.exe")) || fs.existsSync(path.join(appDir, "ShoulderTap.app"));
if (!hasDesktop) spawnSync(process.execPath, [path.join(skillDst, "onboard.mjs")], { stdio: "inherit" });
