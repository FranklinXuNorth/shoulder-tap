import { Habit, Item, current } from "./focus";

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
      (h) => `  · ${h.name} —— 超了 ${h.overdueMin} 分钟（说好每 ${h.everyMin} 分钟一次）`,
    ),
    "在你正常回答的最后轻轻带一句就行，一句话。不要说教、不要追问、不要为这个打断正事。",
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
    "C. 完全不在清单里 → 不要动手，也不要帮他做任何一步。直接说出来：他正在偏离今天说好的事。" +
      `复述当前这条（第 ${cur.order} 条：${cur.task}），然后问他——这是必须插队的急事（那就用 add_focus 加进来），` +
      "还是他其实该回去做这条？等他回答。",
    "",
    "判断标准是语义上的真实相关，不是字面相似。拿不准就按 C 处理：拦下来问他，这正是他装这个东西的原因。",
    nudge,
  ].join("\n");
}
