#!/usr/bin/env node
/**
 * shoulder-tap 的本地哨兵。
 *
 * 模型只在被调用的那一瞬间存在，所以没有任何东西能「推」给它。
 * 这个脚本换了个方向：让 harness 在两个确定的时刻替模型去看一眼，
 * 把结果直接塞进它的上下文 —— 模型没有跳过的余地。
 *
 *   UserPromptSubmit  你每次开口     → 带上你这句话去查，拿回清单和判断规则
 *   PostToolUse       每次工具调用后 → 节流到十分钟一次，只在真有到期习惯时才出声
 *
 * 三条硬规矩：
 *   1. 永远 exit 0。哨兵坏了不能把你的会话也搞坏。
 *   2. 有超时。Vercel 或 Notion 慢了，宁可这次不查。
 *   3. 没话说就一个字都不输出。上下文很贵。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(HERE, ".watch-state.json");
const TICK_MINUTES = 10; // PostToolUse 的节流间隔
const TIMEOUT_MS = 4000;

// ---------- 配置：skill 自己的 .env，不进仓库，不上传任何地方 ----------

function loadEnv() {
  const out = { ...process.env };
  for (const file of [path.join(HERE, ".env"), path.join(os.homedir(), ".claude", "skills", "shoulder-tap", ".env")]) {
    try {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return out;
}

// ---------- 跟 MCP 说话 ----------

async function callTool(env, name, args) {
  const url = env.SHOULDER_TAP_URL || "https://shoulder-tap.vercel.app/mcp";
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    Accept: "application/json, text/event-stream",
  };
  if (env.NOTION_TOKEN) headers.Authorization = `Bearer ${env.NOTION_TOKEN}`;
  if (env.SHOULDER_TAP_KEY) headers["X-Shoulder-Tap-Key"] = env.SHOULDER_TAP_KEY;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const raw = await res.text();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const text = JSON.parse(line.slice(6))?.result?.content?.[0]?.text;
    if (text) return text;
  }
  return "";
}

// ---------- 节流 ----------

function tickIsDue() {
  try {
    const { lastTick = 0 } = JSON.parse(fs.readFileSync(STATE, "utf8"));
    return Date.now() - lastTick >= TICK_MINUTES * 60_000;
  } catch {
    return true; // 没有状态文件 = 第一次，查
  }
}

function markTick() {
  try {
    fs.writeFileSync(STATE, JSON.stringify({ lastTick: Date.now() }), "utf8");
  } catch {}
}

// ---------- 输出 ----------

function say(event, text) {
  if (!text?.trim()) return; // 没话说就闭嘴
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text.trim() },
    }),
  );
}

/** 从完整返回里只抠出「顺便提一句」那一段。定时那一档只关心习惯。 */
function habitsOnly(full) {
  const i = full.indexOf("【顺便提一句】");
  return i < 0 ? "" : full.slice(i);
}

// ---------- 主流程 ----------

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let payload = {};
  try {
    payload = JSON.parse(input || "{}");
  } catch {}

  const event = payload.hook_event_name || "PostToolUse";
  const env = loadEnv();

  if (event === "UserPromptSubmit") {
    // 你开口了 —— 这是最该查的时刻，不节流。把你这句话一起带去。
    const prompt = (payload.prompt || "").slice(0, 400);
    const full = await callTool(env, "check_focus", prompt ? { activity: prompt } : {});
    markTick(); // 刚查过，定时那档可以歇十分钟
    say(event, full);
    return;
  }

  // 工具调用之后：节流。绝大多数时候这里直接返回，不发任何请求。
  if (!tickIsDue()) return;
  markTick();

  const full = await callTool(env, "check_focus", {});
  say(event, habitsOnly(full));
}

main().catch(() => {
  // 哨兵出问题就当它不存在。绝不打断你正在做的事。
  process.exit(0);
});
