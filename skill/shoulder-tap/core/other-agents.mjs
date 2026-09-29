/**
 * OpenClaw（龙虾）和 Hermes Agent：2026-09-29 起不再支持接入，只留卸载时的清理。
 *
 * 为什么停：它们接的只是 MCP 工具，拦你、拍你全靠 Claude Code / Codex 的钩子。OpenClaw 虽然有插件钩子
 * （before_prompt_build / agent_end），但要写进程内插件、开 allowConversationAccess，而且多 agent 归属下
 * 静默不触发（openclaw/openclaw#142783，未修）。做不到跟 Claude Code / Codex 一样的体验，就不挂名支持。
 *
 * 以前接过的机器，卸载时还得替它们清掉，不然会留下一个指向已删文件的 MCP：
 * - OpenClaw：走它自己的 CLI（openclaw mcp unset）。判断接没接过只看 ~/.openclaw/openclaw.json 里有没有 "shoulder-tap"。
 * - Hermes：没有命令可用，只能改 ~/.hermes/config.yaml 的 mcp_servers。没有 YAML 库，按行改：只动 shoulder-tap 那一段。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------- OpenClaw ----------
const openclawDir = () => process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
const openclawConfig = () => process.env.OPENCLAW_CONFIG_PATH || path.join(openclawDir(), "openclaw.json");

export const openclawConnected = () => {
  try { return fs.readFileSync(openclawConfig(), "utf8").includes('"shoulder-tap"'); } catch { return false; }
};
export const openclawRemoveArgs = ["mcp", "unset", "shoulder-tap"];

// ---------- Hermes ----------
const hermesDir = () => process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
export const hermesConfig = () => path.join(hermesDir(), "config.yaml");
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const indentOf = (line) => line.match(/^ */)[0].length;

/** 在 mcp_servers 下找 shoulder-tap 那一段：[起始行, 结束行)；没有就 null。 */
function hermesBlock(lines) {
  const top = lines.findIndex((l) => /^mcp_servers:/.test(l));
  if (top < 0) return null;
  for (let i = top + 1; i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > 0 || lines[i].startsWith("#")); i++) {
    if (!/^ +["']?shoulder-tap["']?:\s*$/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === "" || indentOf(lines[end]) > indentOf(lines[i]))) end++;
    while (end > i + 1 && lines[end - 1].trim() === "") end--; // 段尾的空行留给后面
    return [i, end];
  }
  return null;
}

export function removeFromHermes() {
  const file = hermesConfig();
  const lines = read(file).split("\n");
  const block = hermesBlock(lines);
  if (!block) return null;
  lines.splice(block[0], block[1] - block[0]);
  const top = lines.findIndex((l) => /^mcp_servers:/.test(l));
  const rest = lines.slice(top + 1).find((l) => l.trim() && !l.trimStart().startsWith("#"));
  if (!rest || indentOf(rest) === 0) lines[top] = "mcp_servers: {}"; // 空了就写成空表，别留个 null
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

