/**
 * 两件跟「什么时候」有关的小事：一天从几点开始，习惯到点了没有。
 * 纯算术，只看时间和分钟数。
 */
/**
 * 一天从几点开始。
 * 你 23:00 列好清单，干到凌晨一点 —— 按午夜切的话，清单会在你眼前翻页，
 * 今天说好的事忽然变成"昨天"的，当前这条也没了。那不是新的一天，那是同一个晚上。
 * 默认 4 点：熬夜的人还在昨天，早起的人已经在今天。
 */
export function dayStartHour() {
    const raw = process.env.DAY_STARTS_AT_HOUR;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 && n < 12 ? n : 4;
}
/**
 * 固定时刻的习惯：「今天的 HH:MM」过了没有。过了就回那个瞬时，没过回 undefined。
 * 「今天」按 dayStartHour 切：22:30 的健身，到凌晨四点前都还算今天没做，四点一过就翻篇，
 * 不会第二天一早还在催昨晚的事。
 */
function todayDueAt(at, tz, now) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
    if (!m)
        return undefined;
    let wall;
    try {
        wall = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));
    }
    catch {
        return undefined; // 时区名不认识，宁可不提醒
    }
    const [h, mi] = wall.split(":").map(Number);
    const start = dayStartHour() * 60;
    const roll = (min) => (min < start ? min + 1440 : min); // 凌晨那几小时算前一天的延长
    const nowMin = roll(h * 60 + mi);
    const atMin = roll(Number(m[1]) * 60 + Number(m[2]));
    // ponytail: 按分钟差回推，夏令时切换那天会差一小时；真在意再用 wallToUtc 算
    return nowMin >= atMin ? now - (nowMin - atMin) * 60000 : undefined;
}
/** 超了多少分钟；没到就是 undefined。从没记录过的间隔制习惯回 Infinity。 */
export function overdueMinutes(h, now = Date.now()) {
    if (h.at) {
        const due = todayDueAt(h.at, h.tz || "UTC", now);
        if (due === undefined)
            return undefined;
        if (h.last && Date.parse(h.last) >= due)
            return undefined; // 今天做过了（或跳过了）
        return Math.max(1, Math.floor((now - due) / 60000));
    }
    const every = Number(h.every_minutes);
    if (!Number.isFinite(every) || every <= 0)
        return undefined;
    const since = h.last ? Math.floor((now - Date.parse(h.last)) / 60000) : Infinity;
    return since - every > 0 ? since - every : undefined;
}
export function whatIsDue(items, now = Date.now()) {
    return items
        .map((h) => {
        const overdue = overdueMinutes(h, now);
        return overdue === undefined
            ? undefined
            : { id: h.id, overdue_minutes: Number.isFinite(overdue) ? overdue : -1 };
    })
        .filter((x) => !!x)
        .sort((a, b) => b.overdue_minutes - a.overdue_minutes);
}
