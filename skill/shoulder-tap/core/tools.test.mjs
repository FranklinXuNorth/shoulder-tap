// node core/tools.test.mjs —— 本地存储走一遍全部工具。HOME 指到临时目录，不碰你真的数据。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "shoulder-tap-test-"));
process.env.HOME = process.env.USERPROFILE = home;
const { call } = await import("./tools.mjs");
const tz = "America/New_York";

assert.match(await call("check_focus", { tz }), /还没有记录任何事/);
assert.match(await call("set_focus", { tz, tasks: [{ task: "写作品集" }, { task: "跑推理" }] }), /▸ 1\. 写作品集/);
assert.match(await call("add_focus", { tz, task: "急事", position: 1 }), /▸ 1\. 急事[\s\S]*2\. 写作品集/);
assert.match(await call("complete_focus", { tz, position: 1 }), /下一条是第 2 条：写作品集/);
assert.match(await call("check_focus", { tz, activity: "刷视频" }), /用户现在要做的是：「刷视频」/);

assert.match(await call("add_habit", { tz, name: "喝水", kind: "soft", every_minutes: 60 }), /软习惯，随手就能做，不许跳过/);
assert.match(await call("add_habit", { tz, name: "健身", kind: "hard", at: "22:30" }), /硬习惯，看当天情况，可以说今天不做/);
assert.match(await call("log_habit", { tz, habit: "喝水", skip: true, note: "懒" }), /是软习惯，随手就能做的事不能跳过/);
assert.match(await call("log_habit", { tz, habit: "喝了水" }), /记下了：喝水/);
assert.match(await call("log_habit", { tz, habit: "健身", skip: true, note: "腿疼" }), /健身 今天跳过/);
assert.match(await call("setup", { notion_page: "x" }), /本地存储，不需要建库/);

// 历史：一次一行。喝水做了一次 → 一行 done + 一行新的 pending；健身跳过 → 一行 dropped + 明天才开始算的 pending
const hist = await call("habit_history", {});
assert.match(hist, /✓ .* 喝水/);
assert.match(hist, /– .* 健身（腿疼）/);
assert.match(await call("habit_history", { habit: "健身" }), /最近 1 条/);
assert.doesNotMatch(await call("check_focus", { tz }), /健身 —— 超了/, "跳过之后今天不再提");
assert.match(await call("stop_habit", { habit: "健身" }), /停用了：健身/);
assert.match(await call("log_habit", { tz, habit: "健身" }), /没找到/, "停用之后就不是激活的了");
assert.match(await call("habit_history", { habit: "健身" }), /最近 2 条/, "停用那一行也进历史");

// 不传 tz 就用这台机器的
assert.match(await call("check_focus", {}), new RegExp(`时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone.replace("/", "\\/")}`));

const file = path.join(home, ".claude", "shoulder-tap", "data.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
assert.equal(data.tasks.length, 3);
const water = data.habits.filter((h) => h.name === "喝水");
assert.deepEqual(water.map((h) => h.status), ["done", "pending"], "一次一行，同一个习惯同一时刻只有一行 pending");
assert.equal(new Set(water.map((h) => h.sid)).size, 1, "每一次都沿用同一个习惯 ID");
assert.ok(water.every((h) => h.kind === "soft"), "下一行照抄软硬");

// 老格式（没有 status、激活时间在 last 上）照样当激活中读
data.habits.push({ sid: "h-legacy", name: "护眼", everyMin: 30, tz, last: "2020-01-01T00:00:00Z" });
fs.writeFileSync(file, JSON.stringify(data));
assert.match(await call("check_focus", { tz }), /护眼 —— 超了/);
assert.match(await call("log_habit", { tz, habit: "护眼" }), /记下了：护眼/);
assert.ok(data.tasks.every((t) => t.day.endsWith("Z")), "时间一律存 UTC");
console.log("tools: local store ok");
