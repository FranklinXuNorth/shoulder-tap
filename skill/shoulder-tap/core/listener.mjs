/**
 * listen.mjs 的看门：登录了（或配了同步密钥）就让它在后台常驻，别人一改这台马上知道。
 * 谁都可以叫 ensureListener()：钩子每次你开口时叫一次、设置页启动 / 登录后叫一次、login.mjs 登完叫一次。
 * 活着就不管；死了（重启过、被杀了）就再起一个。listen.mjs 自己也会查 pid 文件，两个同时起只留一个。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STATE_DIR, loadEnv } from "./store.mjs";
import { syncConfig } from "./sync.mjs";

export const PID_FILE = path.join(STATE_DIR, "listen.pid");
const LISTEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "listen.mjs");

export const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};
export const listenerPid = () => { try { return Number(fs.readFileSync(PID_FILE, "utf8")) || 0; } catch { return 0; } };

export function ensureListener() {
  const env = loadEnv();
  if (env.SHOULDER_TAP_NO_LISTENER === "1" || !syncConfig(env)) return false;
  if (alive(listenerPid())) return true;
  try {
    spawn(process.execPath, [LISTEN], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch { return false; }
  return true;
}

export function stopListener() {
  const pid = listenerPid();
  if (alive(pid)) try { process.kill(pid); } catch {}
  fs.rmSync(PID_FILE, { force: true });
}
