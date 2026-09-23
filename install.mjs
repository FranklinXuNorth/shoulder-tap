#!/usr/bin/env node
/**
 * 一键装到这台机器上：node install.mjs
 *
 * 做四件事，每件都可以重复跑：
 *   1. skill  → ~/.claude/skills/shoulder-tap（已有的 .env 不动）
 *   2. 钩子   → ~/.claude/settings.json 里的 UserPromptSubmit / PostToolUse / Stop
 *   3. CLAUDE.md → 把 skill/CLAUDE.md.snippet 粘进 ~/.claude/CLAUDE.md（已有「## 专注」就跳过）
 *   4. 桌面端 → Windows 且装了 .NET SDK 时编译到 ~/.claude/shoulder-tap/app；没有也不影响文本拍肩
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

// 2. 钩子。三个事件各挂一次 watch.mjs；已经挂了就不重复。
const settingsPath = path.join(claude, "settings.json");
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
settings.hooks ??= {};
const command = 'node "$HOME/.claude/skills/shoulder-tap/watch.mjs"';
let added = 0;
for (const event of ["UserPromptSubmit", "PostToolUse", "Stop"]) {
  const list = (settings.hooks[event] ??= []);
  if (list.some((g) => (g.hooks ?? []).some((h) => String(h.command).includes("shoulder-tap/watch.mjs")))) continue;
  const hook = { type: "command", command, timeout: 10 };
  if (event === "UserPromptSubmit") hook.statusMessage = "看一眼今天说好要做什么";
  list.push(event === "PostToolUse" ? { matcher: "*", hooks: [hook] } : { hooks: [hook] });
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

// 4. 桌面端（目前只有 Windows）
if (process.platform !== "win32") log("桌面端只有 Windows 版，这台机器跳过；文本拍肩照常工作");
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
}

console.log(`
还差两步，都要你自己的密钥：

  1. 建一个 Notion integration，拿 ntn_ 开头的密钥，
     写进 ${env} 的 NOTION_TOKEN=，
     再把 Claude Code 接上：
       claude mcp add --transport http shoulder-tap https://shoulder-tap.vercel.app/mcp -s user -H "Authorization: Bearer ntn_你的密钥"
  2. 挑一个 Notion 页面，⋯ → Connections 加上这个 integration，然后在 Claude Code 里说
     「接上 shoulder-tap」，把页面链接给它，它会在那底下建库。
`);
