#!/usr/bin/env node
/**
 * shoulder-tap 的页面。托盘 / 菜单栏点一下就跑它：在 127.0.0.1 上起一个只给本机看的小服务，用浏览器打开。
 *
 *   node ~/.claude/skills/shoulder-tap/onboard.mjs [--hands | --setup]
 *
 * 同一页（ui/app.html），默认是首页：「重新走一遍设置」「选择皮肤」两个入口，下面是待办和习惯的所有记录。
 * --setup 直接进引导（编程工具 → 第一个习惯 → 今天的事 → 数据放哪 → 手 → 试一下）：只有第一次启动和安装时这么开。
 * 端口被占着说明已经开着一个，直接把浏览器指过去。页面半小时没请求就自己退出。
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
import { pageIdFrom, NotionError } from "./core/notion.mjs";
import { STRINGS } from "./core/strings.mjs";
import { readUpdate, repoDir } from "./core/update.mjs";
import * as local from "./core/local.mjs";
import { claudeDesktopState, addToClaudeDesktop } from "./core/claude-desktop.mjs";
import { openclawConnected, openclawAddArgs, hermesDir, hermesConnected, addToHermes } from "./core/other-agents.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47823;
const URL_ = `http://127.0.0.1:${PORT}/`;
const MCP = path.join(HERE, "mcp.mjs");
const ENV = path.join(HERE, ".env");
const CODEX = path.join(os.homedir(), ".codex", "config.toml");
const APP = path.join(STATE_DIR, "app", // 跟 watch.mjs 里同一个位置
  process.platform === "win32" ? "shoulder-tap-tap.exe" : process.platform === "darwin" ? "ShoulderTap.app/Contents/MacOS/shoulder-tap-tap" : "shoulder-tap-tap");

// 页面上给人看的字都在 core/strings.mjs 里，跟着页面右上角那个语言开关走：
// 页面每个请求都带 lang，别处（curl、老页面）没带就按中文。
const msg = (lang) => STRINGS[lang] ?? STRINGS.zh;

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

// 菜单栏那个 app 是 launchd 起的，它的 PATH 里没有你 shell 的那几段：装在 ~/.local/bin（官方安装器）、
// nvm、volta 里的 claude，用 which 一律找不到，页面就会说「没找到」。所以 which 找不到时再问一次登录
// shell，最后翻几个常见位置。找到就一路用绝对路径调，别再指望 PATH。
const FALLBACK_DIRS = [
  path.join(os.homedir(), ".local", "bin"),
  path.join(os.homedir(), ".claude", "local"),
  path.join(os.homedir(), ".bun", "bin"),
  path.join(os.homedir(), ".volta", "bin"),
  path.join(os.homedir(), ".npm-global", "bin"),
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
];
const found = new Map();
function resolveBin(bin) {
  if (found.has(bin)) return found.get(bin);
  const pick = () => {
    const which = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
    if (which.status === 0) return which.stdout.split("\n")[0].trim();
    if (process.platform !== "win32") {
      // -lic：PATH 常常是在 .zshrc / .bashrc 里加的，那只有交互式 shell 才读。两秒不回就算了。
      const r = spawnSync(process.env.SHELL || "/bin/zsh", ["-lic", `command -v ${bin}`], { encoding: "utf8", timeout: 2000 });
      const hit = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean).pop();
      if (hit && path.isAbsolute(hit) && fs.existsSync(hit)) return hit;
    }
    const exe = process.platform === "win32" ? bin + ".exe" : bin;
    return FALLBACK_DIRS.map((d) => path.join(d, exe)).find((f) => fs.existsSync(f)) || null;
  };
  const hit = pick();
  found.set(bin, hit);
  return hit;
}
const has = (bin) => Boolean(resolveBin(bin));
const sh = (cmd, args) => spawnSync(resolveBin(cmd) || cmd, args, { encoding: "utf8", shell: process.platform === "win32", windowsHide: true });

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
    codex: { installed: has("codex") || fs.existsSync(CODEX), connected: codexText.includes("[mcp_servers.shoulder-tap]") },
    desktop: claudeDesktopState(), // Claude Desktop、OpenClaw、Hermes：只有工具，没有钩子
    openclaw: { installed: has("openclaw"), connected: openclawConnected() },
    hermes: { installed: has("hermes") || fs.existsSync(hermesDir()), connected: hermesConnected() },
    command: ["claude", ...claudeArgs].map(quote).join(" "),
    codexBlock: codexBlock.trim(),
    openclawCommand: ["openclaw", ...openclawAddArgs(process.execPath, MCP)].map(quote).join(" "),
    hermesBlock: `mcp_servers:\n  shoulder-tap:\n    command: ${JSON.stringify(process.execPath)}\n    args: [${JSON.stringify(MCP)}]`,
    onboard: path.join(HERE, "onboard.mjs"),
  };
}

function connect(client, lang) {
  const m = msg(lang);
  if (client === "claude") {
    sh("claude", ["mcp", "remove", "-s", "user", "shoulder-tap"]); // 以前接过远程版的，先换掉
    const r = sh("claude", claudeArgs);
    if (r.status !== 0) throw new Error(`${resolveBin("claude") ?? "claude"} ${(r.stderr || r.stdout || m.addFailed).trim()}`);
    return m.claude;
  }
  if (client === "codex") {
    fs.mkdirSync(path.dirname(CODEX), { recursive: true });
    const text = fs.existsSync(CODEX) ? fs.readFileSync(CODEX, "utf8") : "";
    if (!text.includes("[mcp_servers.shoulder-tap]")) fs.writeFileSync(CODEX, text.trimEnd() + "\n" + codexBlock);
    return m.codex;
  }
  if (client === "desktop") {
    try { addToClaudeDesktop(process.execPath, MCP); }
    catch (e) { throw new Error(e?.code === "no_claude_desktop" ? m.noDesktopApp : String(e?.message ?? e)); }
    return m.desktop;
  }
  if (client === "openclaw") {
    const r = sh("openclaw", openclawAddArgs(process.execPath, MCP));
    if (r.status !== 0) throw new Error(`${resolveBin("openclaw") ?? "openclaw"} ${(r.stderr || r.stdout || m.addFailed).trim()}`);
    return m.openclaw;
  }
  if (client === "hermes") { addToHermes(process.execPath, MCP); return m.hermes; }
  throw new Error(m.unknownClient);
}

function setEnv(key, value) {
  const text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  fs.writeFileSync(ENV, re.test(text) ? text.replace(re, line) : text.trimEnd() + (text ? "\n" : "") + line + "\n");
}

/** 选了 Notion：建库（或接管），再把前几步记在本地的习惯和今天的清单搬过去。Notion 里已有的不动。 */
async function useNotion(token, page, lang) {
  const m = msg(lang);
  if (!/^(ntn_|secret_)/.test(token)) throw new Error(m.badToken);
  setEnv("NOTION_TOKEN", token);
  writeConfig({ storage: "notion" });
  // 跟 setup 那个工具做的是同一件事，只是这句话要跟着页面的语言走
  const setup = await (async () => {
    const id = pageIdFrom(page);
    const adopted = await notion.adoptDatabase(token, id).catch(() => undefined);
    return adopted ? m.adopted(adopted.title, adopted.added) : m.created((await notion.createDatabase(token, id)).url ?? id);
  })().catch((e) => { throw new Error(e instanceof NotionError ? m.notionSays(e) : String(e?.message ?? e)); });

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
    moved.push(m.movedTasks(today.length));
  }
  return setup + (moved.length ? m.moved(moved) : "");
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
    history: await store.habitHistory(30).catch(() => []),
    today: await store.listDay(win).catch(() => []),
    // 最近两周的任务，按天分组给页面；时间都是 UTC，页面按本机时区显示
    tasks: await store.taskHistory(new Date(Date.parse(win.startUtc) - 13 * 86400_000).toISOString()).catch(() => []),
    skin: readConfig().skin ?? "glove",
    update: { behind: readUpdate().behind ?? 0 },
    showSec: readConfig().showSec ?? 8, // 手和字条在屏幕上停几秒，桌面端每次拍之前重读
    motion: readConfig().motion ?? "system", // "always" = 无视系统的「减弱动态效果」，照常逐帧播
    skins: listSkins(),
    desktop: fs.existsSync(APP),
  };
}

