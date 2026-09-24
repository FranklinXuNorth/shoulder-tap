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
 *   Stop              模型说完一轮   → 结尾有哪只 ASCII 手就拍哪下：拍拍 = 做完了，taptap = 提醒
 *   PreToolUse        模型要问你话   → AskUserQuestion 弹出来之前打个响指，问题贴在手旁边
 *
 * 跨机器：常驻进程把「我是不是最近被碰过的那台」写在 active.json 里。是本机就直接拍，不绕云端；
 * 不是才经中转（relay.mjs）送到那台；没配、没登录、没人在线、超时，都退回本机拍。
 *
 * 为什么读缓存：网络那一趟是 400ms，而它**卡在你按回车到模型开口之间**。
 * 今天的清单一天才变几次，用几分钟前的副本判断「这件事相不相关」，结论一模一样。
 *
 * 三条硬规矩：
 *   1. 永远 exit 0。哨兵坏了不能把你的会话也搞坏。
 *   2. 有超时。服务端或 Notion 慢了，宁可用旧的。
 *   3. 没话说就一个字都不输出。上下文很贵。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { completionGestures, desktopArgs, doneLine, missingHandDecision } from "./completion.mjs";
import { localJudgement } from "./local-jev.mjs";
import { relaySend } from "./relay.mjs";
import crypto from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/**
 * 状态放在 skill 目录**外面**：skill 目录是装进来的代码，以后更新会整个覆盖；
 * 跑出来的数据混在里面迟早被连带清掉。~/.claude 本来就是全局的，任何项目都读同一份。
 */
const STATE_DIR = path.join(os.homedir(), ".claude", "shoulder-tap");
const STATE = path.join(STATE_DIR, "state.json");

/** 桌面 App。装了就用，没装就当没有 —— 哨兵在纯文本模式下照样完整工作。Mac 版包在 .app 里。 */
const APP = path.join(STATE_DIR, "app",
  process.platform === "win32" ? "shoulder-tap-tap.exe"
  : process.platform === "darwin" ? "ShoulderTap.app/Contents/MacOS/shoulder-tap-tap"
  : "shoulder-tap-tap");

/**
 * 那只 ASCII 手中间一行里最独特的一截：食指那一笔。
 * 刻意挑了不含反斜杠的一段 —— 反斜杠在字符串里要转义，多一层少一层都不会报错，
 * 只会安静地匹配不上。
 */
const HAND = "________/)";

/** 只在消息**结尾**这么多字符里找。中间引用到那段 ASCII（比如正在改这个仓库）不算数。 */
const TAIL_CHARS = 800;

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

/**
 * 常驻进程按中转的广播写的：现在活跃的是不是本机。十分钟没更新就当不知道，走中转让它判。
 * 没这个文件（没开跨机器、常驻进程没起来）也走中转 —— relaySend 没配会立刻返回 false，最后还是本机拍。
 */
function locallyActive() {
  try {
    const { active, at = 0 } = JSON.parse(fs.readFileSync(path.join(STATE_DIR, "active.json"), "utf8"));
    return active === true && Date.now() - at < 10 * 60_000;
  } catch {
    return false;
  }
}

/** 这台机器在频道里的名字：第一次生成，之后不变。随机值，跟机器名无关。 */
function deviceId() {
  const { device } = readState();
  if (device) return device;
  const fresh = crypto.randomUUID();
  writeState({ device: fresh });
  return fresh;
}

// ---------- 跟 MCP 说话 ----------

