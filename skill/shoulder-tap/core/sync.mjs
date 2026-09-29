/**
 * 跨机器同步：本地存储（data.json）照旧是真身，这里只负责跟别的机器对账。
 *
 * 每次动数据都是同一个顺序，而且整段拿着 data.json 的文件锁（同一台机器上 Claude Code、Codex、
 * OpenClaw 各开一个 MCP 进程，不锁就会互相覆盖）：
 *
 *   拉：把别的机器推上来的行拉下来并进本地 → 干活（local.mjs 原样）→ 推：把本地改过的行加密推上去
 *
 * 冲突按时间戳：每一行记着最后一次被改的时刻（row.updated，删掉的记在 d.gone 里）。两台机器改了同一行，
 * 留最后改的那次 —— 跟谁先连上网、谁先推无关。服务端也按这个收：比它手上旧的不写，退回它那份（stale）。
 * 连不上就只动本地，没推上去的行下次接着推，时间戳还是当初改的那一刻。
 * 时间戳用的是各台机器自己的钟：钟差多少，「谁更新」就可能差多少。系统时间都开着自动校准就够了。
 *
 * 一行 = 一个 rid（随机 UUID）。任务、习惯的每一次、偏好（用户在哪个时区）都是一行。
 * 服务端只见 rid、序号和密文；密钥、频道、口令都从 SHOULDER_TAP_SYNC_KEY 派生，跟加密写法跟 relay 那套一致：
 * HKDF-SHA256 空盐，AES-256-GCM，iv(12)|密文|tag(16)。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const newSyncKey = () => crypto.randomBytes(32).toString("base64url");

/**
 * 这台设备是谁：主机名 + 用户名 + 主目录算出来的稳定 ID，不用存。同一台机器重新登录，服务端据此作废旧令牌；
 * 「这个账号下几个设备」也按它数。label 给人看（设置页 / 网页版的设备列表）。
 */
export function deviceId() {
  let user = "";
  try { user = os.userInfo().username; } catch {}
  return crypto.createHash("sha256").update(`${os.hostname()}|${user}|${os.homedir()}`).digest("hex").slice(0, 24);
}
export const deviceLabel = () => process.env.SHOULDER_TAP_DEVICE_LABEL ||
  `${os.hostname()} · ${process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : process.platform}`;

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
      // Windows：锁文件刚被删、还有别的句柄（杀毒软件常干这事）开着时，会报 EPERM / EACCES / EBUSY 而不是 EEXIST —— 都当「有人占着」，等一下再抢
      if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
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
/** 内容指纹：不算 updated 自己，不然每盖一次戳都像是又改了一次。 */
const contentOf = (row) => { const { updated, ...rest } = row; return hashOf(rest); };
const nowIso = () => new Date().toISOString();
/** 比上一次更晚：同一毫秒里改两次，也要分得出先后。 */
const later = (prev) => { const now = Date.now(), p = prev ? Date.parse(prev) : 0; return new Date(Math.max(now, p + 1)).toISOString(); };
/** 老数据没有 updated：取它自己身上的时间（任务的那一天、习惯的收尾 / 激活时刻），别让它冒充刚改的。 */
const naturalAt = (row) => row.finished ?? row.activated ?? row.last ?? row.day ?? "1970-01-01T00:00:00.000Z";

const allRows = (d) => [...d.tasks, ...d.habits, ...(d.prefs ? [d.prefs] : [])];

/**
 * 每次存之前拍一张：rid → 内容指纹。顺手给还没有 rid / updated 的老行补上（这不算改动）。
 * 返回 [指纹表, 补过没有]。
 */
export function snapshot(d) {
  let filled = false;
  if (d.prefs) d.prefs.rid ??= "prefs";
  for (const row of allRows(d)) {
    if (!row.rid) { row.rid = crypto.randomUUID(); filled = true; }
    if (!row.updated) { row.updated = naturalAt(row); filled = true; }
  }
  return [new Map(allRows(d).map((r) => [r.rid, contentOf(r)])), filled];
}

