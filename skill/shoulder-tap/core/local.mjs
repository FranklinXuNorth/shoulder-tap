/**
 * 本地存储：跟 focus.mjs（Notion）同一套函数、同一套签名，第一个参数不用。
 * 一个 JSON 文件，放在 ~/.claude/shoulder-tap/data.json。不上云，不出这台机器。
 *
 * 时间规矩跟 Notion 那边一样：一律存 UTC 瞬时，「今天」读的时候按时区现算。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dayStamp, mintId, nowUtc, findHabit } from "./focus.mjs";
import { overdueMinutes } from "./protocol.mjs";

export const DATA = path.join(os.homedir(), ".claude", "shoulder-tap", "data.json");

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    return { tasks: d.tasks ?? [], habits: d.habits ?? [] };
  } catch {
    return { tasks: [], habits: [] };
  }
}

function save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  // 先写临时文件再改名：写到一半断电，也不会留下半个 JSON 把整份数据弄丢。
  const tmp = DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), "utf8");
  fs.renameSync(tmp, DATA);
}

const inDay = (win) => (t) => t.day >= win.startUtc && t.day < win.endUtc && t.status !== "dropped";

const asItem = (t) => ({ id: t.sid, sid: t.sid, order: t.order, task: t.task, note: t.note ?? "", tz: t.tz ?? "", done: t.status === "done" });

export async function listDay(_, win) {
  return load().tasks.filter(inDay(win)).sort((a, b) => a.order - b.order).map(asItem);
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
  const today = d.tasks.filter(inDay(win));
  const last = today.reduce((m, t) => Math.max(m, t.order), 0);
  const at = position === undefined || position > today.length ? last + 1 : Math.max(1, position);
  for (const t of today) if (t.order >= at) t.order++;
  d.tasks.push({ sid: mintId("t", new Set(d.tasks.map((t) => t.sid))), order: at, task, note, status: "pending", day: dayStamp(win), tz });
  save(d);
  return listDay(_, win);
}

export async function setStatus(_, win, position, status) {
  const d = load();
  const row = d.tasks.filter(inDay(win)).find((t) => t.order === position);
  const items = await listDay(_, win);
  if (!row) return { items, hit: undefined };
  const hit = asItem(row);
  row.status = status;
  save(d);
  return { items: await listDay(_, win), hit };
}

const asHabit = (h, now = Date.now()) => ({
  id: h.sid, sid: h.sid, name: h.name, everyMin: h.everyMin ?? 0, at: h.at || undefined, last: h.last, tz: h.tz ?? "",
  kind: h.kind === "soft" ? "soft" : "hard",
  overdueMin: overdueMinutes({ id: h.sid, every_minutes: h.everyMin, last: h.last, at: h.at, tz: h.tz }, now) ?? -1,
});

export async function listHabits() {
  return load().habits.map((h) => asHabit(h));
}

export async function overdueHabits() {
  return (await listHabits()).filter((h) => h.overdueMin > 0).sort((a, b) => b.overdueMin - a.overdueMin);
}

export async function addHabit(_, name, everyMinutes, note, tz, at, kind = "hard") {
  const d = load();
  d.habits.push({ sid: mintId("h", new Set(d.habits.map((h) => h.sid))), name, everyMin: everyMinutes, at: at ?? "", note, tz, kind, last: nowUtc() });
  save(d);
  return listHabits();
}

export async function logHabit(_, name, tz, note, skip = false) {
  const d = load();
  const hit = findHabit(d.habits.map((h) => asHabit(h)), name);
  if (!hit) return undefined;
  if (skip && hit.kind === "soft") return { ...hit, refused: true };
  const row = d.habits.find((h) => h.sid === hit.sid);
  row.last = nowUtc();
  row.tz = tz;
  if (note !== undefined) row.note = note;
  save(d);
  return { ...hit, overdueMin: -1, last: row.last };
}
