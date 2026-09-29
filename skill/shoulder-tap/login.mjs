#!/usr/bin/env node
/**
 * 登录 shoulder-tap 的跨机器同步（第三档：端到端加密，经 shoulder-tap 的 sync service）。
 *
 *   node login.mjs             打开浏览器登录（邮箱密码或 Google）→ 输同步口令 → 写进 .env，之后自动同步
 *   node login.mjs --logout    注销这台机器，本机数据留着
 *   node login.mjs --status    看看登的是谁
 *
 * 每台机器登同一个账号、输同一个同步口令，就是同一份数据。口令只在本机用，不上传。
 */
import { spawn } from "node:child_process";
import readline from "node:readline";
import { loadEnv, openStore, syncNow, moveNotionToLocal } from "./core/store.mjs";
import { deviceLogin, openVault, accountInfo, logout, writeEnv, ENV_FILE } from "./core/account.mjs";

const DEFAULT_URL = "https://sync.example";
const env = loadEnv();
const base = (env.SHOULDER_TAP_SYNC_URL || DEFAULT_URL).replace(/\/+$/, "");
const say = (s) => console.log("  " + s);

function openBrowser(url) {
  if (env.SHOULDER_TAP_NO_BROWSER === "1") return; // 测试 / 没有桌面的服务器：只打印链接
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).unref(); } catch {}
}

/** 不回显的输入。环境变量 SHOULDER_TAP_PASSPHRASE 给了就不问（脚本里用）。 */
function askHidden(question) {
  if (env.SHOULDER_TAP_PASSPHRASE) return Promise.resolve(env.SHOULDER_TAP_PASSPHRASE);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
  });
}

function askVisible(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

if (process.argv.includes("--status")) {
  if (!env.SHOULDER_TAP_DEVICE_TOKEN) say("没登录。跑 node login.mjs");
  else { const me = await accountInfo(base, env.SHOULDER_TAP_DEVICE_TOKEN); say(me.email ? `登的是 ${me.email}，这个账号下 ${me.devices} 台机器` : "令牌失效了，重跑 node login.mjs"); }
  process.exit(0);
}

if (process.argv.includes("--logout")) {
  if (env.SHOULDER_TAP_DEVICE_TOKEN) await logout(base, env.SHOULDER_TAP_DEVICE_TOKEN).catch(() => {});
  writeEnv({ SHOULDER_TAP_DEVICE_TOKEN: null, SHOULDER_TAP_VAULT_KEY: null });
  say("这台机器注销了。本机的数据都还在，只是不再同步。");
  process.exit(0);
}

// 模型在自己的 shell 里跑（没有终端、没法输口令）：别卡着等输入，说清楚让用户自己跑。口令不能经过聊天。
if (!process.stdin.isTTY && !env.SHOULDER_TAP_PASSPHRASE) {
  say("登录要在你自己的终端窗口里跑（要开浏览器、要输同步口令，口令别发在聊天里）：");
  say(`node "${process.argv[1]}"`);
  process.exit(2);
}

say(`连 ${base}`);
const { token, email } = await deviceLogin(base, {
  onCode: (url, code) => {
    say(`浏览器里登录（没自己打开就手动开）：${url}`);
    say(`设备码 ${code}`);
    openBrowser(url);
  },
});
say(`登上了：${email}`);
const me = await accountInfo(base, token);
say(me.hasVault ? "输你设过的同步口令（每台机器都一样）：" : "设一个同步口令（至少 8 位；每台机器都输这个，忘了云端那份就读不出来）：");
let result;
for (let tries = 0; ; tries++) {
  const pass = await askHidden("  同步口令：");
  if (!me.hasVault && !env.SHOULDER_TAP_PASSPHRASE && (await askHidden("  再输一遍：")) !== pass) { say("两次不一样，重来"); continue; }
  try { result = await openVault(base, token, pass); break; }
  catch (e) { say(e.message); if (tries >= 2 || env.SHOULDER_TAP_PASSPHRASE) process.exit(1); }
}
say(result.created ? "同步密钥建好了。别的机器登同一个账号、输同一个口令就能接上。" : "接上了这个账号的同步。");

// 云同步只管本地存储。这台在用 Notion：先把 Notion 里的全部记录搬到本地，Notion 里的原样留着当备份。
if (openStore().kind === "notion") {
  say("这台机器现在把数据存在 Notion。云同步要用本地存储：把 Notion 里的全部任务和习惯记录搬到本地，Notion 里的原样留着。");
  const yes = env.SHOULDER_TAP_PASSPHRASE ? "y" : await askVisible("  搬过来并开始同步？[Y/n] ");
  if (/^n/i.test(yes.trim())) { say("那这台继续用 Notion，不开云同步。想开的时候再跑一次 node login.mjs。"); process.exit(0); }
  const moved = await moveNotionToLocal();
  say(`从 Notion 搬过来 ${moved.tasks} 条任务、${moved.habits} 条习惯记录。`);
}

writeEnv({ SHOULDER_TAP_SYNC_URL: base, SHOULDER_TAP_DEVICE_TOKEN: token, SHOULDER_TAP_VAULT_KEY: result.key.toString("base64url"), SHOULDER_TAP_SYNC_KEY: null });
say(`写进了 ${ENV_FILE()}。`);
try {
  const r = await syncNow();
  say(`第一次同步好了：拉下来 ${r.pulled} 行，推上去 ${r.pushed} 行。这台现在有 ${r.tasks} 条任务、${r.habits} 条习惯记录，跟账号里的一致。`);
} catch (e) {
  say(`第一次同步没成功（${e.message}）。不要紧：下一次 Claude Code / Codex 调 shoulder-tap 时会接着同步。`);
}
say("已经开着的 Claude Code / Codex 会话不用重开：下一次调 shoulder-tap 就是同步过的数据。");
