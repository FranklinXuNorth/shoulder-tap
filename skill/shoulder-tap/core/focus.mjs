import { notion, plain, text, NotionError } from "./notion.mjs";
import { overdueMinutes, dayStartHour } from "./protocol.mjs";
export { dayStartHour };
/**
 * 一个库装两种东西，靠 Kind 区分：
 *   task  —— 你今天说好要做的事，有顺序，做完就勾掉
 *   habit —— 隔多久该干一次、或每天几点该干的事，没有顺序，永远有效
 * 名字一律自由填。不预设「喝水」这种东西 —— 没人有资格规定你该有什么习惯。
 */
export const DB_TITLE = "Shoulder Tap";
const KIND = { task: "task", habit: "habit" };
const STATUS = { pending: "pending", done: "done", dropped: "dropped" };
/** 同一个 token 在同一个热实例里只查一次数据库位置。冷启动重来一次也就多 200ms。 */
const dsCache = new Map();
/**
 * 时区一律用 IANA 名字（America/New_York、Asia/Shanghai），不用偏移小时数 ——
 * 偏移会因为夏令时变，名字不会。
 *
 * 没有服务端默认时区，这是故意的。
 * 猜一个就等于写死一个 —— 用户飞一趟，数据就静悄悄错一整天，而且没人会发现。
 * 调用方跑在用户机器上，它知道；它不说，就报错，别替它编。
 */
export function requireTz(tz) {
    if (!tz) {
        throw new Error("没传 tz。从用户机器上读 Intl.DateTimeFormat().resolvedOptions().timeZone（node -p 一行就出来），" +
            "把 IANA 名字传进来。服务端不猜时区 —— 猜错就是整整一天的错数据。");
    }
    return assertTz(tz);
}
function partsIn(tz, at) {
    const f = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "longOffset",
    });
    return Object.fromEntries(f.formatToParts(at).map((p) => [p.type, p.value]));
}
/** 不认识的时区名早点炸，别让它悄悄退回 UTC 又写出一天错数据。 */
export function assertTz(tz) {
    try {
        partsIn(tz, new Date());
        return tz;
    }
    catch {
        throw new Error(`不认识时区「${tz}」。要 IANA 名字，比如 America/New_York、Asia/Shanghai、Europe/London。`);
    }
}
/** 那个时区在某一刻的 UTC 偏移，形如 -04:00。夏令时会自己跟着变。 */
export function offsetOf(tz, at = new Date()) {
    const name = partsIn(tz, at).timeZoneName ?? "GMT";
    const m = /GMT([+-]\d{2}:\d{2})/.exec(name);
    return m ? m[1] : "+00:00";
}
function offsetMinutes(tz, at) {
    const [h, m] = offsetOf(tz, at).split(":");
    const sign = h.startsWith("-") ? -1 : 1;
    return sign * (Math.abs(Number(h)) * 60 + Number(m));
}
/**
 * 一切都存 UTC。
 *
 * 存本地日期 / 带偏移的时间戳，等于把「当时在哪」腌进了数据里：
 * 你从纽约飞回上海，同一行记录的含义就变了，而且再也没法还原。
 * 所以写进去的永远是 UTC 瞬时，要哪个时区的日子，读的时候再换算。
 */
export const nowUtc = () => new Date().toISOString();
/** 把某个时区的墙上时间换成 UTC 瞬时。 */
function wallToUtc(tz, wall) {
    const guess = new Date(`${wall}Z`);
    return new Date(guess.getTime() - offsetMinutes(tz, guess) * 60_000);
}
/** 今天是哪天（那个时区的本地日期，不到日切时间就还算前一天）。只用来显示和查询，不入库。 */
export function today(tz, day) {
    if (day)
        return day;
    const p = partsIn(assertTz(tz), new Date());
    const midnight = Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
    const shifted = Number(p.hour) < dayStartHour() ? midnight - 86_400_000 : midnight;
    return new Date(shifted).toISOString().slice(0, 10);
}
/**
 * 「那一天」在 UTC 上对应的区间：[本地 4:00, 次日本地 4:00)。
 * 查询靠它，写入也靠它 —— 记录只认 UTC，日子是算出来的，不是存下来的。
 */
