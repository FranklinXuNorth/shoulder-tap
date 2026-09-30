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
import { syncConfig, withLock, pull, push, snapshot, touch } from "./sync.mjs";

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

/** 没人坐在跟前的机器（服务器上跑的 Claude Code / Codex 之类）：.env 里 SHOULDER_TAP_HEADLESS=1，时区跟着用户走，不看服务器。 */
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
    // 每一次保存、修改都记时间戳：操作前拍一张，操作后新出现、变了的行盖上现在的时间，删掉的记下删的时间。
    const d0 = local.load();
    const [before, filled] = snapshot(d0);
    if (filled) local.save(d0); // 老行补上的 rid / updated 要落盘，否则下面对照时认不出来
    const out = await fn();
    { const d = local.load(); touch(d, before); local.save(d); }
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
  // 一次要读好几样（check_focus：记时区、今天的清单、到点的习惯）：整段只锁一次、只拉一次、只推一次。
  // 上面每个函数单独调都各走一遍 localCall，每一遍都要问一次同步服务；fn 拿到的是不带锁的那一套，里面别再调 store 本身（锁不可重入）。
  const bare = {};
  for (const n of NAMES) bare[n] = (...args) => impl[n](token, ...args);
  for (const n of LOCAL_ONLY) bare[n] = useNotion ? async () => undefined : (...args) => local[n](token, ...args);
  store.together = useNotion ? (fn) => fn(store) : (fn) => localCall(sync, () => fn(bare));
  return store;
}

/**
 * 立刻对一次账（login.mjs 登录之后用）：返回拉下来几行、推上去几行、本机现在有多少。连不上就抛错。
 * 超时放宽到 15 秒：这是人盯着的一次性操作，可能要搬几千行；同步服务新建一个账号的存储偶尔也会慢到一两秒。
 * 钩子和 MCP 那边照旧 1.5 秒 —— 那边卡住的是你的每一句话。
 */
export async function syncNow() {
  const cfg = syncConfig(loadEnv());
  if (!cfg) throw new Error("还没登录，也没配同步密钥");
  const sync = { ...cfg, timeoutMs: 15_000 };
  return withLock(local.DATA, async () => {
    const d = local.load();
    const pulled = await pull(sync, d);
    const pushed = await push(sync, d);
    local.save(d);
    return { pulled, pushed, tasks: d.tasks.length, habits: d.habits.length };
  });
}

/**
 * Notion → 本地：整库倒过来，然后这台改用本地存储（云同步只管本地存储）。Notion 里的一条不动，当备份。
 * 行的 rid 由 Notion 页面定，搬几次、几台机器各搬一次，都不会变成两份。
 */
export async function moveNotionToLocal() {
  const { tasks, habits } = await notion.exportAll(loadEnv().NOTION_TOKEN);
  const added = await withLock(local.DATA, () => {
    const d = local.load();
    const have = new Set([...d.tasks, ...d.habits].map((r) => r.rid));
    const t = tasks.filter((r) => !have.has(r.rid));
    const h = habits.filter((r) => !have.has(r.rid));
    d.tasks.push(...t);
    d.habits.push(...h);
    local.save(d);
    return { tasks: t.length, habits: h.length };
  });
  writeConfig({ storage: "local" });
  return added;
}
