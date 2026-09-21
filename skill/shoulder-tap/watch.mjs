#!/usr/bin/env node
/**
 * shoulder-tap 的本地哨兵。
 *
 * 模型只在被调用的那一瞬间存在，所以没有任何东西能「推」给它。
 * 这个脚本换了个方向：让 harness 在两个确定的时刻替模型去看一眼，
 * 把结果直接塞进它的上下文 —— 模型没有跳过的余地。
 *
 *   UserPromptSubmit  你每次开口     → 读本地缓存，立刻返回，网络甩到后台
 *   PostToolUse       每次工具调用后 → 写操作立即刷新；否则十分钟一次，且只在有到期习惯时出声
 *
 * 为什么读缓存：网络那一趟是 400ms，而它**卡在你按回车到模型开口之间**。
 * 今天的清单一天才变几次，用几分钟前的副本判断「这件事相不相关」，结论一模一样。
 *
 * 三条硬规矩：
 *   1. 永远 exit 0。哨兵坏了不能把你的会话也搞坏。
 *   2. 有超时。Vercel 或 Notion 慢了，宁可用旧的。
 *   3. 没话说就一个字都不输出。上下文很贵。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/**
 * 状态放在 skill 目录**外面**：skill 目录是装进来的代码，以后更新会整个覆盖；
 * 跑出来的数据混在里面迟早被连带清掉。~/.claude 本来就是全局的，任何项目都读同一份。
 */
const STATE_DIR = path.join(os.homedir(), ".claude", "shoulder-tap");
const STATE = path.join(STATE_DIR, "state.json");

const TICK_MINUTES = 10; // PostToolUse 定时那一档的节流
const REFRESH_COOLDOWN_MS = 20_000; // 防止后台刷新扎堆
const TIMEOUT_MS = 4000;

/** 缓存里存的是带占位符的整段返回，注入前把这一处换成你当下说的话。 */
const ACTIVITY_SLOT = "__SHOULDER_TAP_ACTIVITY__";

/** 这些工具会改 Notion，调完立刻刷新，不等十分钟。 */
const WRITE_TOOLS = ["set_focus", "add_focus", "complete_focus", "add_habit", "log_habit", "setup"];

// ---------- 配置：skill 自己的 .env，不进仓库，不上传任何地方 ----------

function loadEnv() {
  const out = { ...process.env };
  const files = [
    path.join(HERE, ".env"),
    path.join(os.homedir(), ".claude", "skills", "shoulder-tap", ".env"),
    path.join(STATE_DIR, ".env"),
  ];
  for (const file of files) {
    try {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (line.trim().startsWith("#")) continue;
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return out;
}

// ---------- 状态 ----------

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ ...readState(), ...patch }, null, 2), "utf8");
  } catch {}
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

/**
 * 去拿一份新的。活动那一行用占位符填，因为整段返回里只有那一行跟「你当下说什么」有关，
 * 其余（清单、当前是第几条、三档规则、到期习惯）都只取决于 Notion 的状态。
 */
async function refresh(env) {
  // 时区从这台机器上读，不写死 —— 哨兵跑在用户身边，它比服务端清楚用户在哪。
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const plan = await callTool(env, "check_focus", { activity: ACTIVITY_SLOT, tz });
  if (plan) writeState({ plan, planAt: Date.now() });
}

/** 把刷新甩到一个独立进程里，本进程立刻退出，不让你等。 */
function spawnRefresh(force = false) {
  const { refreshAt = 0 } = readState();
  if (!force && Date.now() - refreshAt < REFRESH_COOLDOWN_MS) return;
  writeState({ refreshAt: Date.now() });
  try {
    spawn(process.execPath, [SELF, "--refresh"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
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

/** 从整段里只抠出「顺便提一句」那一节。定时那一档只关心习惯。 */
function habitsOnly(full) {
  const i = full?.indexOf("【顺便提一句】") ?? -1;
  return i < 0 ? "" : full.slice(i);
}

/** 缓存里那句占位的活动，换成你真正说的话。 */
function fillActivity(plan, prompt) {
  if (!plan) return "";
  const activity = (prompt || "").replace(/\s+/g, " ").slice(0, 300);
  return activity ? plan.split(ACTIVITY_SLOT).join(activity) : plan;
}

// ---------- 主流程 ----------

async function main() {
  const env = loadEnv();

  // 后台刷新进程走这条，不读 stdin、不输出任何东西。
  if (process.argv.includes("--refresh")) {
    await refresh(env);
    return;
  }

  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let payload = {};
  try {
    payload = JSON.parse(input || "{}");
  } catch {}

  const event = payload.hook_event_name || "PostToolUse";
  const state = readState();

  if (event === "UserPromptSubmit") {
    // 有缓存就立刻用，同时甩一个后台刷新。你感觉到的只有 node 的启动时间。
    if (state.plan) {
      say(event, fillActivity(state.plan, payload.prompt));
      spawnRefresh();
      return;
    }
    // 第一次跑，没有缓存可用，只能同步等一次。
    await refresh(env).catch(() => {});
    say(event, fillActivity(readState().plan, payload.prompt));
    return;
  }

  // 工具调用之后。
  const tool = payload.tool_name || "";
  if (WRITE_TOOLS.some((t) => tool.includes(t))) {
    // 你刚说「做完了」之类的话 —— 立刻去拿新的，别等十分钟。
    // 不直接拿工具返回写缓存：那几个工具回的是「记下了 + 清单」，
    // 形状跟缓存里那整段不一样，硬拼容易错。重新拉一次最稳，反正是后台。
    spawnRefresh(true);
    return;
  }

  const { lastTick = 0 } = state;
  if (Date.now() - lastTick < TICK_MINUTES * 60_000) return;
  writeState({ lastTick: Date.now() });

  spawnRefresh();
  say(event, habitsOnly(state.plan)); // 用缓存里的，不等网络
}

main().catch(() => {
  // 哨兵出问题就当它不存在。绝不打断你正在做的事。
  process.exit(0);
});
