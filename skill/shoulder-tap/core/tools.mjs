/**
 * 七个工具的定义和实现。mcp.mjs 把它们挂到 stdio 上；onboarding 页面和测试直接调 call()。
 * 数据在本地 JSON 或你自己的 Notion（见 store.mjs），不经过 shoulder-tap 的任何服务器。
 * 时区默认读这台机器的；模型传了 tz 就用它传的。
 */
import { openStore, machineTz } from "./store.mjs";
import { current, dayWindow, offsetOf, requireTz, DB_TITLE, adoptDatabase, createDatabase, findHabit } from "./focus.mjs";
import { pageIdFrom, NotionError } from "./notion.mjs";
import { renderCheck, renderPlan } from "./render.mjs";

export const VERSION = "0.2.0";

const tzProp = { type: "string", description: "IANA 时区名。不传就用这台机器的时区（推荐不传）。" };
const dayProp = {
  type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: "YYYY-MM-DD。基本不要传 —— 按用户时区算今天。只有用户明确说「昨天」「上周三」时才传。",
};

export const TOOLS = [
  {
    name: "check_focus",
    description: "在帮用户做任何实质性的事之前先调用这个。它返回用户今天说好要做的事、当前该做哪一条，以及你该怎么处理他现在想做的这件事。新对话开始时、用户提出一个新任务时，都要先 call 一次。",
    inputSchema: { type: "object", properties: { activity: { type: "string", description: "用户现在想做/正在做的事，一句话。" }, tz: tzProp, day: dayProp } },
  },
  {
    name: "set_focus",
    description: "把用户今天要做的事按先后顺序记下来，会覆盖今天已有的清单。用户说「我今天要做 A、B、C」或者要重排顺序时用。",
    inputSchema: {
      type: "object", required: ["tasks"],
      properties: {
        tasks: { type: "array", minItems: 1, items: { type: "object", required: ["task"], properties: { task: { type: "string", description: "一个动作，动词开头，越短越好" }, note: { type: "string" } } } },
        tz: tzProp, day: dayProp,
      },
    },
  },
  {
    name: "add_focus",
    description: "往今天的清单里加一条。只有用户明确说这是该做的事、或者确认要插队时才用，不要替他决定。",
    inputSchema: { type: "object", required: ["task"], properties: { task: { type: "string" }, note: { type: "string" }, position: { type: "integer", minimum: 1, description: "插在第几位，不传排最后。" }, tz: tzProp, day: dayProp } },
  },
  {
    name: "complete_focus",
    description: "把第 N 条标成做完了（或者放弃）。**只有用户明确说这条完成了才调用**——你觉得做完了不算数，问一句「这条算完成了吗」，等他回答。",
    inputSchema: { type: "object", required: ["position"], properties: { position: { type: "integer", minimum: 1 }, dropped: { type: "boolean", description: "true = 今天不做了" }, tz: tzProp, day: dayProp } },
  },
  {
    name: "add_habit",
    description: "用户说「每 N 分钟提醒我做某件事」或「每天几点提醒我」时用。名字用他自己的说法，不要给建议清单。kind：soft = 简单、随手就能做的（喝水这类），所以不许跳过，到点就催到做了为止；hard = 受当天情况影响大的（健身这类），可以说今天不做。不确定就问他一句。",
    inputSchema: {
      type: "object", required: ["name", "kind"],
      properties: {
        name: { type: "string" }, kind: { type: "string", enum: ["hard", "soft"] },
        every_minutes: { type: "integer", minimum: 1, description: "隔多少分钟；和 at 二选一" },
        at: { type: "string", pattern: "^\\d{1,2}:\\d{2}$", description: "每天几点，HH:MM；和 every_minutes 二选一" },
        note: { type: "string" }, tz: tzProp,
      },
    },
  },
  {
    name: "log_habit",
    description: "用户说他刚做了某个习惯，就调用这个把计时清零。他说今天不做了，传 skip=true 并把原因写进 note —— 但软习惯（soft）是随手就能做的事，不许跳过，会被拒绝，照实告诉他。不要替他记：他没说做，就是没做。",
    inputSchema: { type: "object", required: ["habit"], properties: { habit: { type: "string", description: "习惯名或短 ID，模糊匹配" }, skip: { type: "boolean" }, note: { type: "string" }, tz: tzProp } },
  },
  {
    name: "stop_habit",
    description: "用户说以后不用再盯某个习惯了，就停用它。历史都留着，只是不再提醒。只有他明确说不要了才用 —— 说「今天不做」是 log_habit 的 skip。",
    inputSchema: { type: "object", required: ["habit"], properties: { habit: { type: "string" }, note: { type: "string", description: "为什么停，可选" } } },
  },
  {
    name: "habit_history",
    description: "看习惯的历史：每一次做了（done）或跳过（dropped）的记录，新的在前。用户问「我这周喝了几次水」「上次健身是什么时候」时用。",
    inputSchema: { type: "object", properties: { habit: { type: "string", description: "只看这一个，模糊匹配；不传看全部" }, limit: { type: "integer", minimum: 1, maximum: 200 } } },
  },
  {
    name: "setup",
    description: `只在用户选了 Notion 存储、而 check_focus 报 not_set_up 时用：在他给的 Notion 页面下建「${DB_TITLE}」库，或者接管他已有的库。本地存储不需要这一步。`,
    inputSchema: { type: "object", required: ["notion_page"], properties: { notion_page: { type: "string", description: "Notion 链接或 ID，那个页面要已经在 ⋯ → Connections 里连上了 integration" } } },
  },
];

