import { dayStartHour } from "@/lib/focus";

// 每次都要现算，不然时间会被静态化成构建那一刻。
export const dynamic = "force-dynamic";

const mono = "ui-monospace, SFMono-Regular, Consolas, monospace";

function Row({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 0",
        borderTop: "1px solid #24242c",
        fontSize: 13,
      }}
    >
      <span style={{ color: "#8a8a99" }}>{k}</span>
      <span
        style={{
          fontFamily: mono,
          color: good === undefined ? "#ececf1" : good ? "#4bb5b2" : "#e98055",
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {v}
      </span>
    </div>
  );
}

export default function Health() {
  const now = new Date();
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "0 16px", paddingBlock: "64px 48px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "#4bb5b2",
            boxShadow: "0 0 0 4px rgba(75,181,178,0.16)",
          }}
        />
        <h1 style={{ fontSize: 19, margin: 0, fontWeight: 600 }}>shoulder-tap 活着</h1>
      </div>
      <p style={{ color: "#8a8a99", fontSize: 13, margin: "10px 0 26px" }}>
        这页只用来看服务状态。真正的入口是下面那个 MCP 端点。
      </p>

      <Row k="版本" v="0.1.0" />
      <Row k="MCP 端点" v="/mcp" />
      <Row k="零内容工具" v="focus_protocol · due_check · ping" good />
      <Row k="需要 Notion secret 的" v="check_focus · set_focus · setup …" />
      <Row k="服务器时间 (UTC)" v={now.toISOString().replace("T", " ").slice(0, 19)} />
      <Row k="记录时区" v="一律 UTC，读的时候按调用方的 tz 换算" good />
      <Row k="一天从几点开始" v={`本地 ${dayStartHour()}:00`} />

      <p style={{ color: "#5f5f6d", fontSize: 12, marginTop: 30, lineHeight: 1.8 }}>
        服务端不存任何人的 token，也不存任何人的任务。数据在调用方自己的 Notion 里。
        <br />
        <a href="https://github.com/FranklinXuNorth/shoulder-tap" style={{ color: "#4bb5b2" }}>
          github.com/FranklinXuNorth/shoulder-tap
        </a>
      </p>
    </main>
  );
}
