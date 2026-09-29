import test from "node:test";
import assert from "node:assert/strict";
import { desktopArgs, doneLine } from "./completion.mjs";

test("completion caption is the first line, markdown stripped, hand cut off", () => {
  const hand = "\n\n```\n  ____/  ________/)   .  |\n```\n第 1 条还没动。";
  assert.equal(doneLine("修好并已**重新发布**。\n原因：略。\n\n第二段不要。" + hand), "修好并已重新发布。");
  assert.equal(doneLine("\n## 同步已部署，21 个用例全过\n\n细节……" + hand), "同步已部署，21 个用例全过");
  assert.equal(doneLine("改在 [watch.mjs](a/b.mjs) 里，SHOULDER_TAP_KEY 不动"), "改在 watch.mjs 里，SHOULDER_TAP_KEY 不动");
  assert.equal(doneLine(""), "");
  assert.equal(doneLine("一".repeat(200)).length, 120);
  assert.deepEqual(desktopArgs({ session_id: "s" }, "complete", "", "总结").slice(-2), ["--caption", "总结"]);
});

test("caption says which agent finished: --agent wins, then a ~/.codex transcript, else Claude Code", async () => {
  const { agentName, withAgent } = await import("./completion.mjs");
  assert.equal(agentName({}, ["node", "watch.mjs"]), "Claude Code");
  assert.equal(agentName({ transcript_path: "/Users/a/.claude/projects/x/s.jsonl" }, []), "Claude Code");
  assert.equal(agentName({ transcript_path: "/Users/a/.codex/sessions/2026/09/29/r.jsonl" }, []), "Codex");
  assert.equal(agentName({ transcript_path: "C:\\Users\\a\\.codex\\sessions\\r.jsonl" }, []), "Codex");
  assert.equal(agentName({}, ["node", "watch.mjs", "--agent", "codex"]), "Codex");
  assert.equal(agentName({ transcript_path: "/a/.codex/s.jsonl" }, ["--agent", "claude"]), "Claude Code");
  assert.equal(withAgent("Codex", " 修好了 "), "Codex · 修好了");
  assert.equal(withAgent("Claude Code", ""), ""); // 开口那一下没字：不加名字
});
