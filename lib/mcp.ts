import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { NotionError, pageIdFrom } from "@/lib/notion";
import {
  DB_TITLE,
  addHabit,
  addItem,
  adoptDatabase,
  createDatabase,
  current,
  listDay,
  listHabits,
  logHabit,
  overdueHabits,
  setDay,
  setStatus,
  today,
  tzOffset,
} from "@/lib/focus";
import { renderCheck, renderPlan } from "@/lib/render";
import { protocolText, tapEvent, whatIsDue } from "@/lib/protocol";
import { JEV_ON, WHAT_TO_DO, judge } from "@/lib/jev";

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
          "不需要任何凭据的健康检查。返回服务版本、哪些工具要凭据、以及服务器时间。" +
          "部署完先用它确认链路通不通，平时用不到。",
        inputSchema: z.object({}),
      },
      async () =>
        ok(
          [
            "shoulder-tap 0.1.0 活着。",
            `零内容工具（focus_protocol / due_check）：不需要任何凭据`,
            `代劳 Notion 的工具：要在 Authorization 头里带 Notion secret`,
            `服务器时间：${new Date().toISOString()}（按 UTC+${tzOffset()} 算今天 = ${today()}）`,
          ].join("\n"),
        ),
    );

    // ---- 零内容通道：这两个工具看不到你的任何任务文字，只收 ID 和数字 ----

    server.registerTool(
      "focus_protocol",
      {
        title: "取一次判断规程",
        description:
          "动手做实质性的事之前先调这个，拿到该怎么判、判出三档各自怎么办。" +
          "它不需要凭据、也收不到你的任何内容 —— 数据你自己去用户的 Notion 里读。" +
          "新会话第一次干活时调一次；会话中途冒出明显不同的新任务时再调一次。",
        inputSchema: z.object({}),
      },
      async () => ok(protocolText()),
    );

    server.registerTool(
      "due_check",
      {
        title: "哪些习惯到点了",
        description:
          "纯算术：给它每条习惯的 ID、间隔分钟、上次时间，它回哪些 ID 到点了、超了多久。" +
          "**只传 ID 和数字，绝对不要传习惯名字或任何文字** —— 名字留在用户自己的 Notion 里，" +
          "拿返回的 ID 自己对回去。",
        inputSchema: z.object({
          habits: z
            .array(
              z.object({
                id: z.string().describe("短 ID，比如 h-8b12d4。不要传名字。"),
                every_minutes: z.number(),
                last: z.string().optional().describe("上次做的时间，ISO 8601"),
              }),
            )
            .describe("从 Notion 读到的 habit 行，剥掉名字只留这三个字段"),
        }),
      },
      async ({ habits }) => {
        const due = whatIsDue(habits);
        if (!due.length) return ok("没有到点的。什么都不用提。");
        return ok(
          [
            JSON.stringify(tapEvent("due", due.map((d) => d.id))),
            "",
            ...due.map((d) =>
              d.overdue_minutes < 0
                ? `  ${d.id} —— 从来没记录过，第一次`
                : `  ${d.id} —— 超了 ${d.overdue_minutes} 分钟`,
            ),
            "",
            "拿这些 ID 回 Notion 查名字。**但不要现在就说** —— 等当前这条任务做完，",
            "或者长任务做到一半有自然停顿时，再打出那只手加一句话。",
            "正在往下推进的中途不要插；宁可这轮不提，下轮再说。",
            "他说做了，就把那行的 Last 更新成现在；他没说，就是没做。",
          ].join("\n"),
        );
      },
    );

    // ---- 快速判档：要钱、也要把两行字交出去，所以默认不开 ----

    if (JEV_ON) {
      server.registerTool(
        "classify_focus",
        {
          title: "让 Jev 判一档",
          description:
            "把「用户现在要做什么」和「当前这条任务」交给 Jev（System One 模型），" +
            "几百毫秒回一个 related / partial / unrelated 和置信度。" +
            "你自己判得准的时候不需要它；拿不准、或者想要一个不受对话上下文影响的第二意见时才用。" +
            "注意：这一步会把这两行文字送出这台机器，用户的完整清单不要整个塞进来。",
          inputSchema: z.object({
            activity: z.string().describe("用户现在要做的事，一句话"),
            current_task: z.string().describe("今天清单上当前那条，一句话"),
            other_tasks: z
              .array(z.string())
              .optional()
              .describe("清单上其它几条，只传标题。不传也能判，只是分不清 partial。"),
          }),
        },
        async ({ activity, current_task, other_tasks }) =>
          guard(async () => {
            const { relation, confidence } = await judge(
              activity,
              current_task,
              other_tasks ?? [],
            );
            return ok(
              [
                `${relation}（置信度 ${confidence.toFixed(2)}）`,
                "",
                WHAT_TO_DO[relation],
                "",
                confidence < 0.6
                  ? "置信度不高 —— 按 unrelated 处理，拦下来问一句，别自作主张。"
                  : "",
              ]
                .join("\n")
                .trim(),
            );
          }),
      );
    }

    // ---- 以下是「让服务端代劳 Notion」的路径，跟上面二选一 ----

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
      "add_habit",
      {
        title: "加一个要盯的习惯",
        description:
          "用户说「每 N 分钟提醒我做某件事」时用。名字完全自由，用他自己的说法原样记，" +
          "不要给他任何建议清单。只有他自己提出来才加 —— 没人有资格规定他该养什么习惯。",
        inputSchema: z.object({
          name: z.string().describe("习惯名，用户自己的说法，原样记"),
          every_minutes: z.number().int().min(1).describe("隔多少分钟提醒一次"),
          note: z.string().optional().describe("备注，没有就不传"),
        }),
      },
      async ({ name, every_minutes, note }, ctx: any) =>
        guard(async () => {
          const habits = await addHabit(tokenOf(ctx), name, every_minutes, note ?? "");
          return ok(
            `加上了：${name}，每 ${every_minutes} 分钟。\n\n现在盯着这些：\n` +
              habits.map((h) => `  · ${h.name} —— 每 ${h.everyMin} 分钟`).join("\n"),
          );
        }),
    );

    server.registerTool(
      "log_habit",
      {
        title: "记一笔「刚做了」",
        description:
          "用户说他刚做了某个习惯，就调用这个，把计时清零。名字或短 ID 模糊匹配。" +
          "不要替他记——他没说做，就是没做。",
        inputSchema: z.object({
          habit: z.string().describe("习惯名或短 ID，用用户自己的说法，跟库里的名字模糊匹配"),
        }),
      },
      async ({ habit }, ctx: any) =>
        guard(async () => {
          const token = tokenOf(ctx);
          const hit = await logHabit(token, habit);
          if (hit) return ok(`记下了：${hit.name}，下次提醒在 ${hit.everyMin} 分钟后。`);

          const all = await listHabits(token).catch(() => []);
          return ok(
            `没找到「${habit}」。` +
              (all.length
                ? `他盯着的是这些：${all.map((h) => h.name).join("、")}。`
                : "他还没加过任何习惯 —— 想加就用 add_habit，名字他自己定。"),
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
            .describe(
              "Notion 链接或 ID。给页面 → 在它下面新建库；给已有的库 → 直接接管它，只补缺的字段。" +
                "不管哪种，那个东西都必须已经在 ⋯ → Connections 里连上了用户的 integration。",
            ),
        }),
      },
      async ({ notion_page }, ctx: any) =>
        guard(async () => {
          const token = tokenOf(ctx);
          const id = pageIdFrom(notion_page);

          // 先当成已有的库试着接管；不是库才走新建。
          const adopted = await adoptDatabase(token, id).catch(() => undefined);
          const head = adopted
            ? `接管了你已有的库「${adopted.title}」：${adopted.url ?? adopted.databaseId}\n` +
              (adopted.added.length
                ? `补上了这些字段：${adopted.added.join("、")}\n`
                : "字段本来就是齐的，什么都没改。\n")
            : `建好了：${(await createDatabase(token, id)).url ?? id}\n`;

          return ok(
            head +
              "一个库装两种行：Kind=task 是今天要做的事，Kind=habit 是隔多久该干一次的事。\n" +
              "里面没有任何预设 —— 想盯什么习惯，问用户，再用 add_habit 加。\n" +
              "数据全部在用户自己的 Notion 里，这个服务不留副本。",
          );
        }),
    );
  },
  {
    serverInfo: { name: "shoulder-tap", version: "0.1.0" },
  },
);

