/**
 * 这个文件是整个服务真正的产品。
 *
 * 服务端不碰任何用户内容：任务文字、习惯名字、你说了什么，全都不经过这里。
 * 它只交付两样东西 ——
 *   1. 一套判断规程（下面这段），告诉模型动手之前该拿什么和什么比、比出三档怎么办；
 *   2. 一个纯算术的到期判断（只收 ID 和分钟数）。
 * 数据在你自己的 Notion 里，语义判断在你自己机器上的模型脑子里。
 */

import { offTaskBanner } from "./ascii";

/**
 * 规程里要原样贴出去的那只手。故意不缩进 —— 既然要求「一个字符都不要改」，
 * 就不能先自己给它加六格空格。
 */
const HAND_BLOCK = offTaskBanner();

export const VERDICTS = ["related", "partial", "unrelated"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** 两种 tap，共用同一个敲屏幕动作。和 docs/ASSETS.md 里的事件契约对齐。 */
export type TapKind = "off-task" | "due";

export function protocolText(): string {
  return [
    "【shoulder-tap 规程】动手之前先走这三步。",
    "",
    "第一步 · 取数据（服务端不参与，它看不到你的任何内容）",
    "",
    "  先算清楚「今天」是哪天。这一步错了，后面全错 —— 他会查到空的一天，",
    "  然后被告诉「你今天还没记录任何事」，而他明明早上刚列过。",
    "",
    "    · **先确定用户的真实时区**，用 IANA 名字。你跑在他机器上，直接读：",
    "        Intl.DateTimeFormat().resolvedOptions().timeZone   （node -p 一行就出来）",
    "      读不到就问他一句。**不要猜，也不要用你上下文里的日期** —— 那多半是 UTC，差一天。",
    "    · 调 shoulder-tap 的工具时**每次都把 tz 传上**。返回里会回显用了哪个时区，",
    "      对不上就是传错了，当场能看见。",
    "    · **一天从凌晨 4 点开始，不是午夜。** 本地 01:30 还算前一天 ——",
    "      他 23 点列的清单，不该在他还没睡的时候翻页。",
    "    · **写进 Notion 的时间一律是 UTC**（ISO 的 Z 结尾）。不要存本地日期、",
    "      也不要存带偏移的时间戳 —— 那等于把「当时人在哪」腌进数据里，他一飞就错。",
    "      「今天」是读的时候按他当下的时区算出来的，不是存下来的。",
    "    · TZ 字段只记录「写这行时他在哪个时区」，是给人看的线索，不参与筛选。",
    "",
    "  然后从用户自己的 Notion 里读那个 Shoulder Tap 库：",
    "    Kind=task 且 Day=今天 且 Status≠dropped，按 Order 升序 → 这是今天说好要做的事。",
    "    当前这条 = 第一个 Status≠done 的。",
    "    Kind=habit 的行 → 每条有 ID、EveryMinutes 或 At（每天几点，HH:MM）、Last、TZ。",
    "",
    "第二步 · 判一档（你自己判，这里没有第二个模型替你判）",
    "  拿「用户现在要做的这件事」去比「当前这条任务」，只出三档之一：",
    "",
    "  related（有关）—— 就是当前这条，或者是完成它必需的一步。",
    "    → 直接干活。不要提这次检查，不要念清单，不要邀功。",
    "    → 不要自己认定它做完了。只有用户明确说完成，才去 Notion 里把 Status 改成 done。",
    "",
    "  partial（部分有关）—— 沾边但不是当前这条：清单里靠后的某条，或者当前这条的外围。",
    "    → 可以做，但先用一句话点破：前面第 N 条还没完，这件事算插进来还是先放着？",
    "    → 一句话就够，他答了就照办，别追问第二遍。",
    "",
    "  unrelated（完全无关）—— 跟今天说好的任何一条都对不上。",
    "    → **照做，但把答案压短。** 不要在开头拦他，不要先问「你确定吗」 ——",
    "      他是成年人，他的时间他说了算。给他要的那个东西，但**整个回答不超过两句话**：",
    "      跑偏的时候他要的是一个够用的答案，不是一份完整的作业。长度本身就是阻力。",
    "",
    "    → **例外：动清单本身的请求不受这条限制。** 加一条、删一条、勾掉一条、重排，",
    "      照常做完整。没有这个例外，规则就成了陷阱 —— 他跑偏的时候连「把这条加进",
    "      今天的清单」都说不出口。他明说「这条好好做」也一样，那是他重新排了优先级。",
    "",
    "    → 但是干完之后，在回答的**最末尾**，原样打出这只手（代码块，一个字符都不要改）：",
    "",
    HAND_BLOCK,
    "",
    "      然后一句话，点名今天说好的那条还没动。一句，不要两句。",
    "      不问问题、不等回答、不要求他解释 —— 他不欠你一个理由。",
    "",
    "    → **只要那条还没完成，每一轮都提。** 他做十件无关的事，你就提十次。",
    "      烦是故意的：一个提一次就算了的提醒，等于没提醒。",
    "      但每次只能是最后那一句 —— 烦在频率，不在长度。",
    "",
    "    → 什么时候停：他改了优先级（set_focus 重排 / add_focus 插队）、",
    "      说那条做完了（Status 改 done）、或者说「今天不做了」（改成 dropped）。",
    "      他说「别烦我」就这一轮别提，下一轮照提 —— 除非他说的是「今天都别提了」。",
    "",
    "  判断标准是语义上的真实相关，不是字面相似。拿不准就按 unrelated 处理：",
    "  拦下来问一句的代价，远小于替他把跑偏的事干完。",
    "",
    "第三步 · 查到期（调用 due_check，只传 ID 和数字，不传名字）",
    "  把 habit 行的 id / every_minutes / at / tz / last 传给 due_check，它回哪些 ID 到点了。",
    "",
    "  **到点了不等于现在就说。** 习惯提醒不是打断，找这两个时机之一：",
    "    · 一条任务刚做完的时候 —— 本来就是个停顿，顺口带一句。",
    "    · 长任务做到一半、有自然停顿的时候 —— 比如一段跑完了、在等你确认下一步。",
    "  正在往下推进的半句话中间，不要插。宁可这一轮不提，下一轮再说。",
    "",
    "  说的时候也打这只手，然后一句话，不说教、不追问、不因为它停下正事：",
    "",
    HAND_BLOCK,
    "",
    "  用户说他做了、或者今天跳过，就去 Notion 把那行的 Last 更新成现在（跳过的原因写进 Note）。他没说，就是没做。",
    "",
    "什么时候走这套：新会话里第一次要做实质性的事；会话中途冒出明显不同的新任务。",
    "琐碎的追问不用每次都走。",
  ].join("\n");
}

/**
 * 一天从几点开始。
 * 你 23:00 列好清单，干到凌晨一点 —— 按午夜切的话，清单会在你眼前翻页，
 * 今天说好的事忽然变成"昨天"的，当前这条也没了。那不是新的一天，那是同一个晚上。
 * 默认 4 点：熬夜的人还在昨天，早起的人已经在今天。
 */
export function dayStartHour(): number {
  const raw = process.env.DAY_STARTS_AT_HOUR;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 12 ? n : 4;
}

/** 只认 ID 和数字的到期判断。名字、备注、你今天干了什么，这里一概收不到。 */
export type DueInput = { id: string; every_minutes?: number; last?: string; at?: string; tz?: string };
export type DueOut = { id: string; overdue_minutes: number };

/**
 * 固定时刻的习惯：「今天的 HH:MM」过了没有。过了就回那个瞬时，没过回 undefined。
 * 「今天」按 dayStartHour 切：22:30 的健身，到凌晨四点前都还算今天没做，四点一过就翻篇，
 * 不会第二天一早还在催昨晚的事。
 */
function todayDueAt(at: string, tz: string, now: number): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!m) return undefined;
  let wall: string;
  try {
    wall = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));
  } catch {
    return undefined; // 时区名不认识，宁可不提醒
  }
  const [h, mi] = wall.split(":").map(Number);
  const start = dayStartHour() * 60;
  const roll = (min: number) => (min < start ? min + 1440 : min); // 凌晨那几小时算前一天的延长
  const nowMin = roll(h * 60 + mi);
  const atMin = roll(Number(m[1]) * 60 + Number(m[2]));
  // ponytail: 按分钟差回推，夏令时切换那天会差一小时；真在意再用 wallToUtc 算
  return nowMin >= atMin ? now - (nowMin - atMin) * 60000 : undefined;
}

