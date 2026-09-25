/**
 * OpenClaw（龙虾）和 Hermes Agent 的 MCP 配置。跟 Claude Desktop 一样只有工具、没有钩子：
 * 接上后你让它查清单、记习惯它才调，不会自己拦你、拍你。设置页用 add，卸载用 remove。
 *
 * - OpenClaw：走它自己的 CLI（openclaw mcp add / unset），配置文件格式交给它管。
 *   存在 ~/.openclaw/openclaw.json 的 mcp.servers 里，判断接没接上只看这个文件里有没有 "shoulder-tap"。
 * - Hermes：没有 add 命令，只能改 ~/.hermes/config.yaml 的 mcp_servers。没有 YAML 库，按行改：
 *   只动 shoulder-tap 那一段，别的原样留着。
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
export const openclawAddArgs = (command, mcpPath) => ["mcp", "add", "shoulder-tap", "--command", command, "--arg", mcpPath];
export const openclawRemoveArgs = ["mcp", "unset", "shoulder-tap"];

// ---------- Hermes ----------
export const hermesDir = () => process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
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

export const hermesConnected = () => hermesBlock(read(hermesConfig()).split("\n")) !== null;

/** 双引号字符串在 YAML 里跟 JSON 一个写法，Windows 路径的反斜杠也照样转义。 */
export function addToHermes(command, mcpPath) {
  const file = hermesConfig();
  const lines = read(file).replace(/\r\n/g, "\n").split("\n");
  const old = hermesBlock(lines);
  if (old) lines.splice(old[0], old[1] - old[0]); // 换成现在这个路径
  const top = lines.findIndex((l) => /^mcp_servers:/.test(l));
  const entry = (pad) => [`${pad}shoulder-tap:`, `${pad}  command: ${JSON.stringify(command)}`, `${pad}  args: [${JSON.stringify(mcpPath)}]`];
  if (top < 0) {
    while (lines.length && lines.at(-1).trim() === "") lines.pop();
    lines.push(...(lines.length ? [""] : []), "mcp_servers:", ...entry("  "), "");
  } else {
    lines[top] = "mcp_servers:"; // 「mcp_servers: {}」这种行内写法改成块写法
    const next = lines.slice(top + 1).find((l) => l.trim() && !l.trimStart().startsWith("#"));
    const pad = next && indentOf(next) > 0 ? " ".repeat(indentOf(next)) : "  "; // 跟已有的缩进对齐
    lines.splice(top + 1, 0, ...entry(pad));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  return file;
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

