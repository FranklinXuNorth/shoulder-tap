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
 *   5. 跨机器 → .env 里有 SHOULDER_TAP_RELAY 但还没登录，就打印一个链接让你在浏览器里登录，
 *              登录完把设备令牌写进 .env。node install.mjs --login 可以重新登。
 *
 * 不做的事：不碰 Notion，不碰 MCP 配置 —— 那两步要你的密钥，最后会把命令打出来。
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

// 1. skill
fs.mkdirSync(skillDst, { recursive: true });
for (const name of fs.readdirSync(skillSrc)) {
  if (name === ".env" || name.endsWith(".test.mjs")) continue;
  fs.cpSync(path.join(skillSrc, name), path.join(skillDst, name), { recursive: true, force: true });
}
const env = path.join(skillDst, ".env");
if (!fs.existsSync(env)) fs.copyFileSync(path.join(skillSrc, ".env.example"), env);
log(`skill → ${skillDst}`);

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
if (process.platform === "darwin") {
  if (spawnSync("swiftc", ["--version"], { stdio: "ignore" }).status !== 0)
    log("没找到 swiftc：先跑 xcode-select --install，再跑一次这个脚本");
  else {
    // 包成一个只有菜单栏图标的 .app：LSUIElement 不进 Dock；sprite 放 Resources。
    const bundle = path.join(appDir, "ShoulderTap.app");
    const macos = path.join(bundle, "Contents", "MacOS");
    const res = path.join(bundle, "Contents", "Resources");
    fs.mkdirSync(macos, { recursive: true });
    fs.mkdirSync(res, { recursive: true });
    for (const sheet of ["tap-glove-sheet.png", "completion-hand-sheet.png", "snap-glove-sheet.png"])
      fs.copyFileSync(path.join(skillSrc, "ui", "sprites", sheet), path.join(res, sheet));
    fs.writeFileSync(path.join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.shoulder-tap.tap</string>
  <key>CFBundleName</key><string>shoulder-tap</string>
  <key>CFBundleExecutable</key><string>shoulder-tap-tap</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.2</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
    const bin = path.join(macos, "shoulder-tap-tap");
    spawnSync(bin, ["--quit"], { stdio: "ignore" }); // 常驻的那个在跑就先请它退出
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
    execFileSync("swiftc", ["-O", path.join(root, "desktop-mac", "ShoulderTap.swift"), "-o", bin], { stdio: "inherit" });
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
  execFileSync("dotnet", ["publish", path.join(root, "desktop"), "-c", "Release", "-o", appDir, "--nologo", "-v", "q"], { stdio: "inherit" });
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

// 5. 跨机器：登录换设备令牌
const dotenv = Object.fromEntries(
  fs.readFileSync(env, "utf8").split("\n").map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const relay = (dotenv.SHOULDER_TAP_RELAY || "").trim().replace(/\/+$/, "");
if (!relay) log("跨机器没开：想开的话把 worker/ 部署到 Cloudflare，把地址填进 .env 的 SHOULDER_TAP_RELAY，再跑一次");
else if (dotenv.SHOULDER_TAP_DEVICE_TOKEN && !process.argv.includes("--login")) log("跨机器 → 已登录（重新登：node install.mjs --login）");
else await login(relay);

async function login(base) {
  const issued = await (await fetch(`${base}/device/code`, { method: "POST" })).json();
  console.log(`
  在浏览器里打开这个链接登录（Google 或邮箱密码），这台机器就连上了：

    ${issued.url}

  等你……`);
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    // 网络抖一下不算失败：码还活着，下一轮接着问。
    let polled;
    try { polled = await (await fetch(`${base}/device/poll?code=${issued.code}&secret=${issued.secret}`)).json(); } catch { continue; }
    if (polled.error) { log(`登录没成功：${polled.error}`); return; }
    if (!polled.token) continue;
    const text = fs.readFileSync(env, "utf8");
    const line = `SHOULDER_TAP_DEVICE_TOKEN=${polled.token}`;
    fs.writeFileSync(env, /^SHOULDER_TAP_DEVICE_TOKEN=.*$/m.test(text) ? text.replace(/^SHOULDER_TAP_DEVICE_TOKEN=.*$/m, line) : text.trimEnd() + "\n" + line + "\n");
    log(`跨机器 → 登录成功（${polled.email}），设备令牌已写进 .env`);
    return;
  }
  log("十分钟没等到登录，下次跑 node install.mjs --login 再来");
}

console.log(`
还差两步，都要你自己的密钥：

  1. 建一个 Notion integration，拿 ntn_ 开头的密钥，
     写进 ${env} 的 NOTION_TOKEN=，
     再把 Claude Code 接上：
       claude mcp add --transport http shoulder-tap https://shoulder-tap-relay.shoulder-tap.workers.dev/mcp -s user -H "Authorization: Bearer ntn_你的密钥"
  2. 挑一个 Notion 页面，⋯ → Connections 加上这个 integration，然后在 Claude Code 里说
     「接上 shoulder-tap」，把页面链接给它，它会在那底下建库。
`);