const verifyToken = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  // Notion 的 internal integration secret 长这样：ntn_xxx（老的是 secret_xxx）。
  // 只有「让服务端代劳 Notion」那条路径才需要它。零内容路径完全不用给。
  if (!bearer || !/^(ntn_|secret_)/.test(bearer)) return undefined;
  return { token: bearer, scopes: ["notion"], clientId: "shoulder-tap" };
};

/**
 * Bearer（Notion secret）永远是可选的：零内容路径根本不需要凭据，
 * 代劳 Notion 的那几个工具没拿到 token 会自己报一句人话。
 *
 * 这里**绝对不能回 401**。MCP 客户端把 401 读成「请走 OAuth」，
 * 于是它会去做动态客户端注册，撞上一个 404 HTML 页面，然后整个服务器显示连不上 ——
 * 一个本来只是「密钥没给对」的情况，看起来像服务挂了。所以门禁不过用 403。
 */
const authed = withMcpAuth(handler, verifyToken, { required: false });

export const mcpHandler = async (req: Request): Promise<Response> => {
  const gate = process.env.SHOULDER_TAP_KEY;
  if (gate && req.headers.get("x-shoulder-tap-key") !== gate) {
    return new Response(
      JSON.stringify({ error: "bad or missing x-shoulder-tap-key" }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }
  return authed(req);
};