const WRITES = new Set(["/api/task", "/api/log", "/api/today", "/api/habit", "/api/storage"]);
const routes = {
  "GET /api/state": () => state(),
  "POST /api/mcp": ({ client }, lang) => ({ message: connect(client, lang) }),
  // 习惯这两条不走 callText：工具那套话是写给模型看的中文，页面要跟着自己的语言开关
  "POST /api/habit": async ({ name, kind, every_minutes, at }, lang) => {
    const m = msg(lang);
    if (!every_minutes && !at) throw new Error(m.needWhen);
    const tz = notion.requireTz(machineTz());
    await openStore().addHabit(String(name).trim(), every_minutes ?? 0, "", tz, at, kind === "soft" ? "soft" : "hard");
    return { message: m.habitAdded({ name: String(name).trim(), at, everyMin: every_minutes, kind }) };
  },
  "POST /api/today": async ({ tasks }) => ({ message: await callText("set_focus", { tasks: tasks.map((task) => ({ task })) }) }),
  "POST /api/storage": async ({ mode, token, page }, lang) => {
    if (mode === "local") { writeConfig({ storage: "local" }); return { message: msg(lang).localData(local.DATA) }; }
    return { message: await useNotion(String(token || "").trim(), String(page || "").trim(), lang) };
  },
  // 更新要重跑 install.mjs（会换掉这个 skill 目录、重启桌面端），所以甩到独立进程里，输出写进 update.log。
  "POST /api/update": (_, lang) => {
    if (!repoDir()) throw new Error(msg(lang).noRepo);
    const out = fs.openSync(path.join(STATE_DIR, "update.log"), "w");
    spawn(process.execPath, [path.join(HERE, "update.mjs")], { detached: true, stdio: ["ignore", out, out], windowsHide: true }).unref();
    return { message: msg(lang).updating };
  },
  "POST /api/finish": (_, lang) => { writeConfig({ onboarded: true }); return { message: msg(lang).saved }; },
  // install.mjs 换完代码后调这个：还开着的旧服务退掉，下次点托盘图标起来的就是新代码。
  "POST /api/quit": () => { setTimeout(() => process.exit(0), 50); return {}; },
  "GET /api/ping": () => ({}), // 页面开着就隔一会儿来一下，服务知道还有人在看
  // 首页里勾掉 / 放弃一条、记一笔习惯：都是你自己点的，跟你在对话里说一样
  // 待办的三种状态（待做 / 完成 / 今天不做）互相切，设置页的下拉框用。
  "POST /api/task": async ({ id, status }, lang) => {
    if (!["pending", "done", "dropped"].includes(status)) throw new Error(msg(lang).badStatus(status));
    if (!(await openStore().setTaskStatus(id, status))) throw new Error(msg(lang).noTask);
    return {};
  },
  "POST /api/log": async ({ habit, skip, note }, lang) => {
    const m = msg(lang);
    const hit = await openStore().logHabit(habit, notion.requireTz(machineTz()), note, skip === true);
    if (!hit) throw new Error(m.noHabit(habit));
    return { message: hit.refused ? m.refused(hit.name) : skip === true ? m.skipped(hit.name) : m.logged(hit) };
  },
  // 在屏幕上真拍一下：习惯那一步试 tap，手势页三种都能试。没装桌面端就说没装。
  "POST /api/tap": ({ mode = "tap", text = "" }, lang) => {
    if (!["tap", "complete", "snap"].includes(mode)) throw new Error(msg(lang).badGesture(mode));
    if (!fs.existsSync(APP)) return { tapped: false };
    const t = String(text).trim().slice(0, 160);
    const args = ["--mode", mode, "--source-pid", String(process.pid), "--text", t || msg(lang).tryOnce, ...(t ? ["--caption", t] : [])];
    spawn(APP, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return { tapped: true };
  },
  // 手的样式：ui/sprites/skins/<名字>/{tap,pat,snap}.png。桌面端每次拍之前重读 config.json 的 skin。
  "POST /api/hands": ({ skin, motion, showSec }, lang) => {
    if (showSec !== undefined) {
      if (!(Number.isFinite(showSec) && showSec >= 3 && showSec <= 60)) throw new Error(msg(lang).badShowSec(showSec));
      writeConfig({ showSec });
      return { message: msg(lang).showSaved(showSec) };
    }
    // 系统开着「减弱动态效果」时手会停住不动（看着像坏了）；motion: "always" 是给想看动画的人的开关。
    if (motion !== undefined) {
      if (!["system", "always"].includes(motion)) throw new Error(msg(lang).badMotion(motion));
      writeConfig({ motion });
      if (skin === undefined) return { message: motion };
    }
    if (!listSkins().includes(skin)) throw new Error(msg(lang).badSkin(skin));
    writeConfig({ skin });
    return { message: skin };
  },
};

// ponytail: 靠页面每分钟 ping 一次判断还开着；半小时没动静再退出。
// Chrome 会冻结后台标签页、停掉 ping，给久一点，回来时大多还连得上；真断了页面会说点托盘图标重开。
let bye = null;
const idle = () => { clearTimeout(bye); bye = setTimeout(() => process.exit(0), 30 * 60_000); };

const SKINS = path.join(HERE, "ui", "sprites", "skins");
const listSkins = () => fs.readdirSync(SKINS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && ["tap", "pat", "snap"].every((n) => fs.existsSync(path.join(SKINS, d.name, n + ".png"))))
  .map((d) => d.name);

const server = http.createServer(async (req, res) => {
  const send = (status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); // png 是 Buffer，别 JSON 化
  };
  // 只认本机来的请求：防止别的网页借你的浏览器往这里 POST。
  const origin = req.headers.origin;
  if (origin && origin !== URL_.slice(0, -1)) return send(403, { error: "forbidden" });
  idle();

  if (req.method === "GET" && req.url.split("?")[0] === "/") {
    // 加载动画在 /api/state 回来之前就要跑，所以 motion 直接写进 html 标签，页面不用等。
    // 系统开着「减弱动态效果」时页面本来会整段跳过；config.json 里 motion: "always" 就照常播。
    const page = fs.readFileSync(path.join(HERE, "ui", "app.html"), "utf8")
      .replace("<html ", `<html data-motion="${readConfig().motion ?? "system"}" `)
      // 中英两份字只有 core/strings.mjs 一份，页面那边是内联进去的，不多要一次请求
      .replace("// __STRINGS__", () => fs.readFileSync(path.join(HERE, "core", "strings.mjs"), "utf8").replace(/^export /m, ""));
    return send(200, page, "text/html; charset=utf-8");
  }
  const sprite = req.method === "GET" && /^\/skins\/([\w-]+)\/(tap|pat|snap)\.(png|webp)$/.exec(req.url);
  if (sprite) {
    // current = 正在用的那套：打开页面时的加载动画要在数据到之前就知道用哪只手
    const skin = sprite[1] === "current" ? readConfig().skin ?? "glove" : sprite[1];
    const base = path.join(SKINS, skin, sprite[2]);
    // 网页要 webp（make-webp.py 生成）；自己加的皮肤只有 png 也照样能看
    const [file, type] = sprite[3] === "webp" && fs.existsSync(base + ".webp") ? [base + ".webp", "image/webp"] : [base + ".png", "image/png"];
    return fs.existsSync(file) ? send(200, fs.readFileSync(file), type) : send(404, { error: "not found" });
  }
  const [pathname, query] = req.url.split("?");
  const lang = new URLSearchParams(query).get("lang") === "en" ? "en" : "zh"; // 页面上给人看的字跟着它走
  const route = routes[`${req.method} ${pathname}`];
  if (!route) return send(404, { error: "not found" });
  let body = {};
  if (req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { body = JSON.parse(raw || "{}"); } catch { return send(400, { error: "bad json" }); }
  }
  try {
    send(200, await route(body, lang));
    // 清单、习惯在页面上一改，钩子里缓存的那份也马上重拉：模型下一句看到的就是新的，不用等十分钟
    if (WRITES.has(pathname)) spawn(process.execPath, [path.join(HERE, "watch.mjs"), "--refresh"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch (e) {
    send(400, { error: String(e?.message ?? e) });
  }
});

const OPEN = URL_ + (process.argv.includes("--hands") ? "#hands" : process.argv.includes("--setup") ? "#setup" : "");
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") { openBrowser(OPEN); process.exit(0); } // 已经开着一个
  throw e;
});
server.listen(PORT, "127.0.0.1", () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!process.argv.includes("--no-open")) openBrowser(OPEN);
  idle();
  console.log(`shoulder-tap：${URL_}`);
});
