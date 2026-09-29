#!/usr/bin/env node
/**
 * 登录 shoulder-tap 的跨机器同步（第三档：经 shoulder-tap 的 sync service）。平时在设置页右上角点「登录」就行；
 * 这个脚本给没有桌面、只有终端的机器用（比如跑 OpenClaw 的服务器）。
 *
 *   node login.mjs             打印链接（有桌面就顺手打开浏览器）→ 你用邮箱或 Google 登录 → 自动接上同步
 *   node login.mjs --logout    注销这台机器，本机数据留着
 *   node login.mjs --status    看看登的是谁
 *
 * 登录同一个账号的机器就是同一份数据，不用记口令。不需要输入，所以 agent 也可以替你跑，把链接给你点。
 */
import { spawn } from "node:child_process";
import { loadEnv, openStore, syncNow, moveNotionToLocal } from "./core/store.mjs";
import { deviceLogin, openVault, accountInfo, logout, writeEnv, ENV_FILE } from "./core/account.mjs";
import { ensureListener, stopListener } from "./core/listener.mjs";

const DEFAULT_URL = "https://sync.example";
const env = loadEnv();
const base = (env.SHOULDER_TAP_SYNC_URL || DEFAULT_URL).replace(/\/+$/, "");
const say = (s) => console.log("  " + s);

function openBrowser(url) {
  if (env.SHOULDER_TAP_NO_BROWSER === "1") return; // 测试 / 没有桌面的服务器：只打印链接
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref(); } catch {}
}

if (process.argv.includes("--status")) {
  if (!env.SHOULDER_TAP_DEVICE_TOKEN || !env.SHOULDER_TAP_VAULT_KEY) say("没登录。跑 node login.mjs，或者在设置页右上角点「登录」");
  else { const me = await accountInfo(base, env.SHOULDER_TAP_DEVICE_TOKEN); say(me.email ? `登的是 ${me.email}，这个账号下 ${me.devices} 台机器` : "令牌失效了，重新登录一次"); }
  process.exit(0);
}

if (process.argv.includes("--logout")) {
  if (env.SHOULDER_TAP_DEVICE_TOKEN) await logout(base, env.SHOULDER_TAP_DEVICE_TOKEN).catch(() => {});
  writeEnv({ SHOULDER_TAP_DEVICE_TOKEN: null, SHOULDER_TAP_VAULT_KEY: null });
  stopListener();
  say("这台机器注销了。本机的数据都还在，只是不再同步。");
  process.exit(0);
}

say(`连 ${base}`);
const { token, email } = await deviceLogin(base, {
  onCode: (url, code) => {
    say(`在浏览器里登录（邮箱或 Google）：${url}`);
    say(`设备码 ${code}`);
    openBrowser(url);
  },
});
say(`登上了：${email}`);
const { key } = await openVault(base, token);

// 云同步只管本地存储。这台在用 Notion：把 Notion 里的全部记录搬到本地，Notion 里的原样留着当备份。
if (openStore().kind === "notion") {
  const moved = await moveNotionToLocal();
  say(`这台原来存在 Notion：搬过来 ${moved.tasks} 条任务、${moved.habits} 条习惯记录（Notion 里的原样留着）。`);
}

writeEnv({ SHOULDER_TAP_SYNC_URL: base, SHOULDER_TAP_DEVICE_TOKEN: token, SHOULDER_TAP_VAULT_KEY: key.toString("base64url"), SHOULDER_TAP_SYNC_KEY: null });
say(`写进了 ${ENV_FILE()}。`);
try {
  const r = await syncNow();
  say(`同步好了：拉下来 ${r.pulled} 行，推上去 ${r.pushed} 行。这台现在有 ${r.tasks} 条任务、${r.habits} 条习惯记录，跟账号里的一致。`);
} catch (e) {
  say(`第一次同步没成功（${e.message}）。不要紧：下一次 Claude Code / Codex 调 shoulder-tap 时会接着同步。`);
}
if (ensureListener()) say("别的机器一改，这台马上跟上（后台挂着推送监听）。");
say("已经开着的 Claude Code / Codex 会话不用重开：下一次调 shoulder-tap 就是同步过的数据。");