function zoneOf(tz, day) {
  const use = requireTz(tz || machineTz());
  const win = dayWindow(use, day);
  return { tz: use, win, line: `时区 ${use}（UTC${offsetOf(use)}）→ 今天是 ${win.day}` };
}

const when = (h) => (h.at ? `每天 ${h.at}` : `每 ${h.everyMin} 分钟`);
const kindName = (k) => (k === "soft" ? "软习惯，随手就能做，不许跳过" : "硬习惯，看当天情况，可以说今天不做");

export async function call(name, a) {
  const store = openStore();
  switch (name) {
    case "check_focus": {
      const z = zoneOf(a.tz, a.day);
      const [items, habits] = await Promise.all([store.listDay(z.win), store.overdueHabits().catch(() => [])]);
      return `${z.line}\n\n${renderCheck(items, z.win.day, a.activity, habits)}`;
    }
    case "set_focus": {
      const z = zoneOf(a.tz, a.day);
      return `记下了。${z.line}\n\n${renderPlan(await store.setDay(z.win, a.tasks, z.tz), z.win.day)}`;
    }
    case "add_focus": {
      const z = zoneOf(a.tz, a.day);
      return `加上了。${z.line}\n\n${renderPlan(await store.addItem(z.win, a.task, a.note ?? "", a.position, z.tz), z.win.day)}`;
    }
    case "complete_focus": {
      const z = zoneOf(a.tz, a.day);
      const { items, hit } = await store.setStatus(z.win, a.position, a.dropped ? "dropped" : "done");
      if (!hit) return `今天没有第 ${a.position} 条。\n\n${renderPlan(items, z.win.day)}`;
      const next = current(items);
      return `${a.dropped ? `放弃了：${hit.task}` : `✓ ${hit.task}`}\n\n${renderPlan(items, z.win.day)}\n\n` +
        (next ? `下一条是第 ${next.order} 条：${next.task}` : "今天说好的都做完了。");
    }
    case "add_habit": {
      if (!a.every_minutes && !a.at) return "every_minutes 和 at 得给一个：隔多久一次，还是每天几点。";
      const habits = await store.addHabit(a.name, a.every_minutes ?? 0, a.note ?? "", requireTz(a.tz || machineTz()), a.at, a.kind);
      return `加上了：${a.name}，${a.at ? `每天 ${a.at}` : `每 ${a.every_minutes} 分钟`}，${kindName(a.kind)}。\n\n现在盯着这些：\n` +
        habits.map((h) => `  · ${h.name} —— ${when(h)}（${h.kind === "soft" ? "软" : "硬"}）`).join("\n");
    }
    case "log_habit": {
      const hit = await store.logHabit(a.habit, requireTz(a.tz || machineTz()), a.note, a.skip === true);
      if (hit?.refused) return `「${hit.name}」是软习惯，随手就能做的事不能跳过。什么都没记，到点照样会提醒 —— 把这句照实告诉他。`;
      if (hit) return a.skip ? `记下了：${hit.name} 今天跳过。` : `记下了：${hit.name}，下次提醒${hit.at ? `明天 ${hit.at}` : `在 ${hit.everyMin} 分钟后`}。`;
      const all = await store.listHabits().catch(() => []);
      return `没找到「${a.habit}」。` + (all.length ? `他盯着的是这些：${all.map((h) => h.name).join("、")}。` : "他还没加过任何习惯。");
    }
    case "stop_habit": {
      const hit = await store.stopHabit(a.habit, a.note);
      return hit ? `停用了：${hit.name}。历史都还在，以后不再提醒。` : `没找到「${a.habit}」。`;
    }
    case "habit_history": {
      const tz = machineTz();
      let rows = await store.habitHistory(200);
      if (a.habit) {
        const hit = findHabit(rows, a.habit);
        rows = hit ? rows.filter((r) => r.sid === hit.sid) : [];
      }
      rows = rows.slice(0, a.limit ?? 50);
      if (!rows.length) return a.habit ? `「${a.habit}」还没有记录。` : "还没有任何习惯记录。";
      const local = (iso) => (iso ? new Date(iso).toLocaleString("zh-CN", { timeZone: tz, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "?");
      return `最近 ${rows.length} 条（${tz}）：\n` +
        rows.map((r) => `  ${r.status === "done" ? "✓" : "–"} ${local(r.finished)} ${r.name}${r.status === "dropped" && r.note ? `（${r.note}）` : ""}`).join("\n");
    }
    case "setup": {
      if (store.kind !== "notion") return "现在用的是本地存储，不需要建库。想换到 Notion，打开 shoulder-tap 的设置页选 Notion。";
      const id = pageIdFrom(a.notion_page);
      const adopted = await adoptDatabase(store.token, id).catch(() => undefined);
      return adopted
        ? `接管了你已有的库「${adopted.title}」` + (adopted.added.length ? `，补上了：${adopted.added.join("、")}` : "，字段本来就齐")
        : `建好了：${(await createDatabase(store.token, id)).url ?? id}`;
    }
  }
  throw new Error(`没有这个工具：${name}`);
}


/** 报错也当正常返回：说人话，让模型知道下一步能做什么。 */
export async function callText(name, args) {
  try {
    return await call(name, args ?? {});
  } catch (e) {
    return e instanceof NotionError ? `Notion 说：${e.message}（code: ${e.code}）` : `出错了：${e?.message ?? e}`;
  }
}
