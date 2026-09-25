#!/usr/bin/env node
/**
 * 桌面端那只手下面的「已经做了」按钮调的：node habit.mjs done <习惯名>
 * 跟你在聊天里说「做了」一样记一笔（log_habit），然后刷新钩子的缓存，别下一句又被提醒一次。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { call } from "./core/tools.mjs";

const [cmd, name] = process.argv.slice(2);
if (cmd !== "done" || !name) {
  console.log("用法：node habit.mjs done <习惯名>");
  process.exit(1);
}
console.log(await call("log_habit", { habit: name, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "watch.mjs"), "--refresh"], { stdio: "ignore", windowsHide: true });
