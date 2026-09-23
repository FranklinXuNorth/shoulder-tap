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
  if (caption) args.push("--caption", caption.trim().slice(0, 80));
  return args;
}

/**
 * 这轮回答的第一句话，当拍拍旁边的那条如实总结。
 * 先把结尾那只手和它后面的提醒切掉，再去掉 markdown 的壳（链接、代码、粗体），取到第一个句号。
 */
export function doneLine(message, limit = 60) {
  let text = message || "";
  const hand = text.lastIndexOf("________/)");
  const fence = hand >= 0 ? text.lastIndexOf("```", hand) : -1;
  if (fence >= 0) text = text.slice(0, fence);
  text = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const first = text.split(/(?<=[。！？!?])/)[0]?.trim() || "";
  const clipped = first.replace(/[。！？!?.]+$/, "");
  return clipped.length > limit ? clipped.slice(0, limit - 1) + "…" : clipped;
}
