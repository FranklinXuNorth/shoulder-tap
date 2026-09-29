#!/usr/bin/env node
/**
 * 桌面端那只手下面的按钮调的：node habit.mjs done <习惯名>，硬习惯还有 node habit.mjs skip <习惯名>
 * 跟你在聊天里说「做了」一样记一笔（log_habit），然后刷新钩子的缓存，别下一句又被提醒一次。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { call } from "./core/tools.mjs";

const [cmd, raw] = process.argv.slice(2);
// 提醒发出时带上了「这次提醒」的 ID（习惯名#ID）：一次提醒只能被回答一次，别处点过这里就不重复记
const m = /^(.*)#([\w-]{8,})$/.exec(raw ?? "");
const [name, reminder] = m ? [m[1], m[2]] : [raw, undefined];
if (!["done", "skip"].includes(cmd) || !name) {
  console.log("用法：node habit.mjs done|skip <习惯名>");
  process.exit(1);
}
const skip = cmd === "skip" ? { skip: true, note: "桌面上点了今天不做" } : {};
console.log(await call("log_habit", { habit: name, reminder, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...skip }));
spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "watch.mjs"), "--refresh"], { stdio: "ignore", windowsHide: true });
