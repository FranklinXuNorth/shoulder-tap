import { notion, plain, text, NotionError } from "./notion";

export const DB_TITLE = "Shoulder Tap";
export const HABITS_TITLE = "Shoulder Tap Habits";
const STATUS = { pending: "Pending", done: "Done", dropped: "Dropped" } as const;

export type Item = {
  id: string;
  order: number;
  task: string;
  note: string;
  done: boolean;
};

/** 同一个 token 在同一个热实例里只查一次数据库位置。冷启动重来一次也就多 200ms。 */
const dsCache = new Map<string, string>();

/** 今天是哪天。服务器在 UTC，所以按配置的时区偏移算。 */
export function today(day?: string): string {
  if (day) return day;
  const offset = Number(process.env.TIMEZONE_OFFSET_HOURS ?? 8);
  return new Date(Date.now() + offset * 3600_000).toISOString().slice(0, 10);
}

/** 在用户自己的 workspace 里找那个 data source。 */
export async function findDataSource(token: string, title = DB_TITLE): Promise<string> {
  const key = `${token}::${title}`;
  const hit = dsCache.get(key);
  if (hit) return hit;

  const res = await notion<any>(token, "POST", "/search", {
    query: title,
    filter: { property: "object", value: "data_source" },
    page_size: 20,
  });

  const match = (res.results ?? []).find(
    (r: any) => plain(r.title).toLowerCase() === title.toLowerCase(),
  );
  if (!match) {
    throw new NotionError(
      404,
      "not_set_up",
      `你的 Notion 里还没有「${title}」这个数据库，或者你的 integration 还没被授权访问它。` +
        `先调用 setup 工具建一个（要给它一个 Notion 页面链接），或者到那个页面的 ⋯ → Connections 里把 integration 加上。`,
    );
  }
  dsCache.set(key, match.id);
  return match.id;
}

/** 建库。schema 是这个服务唯一「拥有」的东西。 */
export async function createDatabase(token: string, parentPageId: string) {
  const db = await notion<any>(token, "POST", "/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    title: text(DB_TITLE),
    icon: { type: "emoji", emoji: "👀" },
    initial_data_source: {
      properties: {
        Task: { title: {} },
        Order: { number: {} },
        Status: {
          select: {
            options: [
              { name: STATUS.pending, color: "default" },
              { name: STATUS.done, color: "green" },
              { name: STATUS.dropped, color: "gray" },
            ],
          },
        },
        Day: { date: {} },
        Note: { rich_text: {} },
      },
    },
  });

  const dsId = db.data_sources?.[0]?.id;
  if (!dsId) throw new Error("建库成功但没拿到 data source id，Notion 的返回变了。");
  dsCache.set(`${token}::${DB_TITLE}`, dsId);
  return { databaseId: db.id, dataSourceId: dsId, url: db.url as string | undefined };
}

// ---------- 习惯提醒 ----------
// 这些不是任务，是「隔多久该起来一下」。规则和上次时间都在用户自己的 Notion 里，
// 他想改成 45 分钟、想加一条「看远处」，直接在 Notion 里改就行，不用动代码。

export type Habit = { id: string; name: string; everyMin: number; last?: string; overdueMin: number };

const DEFAULT_HABITS = [
  { name: "喝水", every: 30 },
  { name: "起来走两步", every: 60 },
  { name: "做几个拉伸", every: 120 },
];

export async function createHabitsDatabase(token: string, parentPageId: string) {
  const db = await notion<any>(token, "POST", "/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    title: text(HABITS_TITLE),
    icon: { type: "emoji", emoji: "⏱️" },
    initial_data_source: {
      properties: {
        Habit: { title: {} },
        EveryMinutes: { number: {} },
        Last: { date: {} },
      },
    },
  });
  const ds = db.data_sources?.[0]?.id;
  if (!ds) throw new Error("习惯库建好了但没拿到 data source id。");
  dsCache.set(`${token}::${HABITS_TITLE}`, ds);

  for (const h of DEFAULT_HABITS) {
    await notion(token, "POST", "/pages", {
      parent: { type: "data_source_id", data_source_id: ds },
      properties: {
        Habit: { title: text(h.name) },
        EveryMinutes: { number: h.every },
        Last: { date: { start: new Date().toISOString() } },
      },
    });
  }
  return { url: db.url as string | undefined };
}

