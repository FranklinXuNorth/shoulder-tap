/** 每只手最独特的一截，都不含反斜杠（反斜杠在字符串里多一层少一层不报错，只会安静地匹配不上）。 */
const TAP = "________/)"; // taptap：食指那一笔
const SNAP = "(_____)  *"; // 响指：捻在一起的指头和那一下火花
const PAT = "| || || |"; // 以前结尾打的拍拍：已经开着的会话里模型还拿着旧说明，照样认成「做完了」

/**
 * 结尾有哪几只手。响指（做完了）在前，taptap（提醒）在后 —— 桌面按这个顺序播。
 * 重试那一轮（stop_hook_active）也照认：手往往就是在那一轮被补上的。
 */
export function completionGestures(payload) {
  if (payload.hook_event_name !== "Stop") return [];
  const tail = (payload.last_assistant_message || "").slice(-800);
  const out = [];
  if (tail.includes(SNAP) || tail.includes(PAT)) out.push("snap");
  if (tail.includes(TAP)) out.push("tap");
  return out;
}

/**
 * 结尾一只手都没有，就把这轮顶回去一次，让模型补上。只顶一次：重试那轮还没有就算了，
 * 绝不能把用户的会话卡在循环里。
 */
export function missingHandDecision(payload) {
  if (payload.hook_event_name !== "Stop" || payload.stop_hook_active) return null;
  if (!(payload.last_assistant_message || "").trim()) return null;
  if (completionGestures(payload).length) return null;
  return {
    decision: "block",
    reason:
      "结尾漏了手。补上：一句话说这轮做了什么，然后原样打出响指那只手（check_focus 的返回里有画，代码块）。" +
      "今天说好的那条还没动、或有习惯到点，就再打 taptap 那只手，最后加一句提醒。",
  };
}

export function desktopArgs(payload, mode, text = "", caption = "", habit = "") {
  const args = ["--mode", mode, "--session", payload.session_id || payload.transcript_path || "",
    "--source-pid", String(process.ppid)];
  if (text) args.push("--text", text.trim().slice(0, 400));
  if (caption) args.push("--caption", caption.trim().slice(0, 160));
  // 这次 taptap 提醒的是一个到点的习惯：桌面端在字下面放「已经做了 / 还没做」，点「已经做了」就用这个 node 跑 habit.mjs 记一笔
  if (habit) args.push("--habit", habit, "--node", process.execPath);
  return args;
}

/** 提醒那句话里点了名的、正在到点的习惯（从缓存的 check_focus 返回里「顺便提一句」那几行找）。没有就空串。 */
export function dueHabitIn(plan, reminder) {
  const due = [...(plan || "").matchAll(/^ {2}· (.+?) —— 超了/gm)].map((m) => m[1].trim());
  return due.find((name) => reminder.includes(name)) ?? "";
}

/**
 * 这轮回答的第一段，当响指旁边的那条如实总结。
 * 先把结尾的手（不管几只）和它们后面的提醒切掉，取第一段（空行之前），再去掉 markdown 的壳。超了打省略号。
 */
export function doneLine(message, limit = 120) {
  let text = message || "";
  const first = [TAP, SNAP, PAT].map((a) => text.lastIndexOf(a)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const fence = first === undefined ? -1 : text.lastIndexOf("```", first);
  if (fence >= 0) text = text.slice(0, fence);
  text = text.trim().split(/\n\s*\n/)[0] || "";
  text = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}
