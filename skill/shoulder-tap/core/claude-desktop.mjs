/**
 * Claude Desktop（聊天那个 App）的 MCP 配置：claude_desktop_config.json 里的 mcpServers。
 * 它没有钩子、不读 CLAUDE.md，所以接上之后只有工具，你让它查清单 / 记习惯它才会调。
 * 设置页用 add，卸载用 remove。文件里别的东西（preferences 之类）原样留着。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 这台机器上所有可能的配置文件（Windows 的商店版装在 Packages 底下）。只返回目录存在的。 */
export function claudeDesktopConfigs() {
  const home = os.homedir();
  const dirs = process.platform === "darwin"
    ? [path.join(home, "Library", "Application Support", "Claude")]
    : process.platform === "win32"
      ? [
          path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude"),
          ...packagedDirs(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")),
        ]
      : [path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude")];
  return dirs.filter((d) => fs.existsSync(d)).map((d) => path.join(d, "claude_desktop_config.json"));
}

function packagedDirs(local) {
  const pkgs = path.join(local, "Packages");
  if (!fs.existsSync(pkgs)) return [];
  return fs.readdirSync(pkgs).filter((n) => /^Claude_/.test(n)).map((n) => path.join(pkgs, n, "LocalCache", "Roaming", "Claude"));
}

const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };

export function claudeDesktopState() {
  const files = claudeDesktopConfigs();
  return { installed: files.length > 0, connected: files.some((f) => Boolean(read(f).mcpServers?.["shoulder-tap"])) };
}

/** 写进每一个找到的配置里（商店版和普通版可能同时在）。 */
export function addToClaudeDesktop(command, mcpPath) {
  const files = claudeDesktopConfigs();
  // 话留给调用方说：设置页要跟着页面语言，模型那边要中文
  if (!files.length) throw Object.assign(new Error("Claude Desktop not found"), { code: "no_claude_desktop" });
  for (const file of files) {
    const cfg = read(file);
    cfg.mcpServers = { ...cfg.mcpServers, "shoulder-tap": { command, args: [mcpPath] } };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  }
  return files;
}

export function removeFromClaudeDesktop() {
  const changed = [];
  for (const file of claudeDesktopConfigs()) {
    const cfg = read(file);
    if (!cfg.mcpServers?.["shoulder-tap"]) continue;
    delete cfg.mcpServers["shoulder-tap"];
    if (!Object.keys(cfg.mcpServers).length) delete cfg.mcpServers;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
    changed.push(file);
  }
  return changed;
}
