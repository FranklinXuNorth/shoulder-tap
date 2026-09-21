import { notion, plain, text, NotionError } from "./notion";

/**
 * 一个库装两种东西，靠 Kind 区分：
 *   task  —— 你今天说好要做的事，有顺序，做完就勾掉
 *   habit —— 隔多久该干一次的事，没有顺序，永远有效
 * 名字一律自由填。不预设「喝水」这种东西 —— 没人有资格规定你该有什么习惯。
 */
export const DB_TITLE = "Shoulder Tap";

const KIND = { task: "task", habit: "habit" } as const;
const STATUS = { pending: "pending", done: "done", dropped: "dropped" } as const;

export type Item = {
  id: string; // Notion page id
  sid: string; // 我们自己签的短 ID，比如 t-a3f91c
  order: number;
  task: string;
  note: string;
  done: boolean;
};

export type Habit = {
  id: string;
  sid: string;
  name: string;
  everyMin: number;
  last?: string;
  overdueMin: number;
};

/** 同一个 token 在同一个热实例里只查一次数据库位置。冷启动重来一次也就多 200ms。 */
const dsCache = new Map<string, string>();

/**
 * 时区偏移。注意不能写成 `?? 8`：构建时这个变量会被内联成空字符串，
 * `??` 只挡 null/undefined，挡不住 ""，于是 Number("") = 0，"今天"静悄悄退回 UTC。
 */
export function tzOffset(): number {
  const raw = process.env.TIMEZONE_OFFSET_HOURS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 8;
}

/**
 * 一天从几点开始。**不是午夜。**
 *
 * 你 23:00 列好清单，干到凌晨一点 —— 按午夜切的话，清单会在你眼前翻页，
 * 今天说好的事忽然变成"昨天"的，当前这条也没了。那不是新的一天，那是同一个晚上。
 * 默认 4 点：熬夜的人还在昨天，早起的人已经在今天。
 */
export function dayStartHour(): number {
  const raw = process.env.DAY_STARTS_AT_HOUR;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 12 ? n : 4;
}

/** 今天是哪天。服务器在 UTC，所以按用户时区算，再按日切时间往回挪。 */
export function today(day?: string): string {
  if (day) return day;
  const local = Date.now() + tzOffset() * 3600_000;
  return new Date(local - dayStartHour() * 3600_000).toISOString().slice(0, 10);
}

