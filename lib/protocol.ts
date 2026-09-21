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
    "  从用户自己的 Notion 里读那个 Shoulder Tap 库：",
    "    Kind=task 且 Day=今天 且 Status≠dropped，按 Order 升序 → 这是今天说好要做的事。",
    "    当前这条 = 第一个 Status≠done 的。",
    "    Kind=habit 的行 → 每条有 ID、EveryMinutes、Last。",
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
    "    → **照做。** 他要你干什么就干什么，干完整、干好，不要在开头拦他，",
    "      不要先问「你确定吗」，也不要因为这个少做一步。他是成年人，他的时间他说了算。",
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
    "  把 habit 行的 id / every_minutes / last 传给 due_check，它回哪些 ID 到点了。",
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
    "  用户说他做了，就去 Notion 把那行的 Last 更新成现在。他没说做，就是没做。",
    "",
    "什么时候走这套：新会话里第一次要做实质性的事；会话中途冒出明显不同的新任务。",
    "琐碎的追问不用每次都走。",
  ].join("\n");
}

/** 只认 ID 和数字的到期判断。名字、备注、你今天干了什么，这里一概收不到。 */
export type DueInput = { id: string; every_minutes: number; last?: string };
export type DueOut = { id: string; overdue_minutes: number };

export function whatIsDue(items: DueInput[], now = Date.now()): DueOut[] {
  return items
    .map((h) => {
      const every = Number(h.every_minutes);
      if (!Number.isFinite(every) || every <= 0) return undefined;
      const since = h.last ? Math.floor((now - Date.parse(h.last)) / 60000) : Infinity;
      const overdue = since - every;
      return overdue > 0
        ? { id: h.id, overdue_minutes: Number.isFinite(overdue) ? overdue : -1 }
        : undefined;
    })
    .filter((x): x is DueOut => !!x)
    .sort((a, b) => b.overdue_minutes - a.overdue_minutes);
}

/** 给桌面 overlay 的事件。message 由客户端填，服务端不生成任何文字内容。 */
export function tapEvent(kind: TapKind, ids: string[]) {
  return { kind, ids };
}
