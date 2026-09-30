/**
 * 2026-09-29 暂停：钩子和 listen.mjs 都不再调它，每台在线设备照拍。要恢复，在 watch.mjs 的两处 tapDesktop、
 * listen.mjs 的 remoteTap 开头加回 shouldShowHere(env) 的判断即可（git log 里 75d861c 是原样）。
 *
 * 内部开关：这台机器最近有没有人在用（只在本机判断，什么都不上传）。默认关。
 *
 * 打开：config.json 里 "trackActive": true，或者环境变量 SHOULDER_TAP_TRACK_ACTIVE=1。设置页里没有这个开关。
 * 打开后，拍肩要落在这台之前（本机钩子拍自己、别的机器推过来），先问一次「这台多久没被碰过」：
 * 超过 SHOULDER_TAP_IDLE_LIMIT_MIN（默认 10）分钟就不显示。服务端照旧推给所有在线设备，每台自己决定显示不显示。
 *
 * 只读一个空闲时长：不读屏幕、不读按了什么键、鼠标在哪、哪个窗口；不常驻、不轮询，要拍的那一刻问一次；
 * 结果不写盘、不上报。也就不需要任何辅助功能 / 输入监控权限。
 *   Windows  GetLastInputInfo（user32），起一次 PowerShell
 *   macOS    ioreg 的 HIDIdleTime
 *   其它     读不到 → 当作有人在用（照常显示）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const WIN_PS = `Add-Type @"
using System; using System.Runtime.InteropServices;
public static class StIdle {
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref Info i);
  public static uint Ms() { var i = new Info(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.dwTime; }
}
"@
[StIdle]::Ms()`;

export function trackActiveEnabled(env = process.env) {
  if (env.SHOULDER_TAP_TRACK_ACTIVE === "1") return true;
  if (env.SHOULDER_TAP_TRACK_ACTIVE === "0") return false;
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "shoulder-tap", "config.json"), "utf8")).trackActive === true; }
  catch { return false; }
}

/** 这台多少毫秒没被碰过；读不到返回 null。测试用 SHOULDER_TAP_IDLE_MS 直接给值。 */
export function idleMs(env = process.env) {
  if (env.SHOULDER_TAP_IDLE_MS !== undefined) return Number(env.SHOULDER_TAP_IDLE_MS);
  try {
    if (process.platform === "win32")
      return Number(execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", WIN_PS], { encoding: "utf8", timeout: 5000, windowsHide: true }).trim());
    if (process.platform === "darwin") {
      const m = /"HIDIdleTime" = (\d+)/.exec(execFileSync("ioreg", ["-c", "IOHIDSystem", "-d", "4"], { encoding: "utf8", timeout: 5000, maxBuffer: 4 << 20 }));
      return m ? Number(m[1]) / 1e6 : null;
    }
  } catch {}
  return null;
}

/** 开关关着：永远显示。开着：这台最近 N 分钟有人碰过（或读不到）才显示。 */
export function shouldShowHere(env = process.env) {
  if (!trackActiveEnabled(env)) return true;
  const ms = idleMs(env);
  const limit = (Number(env.SHOULDER_TAP_IDLE_LIMIT_MIN) || 10) * 60_000;
  return ms === null || !Number.isFinite(ms) || ms < limit;
}
