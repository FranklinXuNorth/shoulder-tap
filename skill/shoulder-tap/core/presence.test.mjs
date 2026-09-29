// 内部开关「这台最近有没有人在用」：默认关、只在本机判断。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = process.env.USERPROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "st-presence-"));
const { trackActiveEnabled, shouldShowHere, idleMs } = await import("./presence.mjs");

assert.equal(trackActiveEnabled({}), false, "默认关");
assert.equal(shouldShowHere({ SHOULDER_TAP_IDLE_MS: "99999999" }), true, "关着的时候，多久没人碰都照拍");
const on = { SHOULDER_TAP_TRACK_ACTIVE: "1" };
assert.equal(shouldShowHere({ ...on, SHOULDER_TAP_IDLE_MS: "5000" }), true, "刚碰过：拍");
assert.equal(shouldShowHere({ ...on, SHOULDER_TAP_IDLE_MS: String(11 * 60_000) }), false, "超过 10 分钟没人碰：不拍");
assert.equal(shouldShowHere({ ...on, SHOULDER_TAP_IDLE_MS: String(11 * 60_000), SHOULDER_TAP_IDLE_LIMIT_MIN: "30" }), true, "阈值可调");
// config.json 里打开
fs.mkdirSync(path.join(process.env.HOME, ".claude", "shoulder-tap"), { recursive: true });
fs.writeFileSync(path.join(process.env.HOME, ".claude", "shoulder-tap", "config.json"), JSON.stringify({ trackActive: true }));
assert.equal(trackActiveEnabled({}), true);
assert.equal(trackActiveEnabled({ SHOULDER_TAP_TRACK_ACTIVE: "0" }), false, "环境变量能压过 config");
// 真的读一次本机（Windows / macOS 能读到一个数，别的平台 null）
const real = idleMs({});
assert.ok(real === null || Number.isFinite(real));
console.log("presence toggle ok", real === null ? "(本机读不到空闲时长)" : `(本机空闲 ${Math.round(real / 1000)} 秒)`);
