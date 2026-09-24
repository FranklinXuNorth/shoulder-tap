/**
 * shoulder-tap 的云端：一个 Cloudflare Worker，两种 Durable Object。
 *
 *   Accounts（全局一个）  账号、设备码、设备令牌。密码只存 PBKDF2 哈希。
 *   Channel（每账号一个） 常驻进程挂着的 WebSocket、谁是活跃机器、拍肩历史（密文）。
 *
 * 路由：
 *   GET  /link?code=            浏览器里登录，把这个设备码绑到账号上
 *   POST /auth/password         {email, password, code}   没有账号就顺手建一个
 *   GET  /auth/google?code=     跳去 Google；/auth/google/callback 回来
 *   POST /device/code           终端要一个设备码            → {code, secret, url}
 *   GET  /device/poll?code&secret  终端轮询                → {token} 或 {pending}
 *
 *   下面这些都要 Authorization: Bearer <设备令牌>：
 *   GET  /ch?device=&platform=&screens=&t=   WebSocket，常驻进程挂在这
 *   POST /ch/send   {device, platform, gesture, blob}      钩子发一下拍肩
 *   GET  /ch/history?limit=
 *
 * 服务端见到的：账号邮箱、设备 ID、平台、屏幕数、手势、时间戳、密文。
 * 见不到的：字条内容、任务、习惯 —— 那些在密文里，密钥从 Notion token 派生，从不上云。
 */
