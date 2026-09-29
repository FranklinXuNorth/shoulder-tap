/**
 * 拍一下这台机器的桌面。钩子（watch.mjs）在本机拍，推送监听（listen.mjs）替别的机器在这台拍，都走这里。
 *
 * 一条命令覆盖两种情况：App 没开就开起来再拍，开着就直接拍（单实例锁在 App 那边）。
 * 没装桌面 App 就安静跳过 —— 文本拍肩照样完整工作。Linux 没有官方桌面端；有人按 desktop-linux/README.md
 * 写了一个放在 APP 那个位置，就照样调。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { desktopArgs } from "../completion.mjs";

/** 桌面 App。Mac 版包在 .app 里。 */
export const APP = path.join(os.homedir(), ".claude", "shoulder-tap", "app",
  process.platform === "win32" ? "shoulder-tap-tap.exe"
  : process.platform === "darwin" ? "ShoulderTap.app/Contents/MacOS/shoulder-tap-tap"
  : "shoulder-tap-tap");

export function tapDesktop(env, text, payload = {}, mode = "tap", caption = "", habit = "", skippable = false) {
  const exe = env.SHOULDER_TAP_APP || APP;
  const body = (text || "").trim();
  if (!body && mode === "tap") return false;
  // 测试用：记一行「这台拍了什么」，不起桌面端
  if (env.SHOULDER_TAP_TAP_LOG) { fs.appendFileSync(env.SHOULDER_TAP_TAP_LOG, `${mode} ${caption || body}\n`); return true; }
  try {
    if (!fs.existsSync(exe)) return false;
    spawn(exe, desktopArgs(payload, mode, body, caption, habit, skippable), { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  } catch { return false; }
}
