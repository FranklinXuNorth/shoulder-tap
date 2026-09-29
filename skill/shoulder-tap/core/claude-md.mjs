/**
 * ~/.claude/CLAUDE.md 里「## 专注」那一节怎么更新。
 *
 * 那一节装上之后多半被用户改过（加了自己的规矩），整节覆盖会把他的话抹掉，所以只认 snippet 里
 * 带标记的块（<!-- shoulder-tap:xxx --> … <!-- /shoulder-tap:xxx -->）：
 *   - 没有这一节：整段 snippet 追加到文件尾
 *   - 有这一节、有这个块：只换块里的内容
 *   - 有这一节、没这个块：把块插在「## 专注」标题下面第一行（新规矩放最前，模型先读到）
 * 块外面的字一个都不动。卸载时整节删掉，块在节里，跟着一起走。
 */
const BLOCK = /<!-- shoulder-tap:([\w-]+) -->\n[\s\S]*?<!-- \/shoulder-tap:\1 -->\n?/g;

export function mergeFocusSection(have, snippet) {
  // Windows 上编辑器可能存成 CRLF：按 LF 处理，出去时还原，否则第二次装认不出已有的块，会插重复
  if (have.includes("\r\n")) return mergeFocusSection(have.replace(/\r\n/g, "\n"), snippet).replace(/\n/g, "\r\n");
  snippet = snippet.replace(/\r\n/g, "\n");
  const body = snippet.replace(/^<!--[\s\S]*?-->\s*/, ""); // 去掉 snippet 顶上给人看的说明
  if (!have.includes("## 专注")) return have.trimEnd() + (have.trim() ? "\n\n" : "") + body.trimEnd() + "\n";
  let out = have;
  for (const [block, name] of body.matchAll(BLOCK)) {
    const fresh = block.endsWith("\n") ? block : block + "\n";
    const old = new RegExp(`<!-- shoulder-tap:${name} -->\\n[\\s\\S]*?<!-- \\/shoulder-tap:${name} -->\\n?`);
    out = old.test(out) ? out.replace(old, () => fresh) : out.replace(/## 专注[^\n]*\n(\s*\n)?/, (h) => h + fresh + "\n");
  }
  return out;
}
