export const metadata = {
  title: "shoulder-tap",
  description: "一个在你跑偏的时候拍你肩膀的 MCP 服务。你的数据留在你自己的 Notion 里。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          background: "#0e0e11",
          color: "#ececf1",
          fontFamily:
            "ui-sans-serif, system-ui, 'Microsoft YaHei UI', -apple-system, sans-serif",
          lineHeight: 1.7,
        }}
      >
        {children}
      </body>
    </html>
  );
}
