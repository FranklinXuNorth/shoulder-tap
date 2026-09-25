import test from "node:test";
import assert from "node:assert/strict";
import { completionGestures, desktopArgs, dueHabitIn, habitSkippable, missingHandDecision } from "./completion.mjs";
import { localJudgement, planTasks } from "./local-jev.mjs";

test("each hand at the tail is one gesture; snap before tap; no hand, nothing", () => {
  const pat = "```\n  /      (_____)  *\n```"; // 响指
  const tap = "```\n  ____/  ________/)   .  |\n```";
  for (const session_id of ["one", "two", "three"]) {
    const payload = { session_id, hook_event_name: "Stop", last_assistant_message: "做好了\n\n" + pat };
    assert.deepEqual(completionGestures(payload), ["snap"]);
    assert.ok(desktopArgs(payload, "snap").includes(session_id));
    assert.deepEqual(completionGestures({ ...payload, last_assistant_message: tap + "\n回到计划" }), ["tap"]);
    assert.deepEqual(completionGestures({ ...payload, last_assistant_message: pat + "\n" + tap + "\n第 1 条还没动" }), ["snap", "tap"]);
    assert.deepEqual(completionGestures({ ...payload, last_assistant_message: "只是回答了一个问题。" }), []);
  }
});
test("subagent and empty stops do nothing; the retry turn still counts", () => {
  const pat = "```\n        | || || |  _     |\n```";
  assert.deepEqual(completionGestures({ hook_event_name: "SubagentStop", last_assistant_message: pat }), []);
  assert.deepEqual(completionGestures({ hook_event_name: "Stop", stop_hook_active: true, last_assistant_message: pat }), ["snap"]);
  assert.deepEqual(completionGestures({ hook_event_name: "Stop", last_assistant_message: "" }), []);
});
test("a stop with no hand is blocked once, never twice", () => {
  const pat = "```\n        | || || |  _     |\n```";
  assert.equal(missingHandDecision({ hook_event_name: "Stop", last_assistant_message: "改完了。" })?.decision, "block");
  assert.equal(missingHandDecision({ hook_event_name: "Stop", stop_hook_active: true, last_assistant_message: "改完了。" }), null);
  assert.equal(missingHandDecision({ hook_event_name: "Stop", last_assistant_message: "改完了。\n" + pat }), null);
  assert.equal(missingHandDecision({ hook_event_name: "Stop", last_assistant_message: "" }), null);
});
test("quoted hand outside the tail is not a tap", () => {
  assert.deepEqual(completionGestures({ hook_event_name: "Stop", last_assistant_message: "________/)" + "a".repeat(801) }), []);
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
test("the old pat-pat hand still counts as snap for sessions started before the switch", () => {
  const old = "```\n       | || || |  _     |\n```";
  assert.deepEqual(completionGestures({ hook_event_name: "Stop", last_assistant_message: "做好了\n" + old }), ["snap"]);
});
test("the snap hand the rule prints is the one the hook detects", async () => {
  const { doneBanner } = await import("./core/ascii.mjs");
  assert.deepEqual(completionGestures({ hook_event_name: "Stop", last_assistant_message: "做好了\n\n" + doneBanner() }), ["snap"]);
});

test("提醒那句点了名的到点习惯，桌面端才带「已经做了 / 还没做」", () => {
  const plan = "清单\n【顺便提一句】\n  · 喝水 —— 超了 45 分钟（说好每 60 分钟一次）\n  · 健身 —— 超了 3 分钟（说好每天 22:30）\n";
  assert.equal(dueHabitIn(plan, "喝水 —— 45 分钟没动了"), "喝水");
  assert.equal(dueHabitIn(plan, "该去健身了"), "健身");
  assert.equal(dueHabitIn(plan, "今天说好的第 2 条还没动。"), "");
  assert.equal(dueHabitIn("", "喝水"), "");
  const args = desktopArgs({}, "tap", "喝水", "喝水", "喝水");
  assert.deepEqual(args.slice(args.indexOf("--habit"), args.indexOf("--habit") + 3), ["--habit", "喝水", "--node"]);
  assert.ok(!desktopArgs({}, "tap", "x", "x").includes("--habit"));
  assert.ok(desktopArgs({}, "tap", "x", "x", "健身", true).includes("--skippable"));
  assert.ok(!desktopArgs({}, "tap", "x", "x", "", true).includes("--skippable"));
});

test("硬习惯才在桌面上多一个「今天不做」", () => {
  const plan = "  · 喝水 —— 超了 45 分钟（说好每 60 分钟一次；软习惯，不能跳过）\n  · 健身 —— 超了 3 分钟（说好每天 22:30；硬习惯，可以今天不做）\n";
  assert.equal(habitSkippable(plan, "健身"), true);
  assert.equal(habitSkippable(plan, "喝水"), false);
  assert.equal(dueHabitIn(plan, "该去健身了"), "健身");
});
