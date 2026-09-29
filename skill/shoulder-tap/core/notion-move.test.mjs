// Notion → 本地：翻页翻到底一条不漏；rid 由 Notion 页面定，搬两次不重复；搬完这台改用本地存储。
// 不连真的 Notion：fetch 换成一个假的，演一个 150 条任务 + 3 条习惯、分两页返回的库。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "st-notion-move-"));
process.env.HOME = process.env.USERPROFILE = home;
process.env.NOTION_TOKEN = "ntn_fake";
const { DB_TITLE } = await import("./focus.mjs");

const rt = (s) => [{ plain_text: s }];
const task = (i) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  properties: { Kind: { select: { name: "task" } }, ID: { rich_text: rt(`t-${i}`) }, Order: { number: (i % 5) + 1 }, Name: { title: rt(`任务 ${i}`) },
    Status: { select: { name: i % 3 ? "pending" : "done" } }, Day: { date: { start: new Date(Date.UTC(2026, 8, 1 + (i % 28), 14)).toISOString() } }, TZ: { rich_text: rt("America/New_York") } },
});
const habit = (i, status, name) => ({
  id: `11111111-0000-0000-0000-${String(i).padStart(12, "0")}`,
  properties: { Kind: { select: { name: "habit" } }, ID: { rich_text: rt("h-water") }, Name: { title: rt(name) }, Type: { select: { name: "soft" } },
    EveryMinutes: { number: 60 }, Status: { select: { name: status } }, Day: { date: { start: "2026-09-20T12:00:00.000Z" } },
    ...(status === "pending" ? {} : { Last: { date: { start: "2026-09-20T13:00:00.000Z" } } }), TZ: { rich_text: rt("America/New_York") } },
});
const pages = [...Array.from({ length: 150 }, (_, i) => task(i)), habit(1, "done", "喝水"), habit(2, "done", "喝水"), habit(3, "pending", "喝水")];

let queries = 0;
globalThis.fetch = async (url, init) => {
  const p = new URL(url).pathname;
  const body = init?.body ? JSON.parse(init.body) : {};
  const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (p.endsWith("/search")) return ok({ results: [{ id: "ds1", title: rt(DB_TITLE) }] });
  if (p.endsWith("/data_sources/ds1") && init.method === "GET") return ok({ properties: new Proxy({}, { get: () => ({}), has: () => true }) });
  if (p.endsWith("/data_sources/ds1")) return ok({});
  if (p.endsWith("/data_sources/ds1/query")) {
    queries++;
    const start = Number(body.start_cursor ?? 0);
    const slice = pages.slice(start, start + 100);
    return ok({ results: slice, has_more: start + 100 < pages.length, next_cursor: String(start + 100) });
  }
  throw new Error(`没演这个：${init?.method} ${p}`);
};

const { moveNotionToLocal, openStore, readConfig, writeConfig } = await import("./store.mjs");
writeConfig({ storage: "notion" });
assert.equal(openStore().kind, "notion");

assert.deepEqual(await moveNotionToLocal(), { tasks: 150, habits: 3 });
assert.equal(queries, 2, "153 条要翻两页");
assert.equal(readConfig().storage, "local");
assert.equal(openStore().kind, "local");
const data = JSON.parse(fs.readFileSync(path.join(home, ".claude", "shoulder-tap", "data.json"), "utf8"));
assert.equal(data.tasks.length, 150);
assert.ok(data.tasks.every((t) => /^n-[0-9a-f]{32}$/.test(t.rid) && t.day.endsWith("Z")));
assert.equal(data.tasks.filter((t) => t.status === "done").length, 50);
assert.deepEqual(data.habits.map((h) => h.status).sort(), ["done", "done", "pending"]);
assert.ok(data.habits.every((h) => h.sid === "h-water" && h.kind === "soft" && h.everyMin === 60));

// 再搬一次（或者另一台连着同一个 Notion 的机器也搬）：一条不多
writeConfig({ storage: "notion" });
assert.deepEqual(await moveNotionToLocal(), { tasks: 0, habits: 0 });
assert.match(await (await import("./tools.mjs")).call("habit_history", {}), /最近 2 条/);
console.log("notion → local ok");
