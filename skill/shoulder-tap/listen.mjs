#!/usr/bin/env node
/**
 * 常驻：挂在同步频道的 WebSocket 上。别的机器（或云端网页版）一改，服务端喊一声，这里马上：
 *   1. 拉下来并进本地 data.json（跟 MCP 调用走同一条路：锁、拉、推）
 *   2. 刷新钩子的缓存，下一次你开口时注入的就是最新的清单
 * 每一轮都打一行日志到 stdout。没登录也没配同步密钥就直接退出。
 *
 *   node ~/.claude/skills/shoulder-tap/listen.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, openStore } from "./core/store.mjs";
import { syncConfig, listen } from "./core/sync.mjs";

const cfg = syncConfig(loadEnv());
if (!cfg) {
  console.log("没登录，也没配同步密钥：没什么可听的。先跑 node login.mjs");
  process.exit(0);
}
const WATCH = path.join(path.dirname(fileURLToPath(import.meta.url)), "watch.mjs");

// 一连串通知只拉一次：正在拉的时候又来了，拉完再补一次
let running = false, again = false;
async function refresh(seq) {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      await openStore().listHabits(); // 走一遍 localCall：锁住 → 拉 → 推
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
