import { Habit, Item, current } from "./focus";
import { offTaskBanner } from "./ascii";

/** 把今天的清单画出来。当前那条用 ▸ 标出来，模型和人都一眼能看见。 */
export function renderPlan(items: Item[], day: string): string {
  if (!items.length) return `${day}：还没有记录任何事。`;

  const cur = current(items);
  const lines = items.map((i) => {
    const mark = i.done ? "✓" : i.id === cur?.id ? "▸" : " ";
    const tail = i.id === cur?.id ? "   ← 现在该做这条" : "";
    const note = i.note ? `\n      备注：${i.note}` : "";
    return `  ${mark} ${i.order}. ${i.task}${tail}${note}`;
  });

  const done = items.filter((i) => i.done).length;
  return `${day} 说好要做的事：\n${lines.join("\n")}\n\n进度 ${done}/${items.length}`;
}

/** 身体上的提醒。这块语气要轻：提一句，他说无视就无视。 */
export function renderHabits(habits: Habit[]): string {
  if (!habits.length) return "";
  return [
    "",
    "【顺便提一句】",
    ...habits.map(
      (h) => `  · ${h.name} —— 超了 ${h.overdueMin} 分钟（说好${h.at ? `每天 ${h.at}` : `每 ${h.everyMin} 分钟一次`}）`,
    ),
    "**不要现在就说。** 等当前这条任务做完、或者长任务做到一半有自然停顿时，再打出那只手加一句话：",
    "",
    offTaskBanner(),
    "",
    "一句话就够。不说教、不追问、不为这个打断正在推进的事。",
    "他说做了就调用 log_habit 记一笔；他说别烦我，这次就别提了。",
  ].join("\n");
}

/** check_focus 的返回。真正干活的是这段给模型看的判断规则。 */
export function renderCheck(
  items: Item[],
  day: string,
  activity?: string,
  habits: Habit[] = [],
): string {
  const plan = renderPlan(items, day);
  const nudge = renderHabits(habits);

  if (!items.length) {
    return [
      plan,
      "",
      "【你要做什么】用户今天还没说过要做什么，所以现在没有东西可以拦他。",
      "先问一句「今天打算做哪几件事」，他说完之后用 set_focus 按先后顺序记下来，然后正常干活。",
      nudge,
    ].join("\n");
  }

  const cur = current(items);
  if (!cur) {
    return [
      plan,
      "",
      "【你要做什么】今天说好的事已经全部做完了。放行，正常帮他。",
      activity
        ? `如果「${activity}」是他想新加的事，问一句要不要用 add_focus 加进今天。`
        : "可以问一句还要不要加点别的。",
      nudge,
    ].join("\n");
  }

  if (!activity) {
    return [
      plan,
      "",
      `【你要做什么】当前这条是第 ${cur.order} 条：${cur.task}`,
      "把它告诉用户，然后按这条来推进。",
      "勾掉这条的权力在用户手上：他明确说做完了，你才调用 complete_focus。",
      nudge,
    ].join("\n");
  }

  return [
    plan,
    "",
    `用户现在要做的是：「${activity}」`,
    "",
    `【先判断，再动手】这件事和当前第 ${cur.order} 条「${cur.task}」是不是同一件事，或者是完成它必需的一步？`,
    "",
    `A. 是 → 直接继续帮他，不要提这次检查，也不要念清单。`,
    `   但不要自己认定这条做完了：只有用户明确说完成了，才调用 complete_focus(${cur.order})。` +
      "你觉得像是做完了，最多问一句「这条算完成了吗」，然后等他回答。",
    "",
    `B. 不是，但它是清单里靠后的某一条 → 不要动手。告诉他前面第 ${cur.order} 条还没做完，` +
      "问他是先做完那条，还是确实要改顺序（改的话用 set_focus 重排）。等他回答。",
    "",
    "C. 完全不在清单里 → **照做，别拦他。** 他要什么就给什么，干完整，不要在开头质询。",
    "   干完之后，在回答的最末尾原样打出这只手（代码块，一个字符都别改）：",
    "",
    offTaskBanner(),
    "",
    `   然后一句话，点名第 ${cur.order} 条「${cur.task}」还没动。一句就好，不问问题、不等回答。`,
    "   **只要那条没完成，每一轮都提。** 烦是故意的 —— 提一次就算了的提醒等于没提醒；" +
      "但烦在频率，不在长度。",
    `   他改优先级（set_focus / add_focus）、说第 ${cur.order} 条做完了（complete_focus）、` +
      "或者说今天不做了（dropped），就不用再提。",
    "",
    "判断标准是语义上的真实相关，不是字面相似。拿不准就按 C 处理：反正也不拦他，代价只是末尾多一句。",
    nudge,
  ].join("\n");
}