export function dayWindow(tz, day) {
    const zone = assertTz(tz);
    const d = today(zone, day);
    const h = String(dayStartHour()).padStart(2, "0");
    const start = wallToUtc(zone, `${d}T${h}:00:00`);
    const end = new Date(start.getTime() + 86_400_000);
    return {
        day: d,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        midUtc: new Date(start.getTime() + 43_200_000).toISOString(),
    };
}
/**
 * 这一行该写哪个 UTC 瞬时。
 * 就是当天就写"现在"；补录别的日子，写那天的正午 —— 落在区间中间，
 * 不会因为夏令时差半小时就掉到隔壁去。
 */
export function dayStamp(win) {
    const now = Date.now();
    const inside = now >= Date.parse(win.startUtc) && now < Date.parse(win.endUtc);
    return inside ? new Date(now).toISOString() : win.midUtc;
}
/** 签一个短 ID。撞上已有的就重签 —— taken 是调用方手上已经有的那一批。 */
export function mintId(prefix, taken) {
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
const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
/** 在用户自己的 workspace 里找那个叫 Shoulder Tap 的 data source。 */
export async function findDataSource(token) {
    const hit = dsCache.get(token);
    if (hit)
        return hit;
    // 两轮：先按标题搜（快），搜不到就把能看见的库都列出来自己比。
    // Notion 的全文搜索是按词匹配的，"Shoulder Tap" 搜不出叫 "ShoulderTap" 的库 ——
    // 只在结果里做归一化没用，那一行在搜索阶段就已经被滤掉了。
    const search = async (query) => {
        const res = await notion(token, "POST", "/search", {
            ...(query ? { query } : {}),
            filter: { property: "object", value: "data_source" },
            page_size: 100,
        });
        return (res.results ?? []).find((r) => norm(plain(r.title)) === norm(DB_TITLE));
    };
    const match = (await search(DB_TITLE)) ?? (await search());
    if (!match) {
        throw new NotionError(404, "not_set_up", `你的 Notion 里还没有「${DB_TITLE}」这个数据库，或者你的 integration 还没被授权访问它。` +
            `先调用 setup 工具建一个（要给它一个 Notion 页面链接），或者到那个页面的 ⋯ → Connections 里把 integration 加上。`);
    }
    await ensureFields(token, match.id);
    dsCache.set(token, match.id);
    return match.id;
}
/** 老库缺后来加的字段（比如习惯的 Type）：补上，不碰已有的。每个进程只查一次。 */
async function ensureFields(token, dsId) {
    const ds = await notion(token, "GET", `/data_sources/${dsId}`);
    const have = new Set(Object.keys(ds.properties ?? {}));
    const missing = Object.fromEntries(Object.entries(schema()).filter(([k]) => k !== "Name" && !have.has(k)));
    if (Object.keys(missing).length)
        await notion(token, "PATCH", `/data_sources/${dsId}`, { properties: missing });
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
        TZ: { rich_text: {} },
        EveryMinutes: { number: {} },
        At: { rich_text: {} },
        Last: { date: {} },
        Note: { rich_text: {} },
        Type: {
            select: {
                options: [
                    { name: "hard", color: "orange" },
                    { name: "soft", color: "blue" },
                ],
            },
        },
    };
}
/**
 * 接管一个已经存在的库：只补缺的字段，不碰已有的。
 * 用户自己先建好了库再来接的情况很常见，不该逼他重建一个。
 */
