/**
 * 这台机器多久没被碰过（键盘、鼠标、触控板），毫秒；以及鼠标在第几块屏（共几块）。
 * 给 listen.mjs 判断「你是不是正在用这台、哪块屏」。不读按了什么键、鼠标的坐标、哪个窗口 ——
 * 也就不需要任何辅助功能 / 输入监控权限。
 *
 *   Windows  一个常驻的 PowerShell，每秒一次：GetLastInputInfo（user32）+ 鼠标所在的 Screen
 *   macOS    每 1.5 秒读一次 ioreg 的 HIDIdleTime；刚被碰过时再用 JXA 问一次鼠标在哪块 NSScreen
 *   其它     没有 → 不上报，拍肩退回「推给所有其它在线设备」
 *   测试     SHOULDER_TAP_IDLE_FILE=<文件>：内容「毫秒」或「毫秒|第几块屏|共几块」
 *
 * watchIdle(onIdle) 返回 stop()；onIdle(ms, screen)，screen = {screen, screens} 或 null。
 */
import fs from "node:fs";
import { spawn, execFile } from "node:child_process";
import readline from "node:readline";

// 一行「空闲毫秒|第几块屏|共几块」
const parse = (line) => {
  const [ms, at, n] = String(line).trim().split("|");
  const idle = Number(ms);
  if (!Number.isFinite(idle)) return null;
  return [idle, at !== undefined && at !== "" && Number(at) >= 0 ? { screen: String(at), screens: Number(n) || null } : null];
};

// macOS：鼠标在第几块屏。NSEvent.mouseLocation 不需要辅助功能权限
const MAC_SCREEN = "ObjC.import('AppKit'); var p=$.NSEvent.mouseLocation, s=$.NSScreen.screens, n=s.count, k=-1;" +
  "for (var i=0;i<n;i++){var f=s.objectAtIndex(i).frame; if(p.x>=f.origin.x&&p.x<f.origin.x+f.size.width&&p.y>=f.origin.y&&p.y<f.origin.y+f.size.height){k=i;break}} k+'|'+n";

const WIN_PS = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class StIdle {
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref Info i);
  public static uint Ms() { var i = new Info(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.dwTime; }
}
"@
while ($true) {
  $all = [System.Windows.Forms.Screen]::AllScreens
  $at = [Array]::IndexOf($all, [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position))
  [Console]::Out.WriteLine("$([StIdle]::Ms())|$at|$($all.Length)"); [Console]::Out.Flush(); Start-Sleep -Milliseconds 1000
}
`;

export function watchIdle(onIdle, env = process.env) {
  if (env.SHOULDER_TAP_IDLE_FILE) {
    const t = setInterval(() => {
      try { const r = parse(fs.readFileSync(env.SHOULDER_TAP_IDLE_FILE, "utf8")); if (r) onIdle(...r); } catch {}
    }, 200);
    return () => clearInterval(t);
  }
  if (process.platform === "win32") {
    const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", WIN_PS], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    ps.on("error", () => {});
    readline.createInterface({ input: ps.stdout }).on("line", (l) => { const r = parse(l); if (r) onIdle(...r); });
    return () => { try { ps.kill(); } catch {} };
  }
  if (process.platform === "darwin") {
    const t = setInterval(() => execFile("ioreg", ["-c", "IOHIDSystem", "-d", "4"], { maxBuffer: 4 << 20 }, (err, out) => {
      const m = !err && /"HIDIdleTime" = (\d+)/.exec(out);
      if (!m) return;
      const idle = Number(m[1]) / 1e6; // 纳秒 → 毫秒
      if (idle >= 3000) return onIdle(idle, null); // 没人碰，不用问在哪块屏
      execFile("osascript", ["-l", "JavaScript", "-e", MAC_SCREEN], (e2, o2) => onIdle(idle, e2 ? null : parse(`0|${o2}`)?.[1] ?? null));
    }), 1500);
    return () => clearInterval(t);
  }
  return () => {};
}
