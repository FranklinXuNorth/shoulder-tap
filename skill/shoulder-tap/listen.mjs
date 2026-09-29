#!/usr/bin/env node
/**
 * 常驻：挂在同步频道的 WebSocket 上。别的机器（或云端网页版）一改，服务端喊一声，这里马上：
 *   1. 拉下来并进本地 data.json（跟 MCP 调用走同一条路：锁、拉、推）
 *   2. 刷新钩子的缓存，下一次你开口时注入的就是最新的清单
 * 平时不用手动起：登录之后钩子、设置页会用 core/listener.mjs 把它带起来，一台机器只留一个。
 * 没登录、退出登录、令牌失效，它自己退出。每一轮打一行日志到 stdout。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv, openStore, lastSyncError } from "./core/store.mjs";
import { syncConfig, listen } from "./core/sync.mjs";
import { PID_FILE, alive, listenerPid } from "./core/listener.mjs";

const cfg = syncConfig(loadEnv());
if (!cfg) {
  console.log("没登录，也没配同步密钥：没什么可听的。");
  process.exit(0);
}
// 一台机器只留一个：已经有一个活着就走
const other = listenerPid();
if (other && other !== process.pid && alive(other)) process.exit(0);
fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
fs.writeFileSync(PID_FILE, String(process.pid));
const cleanup = () => { if (listenerPid() === process.pid) fs.rmSync(PID_FILE, { force: true }); };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));

const WATCH = path.join(path.dirname(fileURLToPath(import.meta.url)), "watch.mjs");

// 一连串通知只拉一次：正在拉的时候又来了，拉完再补一次
let running = false, again = false;
async function refresh(seq) {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      if (!syncConfig(loadEnv())) { console.log("退出登录了，不听了"); process.exit(0); }
      await openStore().listHabits(); // 走一遍 localCall：锁住 → 拉 → 推
      if (/→ 403/.test(String(lastSyncError?.message ?? ""))) { console.log("令牌失效了，不听了"); process.exit(0); }
      spawnSync(process.execPath, [WATCH, "--refresh"], { stdio: "ignore", windowsHide: true });
      console.log(`changed seq=${seq} → 已拉取并刷新`);
    } while (again);
  } catch (e) {
    console.log(`拉取失败：${e.message}`);
  } finally {
    running = false;
  }
}

const sub = listen(cfg, (m) => refresh(m.seq));
await sub.ready;
console.log("listening");
await refresh("start"); // 刚连上：补一次，断线期间别的机器改过的也拉下来
