export function completionGesture(payload) {
  if (payload.hook_event_name !== "Stop" || payload.stop_hook_active) return null;
  const tail = (payload.last_assistant_message || "").slice(-800);
  if (!tail.trim()) return null;
  return tail.includes("________/)") ? "tap" : "complete";
}

export function desktopArgs(payload, mode, text = "", caption = "") {
  const args = ["--mode", mode, "--session", payload.session_id || payload.transcript_path || "",
    "--source-pid", String(process.ppid)];
  if (text) args.push("--text", text.trim().slice(0, 400));
  if (caption) args.push("--caption", caption.trim().slice(0, 160));
  return args;
}

/**
 * 这轮回答的第一段，当拍拍旁边的那条如实总结。
 * 先把结尾那只手和它后面的提醒切掉，取第一段（空行之前），再去掉 markdown 的壳（链接、代码、粗体）。超了打省略号。
 */
export function doneLine(message, limit = 120) {
  let text = message || "";
  const hand = text.lastIndexOf("________/)");
  const fence = hand >= 0 ? text.lastIndexOf("```", hand) : -1;
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