/** 超了多少分钟；没到就是 undefined。从没记录过的间隔制习惯回 Infinity。 */
export function overdueMinutes(h: DueInput, now = Date.now()): number | undefined {
  if (h.at) {
    const due = todayDueAt(h.at, h.tz || "UTC", now);
    if (due === undefined) return undefined;
    if (h.last && Date.parse(h.last) >= due) return undefined; // 今天做过了（或跳过了）
    return Math.max(1, Math.floor((now - due) / 60000));
  }
  const every = Number(h.every_minutes);
  if (!Number.isFinite(every) || every <= 0) return undefined;
  const since = h.last ? Math.floor((now - Date.parse(h.last)) / 60000) : Infinity;
  return since - every > 0 ? since - every : undefined;
}

export function whatIsDue(items: DueInput[], now = Date.now()): DueOut[] {
  return items
    .map((h) => {
      const overdue = overdueMinutes(h, now);
      return overdue === undefined
        ? undefined
        : { id: h.id, overdue_minutes: Number.isFinite(overdue) ? overdue : -1 };
    })
    .filter((x): x is DueOut => !!x)
    .sort((a, b) => b.overdue_minutes - a.overdue_minutes);
}

/** 给桌面 overlay 的事件。message 由客户端填，服务端不生成任何文字内容。 */
export function tapEvent(kind: TapKind, ids: string[]) {
  return { kind, ids };
}
