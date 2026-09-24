/**
 * 跨机器那条线的发送端。钩子每拍一下，先试着经中转送到「你眼睛所在的那台」；
 * 送到了本机就不拍，没送到（没配、没登录、没人在线、超时）就退回本机拍。
 *
 * 频道由账号决定（设备令牌换的），字条的密钥从 Notion token 派生 —— 每台机器本来就有它，
 * 于是不用再同步任何密钥，服务端也永远只见密文。
 * 派生和加密的写法要跟桌面端 Relay.cs 一字不差：HKDF-SHA256 空盐，AES-256-GCM，iv(12)|密文|tag(16)。
 */
import crypto from "node:crypto";
import os from "node:os";

const KEY_INFO = "shoulder-tap/key";

export function keyOf(token) {
  return Buffer.from(crypto.hkdfSync("sha256", token, "", KEY_INFO, 32));
}

export function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}

export function unseal(key, b64) {
  const raw = Buffer.from(b64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const body = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
  return JSON.parse(body.toString("utf8"));
}

export function platformName() {
  return process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : process.platform;
}

/** 配齐了才算开着：中转地址、设备令牌、Notion token（密钥从它来）。 */
export function relayConfig(env) {
  const base = (env.SHOULDER_TAP_RELAY || "").trim().replace(/\/+$/, "");
  const token = (env.SHOULDER_TAP_DEVICE_TOKEN || "").trim();
  if (!base || !token || !env.NOTION_TOKEN) return null;
  return { base, token, key: keyOf(env.NOTION_TOKEN), telemetry: env.SHOULDER_TAP_TELEMETRY !== "0" };
}

/**
 * 发一下。返回 true = 中转说送到了某台在线的机器（可能就是本机），别再本机拍。
 * 最多等 timeoutMs：钩子卡在这里，用户就卡在这里。
 */
export async function relaySend(env, device, gesture, { caption = "", text = "" }, timeoutMs = 1500) {
  const cfg = relayConfig(env);
  if (!cfg || !device) return false;
  const blob = seal(cfg.key, { host: os.hostname(), gesture, caption, text });
  try {
    const res = await fetch(`${cfg.base}/ch/send`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ device, platform: platformName(), gesture, blob, telemetry: cfg.telemetry }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    return (await res.json())?.delivered === true;
  } catch {
    return false;
  }
}
