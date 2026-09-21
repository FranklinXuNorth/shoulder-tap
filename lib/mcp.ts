import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { NotionError, pageIdFrom } from "@/lib/notion";
import {
  DB_TITLE,
  addItem,
  createDatabase,
  createHabitsDatabase,
  current,
  listDay,
  logHabit,
  overdueHabits,
  setDay,
  setStatus,
  today,
  tzOffset,
} from "@/lib/focus";
import { renderCheck, renderPlan } from "@/lib/render";

/**
 * Bearer token 就是调用方自己的 Notion integration secret。
 * 服务端不存任何人的 token、也不存任何人的任务 —— 只提供 schema 和通路。
 */
function tokenOf(ctx: any): string {
  const t =
    ctx?.http?.authInfo?.token ??
    ctx?.authInfo?.token ??
    ctx?.requestInfo?.headers?.authorization?.replace(/^Bearer\s+/i, "");
  if (!t) throw new Error("没拿到 Notion token。MCP 配置里的 Authorization 头是不是漏了？");
  return t;
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

const AUTH_ON = process.env.SHOULDER_TAP_AUTH === "on";

/** 工具里的报错要说人话，而且要告诉模型下一步能做什么。 */
async function guard(fn: () => Promise<{ content: { type: "text"; text: string }[] }>) {
  try {
    return await fn();
  } catch (e: any) {
    if (e instanceof NotionError) return ok(`Notion 说：${e.message}（code: ${e.code}）`);
    return ok(`出错了：${e?.message ?? e}`);
  }
}

const dayArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("YYYY-MM-DD。不传就按服务器时区算今天；你知道用户本地日期的话最好传。");

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "ping",
      {
        title: "看看服务活着没",
        description:
          "不需要任何凭据的健康检查。返回服务版本、当前鉴权模式和服务器时间。" +
          "部署完先用它确认链路通不通，平时用不到。",
        inputSchema: z.object({}),
      },
      async () =>
        ok(
          [
            "shoulder-tap 0.1.0 活着。",
            `鉴权：${AUTH_ON ? "开（必须带 Notion token）" : "关 —— 端点是开放的，只有 ping 能用"}`,
            `服务器时间：${new Date().toISOString()}（按 UTC+${tzOffset()} 算今天 = ${today()}）`,
          ].join("\n"),
        ),
    );

    server.registerTool(
      "check_focus",
      {
        title: "检查是否跑偏",
        description:
          "在帮用户做任何实质性的事之前先调用这个。它返回用户今天说好要做的事、当前该做哪一条，" +
          "以及你该怎么处理他现在想做的这件事。新对话开始时、用户提出一个新任务时，都要先call 一次。",
        inputSchema: z.object({
          activity: z
            .string()
            .optional()
            .describe("用户现在想做/正在做的事，一句话。没有就不传，那就只是看一眼今天的清单。"),
          day: dayArg,
        }),
      },
      async ({ activity, day }, ctx: any) =>
        guard(async () => {
          const token = tokenOf(ctx);
          const d = today(day);
          const [items, habits] = await Promise.all([
            listDay(token, d),
            overdueHabits(token).catch(() => []),
          ]);
          return ok(renderCheck(items, d, activity, habits));
        }),
    );

    server.registerTool(
      "set_focus",
      {
        title: "记下今天要做的事",
        description:
          "把用户今天要做的事按先后顺序记下来，会覆盖今天已有的清单（旧的进 Notion 回收站）。" +
          "用户说「我今天要做 A、B、C」或者要重排顺序时用这个。顺序很重要：必须先做的排前面。",
        inputSchema: z.object({
          tasks: z
            .array(
              z.object({
                task: z.string().describe("一个动作，动词开头，越短越好"),
                note: z.string().optional().describe("执行这条需要的关键细节，没有就不传"),
              }),
            )
            .min(1)
            .describe("按执行先后排好的清单"),
          day: dayArg,
        }),
      },
      async ({ tasks, day }, ctx: any) =>
        guard(async () => {
          const d = today(day);
          const items = await setDay(tokenOf(ctx), d, tasks);
          return ok(`记下了。\n\n${renderPlan(items, d)}`);
        }),
    );

    server.registerTool(
      "add_focus",
      {
        title: "插一条新的",
        description:
          "往今天的清单里加一条。只有用户明确说这是该做的事、或者确认要插队时才用，不要替他决定。",
        inputSchema: z.object({
          task: z.string(),
          note: z.string().optional(),
          position: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe("插在第几位，后面的顺延。不传就排到最后。急事插队传 1。"),
          day: dayArg,
        }),
      },
      async ({ task, note, position, day }, ctx: any) =>
        guard(async () => {
          const d = today(day);
          const items = await addItem(tokenOf(ctx), d, task, note ?? "", position);
          return ok(`加上了。\n\n${renderPlan(items, d)}`);
        }),
    );

    server.registerTool(
      "complete_focus",
      {
        title: "勾掉一条",
        description:
          "把第 N 条标成做完了（或者放弃）。**只有用户明确说这条完成了才调用**——你自己觉得做完了不算数，" +
          "那种情况下问一句「这条算完成了吗」，等他回答。调用之后告诉他下一条是什么。",
        inputSchema: z.object({
          position: z.number().int().min(1).describe("清单里的序号"),
          dropped: z.boolean().optional().describe("true = 今天不做了，从清单里拿掉，而不是完成"),
          day: dayArg,
        }),
      },
      async ({ position, dropped, day }, ctx: any) =>
        guard(async () => {
          const d = today(day);
          const { items, hit } = await setStatus(
            tokenOf(ctx),
            d,
            position,
            dropped ? "dropped" : "done",
          );
          if (!hit) return ok(`今天没有第 ${position} 条。\n\n${renderPlan(items, d)}`);

          const next = current(items);
          const head = dropped ? `放弃了：${hit.task}` : `✓ ${hit.task}`;
          const tail = next
            ? `下一条是第 ${next.order} 条：${next.task}`
            : "今天说好的都做完了。";
          return ok(`${head}\n\n${renderPlan(items, d)}\n\n${tail}`);
        }),
    );

    server.registerTool(
      "log_habit",
      {
        title: "记一笔「刚做了」",
        description:
          "用户说他喝水了 / 起来走了 / 拉伸了，就调用这个，把计时清零。名字模糊匹配，" +
          "对不上会告诉你他的习惯库里都有哪些。不要替他记——他没说做，就是没做。",
        inputSchema: z.object({
          habit: z.string().describe("习惯名，比如「喝水」。跟 Notion 习惯库里的名字模糊匹配。"),
        }),
      },
      async ({ habit }, ctx: any) =>
        guard(async () => {
          const hit = await logHabit(tokenOf(ctx), habit);
          return ok(
            hit
              ? `记下了：${hit.name}，下次提醒在 ${hit.everyMin} 分钟后。`
              : `习惯库里没有「${habit}」这一条。让用户自己去 Notion 的 Shoulder Tap Habits 里加一行，或者换个叫法。`,
          );
        }),
    );

    server.registerTool(
      "setup",
      {
        title: "第一次用：在 Notion 里建库",
        description:
          `在用户指定的 Notion 页面下面建一个叫「${DB_TITLE}」的数据库。整个服务只在这里写一次结构，` +
          "之后所有数据都在用户自己的 Notion 里。只有 check_focus 报 not_set_up 的时候才需要用。",
        inputSchema: z.object({
          notion_page: z
            .string()
            .describe("建在哪个页面下面 —— Notion 页面链接或 ID。这个页面必须已经连接了用户的 integration。"),
        }),
      },
      async ({ notion_page }, ctx: any) =>
        guard(async () => {
          const token = tokenOf(ctx);
          const pageId = pageIdFrom(notion_page);
          const res = await createDatabase(token, pageId);
          // 习惯库建不出来不算失败 —— 主线是任务，提醒是附赠的。
          const habits = await createHabitsDatabase(token, pageId).catch(() => undefined);
          return ok(
            `建好了：${res.url ?? res.databaseId}\n` +
              (habits
                ? `习惯提醒库：${habits.url}（喝水 / 走动 / 拉伸，间隔在 Notion 里随便改）\n`
                : "习惯提醒库没建成，不影响主线，之后想要再单独建。\n") +
              `以后不用再管它，直接用 check_focus / set_focus。数据全部在用户自己的 Notion 里，这个服务不留副本。`,
          );
        }),
    );
  },
  {
    serverInfo: { name: "shoulder-tap", version: "0.1.0" },
  },
);

const verifyToken = async (req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  // 可选的门禁：只用来挡住路人蹭这台 Vercel，跟用户数据无关。
  const gate = process.env.SHOULDER_TAP_KEY;
  if (gate && req.headers.get("x-shoulder-tap-key") !== gate) return undefined;

  // Notion 的 internal integration secret 长这样：ntn_xxx（老的是 secret_xxx）。
  if (!bearer || !/^(ntn_|secret_)/.test(bearer)) return undefined;

  return { token: bearer, scopes: ["notion"], clientId: "shoulder-tap" };
};

/**
 * 分两步上线：
 *  1. 不设 SHOULDER_TAP_AUTH  → 端点开放，任何人能连上调 ping，用来验证部署本身通不通。
 *     其它工具照样没用 —— 它们要拿调用方的 Notion token 才能干活，没 token 会直接报错。
 *  2. 在 Vercel 环境变量里设 SHOULDER_TAP_AUTH=on 再 Redeploy → 立刻变成必须带 token。
 *     不用改代码，也不用重新 push。
 */
export const mcpHandler = AUTH_ON
  ? withMcpAuth(handler, verifyToken, { required: true })
  : handler;

export { AUTH_ON };
