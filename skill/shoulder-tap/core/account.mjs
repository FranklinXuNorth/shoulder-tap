/**
 * 登录（第三档：用 shoulder-tap 的 sync service 同步）。登录了同一个账号就能同步，不用记任何口令：
 *
 *   你是谁 → 设备码登录（浏览器里邮箱密码或 Google），换一个设备令牌。它决定你进哪个频道。
 *   钥匙   → 服务端替这个账号保管一把同步密钥，登录过的设备凭令牌来拿，在本机加解密每一行。
 *
 * 行在云端是密文；但钥匙在服务端手里，所以这不是端到端加密（要端到端就用 v1：每台手填同一把 SHOULDER_TAP_SYNC_KEY）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ENV_FILE = () => path.join(os.homedir(), ".claude", "skills", "shoulder-tap", ".env");
async function call(base, pathname, { token, method = "GET", body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(base + pathname, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/**
 * 设备码登录：要一个码 → onCode(url, code) 让人去浏览器登录 → 轮询到令牌。
 * 浏览器那一步谁来做都行，测试里就直接 POST /auth/password。
 */
export async function deviceLogin(base, { onCode, intervalMs = 1500, timeoutMs = 10 * 60_000 } = {}) {
  const issued = await startDeviceLogin(base);
  await onCode?.(issued.url, issued.code);
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, intervalMs))) {
    const data = await pollDeviceLogin(base, issued);
    if (data.token) return { token: data.token, email: data.email };
    if (data.error) throw new Error(data.error);
  }
  throw new Error("等太久了，重跑一次 node login.mjs");
}

/** 拆开的两步，给自己轮询的人用（设置页）：要一个码 → {code, secret, url}；问一次 → {token,email} | {pending} | {error}。 */
export async function startDeviceLogin(base) {
  const issued = (await call(base, "/device/code", { method: "POST" })).data;
  if (!issued.code) throw new Error("服务端没发设备码");
  return issued;
}
export const pollDeviceLogin = async (base, { code, secret }) => (await call(base, `/device/poll?code=${code}&secret=${secret}`)).data;

/**
 * 登录之后拿这个账号的同步密钥（服务端托管，第一台来要时生成；两台同时来要也只有一把）。
 * 不用口令：登录了同一个账号就是同一把钥匙、同一份数据。
 */
export async function openVault(base, token) {
  const got = await call(base, "/account/key", { token });
  if (got.status !== 200 || !got.data.key) throw new Error(got.data.error ?? `key ${got.status}`);
  return { key: Buffer.from(got.data.key, "base64url") };
}

export const accountInfo = async (base, token) => (await call(base, "/account", { token })).data;
export const logout = (base, token) => call(base, "/account/logout", { token, method: "POST" });

/** 改 .env 里的几行：有就换，没有就加，值为 null 就删。别的行一个字不动。 */
export function writeEnv(patch, file = ENV_FILE()) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n") : [];
  for (const [k, v] of Object.entries(patch)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*#?\\s*${k}\\s*=`).test(l));
    if (v === null) { if (i >= 0 && !lines[i].trim().startsWith("#")) lines.splice(i, 1); continue; }
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));
}
