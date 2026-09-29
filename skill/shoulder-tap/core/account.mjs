/**
 * 登录（第三档：用 shoulder-tap 的 sync service 做端到端加密同步）。两件事分开：
 *
 *   你是谁 → 设备码登录（浏览器里邮箱密码或 Google），换一个设备令牌。它决定你进哪个频道。
 *   能不能读 → 同步密钥。第一台机器随机生成，用你的「同步口令」包一层（PBKDF2-SHA256 + AES-GCM）存到服务端；
 *             以后每台机器登录后把包好的那份拉下来，在本机用口令拆开。口令从不上传，服务端拆不开。
 *
 * 忘了同步口令 = 云端那份作废（本机数据都在），换一个口令重新包一份上去就行。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seal, unseal } from "./sync.mjs";

export const ENV_FILE = () => path.join(os.homedir(), ".claude", "skills", "shoulder-tap", ".env");
// v2：PBKDF2-SHA256 60 万次 —— 浏览器自带（云端网页版在浏览器里拆同一份钥匙），拿去猜口令也够贵。
// v1（scrypt）是早先的格式，只读不写。
const PBKDF2_ITER = 600_000;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const kekOf = (v, passphrase, salt) => v === "v1"
  ? crypto.scryptSync(passphrase.normalize("NFC"), salt, 32, SCRYPT)
  : crypto.pbkdf2Sync(passphrase.normalize("NFC"), salt, PBKDF2_ITER, 32, "sha256");

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

/** 包：v2.<盐>.<密文>。密文就是 sync.mjs 的 seal，里面装着同步密钥。 */
export function wrapKey(vaultKey, passphrase) {
  const salt = crypto.randomBytes(16);
  return `v2.${salt.toString("base64url")}.${seal(kekOf("v2", passphrase, salt), { k: vaultKey.toString("base64url") })}`;
}

/** 拆：口令不对就抛「同步口令不对」—— AES-GCM 的认证标签对不上，不会拆出一把错的钥匙。 */
export function unwrapKey(wrapped, passphrase) {
  const [v, salt, blob] = wrapped.split(".");
  if (v !== "v1" && v !== "v2") throw new Error(`不认识的密钥格式 ${v}`);
  const kek = kekOf(v, passphrase, Buffer.from(salt, "base64url"));
  try {
    return Buffer.from(unseal(kek, blob).k, "base64url");
  } catch {
    throw new Error("同步口令不对");
  }
}

/**
 * 登录之后拿到这个账号的同步密钥：服务端还没有（这是第一台）就生成一把、包好放上去；有就拉下来拆开。
 * 两台同时当「第一台」：后放的那台会被 409，转去拉先放的那份，所以一个账号永远只有一把钥匙。
 */
export async function openVault(base, token, passphrase) {
  if (!passphrase || passphrase.length < 8) throw new Error("同步口令至少 8 位");
  const got = await call(base, "/account/vault", { token });
  if (got.status !== 200) throw new Error(got.data.error ?? `vault ${got.status}`);
  if (got.data.wrapped) {
    const key = unwrapKey(got.data.wrapped, passphrase);
    // 早先的 v1（scrypt）浏览器拆不开：口令对上了就顺手换成 v2 重新放上去，云端网页版才能用
    if (got.data.wrapped.startsWith("v1.")) await call(base, "/account/vault", { token, method: "PUT", body: { wrapped: wrapKey(key, passphrase), replace: true } });
    return { key, created: false };
  }
  const key = crypto.randomBytes(32);
  const put = await call(base, "/account/vault", { token, method: "PUT", body: { wrapped: wrapKey(key, passphrase) } });
  if (put.status === 409) return openVault(base, token, passphrase);
  if (put.status !== 200) throw new Error(put.data.error ?? `vault ${put.status}`);
  return { key, created: true };
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