/**
 * 存完之后对照那一张：新出现的行、内容变了的行盖上现在的时间；不见了的行记下删掉的时间（d.gone）。
 * 这就是「每一次保存、修改都记时间戳」。同步关着也照样记。
 */
export function touch(d, before) {
  if (d.prefs) d.prefs.rid ??= "prefs";
  const now = new Set();
  for (const row of allRows(d)) {
    row.rid ??= crypto.randomUUID();
    now.add(row.rid);
    if (!before.has(row.rid) || before.get(row.rid) !== contentOf(row)) row.updated = later(row.updated);
  }
  const at = nowIso();
  for (const rid of before.keys()) if (!now.has(rid)) (d.gone ??= {})[rid] = at;
}

/** data.json 里所有要同步的行：rid → {kind, row}。老数据没有 rid 的顺手补上。 */
function records(d) {
  const out = new Map();
  for (const kind of ["tasks", "habits"]) for (const row of d[kind]) out.set((row.rid ??= crypto.randomUUID()), { kind, row });
  if (d.prefs) out.set("prefs", { kind: "prefs", row: d.prefs });
  return out;
}

/** 把服务端的一行（拉下来的，或者 push 被退回的 stale）落到本地。 */
function apply(cfg, d, hashes, r) {
  if (r.deleted) {
    remove(d, r.rid);
    delete hashes[r.rid];
  } else {
    const { kind, row } = unseal(cfg.key, r.blob);
    place(d, kind, r.rid, row);
    hashes[r.rid] = hashOf(row);
  }
  if (d.gone) delete d.gone[r.rid];
}

function place(d, kind, rid, row) {
  if (kind === "prefs") return void (d.prefs = row);
  row.rid = rid; // 以服务端这一行的 rid 为准：别的客户端（网页版）换 rid 时行里那份可能还是旧的
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
 * 同步进度（拉到哪了、每行上次同步时的样子）按频道记。换了频道 —— 手填密钥换成登录、换账号、重新登录 ——
 * 就从头对一遍账：先把频道里的全拉下来，本机有而频道没有的全推上去。不这样的话，旧频道的进度会让
 * 新频道里的行被跳过、本机的行被当成「已经推过」。
 */
function stateOf(cfg, d) {
  // 只认口令 / 令牌：它就代表「哪个频道、哪次登录」。别带上地址 —— 地址写法变了（多个斜杠）、暂时连不上，
  // 都不该把进度清掉：清掉就忘了自己删过哪些行，别处的旧版会趁机回来。
  const id = hashOf(cfg.auth);
  if (d.sync?.id !== id) d.sync = { id, cursor: 0, hashes: {} };
  return d.sync;
}

/**
 * 两台机器各自加过「喝水」：是两个 sid 的同名习惯，同步到一起就会催两遍。
 * 同名（不分大小写）的激活习惯并成一个：取最小的那个 sid，这个名字下所有行（历史也算）都改成它。
 * 每台机器挑出来的都是同一个 sid，所以会收敛。改过的行下一次推上去。
 */
function mergeSameName(d) {
  const key = (h) => (h.name ?? "").trim().toLowerCase();
  const canon = new Map();
  for (const h of d.habits) {
    if ((h.status ?? "pending") !== "pending") continue;
    if (!canon.has(key(h)) || h.sid < canon.get(key(h))) canon.set(key(h), h.sid);
  }
  for (const h of d.habits) {
    const sid = canon.get(key(h));
    if (sid && h.sid !== sid) { h.sid = sid; h.updated = later(h.updated); }
  }
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
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.auth}`, "x-st-device": deviceId(), "x-st-label": encodeURIComponent(deviceLabel()) },
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) throw new Error(`sync ${path} → ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

/** 拉下来并进 d（原地改）。返回拉到了几行；连不上抛错，由调用方决定吞掉。 */
export async function pull(cfg, d) {
  const state = stateOf(cfg, d);
  const { hashes } = state;
  let got = 0;
  for (;;) {
    const page = await request(cfg, `/pull?since=${state.cursor}`);
    const mine = records(d);
    for (const r of page.rows) {
      const local = mine.get(r.rid);
      // 本地改过（或删过）还没推上去：比时间戳，本地这次更晚（或一样）就留着，等会儿推上去；拉下来的更晚就听它的。
      const dirty = local ? hashOf(local.row) !== hashes[r.rid] : r.rid in hashes;
      if (dirty && (r.at ?? "") <= ((local ? local.row.updated : d.gone?.[r.rid]) ?? "")) continue;
      apply(cfg, d, hashes, r);
      got++;
    }
    state.cursor = page.seq;
    if (!page.more) break;
  }
  mergeSameName(d);
  dedupePending(d);
  return got;
}

/** 本地改过、删过的行推上去。没有要推的就不碰网络。返回推了几行。 */
export async function push(cfg, d) {
  const { hashes } = stateOf(cfg, d);
  const mine = records(d);
  const rows = [];
  for (const [rid, { kind, row }] of mine) {
    if (hashOf(row) === hashes[rid]) continue;
    row.updated ??= naturalAt(row);
    rows.push({ rid, blob: seal(cfg.key, { kind, row }), at: row.updated, hash: hashOf(row) });
  }
  for (const rid of Object.keys(hashes)) if (!mine.has(rid)) rows.push({ rid, deleted: true, at: d.gone?.[rid] ?? nowIso() });
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const res = await request(cfg, "/push", { method: "POST", body: JSON.stringify({ rows: batch.map(({ hash, ...r }) => r) }) });
    const lost = new Map((res.stale ?? []).map((r) => [r.rid, r]));
    for (const r of batch) {
      if (lost.has(r.rid)) apply(cfg, d, hashes, lost.get(r.rid)); // 服务端那份更新：改回它
      else if (r.deleted) { delete hashes[r.rid]; if (d.gone) delete d.gone[r.rid]; }
      else hashes[r.rid] = r.hash;
    }
  }
  return rows.length;
}

