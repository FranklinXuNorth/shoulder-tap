/**
 * 本地存储：跟 focus.mjs（Notion）同一套函数、同一套签名，第一个参数不用。
 * 一个 JSON 文件，放在 ~/.claude/shoulder-tap/data.json。不上云，不出这台机器。
 *
 * 时间规矩跟 Notion 那边一样：一律存 UTC 瞬时，「今天」读的时候按时区现算。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dayStamp, mintId, nowUtc, findHabit, nextActivation } from "./focus.mjs";
import { overdueMinutes } from "./protocol.mjs";

export const DATA = path.join(os.homedir(), ".claude", "shoulder-tap", "data.json");

/** 除了 tasks / habits，同步的游标和偏好（sync、prefs）也在这个文件里，读写都得原样带着。 */
export function load() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    return { ...d, tasks: d.tasks ?? [], habits: d.habits ?? [] };
  } catch {
    return { tasks: [], habits: [] };
  }
}

export function save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  // 先写临时文件再改名：写到一半断电，也不会留下半个 JSON 把整份数据弄丢。
  const tmp = DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), "utf8");
  // Windows：目标文件正被别的句柄（杀毒软件、索引服务）短暂打开时 rename 会报 EPERM / EBUSY：等一下再试，别把这一次保存丢掉
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, DATA); return; }
    catch (e) {
      if (i >= 40 || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

const inDay = (win) => (t) => t.day >= win.startUtc && t.day < win.endUtc && t.status !== "dropped";

const asItem = (t, order = t.order) => ({ id: t.sid, sid: t.sid, order, task: t.task, note: t.note ?? "", tz: t.tz ?? "", done: t.status === "done" });

/**
 * 当天的行，按存的 order 排，同号再按 sid。第几条永远是排出来的位置，不直接信存的 order：
 * 两台机器离线时各往今天末尾加一条，存下来的都是同一个 order，合到一起也得有确定的先后。
 */
const dayRows = (d, win) => d.tasks.filter(inDay(win)).sort((a, b) => a.order - b.order || a.sid.localeCompare(b.sid));

export async function listDay(_, win) {
  return dayRows(load(), win).map((t, i) => asItem(t, i + 1));
}

export async function setDay(_, win, tasks, tz) {
  const d = load();
  d.tasks = d.tasks.filter((t) => !inDay(win)(t)); // 旧的直接删：本地没有回收站可言
  const taken = new Set(d.tasks.map((t) => t.sid));
  tasks.forEach((t, i) =>
    d.tasks.push({ sid: mintId("t", taken), order: i + 1, task: t.task, note: t.note ?? "", status: "pending", day: dayStamp(win), tz }));
  save(d);
  return listDay(_, win);
}

export async function addItem(_, win, task, note, position, tz) {
  const d = load();
  const today = dayRows(d, win);
  today.forEach((t, i) => { if (t.order !== i + 1) t.order = i + 1; }); // 先压成 1..n，插队才插得准
  const at = position === undefined || position > today.length ? today.length + 1 : Math.max(1, position);
  for (const t of today) if (t.order >= at) t.order++;
  d.tasks.push({ sid: mintId("t", new Set(d.tasks.map((t) => t.sid))), order: at, task, note, status: "pending", day: dayStamp(win), tz });
  save(d);
  return listDay(_, win);
}

export async function setStatus(_, win, position, status) {
  const d = load();
  const row = dayRows(d, win)[position - 1];
  const items = await listDay(_, win);
  if (!row) return { items, hit: undefined };
  const hit = asItem(row, position);
  row.status = status;
  save(d);
  return { items: await listDay(_, win), hit };
}

/** 设置页的下拉框：按 id 直接改一条的状态，哪天的都行，改回 pending 也行。 */
export async function setTaskStatus(_, id, status) {
  const d = load();
  const row = d.tasks.find((t) => t.sid === id);
  if (!row) return false;
  row.status = status;
  save(d);
  return true;
}

/**
 * 习惯：跟 Notion 那边一样，一次一行，都在 habits 这一个数组里。
 * status = pending（当前激活，activated 是激活时刻）/ done / dropped（finished 是收尾时刻）。
 * 老数据没有 status：当 pending，激活时刻取原来的 last。
 */
const status = (h) => h.status ?? "pending";
const activatedOf = (h) => h.activated ?? h.last;

const asHabit = (h, now = Date.now()) => ({
  id: h.sid, sid: h.sid, name: h.name, everyMin: h.everyMin ?? 0, at: h.at || undefined, tz: h.tz ?? "",
  kind: h.kind === "soft" ? "soft" : "hard",
  status: status(h), activated: activatedOf(h), finished: h.finished, note: h.note ?? "",
  overdueMin: status(h) === "pending"
    ? overdueMinutes({ id: h.sid, every_minutes: h.everyMin, last: activatedOf(h), at: h.at, tz: h.tz }, now) ?? -1
    : -1,
});

const active = (d) => d.habits.filter((h) => status(h) === "pending");

export async function listHabits() {
  return active(load()).map((h) => asHabit(h));
}

export async function overdueHabits() {
  return (await listHabits()).filter((h) => h.overdueMin > 0).sort((a, b) => b.overdueMin - a.overdueMin);
}

const pendingRow = (h, activated) =>
  ({ sid: h.sid, name: h.name, everyMin: h.everyMin ?? 0, at: h.at ?? "", tz: h.tz, kind: h.kind, status: "pending", activated });

export async function addHabit(_, name, everyMinutes, note, tz, at, kind = "hard") {
  const d = load();
  const sid = mintId("h", new Set(d.habits.map((h) => h.sid)));
  d.habits.push(pendingRow({ sid, name, everyMin: everyMinutes, at, tz, kind }, nowUtc()));
  save(d);
  return listHabits();
}

/** 做了 / 今天跳过：这一行收尾，再开下一行 pending。软习惯不许跳过。 */
export async function logHabit(_, name, tz, note, skip = false) {
  const d = load();
  const hit = findHabit(active(d).map((h) => asHabit(h)), name);
  if (!hit) return undefined;
  if (skip && hit.kind === "soft") return { ...hit, refused: true };
  const row = active(d).find((h) => h.sid === hit.sid);
  const at = nowUtc();
  Object.assign(row, { status: skip ? "dropped" : "done", activated: activatedOf(row), finished: at, ...(note === undefined ? {} : { note }) });
  delete row.last;
  // 收尾的这一行换个同步 ID：两台机器离线时各记了一次，是两条记录，不能因为收的是同一行 pending 就合成一条。
  delete row.rid;
  d.habits.push(pendingRow({ ...row, tz }, nextActivation(skip, tz)));
  save(d);
  return { ...hit, overdueMin: -1, finished: at };
}

/** 停用：pending 那行标 dropped，不再开下一行。 */
export async function stopHabit(_, name, note) {
  const d = load();
  const hit = findHabit(active(d).map((h) => asHabit(h)), name);
  if (!hit) return undefined;
  Object.assign(active(d).find((h) => h.sid === hit.sid), { status: "dropped", finished: nowUtc(), note: note ?? "停用" });
  save(d);
  return hit;
}

/** 历史：做过的和跳过的，新的在前。 */
/** 设置页的记录：从 sinceUtc 起所有的任务，放弃的也算，新的一天在前。 */
export async function taskHistory(_, sinceUtc) {
  return load().tasks.filter((t) => t.day >= sinceUtc)
    .sort((a, b) => b.day.localeCompare(a.day) || a.order - b.order)
    .map((t) => ({ ...asItem(t), status: t.status ?? "pending", day: t.day }));
}

export async function habitHistory(_, limit = 50) {
  return load().habits.filter((h) => status(h) !== "pending").map((h) => asHabit(h))
    .sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? "")).slice(0, limit);
}

/**
 * 用户现在在哪个时区。跟着同步走：有人在身边的机器（跑钩子、开着编辑器的那台）每次 check 都记一下自己的时区；
 * 没人在身边的机器（比如跑在服务器上、从 Discord 收消息的 OpenClaw）读这个，而不是读自己那台服务器的 UTC。
 */
export async function userTz() {
  return load().prefs?.tz;
}

export async function noteTz(_, tz) {
  const d = load();
  if (!tz || d.prefs?.tz === tz) return;
  d.prefs = { tz };
  save(d);
}