import { DurableObject } from "cloudflare:workers";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉 0/O/1/I，念出来不会错
const CODE_TTL_MS = 10 * 60_000;
const PBKDF2_ITERATIONS = 100_000;

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName("accounts"));

    if (path === "/") return html(PAGE_HOME);

    // ---------- 登录 ----------
    if (path === "/link") return html(linkPage(url.searchParams.get("code") || "", Boolean(env.GOOGLE_CLIENT_ID)));

    if (path === "/auth/password" && request.method === "POST") {
      const { email = "", password = "", confirm = null, code = "" } = await request.json().catch(() => ({}));
      if (!/^[^\s@]+@[^\s@]+$/.test(email) || password.length < 8) return json({ error: "邮箱不对，或密码不足 8 位" }, 400);
      const result = await accounts.passwordLogin(email.trim().toLowerCase(), password, confirm);
      if (result.register) return json(result, 409); // 新邮箱：让页面要一次确认密码，再来
      if (result.error) return json(result, 401);
      if (!(await accounts.bindCode(code, result.account))) return json({ error: "设备码过期了，回终端重跑一次安装" }, 400);
      return json({ ok: true, created: result.created });
    }

    if (path === "/auth/google") {
      if (!env.GOOGLE_CLIENT_ID) return json({ error: "没配 Google 登录" }, 404);
      const code = url.searchParams.get("code") || "";
      const to = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      to.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      to.searchParams.set("redirect_uri", `${url.origin}/auth/google/callback`);
      to.searchParams.set("response_type", "code");
      to.searchParams.set("scope", "openid email");
      to.searchParams.set("state", code);
      return Response.redirect(to.toString(), 302);
    }

    if (path === "/auth/google/callback") {
      const state = url.searchParams.get("state") || "";
      const authCode = url.searchParams.get("code") || "";
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: authCode,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${url.origin}/auth/google/callback`,
          grant_type: "authorization_code",
        }),
      });
      const tokens = await res.json().catch(() => ({}));
      // id_token 是 Google 刚刚通过 TLS 直接交给我们的，不需要再验签名。
      const claims = parseJwt(tokens.id_token);
      if (!claims?.sub || !claims.email) return html(donePage("Google 那边没给身份，再试一次。"), 400);
      const account = await accounts.googleLogin(claims.sub, claims.email.toLowerCase());
      if (!(await accounts.bindCode(state, account))) return html(donePage("设备码过期了，回终端重跑一次安装。"), 400);
      return html(donePage("连上了。回到终端，那边会自己继续。"));
    }

    // ---------- 设备码 ----------
    if (path === "/device/code" && request.method === "POST") {
      const issued = await accounts.newCode();
      return json({ ...issued, url: `${url.origin}/link?code=${issued.code}` });
    }
    if (path === "/device/poll") {
      return json(await accounts.pollCode(url.searchParams.get("code") || "", url.searchParams.get("secret") || ""));
    }

    // ---------- 频道：要设备令牌 ----------
    if (path === "/ch" || path.startsWith("/ch/")) {
      const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const account = token ? await accounts.resolveToken(token) : null;
      if (!account) return json({ error: "设备令牌无效，重跑 node install.mjs --login" }, 403);
      const channel = env.CHANNEL.get(env.CHANNEL.idFromName(account));
      return channel.fetch(request);
    }

    return json({ error: "not found" }, 404);
  },
};

function parseJwt(jwt) {
  try {
    const payload = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 账号、设备码、设备令牌。全局只有一个实例；密码哈希在这里算，DO 的 CPU 上限比 Worker 宽得多。 */
export class Accounts extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        account TEXT PRIMARY KEY, email TEXT UNIQUE, google_sub TEXT UNIQUE,
        pw_hash TEXT, pw_salt TEXT, created INTEGER);
      CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, secret TEXT, account TEXT, token TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, account TEXT, created INTEGER, last_seen INTEGER);
    `);
  }

  /** 邮箱没见过就是注册：要求 confirm 和 password 一致，页面拿到 register 标记后才显示那个框。 */
  async passwordLogin(email, password, confirm = null) {
    const user = this.sql.exec("SELECT account, pw_hash, pw_salt FROM users WHERE email = ?", email).toArray()[0];
    if (!user) {
      if (confirm === null) return { register: true, error: "这个邮箱还没账号。再输一遍密码，就建一个。" };
      if (confirm !== password) return { register: true, error: "两次密码不一样。" };
      const account = randomHex(16);
      const salt = randomHex(16);
      const hash = await pbkdf2(password, salt);
      this.sql.exec("INSERT INTO users (account, email, pw_hash, pw_salt, created) VALUES (?,?,?,?,?)", account, email, hash, salt, Date.now());
      return { account, created: true };
    }
    if (!user.pw_hash) return { error: "这个邮箱是用 Google 登录的" };
    if ((await pbkdf2(password, user.pw_salt)) !== user.pw_hash) return { error: "密码不对" };
    return { account: user.account, created: false };
  }

  googleLogin(sub, email) {
    const bySub = this.sql.exec("SELECT account FROM users WHERE google_sub = ?", sub).toArray()[0];
    if (bySub) return bySub.account;
    const byEmail = this.sql.exec("SELECT account FROM users WHERE email = ?", email).toArray()[0];
    if (byEmail) {
      this.sql.exec("UPDATE users SET google_sub = ? WHERE account = ?", sub, byEmail.account);
      return byEmail.account;
    }
    const account = randomHex(16);
    this.sql.exec("INSERT INTO users (account, email, google_sub, created) VALUES (?,?,?,?)", account, email, sub, Date.now());
    return account;
  }

  newCode() {
    this.sql.exec("DELETE FROM codes WHERE expires < ?", Date.now());
    const code = randomCode();
    const secret = randomHex(16);
    this.sql.exec("INSERT INTO codes (code, secret, expires) VALUES (?,?,?)", code, secret, Date.now() + CODE_TTL_MS);
    return { code, secret };
  }

  /** 浏览器那头登录成功：把码绑到账号上，顺手签发设备令牌，等终端来取。 */
  bindCode(code, account) {
    const row = this.sql.exec("SELECT expires, account FROM codes WHERE code = ?", code.toUpperCase()).toArray()[0];
    if (!row || row.expires < Date.now() || row.account) return false;
    const token = randomHex(24);
    this.sql.exec("INSERT INTO tokens (token, account, created, last_seen) VALUES (?,?,?,?)", token, account, Date.now(), Date.now());
    this.sql.exec("UPDATE codes SET account = ?, token = ? WHERE code = ?", account, token, code.toUpperCase());
    return true;
  }

  /** 终端轮询。secret 是终端自己的，浏览器不知道 —— 别人看见屏幕上的码也拿不走令牌。 */
  pollCode(code, secret) {
    const row = this.sql.exec("SELECT secret, account, token, expires FROM codes WHERE code = ?", code.toUpperCase()).toArray()[0];
    if (!row || row.secret !== secret) return { error: "设备码不对" };
    if (row.expires < Date.now()) return { error: "设备码过期了" };
    if (!row.account) return { pending: true };
    this.sql.exec("DELETE FROM codes WHERE code = ?", code.toUpperCase());
    const user = this.sql.exec("SELECT email FROM users WHERE account = ?", row.account).toArray()[0];
    return { token: row.token, email: user?.email ?? "" };
  }

  resolveToken(token) {
    const row = this.sql.exec("SELECT account FROM tokens WHERE token = ?", token).toArray()[0];
    if (!row) return null;
    this.sql.exec("UPDATE tokens SET last_seen = ? WHERE token = ?", Date.now(), token);
    return row.account;
  }
}

