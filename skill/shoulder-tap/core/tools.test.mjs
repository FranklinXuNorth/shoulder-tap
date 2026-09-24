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

assert.match(await call("add_habit", { tz, name: "喝水", kind: "soft", every_minutes: 60 }), /软习惯，不许跳过/);
assert.match(await call("add_habit", { tz, name: "健身", kind: "hard", at: "22:30" }), /硬习惯，可以说今天不做/);
assert.match(await call("log_habit", { tz, habit: "喝水", skip: true, note: "懒" }), /是软习惯，不能跳过/);
assert.match(await call("log_habit", { tz, habit: "喝了水" }), /记下了：喝水/);
assert.match(await call("log_habit", { tz, habit: "健身", skip: true, note: "腿疼" }), /健身 今天跳过/);
assert.match(await call("setup", { notion_page: "x" }), /本地存储，不需要建库/);

// 不传 tz 就用这台机器的
assert.match(await call("check_focus", {}), new RegExp(`时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone.replace("/", "\\/")}`));

const data = JSON.parse(fs.readFileSync(path.join(home, ".claude", "shoulder-tap", "data.json"), "utf8"));
assert.equal(data.tasks.length, 3);
assert.equal(data.habits.find((h) => h.name === "喝水").kind, "soft");
assert.ok(data.tasks.every((t) => t.day.endsWith("Z")), "时间一律存 UTC");
console.log("tools: local store ok");
