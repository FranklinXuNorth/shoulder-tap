/**
 * Jev（TypeSafe AI 的 System One 模型）—— 不生成文本，只做有类型的决策。
 * 拿它判「现在做的事和当前任务有没有关系」，70-500ms 出一个三选一。
 *
 * 注意这条路径的代价：调用它意味着两行文字（用户现在要做什么、当前那条任务）
 * 会经过这台 Worker，再到 TypeSafe AI。零内容路径（focus_protocol + 模型自己判）
 * 不付这个代价。所以这个工具只在配了 JEV_API_KEY 时才存在，默认不开。
 */

/**
 * 默认走 TypeSafe 官方。key 是从别的地方拿的（OpenRouter、Vercel AI Gateway、
 * 各种转售网关）就必须改成对应的 base —— key 和 base 对不上就是 401，
 * 这个错看起来像密钥失效，其实只是敲错了门。
 */
const BASE = process.env.JEV_BASE_URL || "https://api.typesafe.ai";
const ENDPOINT = `${BASE.replace(/\/+$/, "")}/v1/systemone`;

export const JEV_ON = !!process.env.JEV_API_KEY;

export type Relation = "related" | "partial" | "unrelated";

export type Judgement = {
  relation: Relation;
  confidence: number;
};

const CRITERIA: Record<Relation, string> = {
  related:
    "用户现在要做的这件事，就是当前这条或今天清单上其它还没做完的某一条本身，或者是完成它必须先走的一步。",
  partial:
    "沾边但不是清单上的任何一条本身：是某条任务的外围、准备工作、顺带的事。",
  unrelated:
    "和今天清单上的任何一条都对不上，是计划之外的事。",
};

export async function judge(
  activity: string,
  currentTask: string,
  otherTasks: string[] = [],
): Promise<Judgement> {
  const key = process.env.JEV_API_KEY;
  if (!key) throw new Error("没配 JEV_API_KEY，这条路径没开。");

  const state = [
    `当前这条任务：${currentTask}`,
    otherTasks.length ? `今天清单上其它的：${otherTasks.join("；")}` : "今天清单上没有别的了。",
    `用户现在要做：${activity}`,
  ].join("\n");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state,
      questions: {
        relation: {
          type: "choice",
          instructions:
            "用户现在要做的这件事，和他今天说好的任务（当前这条以及清单上其它没做完的）是什么关系？" +
            "按语义上的真实相关判断，不要只看字面像不像。",
          criteria: CRITERIA,
        },
      },
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Jev 返回 ${res.status}：${body.slice(0, 200)}`);

  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`看不懂 Jev 的回复：${body.slice(0, 200)}`);
  }

  const ans = parsed?.answers?.relation;
  const relation = ans?.choice as Relation | undefined;
  if (!relation || !(relation in CRITERIA)) {
    throw new Error(`Jev 给了个没见过的档位：${JSON.stringify(ans).slice(0, 160)}`);
  }

  return { relation, confidence: Number(ans.confidence ?? 0) };
}

/** 三档各自该怎么办。措辞跟 protocol.ts 里那套保持一致，不能两头说不一样的话。 */
export const WHAT_TO_DO: Record<Relation, string> = {
  related:
    "直接干活。不要提这次检查，不要念清单。不要自己认定它做完了 —— 只有用户明确说完成，才去改 Status。",
  partial:
    "可以做，但先用一句话点破：前面那条还没完，这件事算插进来还是先放着？一句话就够，他答了就照办。",
  unrelated:
    "照做，别拦他，但把整个回答压到两句话以内 —— 长度本身就是阻力。" +
    "动清单本身的请求（增、删、勾掉、重排）不受这条限制，照常做完整，" +
    "否则他跑偏时连「加进清单」都说不出口。" +
    "然后在回答最末尾打出那只手，一句话点名今天说好的那条还没动。" +
    "不问问题、不等回答；只要那条没完成，每一轮都这么收尾。",
};