async function callTool(env, name, args) {
  const url = env.SHOULDER_TAP_URL || "https://shoulder-tap-relay.shoulder-tap.workers.dev/mcp";
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
  if (!res.ok) return "";
  try {
    const text = JSON.parse(raw)?.result?.content?.[0]?.text;
    if (text) return text;
  } catch {}
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

/**
 * 拍一下桌面。
 *
 * 只有 Stop 那一档走到这里：模型说完一轮，结尾有那只手才拍。到期的习惯先进上下文，
 * 由模型在停顿处带出来。模型自己不调这个 exe —— 拍肩这件事不该由被拍的人自觉。
 *
 * 一条命令覆盖两种情况：App 没开就开起来再拍，开着就直接拍。
 * 单实例锁在 App 那边，这里不需要知道它在不在。
 *
 * 屏幕上只有那一下，不显示文字 —— 话已经通过 say() 进了模型的上下文，
 * 传过去的正文只落进托盘提示，留个事后能看一眼的地方。
 */
function tapDesktop(env, text, payload = {}, mode = "tap", caption = "") {
  // Linux 没有官方桌面端；有人按 desktop-linux/README.md 写了一个放在那个位置，就照样调。

  const exe = env.SHOULDER_TAP_APP || APP;
  const body = (text || "").trim();
  if (!body && mode === "tap") return;

  try {
    if (!fs.existsSync(exe)) return; // 没装桌面 App，安静跳过
    spawn(exe, desktopArgs(payload, mode, body, caption), {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {}
}

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

/**
 * 那只手后面跟着的那一句，就是这次要提的事 —— 按约定它永远是回答的最后一行。
 * 手本身也是几行 ASCII，最后一行要是落在手上，说明后面没跟话，给句通用的。
 */
function reminderAfterHand(tail) {
  const lines = tail.split("\n").map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || "";
  const stillArt = last.includes("(__)") || last.includes("|") || last.startsWith("```");
  return stillArt ? "该回到今天说好的那条了。" : last;
}

/** 弹出来的那几个问题，拼成一行。多个问题用「｜」隔开，字条那边会截断。 */
function questionLine(input) {
  return (input?.questions || []).map((q) => (q?.question || "").trim()).filter(Boolean).join(" ｜ ");
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

  // 模型刚说完一轮。结尾有那只 ASCII 手，就拍一下桌面。
  //
  // 为什么放在钩子里，而不是让模型自己去调那个 exe：拍肩这件事不该由被拍的人自觉。
  // 模型漏读一行 CLAUDE.md 就哑掉了，钩子不会。顺带两个好处 —— 时机对（话说完了才拍，
  // 不是说到一半），以及不占模型的一次工具调用。
  //
  // Stop 不为子 agent 触发（那是 SubagentStop），所以后台任务不会拍你一脸。
  if (event === "Stop") {
    // 结尾一只手都没有：顶回去一次让模型补（重试那轮不再顶，绝不卡死会话）。
    const block = missingHandDecision(payload);
    if (block) { process.stdout.write(JSON.stringify(block)); return; }

    // 只看结尾。中间引用到那段 ASCII（比如正在改这个仓库）不算数。
    const tail = (payload.last_assistant_message || "").slice(-TAIL_CHARS);
    // 结尾有几只手就拍几下，桌面按顺序排队：拍拍（做完了）在前，taptap（提醒）在后。
    // 手旁边那一小条字：拍拍放这轮的如实总结；taptap 放手后面那句提醒。
    const reminder = reminderAfterHand(tail);
    for (const gesture of completionGestures(payload)) {
      const mode = gesture === "tap" ? "tap" : "complete";
      const text = mode === "tap" ? reminder : "";
      const caption = mode === "tap" ? reminder : doneLine(payload.last_assistant_message);
      // 本机就是你在用的那台：直接拍。否则经中转送过去；送到了那台会自己拍。
      if (!locallyActive() && (await relaySend(env, deviceId(), mode, { caption, text }))) continue;
      tapDesktop(env, text, payload, mode, caption);
    }
    return;
  }

  // 模型要停下来问你。你可能早切去别的窗口了 —— 打个响指，把问题贴在手旁边。
  // 不输出任何东西：不拦这次调用，也不往上下文里塞话。
  if (event === "PreToolUse") {
    if (payload.tool_name === "AskUserQuestion") {
      const question = questionLine(payload.tool_input);
      if (locallyActive() || !(await relaySend(env, deviceId(), "snap", { caption: question, text: question })))
        tapDesktop(env, question, payload, "snap", question);
    }
    return;
  }

  if (event === "UserPromptSubmit") {
    tapDesktop(env, "", payload, "bind");
    // 有缓存就立刻用，同时甩一个后台刷新。你感觉到的只有 node 的启动时间。
    if (state.plan) {
      spawnRefresh();
      const judgement = await localJudgement(env, state.plan, payload.prompt);
      say(event, fillActivity(state.plan, payload.prompt) + judgement);
      return;
    }
    // 第一次跑，没有缓存可用，只能同步等一次。
    await refresh(env).catch(() => {});
    const plan = readState().plan;
    const judgement = await localJudgement(env, plan, payload.prompt);
    say(event, fillActivity(plan, payload.prompt) + judgement);
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

  const habits = habitsOnly(state.plan); // 用缓存里的，不等网络
  say(event, habits); // 只进上下文，不拍桌面：手只在 Stop 出现，模型会在停顿处带上它
}

main().catch(() => {
  // 哨兵出问题就当它不存在。绝不打断你正在做的事。
  process.exit(0);
});