/** 现在有哪些该做了。习惯库不存在就当没这回事，不要因此挡住 check_focus。 */
export async function overdueHabits(token: string): Promise<Habit[]> {
  let ds: string;
  try {
    ds = await findDataSource(token, HABITS_TITLE);
  } catch {
    return [];
  }

  const res = await notion<any>(token, "POST", `/data_sources/${ds}/query`, { page_size: 50 });
  const now = Date.now();

  return (res.results ?? [])
    .map((page: any): Habit => {
      const p = page.properties ?? {};
      const last = p.Last?.date?.start;
      const everyMin = p.EveryMinutes?.number ?? 0;
      const sinceMin = last ? Math.floor((now - Date.parse(last)) / 60000) : Infinity;
      return {
        id: page.id,
        name: plain(p.Habit?.title),
        everyMin,
        last,
        overdueMin: everyMin > 0 ? sinceMin - everyMin : -1,
      };
    })
    .filter((h: Habit) => h.name && h.everyMin > 0 && h.overdueMin > 0)
    .sort((a: Habit, b: Habit) => b.overdueMin - a.overdueMin);
}

/** 记一笔「刚做了」。名字模糊匹配，模型说「喝水」「喝了水」都认。 */
export async function logHabit(token: string, name: string): Promise<Habit | undefined> {
  const ds = await findDataSource(token, HABITS_TITLE);
  const res = await notion<any>(token, "POST", `/data_sources/${ds}/query`, { page_size: 50 });
  const rows = (res.results ?? []).map((page: any) => ({
    id: page.id,
    name: plain(page.properties?.Habit?.title),
    everyMin: page.properties?.EveryMinutes?.number ?? 0,
  }));

  const needle = name.trim();
  const hit =
    rows.find((r: any) => r.name === needle) ??
    rows.find((r: any) => r.name.includes(needle) || needle.includes(r.name));
  if (!hit) return undefined;

  await notion(token, "PATCH", `/pages/${hit.id}`, {
    properties: { Last: { date: { start: new Date().toISOString() } } },
  });
  return { ...hit, overdueMin: -hit.everyMin };
}

function parse(page: any): Item {
  const p = page.properties ?? {};
  return {
    id: page.id,
    order: p.Order?.number ?? 0,
    task: plain(p.Task?.title),
    note: plain(p.Note?.rich_text),
    done: p.Status?.select?.name === STATUS.done,
  };
}

export async function listDay(token: string, day: string): Promise<Item[]> {
  const ds = await findDataSource(token);
  const res = await notion<any>(token, "POST", `/data_sources/${ds}/query`, {
    filter: {
      and: [
        { property: "Day", date: { equals: day } },
        { property: "Status", select: { does_not_equal: STATUS.dropped } },
      ],
    },
    sorts: [{ property: "Order", direction: "ascending" }],
    page_size: 100,
  });
  return (res.results ?? []).map(parse).sort((a: Item, b: Item) => a.order - b.order);
}

async function createItem(
  token: string,
  ds: string,
  day: string,
  order: number,
  task: string,
  note: string,
) {
  await notion(token, "POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: ds },
    properties: {
      Task: { title: text(task) },
      Order: { number: order },
      Status: { select: { name: STATUS.pending } },
      Day: { date: { start: day } },
      Note: { rich_text: text(note) },
    },
  });
}

/** 重设今天：旧的扔进回收站，按给的顺序重新写一遍。 */
export async function setDay(
  token: string,
  day: string,
  tasks: { task: string; note?: string }[],
): Promise<Item[]> {
  const ds = await findDataSource(token);
  const old = await listDay(token, day);
  for (const it of old) {
    await notion(token, "PATCH", `/pages/${it.id}`, { in_trash: true });
  }
  let order = 1;
  for (const t of tasks) {
    await createItem(token, ds, day, order++, t.task, t.note ?? "");
  }
  return listDay(token, day);
}

/** 插一条。position 不给就排到最后；给了就插在那个位置，后面的顺延。 */
export async function addItem(
  token: string,
  day: string,
  task: string,
  note: string,
  position?: number,
): Promise<Item[]> {
  const ds = await findDataSource(token);
  const items = await listDay(token, day);

  if (position === undefined || position > items.length) {
    const last = items.length ? items[items.length - 1].order : 0;
    await createItem(token, ds, day, last + 1, task, note);
    return listDay(token, day);
  }

  const at = Math.max(1, position);
  for (const it of items) {
    if (it.order >= at) {
      await notion(token, "PATCH", `/pages/${it.id}`, {
        properties: { Order: { number: it.order + 1 } },
      });
    }
  }
  await createItem(token, ds, day, at, task, note);
  return listDay(token, day);
}

export async function setStatus(
  token: string,
  day: string,
  position: number,
  status: "done" | "dropped",
): Promise<{ items: Item[]; hit: Item | undefined }> {
  const items = await listDay(token, day);
  const hit = items.find((i) => i.order === position);
  if (!hit) return { items, hit: undefined };
  await notion(token, "PATCH", `/pages/${hit.id}`, {
    properties: { Status: { select: { name: STATUS[status] } } },
  });
  return { items: await listDay(token, day), hit };
}

export const current = (items: Item[]) => items.find((i) => !i.done);
