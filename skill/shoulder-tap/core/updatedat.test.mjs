// 每一行都有 updatedAt（最后一次被改的时刻）：老数据叫 updated 的，下次读写时原样改名、不算改动；改过的行才换成现在。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "st-updatedat-"));
process.env.HOME = process.env.USERPROFILE = home;
const file = path.join(home, ".claude", "shoulder-tap", "data.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
const old = "2026-01-01T12:00:00.000Z";
fs.writeFileSync(file, JSON.stringify({
  tasks: [{ rid: "r-old", sid: "t-old1", order: 1, task: "老数据", status: "pending", day: new Date().toISOString(), updated: old }],
  habits: [],
}));
const { call } = await import("./tools.mjs");
const tz = "America/New_York";
await call("check_focus", { tz });
let t = JSON.parse(fs.readFileSync(file, "utf8")).tasks[0];
assert.equal(t.updatedAt, old, "只是读：时间照搬，不当成刚改过");
assert.equal("updated" in t, false, "老字段名换掉了");

await call("add_focus", { tz, task: "新的一条" });
const d = JSON.parse(fs.readFileSync(file, "utf8"));
assert.equal(d.tasks.find((x) => x.task === "老数据").updatedAt, old, "没动的那行不变");
assert.ok(d.tasks.find((x) => x.task === "新的一条").updatedAt > old, "新行是现在");
await call("complete_focus", { tz, position: 1 });
t = JSON.parse(fs.readFileSync(file, "utf8")).tasks.find((x) => x.task === "老数据");
assert.ok(t.updatedAt > old, "改过的行换成现在");
console.log("updatedAt ok");
