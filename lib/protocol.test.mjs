// node lib/protocol.test.mjs —— 到期判断的最小自检。没有测试框架：先用 tsc 编成 CJS 再断言。
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

const out = path.join(os.tmpdir(), "shoulder-tap-protocol-test");
execFileSync("node", ["node_modules/typescript/lib/tsc.js", "lib/protocol.ts", "lib/ascii.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--skipLibCheck"], { stdio: "inherit" });
const { overdueMinutes, whatIsDue } = createRequire(import.meta.url)(path.join(out, "protocol.js"));

const tz = "America/New_York";
const T = (s) => Date.parse(s);
const gym = { id: "h", at: "22:30", tz, last: "2026-09-21T19:21:00Z" }; // 昨天下午记的
assert.equal(overdueMinutes(gym, T("2026-09-22T21:30:00Z")), undefined, "17:30，今天还没到点，别催");
assert.equal(overdueMinutes(gym, T("2026-09-23T03:00:00Z")), 30, "23:00，超 30 分钟");
assert.equal(overdueMinutes(gym, T("2026-09-23T06:00:00Z")), 210, "凌晨 2 点还算今天");
assert.equal(overdueMinutes(gym, T("2026-09-23T09:00:00Z")), undefined, "早上 5 点翻篇，不再催昨晚的");
assert.equal(overdueMinutes({ ...gym, last: "2026-09-23T02:40:00Z" }, T("2026-09-23T03:00:00Z")), undefined, "22:40 记了（做了或跳过）");
assert.equal(overdueMinutes({ id: "w", every_minutes: 60, last: "2026-09-22T20:00:00Z" }, T("2026-09-22T21:30:00Z")), 30, "间隔制不变");
assert.deepEqual(whatIsDue([{ id: "w", every_minutes: 60 }]), [{ id: "w", overdue_minutes: -1 }], "从没记过");
assert.equal(overdueMinutes({ id: "h", at: "25:99", tz }), undefined, "坏时刻不催");
assert.equal(overdueMinutes({ id: "h", at: "22:30", tz: "Nope/Nope" }), undefined, "坏时区不催");
console.log("protocol: due checks pass");