/** 签一个短 ID。撞上已有的就重签 —— taken 是调用方手上已经有的那一批。 */
function mintId(prefix: "t" | "h", taken: Set<string>): string {
  for (let i = 0; i < 8; i++) {
    const sid = `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    if (!taken.has(sid)) {
      taken.add(sid);
      return sid;
    }
  }
  // 连撞八次是天方夜谭，真撞上就用完整 uuid，宁可难看也不能重复。
  return `${prefix}-${crypto.randomUUID()}`;
}

/** 「Shoulder Tap」「ShoulderTap」「shoulder tap」是同一个东西，别为空格吵架。 */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 在用户自己的 workspace 里找那个叫 Shoulder Tap 的 data source。 */
export async function findDataSource(token: string): Promise<string> {
  const hit = dsCache.get(token);
  if (hit) return hit;

  // 两轮：先按标题搜（快），搜不到就把能看见的库都列出来自己比。
  // Notion 的全文搜索是按词匹配的，"Shoulder Tap" 搜不出叫 "ShoulderTap" 的库 ——
  // 只在结果里做归一化没用，那一行在搜索阶段就已经被滤掉了。
  const search = async (query?: string) => {
    const res = await notion<any>(token, "POST", "/search", {
      ...(query ? { query } : {}),
      filter: { property: "object", value: "data_source" },
      page_size: 100,
    });
    return (res.results ?? []).find((r: any) => norm(plain(r.title)) === norm(DB_TITLE));
  };

  const match = (await search(DB_TITLE)) ?? (await search());
  if (!match) {
    throw new NotionError(
      404,
      "not_set_up",
      `你的 Notion 里还没有「${DB_TITLE}」这个数据库，或者你的 integration 还没被授权访问它。` +
        `先调用 setup 工具建一个（要给它一个 Notion 页面链接），或者到那个页面的 ⋯ → Connections 里把 integration 加上。`,
    );
  }
  dsCache.set(token, match.id);
  return match.id;
}

/** 这个服务唯一「拥有」的东西：一份 schema。建完就全是用户的了。 */
function schema() {
  return {
    Name: { title: {} },
    Kind: {
      select: {
        options: [
          { name: KIND.task, color: "blue" },
          { name: KIND.habit, color: "purple" },
        ],
      },
    },
    ID: { rich_text: {} },
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
    EveryMinutes: { number: {} },
    Last: { date: {} },
    Note: { rich_text: {} },
  } as Record<string, any>;
}

/**
 * 接管一个已经存在的库：只补缺的字段，不碰已有的。
 * 用户自己先建好了库再来接的情况很常见，不该逼他重建一个。
 */
export async function adoptDatabase(token: string, databaseId: string) {
  const db = await notion<any>(token, "GET", `/databases/${databaseId}`);
  const dsId = db.data_sources?.[0]?.id;
  if (!dsId) throw new Error("这个库里没有 data source，可能是个链接视图（linked view），换原始库试试。");

  const ds = await notion<any>(token, "GET", `/data_sources/${dsId}`);
  const have = new Set(Object.keys(ds.properties ?? {}));

  const missing: Record<string, any> = {};
  for (const [k, v] of Object.entries(schema())) {
    // title 字段每个库必有一个，名字不同也不能再加一个，跳过。
    if (k === "Name" || have.has(k)) continue;
    missing[k] = v;
  }

  if (Object.keys(missing).length) {
    await notion(token, "PATCH", `/data_sources/${dsId}`, { properties: missing });
  }

  dsCache.set(token, dsId);
  return {
    databaseId: db.id,
    dataSourceId: dsId,
    url: db.url as string | undefined,
    added: Object.keys(missing),
    title: plain(db.title),
  };
}

/** 在一个页面下面新建库。 */
export async function createDatabase(token: string, parentPageId: string) {
  const db = await notion<any>(token, "POST", "/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    title: text(DB_TITLE),
    icon: { type: "emoji", emoji: "👀" },
    initial_data_source: {
      properties: schema(),
    },
  });

  const dsId = db.data_sources?.[0]?.id;
  if (!dsId) throw new Error("建库成功但没拿到 data source id，Notion 的返回变了。");
  dsCache.set(token, dsId);
  return { databaseId: db.id, dataSourceId: dsId, url: db.url as string | undefined };
}

// ---------- task ----------

function parseTask(page: any): Item {
  const p = page.properties ?? {};
  return {
    id: page.id,
    sid: plain(p.ID?.rich_text),
    order: p.Order?.number ?? 0,
    task: plain(p.Name?.title),
    note: plain(p.Note?.rich_text),
    done: p.Status?.select?.name === STATUS.done,
  };
}

export async function listDay(token: string, day: string): Promise<Item[]> {
  const ds = await findDataSource(token);
  const res = await notion<any>(token, "POST", `/data_sources/${ds}/query`, {
    filter: {
      and: [
        { property: "Kind", select: { equals: KIND.task } },
        { property: "Day", date: { equals: day } },
        { property: "Status", select: { does_not_equal: STATUS.dropped } },
      ],
    },
    sorts: [{ property: "Order", direction: "ascending" }],
    page_size: 100,
  });
  return (res.results ?? []).map(parseTask).sort((a: Item, b: Item) => a.order - b.order);
}

async function createTask(
  token: string,
  ds: string,
  day: string,
  order: number,
  task: string,
  note: string,
  sid: string,
) {
  await notion(token, "POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: ds },
    properties: {
      Name: { title: text(task) },
      Kind: { select: { name: KIND.task } },
      ID: { rich_text: text(sid) },
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

  const taken = new Set<string>();
  let order = 1;
  for (const t of tasks) {
    await createTask(token, ds, day, order++, t.task, t.note ?? "", mintId("t", taken));
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
  const sid = mintId("t", new Set(items.map((i) => i.sid)));

  if (position === undefined || position > items.length) {
    const last = items.length ? items[items.length - 1].order : 0;
    await createTask(token, ds, day, last + 1, task, note, sid);
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
  await createTask(token, ds, day, at, task, note, sid);
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

// ---------- habit ----------

function parseHabit(page: any, now: number): Habit {
  const p = page.properties ?? {};
  const last = p.Last?.date?.start;
  const everyMin = p.EveryMinutes?.number ?? 0;
  const sinceMin = last ? Math.floor((now - Date.parse(last)) / 60000) : Infinity;
  return {
    id: page.id,
    sid: plain(p.ID?.rich_text),
    name: plain(p.Name?.title),
    everyMin,
    last,
    overdueMin: everyMin > 0 ? sinceMin - everyMin : -1,
  };
}

async function allHabits(token: string): Promise<Habit[]> {
  const ds = await findDataSource(token);
  const res = await notion<any>(token, "POST", `/data_sources/${ds}/query`, {
    filter: { property: "Kind", select: { equals: KIND.habit } },
    page_size: 100,
  });
  const now = Date.now();
  return (res.results ?? []).map((p: any) => parseHabit(p, now)).filter((h: Habit) => h.name);
}

export async function listHabits(token: string): Promise<Habit[]> {
  return allHabits(token);
}

/** 现在有哪些该做了。库还没建就当没这回事，不要因此挡住 check_focus。 */
export async function overdueHabits(token: string): Promise<Habit[]> {
  let habits: Habit[];
  try {
    habits = await allHabits(token);
  } catch {
    return [];
  }
  return habits
    .filter((h) => h.everyMin > 0 && h.overdueMin > 0)
    .sort((a, b) => b.overdueMin - a.overdueMin);
}

export async function addHabit(
  token: string,
  name: string,
  everyMinutes: number,
  note: string,
): Promise<Habit[]> {
  const ds = await findDataSource(token);
  const existing = await allHabits(token);
  const sid = mintId("h", new Set(existing.map((h) => h.sid)));

  await notion(token, "POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: ds },
    properties: {
      Name: { title: text(name) },
      Kind: { select: { name: KIND.habit } },
      ID: { rich_text: text(sid) },
      EveryMinutes: { number: everyMinutes },
      Last: { date: { start: new Date().toISOString() } },
      Note: { rich_text: text(note) },
    },
  });
  return allHabits(token);
}

/** 记一笔「刚做了」。名字模糊匹配，模型说「喝水」「喝了水」都认。 */
export async function logHabit(token: string, name: string): Promise<Habit | undefined> {
  const habits = await allHabits(token);
  const needle = name.trim();
  const hit =
    habits.find((h) => h.sid === needle) ??
    habits.find((h) => h.name === needle) ??
    habits.find((h) => h.name.includes(needle) || needle.includes(h.name));
  if (!hit) return undefined;

  await notion(token, "PATCH", `/pages/${hit.id}`, {
    properties: { Last: { date: { start: new Date().toISOString() } } },
  });
  return { ...hit, overdueMin: -hit.everyMin, last: new Date().toISOString() };
}
