/** Codex 接入：MCP、生命周期钩子、全局规则必须一起安装；保留用户的其它配置。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const START = "<!-- shoulder-tap:codex -->";
const END = "<!-- /shoulder-tap:codex -->";
const hookCommand = (node, skill) => {
  const quote = (p) => process.platform === "win32" ? JSON.stringify(p.replace(/\\/g, "/")) : "'" + p.replace(/'/g, "'\"'\"'") + "'";
  return `${quote(node)} ${quote(path.join(skill, "watch.mjs"))} --agent codex`;
};
const EVENTS = ["UserPromptSubmit", "PostToolUse", "Stop", "PreToolUse"];
const read = (p) => fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
const owned = (h) => /shoulder-tap[\\/]+watch\.mjs/.test(String(h.command));

// 只删本工具的 TOML 表及其子表，其它表、注释、凭据均原样保留。
export function removeCodexMcp(text) {
  let dropping = false;
  return text.split(/(?<=\n)/).filter((line) => {
    if (/^\s*\[/.test(line)) dropping = /^\s*\[mcp_servers\.(?:shoulder-tap|"shoulder-tap"|'shoulder-tap')(?:\.|\])/.test(line);
    return !dropping;
  }).join("");
}

export const codexMcpBlock = (node = process.execPath, skill = SKILL) =>
  `[mcp_servers.shoulder-tap]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(path.join(skill, "mcp.mjs"))}]\nenabled = true\n`;

export function removeCodexHooks(settings) {
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups.map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !owned(h)) })).filter((g) => g.hooks.length);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

export function removeCodexRules(text) {
  return text.replace(/<!-- shoulder-tap:codex -->[\s\S]*?<!-- \/shoulder-tap:codex -->\r?\n?/g, "");
}

export function codexState({ home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), skill = SKILL, node = process.execPath } = {}) {
  const text = read(path.join(home, "config.toml"));
  const block = text.match(/^\s*\[mcp_servers\.(?:shoulder-tap|"shoulder-tap"|'shoulder-tap')\][^\n]*\n([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m)?.[1] || "";
  const mcp = block.includes(JSON.stringify(path.join(skill, "mcp.mjs"))) && block.includes(JSON.stringify(node)) && !/^\s*enabled\s*=\s*false/m.test(block) && !/^\s*url\s*=/m.test(block);
  let hooks = {};
  try { hooks = JSON.parse(read(path.join(home, "hooks.json"))).hooks ?? {}; } catch {}
  const command = hookCommand(node, skill);
  const hooked = EVENTS.every((event) => (hooks[event] ?? []).some((g) =>
    (event !== "PostToolUse" || g.matcher === "*") &&
    (event !== "PreToolUse" || g.matcher === "request_user_input|request_user_input_async") &&
    (g.hooks ?? []).some((h) => h.type === "command" && h.command === command)));
  const rules = read(path.join(home, "AGENTS.md")).includes(START) && read(path.join(home, "AGENTS.md")).includes(END);
  return { mcp, hooks: hooked, rules, connected: mcp && hooked && rules, remote: !!block && !mcp };
}

export function connectCodex({ home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), skill = SKILL, node = process.execPath, snippet } = {}) {
  // 先读取、校验全部输入，损坏的 JSON 不能被当成空配置覆盖。
  const configPath = path.join(home, "config.toml"), hooksPath = path.join(home, "hooks.json"), agentsPath = path.join(home, "AGENTS.md");
  const config = read(configPath), agents = read(agentsPath);
  const settings = JSON.parse(read(hooksPath) || "{}");
  snippet ??= read(path.join(skill, "AGENTS.md.snippet")) || read(path.join(skill, "..", "CLAUDE.md.snippet"));
  if (!snippet.trim()) throw new Error("Missing shoulder-tap agent rules; rerun install.mjs.");
  removeCodexHooks(settings);
  settings.hooks ??= {};
  const command = hookCommand(node, skill);
  for (const event of EVENTS) {
    const matcher = { PostToolUse: "*", PreToolUse: "request_user_input|request_user_input_async" }[event];
    const group = { hooks: [{ type: "command", command, timeout: 10 }] };
    if (matcher) group.matcher = matcher;
    (settings.hooks[event] ??= []).push(group);
  }
  const body = snippet.replace(/^<!--[\s\S]*?-->\s*/, "").trim();
  const managed = `${START}\n${body}\n${END}\n`;
  const nextAgents = agents.includes(START)
    ? agents.replace(/<!-- shoulder-tap:codex -->[\s\S]*?<!-- \/shoulder-tap:codex -->\r?\n?/, () => managed)
    : agents + (agents && !agents.endsWith("\n") ? "\n" : "") + managed;
  fs.mkdirSync(home, { recursive: true });
  for (const [p, next] of [[configPath, removeCodexMcp(config).trimEnd() + "\n\n" + codexMcpBlock(node, skill)], [hooksPath, JSON.stringify(settings, null, 2) + "\n"], [agentsPath, nextAgents]]) {
    if (read(p) !== next) fs.writeFileSync(p, next);
  }
  return codexState({ home, skill, node });
}
