const box: React.CSSProperties = {
  background: "#17171c",
  border: "1px solid #2c2c36",
  borderRadius: 10,
  padding: "14px 16px",
  overflowX: "auto",
  fontSize: 13,
  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
};

export default function Home() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "56px 20px 80px" }}>
      <h1 style={{ fontSize: 32, margin: 0 }}>shoulder-tap 👀</h1>
      <p style={{ color: "#9a9aa8", marginTop: 8 }}>
        你告诉模型今天要做什么。之后每次你想干点别的，它先拍你一下肩膀。
      </p>

      <h2 style={{ fontSize: 17, marginTop: 36 }}>你的数据不经过我</h2>
      <p style={{ color: "#9a9aa8" }}>
        这台服务器不存任何人的 token，也不存任何人的任务。你在 MCP 配置里填的是
        <b style={{ color: "#ececf1" }}> 你自己的 Notion integration secret</b>
        ，每次调用它拿着你的 token 去读写<b style={{ color: "#ececf1" }}>你自己的</b> Notion
        数据库。我提供的只是 schema 和一条通路。
      </p>

      <h2 style={{ fontSize: 17, marginTop: 32 }}>接上</h2>
      <ol style={{ color: "#9a9aa8", paddingLeft: 20 }}>
        <li>
          去 <code>notion.so/profile/integrations</code> 建一个 internal integration，拿到
          <code> ntn_…</code> 开头的密钥。
        </li>
        <li>随便找一个 Notion 页面，⋯ → Connections → 把这个 integration 加进去。</li>
        <li>把下面这段加进 MCP 配置，然后让模型调用 <code>setup</code>，把那个页面的链接给它。</li>
      </ol>
      <pre style={box}>{`{
  "mcpServers": {
    "shoulder-tap": {
      "type": "http",
      "url": "https://<你的部署>.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer ntn_你的密钥" }
    }
  }
}`}</pre>

      <h2 style={{ fontSize: 17, marginTop: 32 }}>它有什么</h2>
      <ul style={{ color: "#9a9aa8", paddingLeft: 20 }}>
        <li>
          <code>check_focus</code> —— 拦路的那个。你要做的事和今天说好的无关时，它让模型停下来问你。
        </li>
        <li>
          <code>set_focus</code> / <code>add_focus</code> / <code>complete_focus</code> —— 按顺序记、插队、勾掉。
        </li>
        <li>
          <code>setup</code> —— 第一次在你的 Notion 里建库。
        </li>
      </ul>
    </main>
  );
}
