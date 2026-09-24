#!/usr/bin/env node
/**
 * 设置页。桌面端第一次打开、或者托盘里点「设置…」时跑它：
 * 在 127.0.0.1 上起一个只给本机看的小服务，用浏览器打开，设置完自己退出。
 *
 *   node ~/.claude/skills/shoulder-tap/onboard.mjs
 *
 * 四步：接上编程工具的 MCP → 第一个习惯 → 今天要做的事 → 数据放哪（本地 / 你自己的 Notion）。
 * 端口被占着说明已经开着一个，直接把浏览器指过去。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { callText } from "./core/tools.mjs";
import { STATE_DIR, loadEnv, readConfig, writeConfig, machineTz, openStore } from "./core/store.mjs";
import * as notion from "./core/focus.mjs";
import * as local from "./core/local.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47823;
const URL_ = `http://127.0.0.1:${PORT}/`;
const MCP = path.join(HERE, "mcp.mjs");
const ENV = path.join(HERE, ".env");
const CODEX = path.join(os.homedir(), ".codex", "config.toml");

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

const has = (bin) => spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }).status === 0;
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", windowsHide: true });

// 路径里有空格也不怕：两边都用绝对路径，node 也用当前这个。
const claudeArgs = ["mcp", "add", "-s", "user", "shoulder-tap", "--", process.execPath, MCP];
const codexBlock = `\n[mcp_servers.shoulder-tap]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(MCP)}]\n`;
const quote = (a) => (/\s/.test(a) ? `"${a}"` : a);

function mcpState() {
  const codexText = fs.existsSync(CODEX) ? fs.readFileSync(CODEX, "utf8") : "";
  // 只有指向本机 mcp.mjs 的才算接上；以前接的远程版（http）要能一键换掉。
  const got = has("claude") ? sh("claude", ["mcp", "get", "shoulder-tap"]) : { status: 1, stdout: "" };
  return {
    claude: { installed: has("claude"), connected: got.status === 0 && got.stdout.includes("mcp.mjs"), remote: got.status === 0 && !got.stdout.includes("mcp.mjs") },
    codex: { installed: has("codex") || fs.existsSync(path.dirname(CODEX)), connected: codexText.includes("[mcp_servers.shoulder-tap]") },
    command: ["claude", ...claudeArgs].map(quote).join(" "),
    codexBlock: codexBlock.trim(),
    onboard: path.join(HERE, "onboard.mjs"),
  };
}

function connect(client) {
  if (client === "claude") {
    sh("claude", ["mcp", "remove", "-s", "user", "shoulder-tap"]); // 以前接过远程版的，先换掉
    const r = sh("claude", claudeArgs);
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || "claude mcp add 失败").trim());
    return "Claude Code 接上了。已经开着的会话要重开一次才看得到新工具。";
  }
  if (client === "codex") {
    fs.mkdirSync(path.dirname(CODEX), { recursive: true });
    const text = fs.existsSync(CODEX) ? fs.readFileSync(CODEX, "utf8") : "";
    if (!text.includes("[mcp_servers.shoulder-tap]")) fs.writeFileSync(CODEX, text.trimEnd() + "\n" + codexBlock);
    return "Codex 接上了（写进了 ~/.codex/config.toml）。重开一次 Codex 生效。";
  }
  throw new Error("不认识的客户端");
}

function setEnv(key, value) {
  const text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  fs.writeFileSync(ENV, re.test(text) ? text.replace(re, line) : text.trimEnd() + (text ? "\n" : "") + line + "\n");
}

/** 选了 Notion：建库（或接管），再把前几步记在本地的习惯和今天的清单搬过去。Notion 里已有的不动。 */
async function useNotion(token, page) {
  if (!/^(ntn_|secret_)/.test(token)) throw new Error("这不像 Notion integration 的密钥（应该是 ntn_ 开头）");
  setEnv("NOTION_TOKEN", token);
  writeConfig({ storage: "notion" });
  const setup = await callText("setup", { notion_page: page });
  if (/^(Notion 说|出错了)/.test(setup)) throw new Error(setup);

  const tz = machineTz();
  const win = notion.dayWindow(tz);
  const moved = [];
  const have = new Set((await notion.listHabits(token)).map((h) => h.name));
  for (const h of await local.listHabits()) {
    if (have.has(h.name)) continue;
    await notion.addHabit(token, h.name, h.everyMin, "", h.tz || tz, h.at, h.kind);
    moved.push(h.name);
  }
  const today = await local.listDay(null, win);
  if (today.length && !(await notion.listDay(token, win)).length) {
    await notion.setDay(token, win, today.map((t) => ({ task: t.task, note: t.note })), tz);
    moved.push(`今天的 ${today.length} 件事`);
  }
  return setup + (moved.length ? `\n搬到 Notion 的：${moved.join("、")}` : "");
}

async function state() {
  const store = openStore();
  const tz = machineTz();
  const win = notion.dayWindow(tz);
  return {
    tz,
    storage: store.kind,
    hasNotionToken: Boolean(loadEnv().NOTION_TOKEN),
    onboarded: Boolean(readConfig().onboarded),
    mcp: mcpState(),
    habits: await store.listHabits().catch(() => []),
    today: await store.listDay(win).catch(() => []),
  };
}

const routes = {
  "GET /api/state": () => state(),
  "POST /api/mcp": ({ client }) => ({ message: connect(client) }),
  "POST /api/habit": async ({ name, kind, every_minutes, at }) => ({ message: await callText("add_habit", { name, kind, every_minutes, at }) }),
  "POST /api/today": async ({ tasks }) => ({ message: await callText("set_focus", { tasks: tasks.map((task) => ({ task })) }) }),
  "POST /api/storage": async ({ mode, token, page }) => {
    if (mode === "local") { writeConfig({ storage: "local" }); return { message: "就放在这台机器上：" + local.DATA }; }
    return { message: await useNotion(String(token || "").trim(), String(page || "").trim()) };
  },
  "POST /api/finish": () => {
    writeConfig({ onboarded: true });
    setTimeout(() => process.exit(0), 300);
    return { message: "好了。" };
  },
};

const server = http.createServer(async (req, res) => {
  const send = (status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  // 只认本机来的请求：防止别的网页借你的浏览器往这里 POST。
  const origin = req.headers.origin;
  if (origin && origin !== URL_.slice(0, -1)) return send(403, { error: "forbidden" });

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html"))
    return send(200, fs.readFileSync(path.join(HERE, "ui", "onboard.html"), "utf8"), "text/html; charset=utf-8");
  const route = routes[`${req.method} ${req.url}`];
  if (!route) return send(404, { error: "not found" });
  let body = {};
  if (req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { body = JSON.parse(raw || "{}"); } catch { return send(400, { error: "bad json" }); }
  }
  try {
    send(200, await route(body));
  } catch (e) {
    send(400, { error: String(e?.message ?? e) });
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") { openBrowser(URL_); process.exit(0); } // 已经开着一个
  throw e;
});
server.listen(PORT, "127.0.0.1", () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!process.argv.includes("--no-open")) openBrowser(URL_);
  console.log(`shoulder-tap 设置页：${URL_}`);
});