export async function adoptDatabase(token, databaseId) {
    const db = await notion(token, "GET", `/databases/${databaseId}`);
    const dsId = db.data_sources?.[0]?.id;
    if (!dsId)
        throw new Error("这个库里没有 data source，可能是个链接视图（linked view），换原始库试试。");
    const ds = await notion(token, "GET", `/data_sources/${dsId}`);
    const have = new Set(Object.keys(ds.properties ?? {}));
    const missing = {};
    for (const [k, v] of Object.entries(schema())) {
        // title 字段每个库必有一个，名字不同也不能再加一个，跳过。
        if (k === "Name" || have.has(k))
            continue;
        missing[k] = v;
    }
    if (Object.keys(missing).length) {
        await notion(token, "PATCH", `/data_sources/${dsId}`, { properties: missing });
    }
    dsCache.set(token, dsId);
    return {
        databaseId: db.id,
        dataSourceId: dsId,
        url: db.url,
        added: Object.keys(missing),
        title: plain(db.title),
    };
}
/** 在一个页面下面新建库。 */
export async function createDatabase(token, parentPageId) {
    const db = await notion(token, "POST", "/databases", {
        parent: { type: "page_id", page_id: parentPageId },
        title: text(DB_TITLE),
        icon: { type: "emoji", emoji: "👀" },
        initial_data_source: {
            properties: schema(),
        },
    });
    const dsId = db.data_sources?.[0]?.id;
    if (!dsId)
        throw new Error("建库成功但没拿到 data source id，Notion 的返回变了。");
    dsCache.set(token, dsId);
    return { databaseId: db.id, dataSourceId: dsId, url: db.url };
}
// ---------- task ----------
function parseTask(page) {
    const p = page.properties ?? {};
    return {
        id: page.id,
        sid: plain(p.ID?.rich_text),
        order: p.Order?.number ?? 0,
        task: plain(p.Name?.title),
        note: plain(p.Note?.rich_text),
        tz: plain(p.TZ?.rich_text),
        done: p.Status?.select?.name === STATUS.done,
    };
}
export async function listDay(token, win) {
    const ds = await findDataSource(token);
    const res = await notion(token, "POST", `/data_sources/${ds}/query`, {
        filter: {
            and: [
                { property: "Kind", select: { equals: KIND.task } },
                { property: "Day", date: { on_or_after: win.startUtc } },
                { property: "Day", date: { before: win.endUtc } },
                { property: "Status", select: { does_not_equal: STATUS.dropped } },
            ],
        },
        sorts: [{ property: "Order", direction: "ascending" }],
        page_size: 100,
    });
    return (res.results ?? []).map(parseTask).sort((a, b) => a.order - b.order);
}
async function createTask(token, ds, win, order, task, note, sid, tz) {
    await notion(token, "POST", "/pages", {
        parent: { type: "data_source_id", data_source_id: ds },
        properties: {
            Name: { title: text(task) },
            Kind: { select: { name: KIND.task } },
            ID: { rich_text: text(sid) },
            Order: { number: order },
            Status: { select: { name: STATUS.pending } },
            Day: { date: { start: dayStamp(win) } },
            TZ: { rich_text: text(tz) },
            Note: { rich_text: text(note) },
        },
    });
}
/** 重设今天：旧的扔进回收站，按给的顺序重新写一遍。 */
export async function setDay(token, win, tasks, tz) {
    const ds = await findDataSource(token);
    const old = await listDay(token, win);
    for (const it of old) {
        await notion(token, "PATCH", `/pages/${it.id}`, { in_trash: true });
    }
    const taken = new Set();
    let order = 1;
    for (const t of tasks) {
        await createTask(token, ds, win, order++, t.task, t.note ?? "", mintId("t", taken), tz);
    }
    return listDay(token, win);
}
/** 插一条。position 不给就排到最后；给了就插在那个位置，后面的顺延。 */
export async function addItem(token, win, task, note, position, tz) {
    const ds = await findDataSource(token);
    const items = await listDay(token, win);
    const sid = mintId("t", new Set(items.map((i) => i.sid)));
    if (position === undefined || position > items.length) {
        const last = items.length ? items[items.length - 1].order : 0;
        await createTask(token, ds, win, last + 1, task, note, sid, tz);
        return listDay(token, win);
    }
    const at = Math.max(1, position);
    for (const it of items) {
        if (it.order >= at) {
            await notion(token, "PATCH", `/pages/${it.id}`, {
                properties: { Order: { number: it.order + 1 } },
            });
        }
    }
    await createTask(token, ds, win, at, task, note, sid, tz);
    return listDay(token, win);
}
export async function setStatus(token, win, position, status) {
    const items = await listDay(token, win);
    const hit = items.find((i) => i.order === position);
    if (!hit)
        return { items, hit: undefined };
    await notion(token, "PATCH", `/pages/${hit.id}`, {
        properties: { Status: { select: { name: STATUS[status] } } },
    });
    return { items: await listDay(token, win), hit };
}
export const current = (items) => items.find((i) => !i.done);
// ---------- habit ----------
function parseHabit(page, now) {
    const p = page.properties ?? {};
    const last = p.Last?.date?.start;
    const everyMin = p.EveryMinutes?.number ?? 0;
    const at = plain(p.At?.rich_text) || undefined;
    const tz = plain(p.TZ?.rich_text);
    const overdue = overdueMinutes({ id: page.id, every_minutes: everyMin, last, at, tz }, now);
    return {
        id: page.id,
        sid: plain(p.ID?.rich_text),
        name: plain(p.Name?.title),
        everyMin,
        at,
        last,
        tz,
        kind: p.Type?.select?.name === "soft" ? "soft" : "hard",
        overdueMin: overdue ?? -1,
    };
}
async function allHabits(token) {
    const ds = await findDataSource(token);
    const res = await notion(token, "POST", `/data_sources/${ds}/query`, {
        filter: { property: "Kind", select: { equals: KIND.habit } },
        page_size: 100,
    });
    const now = Date.now();
    return (res.results ?? []).map((p) => parseHabit(p, now)).filter((h) => h.name);
}
/** 名字模糊匹配，模型说「喝水」「喝了水」都认。本地存储也用这一个。 */
export function findHabit(habits, name) {
    const needle = name.trim();
    return habits.find((h) => h.sid === needle) ??
        habits.find((h) => h.name === needle) ??
        habits.find((h) => h.name.includes(needle) || needle.includes(h.name)) ??
        habits.find((h) => inOrder(h.name, needle)); // 「喝了水」里按顺序有「喝」「水」
}
const inOrder = (name, text) => {
    let i = 0;
    for (const ch of text) if (ch === name[i]) i++;
    return name.length > 0 && i === name.length;
};
export async function listHabits(token) {
    return allHabits(token);
}
/** 现在有哪些该做了。库还没建就当没这回事，不要因此挡住 check_focus。 */
export async function overdueHabits(token) {
    let habits;
    try {
        habits = await allHabits(token);
    }
    catch {
        return [];
    }
    return habits.filter((h) => h.overdueMin > 0).sort((a, b) => b.overdueMin - a.overdueMin);
}
/**
 * every 和 at 二选一：隔多久一次，或者每天几点（HH:MM，按 tz 算）。
 * kind：hard = 可以说「今天不做」（健身这种）；soft = 不许跳过，到点就催到做了为止（喝水这种）。
 */
export async function addHabit(token, name, everyMinutes, note, tz, at, kind = "hard") {
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
            At: { rich_text: text(at ?? "") },
            Last: { date: { start: nowUtc() } },
            TZ: { rich_text: text(tz) },
            Note: { rich_text: text(note) },
            Type: { select: { name: kind === "soft" ? "soft" : "hard" } },
        },
    });
    return allHabits(token);
}
/**
 * 记一笔「刚做了」—— 或者「今天跳过」：两种都是把 Last 写成现在，区别只在 note 里写没写原因。
 * 软习惯不许跳过：skip=true 时原样返回并带 refused，什么都不写，下次照样催。
 */
export async function logHabit(token, name, tz, note, skip = false) {
    const hit = findHabit(await allHabits(token), name);
    if (!hit)
        return undefined;
    if (skip && hit.kind === "soft")
        return { ...hit, refused: true };
    const at = nowUtc();
    await notion(token, "PATCH", `/pages/${hit.id}`, {
        properties: {
            Last: { date: { start: at } },
            TZ: { rich_text: text(tz) },
            ...(note === undefined ? {} : { Note: { rich_text: text(note) } }),
        },
    });
    return { ...hit, overdueMin: -1, last: at };
}
