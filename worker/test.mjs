/**
 * 端到端：对着本地 wrangler dev（npm run dev）走一遍。
 *   node test.mjs [http://127.0.0.1:8787]
 * 建号 → 设备码绑定 → 两台机器挂上 WebSocket → 活跃切换 → 拍肩送给对的那台 → 历史里有密文。
 */
import assert from "node:assert/strict";
import { keyOf, seal, unseal } from "../skill/shoulder-tap/relay.mjs";

const base = process.argv[2] || "http://127.0.0.1:8787";
const email = `t-${Date.now()}@example.com`;
const password = "correct horse battery";

async function link() {
  const issued = await (await fetch(`${base}/device/code`, { method: "POST" })).json();
  assert.match(issued.code, /^[A-Z2-9]{8}$/);
  assert.equal((await (await fetch(`${base}/device/poll?code=${issued.code}&secret=${issued.secret}`)).json()).pending, true);
  const login = await fetch(`${base}/auth/password`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, confirm: password, code: issued.code }),
  });
  assert.equal(login.status, 200, await login.text());
  const polled = await (await fetch(`${base}/device/poll?code=${issued.code}&secret=${issued.secret}`)).json();
  assert.match(polled.token, /^[0-9a-f]{48}$/);
  assert.equal(polled.email, email);
  return polled.token;
}

const tokenA = await link();
const tokenB = await link(); // 同一个邮箱再登一次：同一个账号，第二个设备令牌
// 新邮箱不带确认、或两次不一致：不建号
{
  const issued = await (await fetch(`${base}/device/code`, { method: "POST" })).json();
  const post = (body) => fetch(`${base}/auth/password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, code: issued.code }) });
  assert.equal((await post({ email: "new-" + email, password })).status, 409);
  assert.equal((await post({ email: "new-" + email, password, confirm: "different!!" })).status, 409);
}
// 密码错要被拒
{
  const issued = await (await fetch(`${base}/device/code`, { method: "POST" })).json();
  const bad = await fetch(`${base}/auth/password`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "wrong password!", code: issued.code }) });
  assert.equal(bad.status, 401);
}
// 没令牌不让进频道
assert.equal((await fetch(`${base}/ch/history`)).status, 403);

function connect(token, device, platform, screens) {
  const url = `${base.replace(/^http/, "ws")}/ch?device=${device}&platform=${platform}&screens=${screens}`;
  const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); (waiters.shift() ?? ((m) => inbox.push(m)))(m); };
  const next = () => inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiters.push(r));
  return new Promise((resolve, reject) => { ws.onopen = () => resolve({ ws, next }); ws.onerror = reject; });
}

const win = await connect(tokenA, "win-device-1", "win", 2);
assert.equal((await win.next()).type, "active");
const mac = await connect(tokenB, "mac-device-1", "mac", 1);
assert.equal((await mac.next()).type, "active");

// Mac 说「我刚被碰过」→ 两边都收到广播，活跃的是 Mac
mac.ws.send(JSON.stringify({ type: "active", screens: 1 }));
assert.equal((await mac.next()).device, "mac-device-1");
assert.equal((await win.next()).device, "mac-device-1");

// Windows 上的钩子拍一下 → 送到 Mac，不送回 Windows
const key = keyOf("ntn_shared");
const send = (token, device, obj) => fetch(`${base}/ch/send`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ device, platform: "win", gesture: obj.gesture, blob: seal(key, obj) }),
}).then((r) => r.json());
let r = await send(tokenA, "win-device-1", { host: "WIN", gesture: "complete", caption: "改完了", text: "" });
assert.deepEqual(r, { delivered: true, to: "mac-device-1" });
const got = await mac.next();
assert.equal(got.type, "tap");
assert.deepEqual(unseal(key, got.blob), { host: "WIN", gesture: "complete", caption: "改完了", text: "" });

// Windows 被碰了 → 活跃切回来 → 下一下送给 Windows
win.ws.send(JSON.stringify({ type: "active", screens: 2 }));
assert.equal((await win.next()).device, "win-device-1");
assert.equal((await mac.next()).device, "win-device-1");
r = await send(tokenB, "mac-device-1", { host: "MAC", gesture: "snap", caption: "用哪个库？", text: "用哪个库？" });
assert.equal(r.to, "win-device-1");
assert.equal(unseal(key, (await win.next()).blob).caption, "用哪个库？");

// 历史：只有密文和元数据
const history = await (await fetch(`${base}/ch/history?limit=5`, { headers: { authorization: `Bearer ${tokenA}` } })).json();
assert.equal(history.length, 2);
assert.equal(history[0].gesture, "snap");
assert.equal(history[0].delivered_to, "win-device-1");
assert.ok(!JSON.stringify(history).includes("用哪个库"));

// 谁都不在线 → delivered false
win.ws.close(); mac.ws.close();
await new Promise((r) => setTimeout(r, 300));
r = await send(tokenA, "win-device-1", { host: "WIN", gesture: "tap", caption: "x", text: "x" });
assert.deepEqual(r, { delivered: false, to: null });

// MCP 也在这台 Worker 上：不带凭据能列工具、能 ping
const rpc = (body) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }).then((r) => r.text());
assert.match(await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }), /"name":"check_focus"/);
assert.match(await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ping", arguments: {} } }), /活着/);

console.log("worker e2e ok");