/**
 * 挂一条 WebSocket 在频道上：别的机器一推，服务端就发 {type:"changed", seq}，onChange 被叫一次（再去 pull）。
 * 断了两秒后自己重连；每 30 秒 ping 一下，免得被中间的网络设备掐掉。返回 { ready, close }。
 * 口令放在 Sec-WebSocket-Protocol 里（"st", 口令），不进 URL。
 */
export function listen(cfg, onChange, { retryMs = 2000, onTap, onActive } = {}) {
  // 报上是哪台（别的机器拍肩时不回发给自己；服务端「你在哪」那张表也记这个名字）
  const url = cfg.url.replace(/^http/, "ws") + `/ws?device=${deviceId()}&label=${encodeURIComponent(deviceLabel())}`;
  let ws, timer, closed = false, resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const open = () => {
    ws = new WebSocket(url, ["st", cfg.auth]);
    ws.onopen = () => resolveReady();
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      try {
        const m = JSON.parse(e.data);
        if (m.type === "changed") onChange(m);
        else if (m.type === "tap" && onTap) onTap(unseal(cfg.key, m.blob), m.from);
        else if ((m.type === "active" || m.type === "hello") && onActive) onActive(m.type === "active" ? m.device : m.active ?? null);
      } catch {}
    };
    ws.onclose = () => { if (!closed) timer = setTimeout(open, retryMs); };
    ws.onerror = () => {};
  };
  open();
  const ping = setInterval(() => { if (ws?.readyState === 1) ws.send("ping"); }, 30_000);
  const send = (obj) => { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); };
  return { ready, send, close() { closed = true; clearTimeout(timer); clearInterval(ping); try { ws?.close(); } catch {} } };
}

/**
 * 跨设备拍肩：这台拍完之后，把这一下（手势、字条、正文、到点的习惯）加密发出去，服务端转给同一个账号里其它在线的设备，
 * 那边的 listen.mjs 解密后在自己的桌面上拍。服务端只见密文。
 * 返回服务端的决定 {delivered, route, active}：route 是 "active" 且送到了，说明你正在用另一台，这台就别拍了。
 */
export async function sendTap(cfg, tap) {
  const blob = seal(cfg.key, { ...tap, host: os.hostname(), at: nowIso() });
  return request(cfg, "/tap", { method: "POST", body: JSON.stringify({ blob, from: deviceId() }) });
}
