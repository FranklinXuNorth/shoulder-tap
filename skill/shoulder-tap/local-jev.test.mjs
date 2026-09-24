// node local-jev.test.mjs —— 没配 Jev、Jev 挂了、Jev 回了怪东西，都要退回「模型自己判」（返回空串，不加任何话）。
import assert from "node:assert/strict";
import { localJudgement } from "./local-jev.mjs";

const d = new Date(Date.now() - 4 * 3600e3); // 凌晨 4 点换日
const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plan = `${day} 说好要做的事：\n  ▸ 1. 做作品集   ← 现在该做这条\n    2. 回邮件\n`;
let calls = 0;
const down = async () => { calls++; throw new Error("down"); };
const answer = (relation) => async () => ({ ok: true, json: async () => ({ answers: { relation } }) });

assert.equal(await localJudgement({}, plan, "查天气", down), "", "没配 key：不发请求，交给模型");
assert.equal(calls, 0);
assert.equal(await localJudgement({ JEV_API_KEY: "k", SHOULDER_TAP_LOCAL_JEV: "0" }, plan, "查天气", down), "", "手动关掉");
assert.equal(await localJudgement({ JEV_API_KEY: "k" }, plan, "查天气", down), "", "Jev 挂了");
assert.equal(await localJudgement({ JEV_API_KEY: "k" }, plan, "查天气", answer({ choice: "maybe", confidence: 0.5 })), "", "不认识的档");
assert.equal(await localJudgement({ JEV_API_KEY: "k" }, plan, "查天气", answer({ choice: "related", confidence: 7 })), "", "置信度越界");
assert.equal(await localJudgement({ JEV_API_KEY: "k" }, "", "查天气", down), "", "没有今天的清单");
assert.match(await localJudgement({ JEV_API_KEY: "k" }, plan, "查天气", answer({ choice: "unrelated", confidence: 0.9 })), /unrelated（置信度 0\.9）/);
console.log("local-jev: fallback ok");
