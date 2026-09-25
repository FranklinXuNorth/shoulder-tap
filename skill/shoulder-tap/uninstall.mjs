#!/usr/bin/env node
/**
 * 卸干净：node ~/.claude/skills/shoulder-tap/uninstall.mjs [--purge]
 *
 * 把 install.mjs 和设置页动过的地方全部还原，三个平台一样：
 *   1. 桌面端：请常驻进程退出，取消开机自启（Windows Run 键 / macOS LaunchAgent），删 ~/.claude/shoulder-tap/app
 *   2. MCP：claude mcp remove；~/.codex/config.toml 里的 [mcp_servers.shoulder-tap] 段；Claude Desktop 配置里的 shoulder-tap；
 *      openclaw mcp unset；~/.hermes/config.yaml 里 mcp_servers 下的 shoulder-tap
 *   3. 钩子：~/.claude/settings.json 里跑 watch.mjs 的那四个
 *   4. CLAUDE.md：「## 专注」那一节
 *   5. skill：~/.claude/skills/shoulder-tap 和 shoulder-tap-uninstall
 * 你的数据（~/.claude/shoulder-tap/data.json、config.json）和 Notion 密钥默认留着；--purge 才一起删。
 * Notion 里那个库不动 —— 那是你自己的。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removeFromClaudeDesktop } from "./core/claude-desktop.mjs";
import { openclawConnected, openclawRemoveArgs, removeFromHermes } from "./core/other-agents.mjs";

const purge = process.argv.includes("--purge");
const home = os.homedir();
const claude = path.join(home, ".claude");
const stateDir = path.join(claude, "shoulder-tap");
const appDir = path.join(stateDir, "app");
const log = (s) => console.log("  " + s);
const rm = (p) => { if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); log(`删了 ${p}`); } };
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore", shell: process.platform === "win32" });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// 1. 桌面端
if (process.platform === "win32") {
  const exe = path.join(appDir, "shoulder-tap-tap.exe");
  if (fs.existsSync(exe)) { run(exe, ["--quit"]); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); }
  const script = "Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'shoulder-tap' -ErrorAction SilentlyContinue";
  run("powershell", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
  log("开机自启 → 取消了");
} else if (process.platform === "darwin") {
  const plist = path.join(home, "Library", "LaunchAgents", "com.shoulder-tap.tap.plist");
  // 先摘 launchd 再请进程退：KeepAlive 被人改成 true 的话，--quit 之后 launchd 立刻把它拉回来。
  // 按 label 摘而不是按 plist 路径：plist 已经被手工删掉、job 还在跑时，按路径摘不掉。
  const booted = run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/com.shoulder-tap.tap`]).status === 0;
  rm(plist);
  log(booted ? "登录自启 → 取消了" : "登录自启 → 本来就没注册");

  const bin = path.join(appDir, "ShoulderTap.app", "Contents", "MacOS", "shoulder-tap-tap");
  const alive = () => run("pgrep", ["-f", "shoulder-tap-tap"]).status === 0;
  if (fs.existsSync(bin)) {
    run(bin, ["--quit"]);
    // 等它真的退，别只等一个固定时长：常驻那个占着 mac.lock，没确认就 rm 会把 binary 从它
    // 脚下抽走 —— 进程照跑（unlink 了也还在），菜单栏图标留到注销为止。
    for (let i = 0; i < 20 && alive(); i++) sleep(100);
    if (alive()) { run("pkill", ["-f", "shoulder-tap-tap"]); sleep(300); }
    log(alive() ? "桌面端 → 没退下来，注销一次或手动 pkill -f shoulder-tap-tap" : "桌面端 → 退了");
  }
  rm(path.join(stateDir, "mac.lock")); // 单实例锁，不是数据，--purge 与否都该走
  rm(path.join(os.tmpdir(), "shoulder-tap-tap.log"));
} else {
  const bin = path.join(appDir, "shoulder-tap-tap");
  if (fs.existsSync(bin)) run(bin, ["--quit"]);
}
rm(appDir);

// 2. MCP
const mcpGone = run("claude", ["mcp", "remove", "-s", "user", "shoulder-tap"]).status === 0;
const codex = path.join(home, ".codex", "config.toml");
if (fs.existsSync(codex)) {
  const text = fs.readFileSync(codex, "utf8");
  const cleaned = text.replace(/\n*\[mcp_servers\.shoulder-tap\][\s\S]*?(?=\n\[|$)/, "\n").trimEnd() + "\n"; // 到下一个 [段] 为止
  if (cleaned !== text) { fs.writeFileSync(codex, cleaned); log(`Codex → 去掉了 [mcp_servers.shoulder-tap]`); }
}
log(mcpGone ? "MCP → 去掉了" : "MCP → 没去掉（claude 不在 PATH 上，或本来就没接）");
for (const file of removeFromClaudeDesktop()) log(`Claude Desktop → 去掉了（${file}）`);
if (openclawConnected()) log(run("openclaw", openclawRemoveArgs).status === 0 ? "OpenClaw → 去掉了" : "OpenClaw → 没去掉（openclaw 不在 PATH 上）：openclaw mcp unset shoulder-tap");
const hermes = removeFromHermes();
if (hermes) log(`Hermes → 去掉了（${hermes}）`);

// 3. 钩子
const settingsPath = path.join(claude, "settings.json");
if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups.filter((g) => !(g.hooks ?? []).some((h) => String(h.command).includes("shoulder-tap/watch.mjs")));
    if (kept.length) settings.hooks[event] = kept; else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  // 只在真改了才落盘：没装过钩子时白写一遍，会把别的会话同时在写的 settings.json 盖掉。
  const next = JSON.stringify(settings, null, 2) + "\n";
  if (next !== fs.readFileSync(settingsPath, "utf8")) { fs.writeFileSync(settingsPath, next); log("钩子 → 去掉了"); }
}

// 4. CLAUDE.md：从「## 专注」到下一个二级标题（或文件尾）
const claudeMd = path.join(claude, "CLAUDE.md");
if (fs.existsSync(claudeMd)) {
  const text = fs.readFileSync(claudeMd, "utf8");
  const cleaned = text.replace(/\n*## 专注\n[\s\S]*?(?=\n## |$)/, "\n").trimEnd() + "\n";
  if (cleaned !== text) { fs.writeFileSync(claudeMd, cleaned.trim() ? cleaned : ""); log("CLAUDE.md → 去掉了「## 专注」"); }
}

// 5. 数据（可选）和 skill
if (purge) { rm(stateDir); rm(path.join(claude, "skills", "shoulder-tap", ".env")); }
else if (fs.existsSync(stateDir)) log(`数据留着：${stateDir}（连同 .env 一起删：--purge）`);
rm(path.join(claude, "skills", "shoulder-tap-uninstall"));
rm(path.join(claude, "skills", "shoulder-tap"));

console.log("\n卸干净了。重开一次 Claude Code 会话就看不到它了。Notion 里的库没动。");
