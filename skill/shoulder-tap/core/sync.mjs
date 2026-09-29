/**
 * 跨机器同步：本地存储（data.json）照旧是真身，这里只负责跟别的机器对账。
 *
 * 每次动数据都是同一个顺序，而且整段拿着 data.json 的文件锁（同一台机器上 Claude Code、Codex、
 * OpenClaw 各开一个 MCP 进程，不锁就会互相覆盖）：
 *
 *   拉：把别的机器推上来的行拉下来并进本地 → 干活（local.mjs 原样）→ 推：把本地改过的行加密推上去
 *
 * 规矩只有一条：谁后到服务端谁赢（按行）。本地改了还没推上去的行，拉下来的旧版本不许盖掉它 ——
 * 它推上去之后自然是后到的那个。连不上就只动本地，没推上去的行下次接着推。
 *
 * 一行 = 一个 rid（随机 UUID）。任务、习惯的每一次、偏好（用户在哪个时区）都是一行。
 * 服务端只见 rid、序号和密文；密钥、频道、口令都从 SHOULDER_TAP_SYNC_KEY 派生，跟加密写法跟 relay 那套一致：
 * HKDF-SHA256 空盐，AES-256-GCM，iv(12)|密文|tag(16)。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const newSyncKey = () => crypto.randomBytes(32).toString("base64url");

/**
 * 配齐了才算开。两种：
 *   登录过（node login.mjs）：设备令牌 + 拆开的同步密钥 → /v2，频道是账号
 *   手填一把同步密钥：从它派生频道、口令、加密密钥 → /v1
 */
export function syncConfig(env) {
  const base = (env.SHOULDER_TAP_SYNC_URL || "").trim().replace(/\/+$/, "");
  const timeoutMs = Number(env.SHOULDER_TAP_SYNC_TIMEOUT_MS) || 1500;
  const device = (env.SHOULDER_TAP_DEVICE_TOKEN || "").trim();
  const vault = (env.SHOULDER_TAP_VAULT_KEY || "").trim();
  if (base && device && vault) return { url: `${base}/v2`, auth: device, key: Buffer.from(vault, "base64url"), timeoutMs };
  const secret = (env.SHOULDER_TAP_SYNC_KEY || "").trim();
  if (!base || !secret) return null;
  const derive = (info) => Buffer.from(crypto.hkdfSync("sha256", secret, "", info, 32));
  return {
    url: `${base}/v1/${derive("shoulder-tap/sync/channel").toString("hex").slice(0, 32)}`,
    auth: derive("shoulder-tap/sync/auth").toString("hex"),
    key: derive("shoulder-tap/sync/key"),
    timeoutMs,
  };
}

export function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}

export function unseal(key, b64) {
  const raw = Buffer.from(b64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8"));
}

// ---------- 文件锁 ----------

/**
 * data.json.lock，用 wx 抢。拿不到就等；锁文件放了超过 staleMs 算是崩掉的进程留下的，直接拆。
 * 拉 + 推各最多 timeoutMs，所以 stale 要比两倍网络超时宽。
 */
export async function withLock(file, fn, staleMs = 10_000) {
  const lock = file + ".lock";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let waited = 0; ; waited += 25) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) fs.rmSync(lock, { force: true }); } catch {}
      if (waited > staleMs * 2) throw new Error("data.json 被别的进程锁着太久了");
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

// ---------- 行 ----------

const hashOf = (row) => crypto.createHash("sha256").update(JSON.stringify(row)).digest("base64url").slice(0, 16);

/** data.json 里所有要同步的行：rid → {kind, row}。老数据没有 rid 的顺手补上。 */
function records(d) {
  const out = new Map();
  for (const kind of ["tasks", "habits"]) for (const row of d[kind]) out.set((row.rid ??= crypto.randomUUID()), { kind, row });
  if (d.prefs) out.set("prefs", { kind: "prefs", row: d.prefs });
  return out;
}

function place(d, kind, rid, row) {
  if (kind === "prefs") return void (d.prefs = row);
  const list = d[kind];
  const i = list.findIndex((r) => r.rid === rid);
  if (i >= 0) list[i] = row;
  else list.push(row);
}

function remove(d, rid) {
  if (rid === "prefs") return void delete d.prefs;
  d.tasks = d.tasks.filter((r) => r.rid !== rid);
  d.habits = d.habits.filter((r) => r.rid !== rid);
}

/**
 * 两台机器离线时各自记了同一个习惯：会出现同一个 sid 的两行 pending。
 * 留激活时间最晚的那行，别的删掉。每台机器算出来的结果一样，所以会收敛，不会来回打架。
 */
function dedupePending(d) {
  const keep = new Map();
  for (const h of d.habits) {
    if ((h.status ?? "pending") !== "pending") continue;
    const cur = keep.get(h.sid);
    const at = h.activated ?? h.last ?? "";
    if (!cur || at > (cur.activated ?? cur.last ?? "") || (at === (cur.activated ?? cur.last ?? "") && h.rid > cur.rid)) keep.set(h.sid, h);
  }
  d.habits = d.habits.filter((h) => (h.status ?? "pending") !== "pending" || keep.get(h.sid) === h);
}

async function request(cfg, path, init = {}) {
  const res = await fetch(cfg.url + path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.auth}` },
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) throw new Error(`sync ${path} → ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

/** 拉下来并进 d（原地改）。返回拉到了几行；连不上抛错，由调用方决定吞掉。 */
export async function pull(cfg, d) {
  d.sync ??= { cursor: 0, hashes: {} };
  const { hashes } = d.sync;
  let got = 0;
  for (;;) {
    const page = await request(cfg, `/pull?since=${d.sync.cursor}`);
    const mine = records(d);
    for (const r of page.rows) {
      const local = mine.get(r.rid);
      // 本地改过（或删过）还没推上去：本地这版会后到，留着它。
      if (local ? hashOf(local.row) !== hashes[r.rid] : r.rid in hashes) continue;
      if (r.deleted) {
        remove(d, r.rid);
        delete hashes[r.rid];
      } else {
        const { kind, row } = unseal(cfg.key, r.blob);
        place(d, kind, r.rid, row);
        hashes[r.rid] = hashOf(row);
      }
      got++;
    }
    d.sync.cursor = page.seq;
    if (!page.more) break;
  }
  dedupePending(d);
  return got;
}

/** 本地改过、删过的行推上去。没有要推的就不碰网络。返回推了几行。 */
export async function push(cfg, d) {
  d.sync ??= { cursor: 0, hashes: {} };
  const { hashes } = d.sync;
  const mine = records(d);
  const rows = [];
  for (const [rid, { kind, row }] of mine)
    if (hashOf(row) !== hashes[rid]) rows.push({ rid, blob: seal(cfg.key, { kind, row }), hash: hashOf(row) });
  for (const rid of Object.keys(hashes)) if (!mine.has(rid)) rows.push({ rid, deleted: true });
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await request(cfg, "/push", { method: "POST", body: JSON.stringify({ rows: batch.map(({ hash, ...r }) => r) }) });
    for (const r of batch) r.deleted ? delete hashes[r.rid] : (hashes[r.rid] = r.hash);
  }
  return rows.length;
}
