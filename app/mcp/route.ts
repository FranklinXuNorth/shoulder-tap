// MCP 端点。客户端配这个：https://<部署>/mcp
import { mcpHandler } from "@/lib/mcp";

export { mcpHandler as GET, mcpHandler as POST, mcpHandler as DELETE };
