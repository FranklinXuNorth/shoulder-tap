// 喝水这种短习惯被「做了」两次：同一次提醒在几处被点、旧提醒的按钮、聊天里说了两遍、两台离线各点一次。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "st-dupe-"));
process.env.HOME = process.env.USERPROFILE = home;
const { call } = await import("./tools.mjs");
const tz = "America/New_York";
const file = path.join(home, ".claude", "shoulder-tap", "data.json");
const data = () => JSON.parse(fs.readFileSync(file, "utf8"));
const pendingRid = () => data().habits.find((h) => h.name === "喝水" && h.status === "pending").rid;
const doneCount = () => data().habits.filter((h) => h.name === "喝水" && h.status === "done").length;

await call("add_habit", { tz, name: "喝水", kind: "soft", every_minutes: 60 });

// 1. 同一次提醒，Windows 和 Mac 上的手都点了「已经做了」
const reminder = pendingRid();
assert.match(await call("log_habit", { tz, habit: "喝水", reminder }), /记下了：喝水/);
assert.match(await call("log_habit", { tz, habit: "喝水", reminder }), /这次提醒已经记过了/);
assert.equal(doneCount(), 1, "一次提醒只算一次");

// 2. 旧提醒的按钮不会把刚开始的下一轮关掉
const next = pendingRid();
assert.notEqual(next, reminder);
await call("log_habit", { tz, habit: "喝水", reminder });
assert.equal(pendingRid(), next, "下一轮还在计时");

// 3. 聊天里 2 分钟内又说一次「喝了水」：先挡住，问一句；确认 again 才记
assert.match(await call("log_habit", { tz, habit: "喝了水" }), /秒前刚记过一次，这次没记/);
assert.equal(doneCount(), 1);
assert.match(await call("log_habit", { tz, habit: "喝了水", again: true }), /记下了：喝水/);
assert.equal(doneCount(), 2, "确认是又喝了一杯，就记");

// 4. 两台离线各点了同一次提醒：合并后 answers 一样的只留最早那条（sync.mjs 的去重，直接对着数据跑）
const { pull } = await import("./sync.mjs");
const d = data();
const a = d.habits.find((h) => h.answers === reminder);
d.habits.push({ ...a, rid: "other-machine-row", finished: new Date(Date.parse(a.finished) + 5000).toISOString() });
const fakeCfg = { url: "http://127.0.0.1:9", auth: "x", key: Buffer.alloc(32), timeoutMs: 50 };
// 用一个空的服务端响应模拟一次成功的拉取，只为了走到合并去重那一步
globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [], seq: 0, more: false }) });
await pull(fakeCfg, d);
assert.equal(d.habits.filter((h) => h.answers === reminder).length, 1, "同一次提醒两台各点一次，只留一条");
assert.equal(d.habits.find((h) => h.answers === reminder).rid, a.rid, "留最早的那条");
console.log("habit dupes ok");
