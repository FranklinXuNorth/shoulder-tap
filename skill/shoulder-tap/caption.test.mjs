import test from "node:test";
import assert from "node:assert/strict";
import { desktopArgs, doneLine } from "./completion.mjs";

test("completion caption is the first paragraph, markdown stripped, hand cut off", () => {
  const hand = "\n\n```\n  ____/  ________/)   .  |\n```\n第 1 条还没动。";
  assert.equal(doneLine("修好并已**重新发布**。原因：略。\n\n第二段不要。" + hand), "修好并已重新发布。原因：略。");
  assert.equal(doneLine("改在 [watch.mjs](a/b.mjs) 里，SHOULDER_TAP_KEY 不动"), "改在 watch.mjs 里，SHOULDER_TAP_KEY 不动");
  assert.equal(doneLine(""), "");
  assert.equal(doneLine("一".repeat(200)).length, 120);
  assert.deepEqual(desktopArgs({ session_id: "s" }, "complete", "", "总结").slice(-2), ["--caption", "总结"]);
});
