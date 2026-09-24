#!/usr/bin/env node
/**
 * shoulder-tap 的 MCP，跑在你自己机器上（stdio）。Claude Code、Codex 这类编程工具都能直接接：
 *
 *   claude mcp add -s user shoulder-tap -- node ~/.claude/skills/shoulder-tap/mcp.mjs
 *
 * 工具本身在 core/tools.mjs。协议只用到 initialize / tools/list / tools/call，手写几十行，不拉 SDK。
 */
import readline from "node:readline";
import { TOOLS, VERSION, callText } from "./core/tools.mjs";

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

async function handle({ id, method, params }) {
  if (method === "initialize")
    return send({ id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "shoulder-tap", version: VERSION } } });
  if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
  if (method === "tools/call") return send({ id, result: { content: [{ type: "text", text: await callText(params.name, params.arguments) }] } });
  if (method === "ping") return send({ id, result: {} });
  if (id !== undefined) send({ id, error: { code: -32601, message: `method not found: ${method}` } }); // 通知（没 id）一律不回
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  handle(req).catch((e) => req.id !== undefined && send({ id: req.id, error: { code: -32603, message: String(e?.message ?? e) } }));
});
