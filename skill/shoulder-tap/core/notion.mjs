/**
 * Notion 的薄封装。这个服务不存任何人的数据：每次请求都拿调用方自己带来的
 * token，去访问调用方自己的 Notion。服务端只知道 schema 长什么样。
 */
const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
export class NotionError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export async function notion(token, method, path, body) {
    const res = await fetch(API + path, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new NotionError(res.status, json?.code ?? String(res.status), json?.message ?? `Notion 返回 ${res.status}`);
    }
    return json;
}
/** 从 Notion 页面链接里抠出 32 位 id；直接传 id 也认。 */
export function pageIdFrom(input) {
    // 先砍掉 query string，否则 ?v=<32位视图id> 会被当成页面 id。
    const hex = input.split("?")[0].replace(/-/g, "").match(/[0-9a-fA-F]{32}/g);
    if (!hex?.length)
        throw new Error(`这不像一个 Notion 页面链接或 ID：${input}`);
    return hex[hex.length - 1];
}
export const plain = (rich) => (rich ?? []).map((r) => r?.plain_text ?? "").join("").trim();
export const text = (s) => [{ type: "text", text: { content: s.slice(0, 2000) } }];
