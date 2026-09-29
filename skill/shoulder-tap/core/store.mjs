/**
 * 数据放哪：本地 JSON（默认）或者你自己的 Notion。两边同一套函数，调用方不用管是哪个。
 *
 * 选哪个写在 ~/.claude/shoulder-tap/config.json 的 storage 字段，onboarding 页面负责写它。
 * Notion 的密钥从 skill 的 .env 读（NOTION_TOKEN）。两种都不经过 shoulder-tap 的任何服务器：
 * 本地就是这台机器上的一个文件，Notion 是这台机器直接去连你自己的 Notion。
 *
 * 本地存储可以再开跨机器同步（.env 里配 SHOULDER_TAP_SYNC_URL + SHOULDER_TAP_SYNC_KEY，见 sync.mjs）：
 * 中转只经手密文。Notion 本来就在云上，几台机器连同一个库就是同步，不走这条。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as notion from "./focus.mjs";
import * as local from "./local.mjs";
import { syncConfig, withLock, pull, push } from "./sync.mjs";

export const STATE_DIR = path.join(os.homedir(), ".claude", "shoulder-tap");
export const CONFIG = path.join(STATE_DIR, "config.json");
const ENV_FILES = [
  path.join(os.homedir(), ".claude", "skills", "shoulder-tap", ".env"),
  path.join(STATE_DIR, ".env"),
];

export function loadEnv() {
  const out = { ...process.env };
  for (const file of ENV_FILES) {
    try {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (line.trim().startsWith("#")) continue;
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return out;
}

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), ...patch }, null, 2), "utf8");
}

/** 这台机器的时区。不写死、不猜：从系统读，用户换了地方它自己就变。 */
export const machineTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const NAMES = ["listDay", "setDay", "addItem", "setStatus", "setTaskStatus", "listHabits", "overdueHabits", "addHabit", "logHabit", "stopHabit", "habitHistory", "taskHistory"];
const LOCAL_ONLY = ["userTz", "noteTz"];

/** 没人坐在跟前的机器（服务器上的 OpenClaw 之类）：.env 里 SHOULDER_TAP_HEADLESS=1，时区跟着用户走，不看服务器。 */
export const isHeadless = () => loadEnv().SHOULDER_TAP_HEADLESS === "1";

/**
 * 本地存储的每一次读写：锁住 data.json → 拉 → 干活 → 推。
 * 同步没开也要锁：同一台机器上几个 agent 各开一个 MCP 进程，读改写交错就会丢一条。
 * 拉推失败只丢进 lastSyncError，不拦这一下 —— 连不上就是单机模式，没推上去的下次再推。
 */
function localCall(sync, fn) {
  return withLock(local.DATA, async () => {
    if (sync) {
      const d = local.load();
      try { await pull(sync, d); local.save(d); } catch (e) { lastSyncError = e; }
    }
    const out = await fn();
    if (sync) {
      const d = local.load();
      try { if (await push(sync, d)) local.save(d); } catch (e) { lastSyncError = e; local.save(d); }
    }
    return out;
  });
}
export let lastSyncError = null;

/** 返回一组已经绑好后端的函数：store.listDay(win)、store.addHabit(name, …)，不用再传 token。 */
export function openStore() {
  const token = loadEnv().NOTION_TOKEN;
  // 没选过（onboarding 之前就装了的老用户）但配了 Notion 密钥：照旧用 Notion，别让清单凭空变空。
  const chosen = readConfig().storage ?? (token ? "notion" : "local");
  const useNotion = chosen === "notion" && token;
  const impl = useNotion ? notion : local;
  const sync = useNotion ? null : syncConfig(loadEnv());
  const store = { kind: useNotion ? "notion" : "local", token, synced: Boolean(sync) };
  for (const n of NAMES) store[n] = useNotion ? (...args) => impl[n](token, ...args) : (...args) => localCall(sync, () => impl[n](token, ...args));
  for (const n of LOCAL_ONLY) store[n] = useNotion ? async () => undefined : (...args) => localCall(sync, () => local[n](token, ...args));
  return store;
}