/**
 * 一个账号一个频道。路由规则只有一条：送给「最近被碰过」而且在线的那台。
 * 谁都不在线就不送，只记进历史 —— 拍肩只有当下才有意义。
 */
export class Channel extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS devices (device TEXT PRIMARY KEY, platform TEXT, screens INTEGER, last_seen INTEGER, active_at INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, device TEXT, platform TEXT, gesture TEXT, delivered_to TEXT, blob TEXT);
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const sub = url.pathname.split("/")[2] ?? "";
    if ((request.headers.get("upgrade") || "").toLowerCase() === "websocket") return this.connect(url);
    if (sub === "send" && request.method === "POST") return this.send(await request.json().catch(() => ({})));
    if (sub === "history") return this.history(Math.min(Number(url.searchParams.get("limit")) || 50, 500));
    return json({ error: "not found" }, 404);
  }

  connect(url) {
    const device = url.searchParams.get("device") || "";
    if (!/^[\w-]{8,64}$/.test(device)) return json({ error: "device?" }, 400);
    const telemetry = url.searchParams.get("t") !== "0";
    const platform = telemetry ? url.searchParams.get("platform") || null : null;
    const screens = telemetry ? Number(url.searchParams.get("screens")) || null : null;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // hibernation API：进程可以睡，连接不断。tag 用设备 ID，送达时按它找。
    this.ctx.acceptWebSocket(server, [device]);
    server.serializeAttachment({ device, telemetry });
    this.sql.exec(
      `INSERT INTO devices (device, platform, screens, last_seen) VALUES (?,?,?,?)
       ON CONFLICT(device) DO UPDATE SET platform = COALESCE(excluded.platform, platform),
         screens = COALESCE(excluded.screens, screens), last_seen = excluded.last_seen`,
      device, platform, screens, Date.now(),
    );
    server.send(JSON.stringify({ type: "active", device: this.target() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { device, telemetry } = ws.deserializeAttachment();
    if (msg.type !== "active") return;
    // 时间用服务端收到的那一刻，几台机器的时钟对不上也没关系。
    const now = Date.now();
    this.sql.exec(
      "UPDATE devices SET active_at = ?, last_seen = ?, screens = COALESCE(?, screens) WHERE device = ?",
      now, now, telemetry ? Number(msg.screens) || null : null, device,
    );
    this.broadcast({ type: "active", device });
  }

  webSocketClose(ws) {
    try { ws.close(); } catch {}
    // 活跃的那台下线了，剩下的机器里挑一台顶上，让它们知道现在该谁接。
    this.broadcast({ type: "active", device: this.target() });
  }

  webSocketError() {}

  broadcast(msg) {
    const line = JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets()) try { s.send(line); } catch {}
  }

  /** 最近被碰过且在线的那台。 */
  target() {
    const online = new Set(this.ctx.getWebSockets().map((s) => s.deserializeAttachment()?.device));
    for (const row of this.sql.exec("SELECT device FROM devices ORDER BY active_at DESC, last_seen DESC")) {
      if (online.has(row.device)) return row.device;
    }
    return null;
  }

  send(body) {
    const { device = "", platform = "", gesture = "", blob = "", telemetry = true } = body;
    if (typeof blob !== "string" || !blob || blob.length > 16_384) return json({ error: "blob?" }, 400);
    const to = this.target();
    const line = JSON.stringify({ type: "tap", from: device, blob, ts: Date.now() });
    let delivered = 0;
    if (to) for (const s of this.ctx.getWebSockets(to)) { try { s.send(line); delivered++; } catch {} }
    this.sql.exec(
      "INSERT INTO history (ts, device, platform, gesture, delivered_to, blob) VALUES (?,?,?,?,?,?)",
      Date.now(), device, telemetry ? platform : null, telemetry ? gesture : null, delivered ? to : null, blob,
    );
    this.sql.exec("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 500)");
    return json({ delivered: delivered > 0, to: delivered ? to : null });
  }

  history(limit) {
    return json(this.sql.exec("SELECT ts, device, platform, gesture, delivered_to, blob FROM history ORDER BY id DESC LIMIT ?", limit).toArray());
  }
}

// ---------- 页面：只有登录那一页，够用就行 ----------

const STYLE = `
  body { font-family: ui-sans-serif, system-ui, "Microsoft YaHei UI", sans-serif; background: #eef1f2; color: #14191a; margin: 0; }
  main { max-width: 380px; margin: 12vh auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #d3dbdc; border-radius: 10px; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { color: #5d6b6d; margin: 0 0 18px; font-size: 14px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; margin-bottom: 10px; border: 1px solid #aebabc; border-radius: 7px; font-size: 15px; }
  button, a.btn { display: block; width: 100%; box-sizing: border-box; padding: 11px; border: 0; border-radius: 7px; font-size: 15px; cursor: pointer; text-align: center; text-decoration: none; }
  button { background: #0e7c7b; color: #fff; } a.btn { background: #fff; color: #14191a; border: 1px solid #aebabc; margin-top: 10px; }
  .code { font-family: ui-monospace, monospace; letter-spacing: 0.15em; background: #f6f8f8; padding: 6px 10px; border-radius: 6px; display: inline-block; }
  .err { color: #c1471d; font-size: 14px; min-height: 1.4em; margin-top: 10px; }
  @media (prefers-color-scheme: dark) { body { background: #0e1213; color: #e6ecec; } .card { background: #161c1d; border-color: #2a3435; } input { background: #1b2223; color: #e6ecec; border-color: #3d4a4b; } a.btn { background: #1b2223; color: #e6ecec; border-color: #3d4a4b; } .code { background: #1b2223; } }
`;

const PAGE_HOME = `<!doctype html><meta charset="utf-8"><title>shoulder-tap</title><style>${STYLE}</style>
<main><div class="card"><h1>shoulder-tap 中转</h1><p>在跑。装好的机器会自己连过来，这里没有别的可看。</p></div></main>`;

function linkPage(code, google) {
  const safe = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>连接 shoulder-tap</title><style>${STYLE}
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; }
  .tabs button { background: transparent; color: inherit; border: 1px solid #aebabc; padding: 8px; }
  .tabs button.on { background: #0e7c7b; color: #fff; border-color: #0e7c7b; }
  </style>
<main><div class="card">
  <h1>把这台机器连上</h1>
  <p>设备码 <span class="code">${safe}</span>。登录之后，终端那边会自己继续。</p>
  <div class="tabs"><button type="button" id="tabLogin" class="on">登录</button><button type="button" id="tabSignup">注册</button></div>
  <form id="f"><input name="email" type="email" placeholder="邮箱" required autofocus>
    <input name="password" type="password" placeholder="密码（至少 8 位）" minlength="8" required>
    <input name="confirm" type="password" placeholder="确认密码" minlength="8" hidden>
    <button id="go">登录</button></form>
  ${google ? `<a class="btn" href="/auth/google?code=${safe}">用 Google 登录 / 注册</a>` : ""}
  <div class="err" id="err"></div>
</div></main>
<script>
  let signup = false;
  function mode(s) {
    signup = s; err.textContent = "";
    f.confirm.hidden = !s; f.confirm.required = s;
    go.textContent = s ? "创建账号" : "登录";
    tabLogin.classList.toggle("on", !s); tabSignup.classList.toggle("on", s);
  }
  tabLogin.onclick = () => mode(false); tabSignup.onclick = () => mode(true);
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = "";
    if (signup && f.confirm.value !== f.password.value) { err.textContent = "两次密码不一样。"; return; }
    const body = { email: f.email.value, password: f.password.value, code: ${JSON.stringify(safe)} };
    if (signup) body.confirm = f.confirm.value;
    const r = await fetch("/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.register && !signup) { mode(true); err.textContent = "这个邮箱还没账号，确认一下密码就建一个。"; f.confirm.focus(); return; }
    if (!r.ok) { err.textContent = j.error || "没成功"; return; }
    document.querySelector(".card").innerHTML = "<h1>连上了</h1><p>" + (j.created ? "账号建好了。" : "") + "回到终端，那边会自己继续。</p>";
  };
</script>`;
}

function donePage(text) {
  return `<!doctype html><meta charset="utf-8"><title>shoulder-tap</title><style>${STYLE}</style>
<main><div class="card"><h1>shoulder-tap</h1><p>${text}</p></div></main>`;
}
