import test from "node:test";
import assert from "node:assert/strict";
import { completionGesture, desktopArgs } from "./completion.mjs";
import { localJudgement, planTasks } from "./local-jev.mjs";

test("three independent sessions each complete; tap is exclusive", () => {
  for (const session_id of ["one", "two", "three"]) {
    const payload = { session_id, hook_event_name: "Stop", last_assistant_message: "做好了" };
    assert.equal(completionGesture(payload), "complete");
    assert.ok(desktopArgs(payload, "complete").includes(session_id));
    assert.equal(completionGesture({ ...payload, last_assistant_message: "________/)\n回到计划" }), "tap");
  }
});
test("retry, subagent, empty stops do not notify", () => {
  assert.equal(completionGesture({ hook_event_name: "SubagentStop", last_assistant_message: "done" }), null);
  assert.equal(completionGesture({ hook_event_name: "Stop", stop_hook_active: true, last_assistant_message: "done" }), null);
  assert.equal(completionGesture({ hook_event_name: "Stop" }), null);
});
test("quoted hand outside the tail is not a tap", () => {
  assert.equal(completionGesture({ hook_event_name: "Stop", last_assistant_message: "________/)" + "a".repeat(801) }), "complete");
});
const now = new Date(2026, 8, 22, 12);
const plan = "时区 test\n2026-09-22 说好要做的事：\n ✓ 1. Done\n ▸ 2. API   ← 现在该做这条\n   3. Course\n\n进度 1/3\n\n用户现在要做的是：placeholder\n【先判断，再动手】instructions";
test("extracts only current and pending tasks; respects 4am rollover", () => {
  assert.deepEqual(planTasks(plan, now), { current: "API", others: ["Course"] });
  assert.equal(planTasks(plan, new Date(2026, 8, 23, 12)), null);
  assert.ok(planTasks(plan, new Date(2026, 8, 23, 2)));
});
test("Jev request goes directly to configured host and validates answer", async () => {
  let count = 0;
  const result = await localJudgement({ JEV_API_KEY: "test", JEV_BASE_URL: "https://jev.example/" }, plan, "API work", async (url, options) => {
    count++;
    assert.equal(url, "https://jev.example/v1/systemone");
    assert.equal(options.headers.Authorization, "Bearer test");
    assert.ok(!JSON.parse(options.body).state.includes("placeholder"));
    return { ok: true, json: async () => ({ answers: { relation: { choice: "related", confidence: 0.95 } } }) };
  }, now);
  assert.equal(count, 1); assert.match(result, /related/);
});
test("missing key, stale plan, network and malformed answers fall back silently", async () => {
  const fail = async () => { throw new Error("offline"); };
  assert.equal(await localJudgement({}, plan, "work", fail, now), "");
  assert.equal(await localJudgement({ JEV_API_KEY: "test" }, plan, "work", fail, now), "");
  for (const answer of [{ choice: "other", confidence: 1 }, { choice: "related", confidence: 10 }]) {
    assert.equal(await localJudgement({ JEV_API_KEY: "test" }, plan, "work", async () => ({ ok: true, json: async () => ({ answers: { relation: answer } }) }), now), "");
  }
});
