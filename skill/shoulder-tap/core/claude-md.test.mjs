// 装的时候 CLAUDE.md 怎么改：新装整段追加；已经有「## 专注」只插 / 换带标记的块，用户自己写的字不动。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeFocusSection } from "./claude-md.mjs";

const snippet = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "CLAUDE.md.snippet"), "utf8");
const RULE = "每轮回答的第一行就是这轮的结论";

// 新装
const fresh = mergeFocusSection("# 我的规矩\n\n别用 tab。\n", snippet);
assert.ok(fresh.startsWith("# 我的规矩\n\n别用 tab。\n\n## 专注"));
assert.equal(fresh.split(RULE).length, 2);
assert.ok(!fresh.includes("把这几行粘进"), "给人看的说明不进 CLAUDE.md");

// 老用户：有自己改过的「## 专注」，没有块 → 块插在标题下面，别的原样
const mine = "## 专注\n\n我装了 `shoulder-tap`，而且我自己加了一条：别叫我休息。\n- 手前面那句话就是这轮的总结。\n\n## 别的\nx\n";
const merged = mergeFocusSection(mine, snippet);
assert.ok(merged.startsWith("## 专注\n\n<!-- shoulder-tap:first-line -->\n"));
assert.ok(merged.includes("别叫我休息") && merged.includes("手前面那句话就是这轮的总结") && merged.endsWith("## 别的\nx\n"));
assert.equal(merged.split(RULE).length, 2);

// 再装一次：不重复
assert.equal(mergeFocusSection(merged, snippet), merged);

// 块里是旧内容：换成新的，块外不动
const stale = merged.replace(/(<!-- shoulder-tap:first-line -->\n)[\s\S]*?(<!-- \/shoulder-tap:first-line -->)/, "$1- 旧规则\n$2");
assert.equal(mergeFocusSection(stale, snippet), merged);

// CRLF 的文件：装两次也只有一个块，换行保持 CRLF
const crlf = mergeFocusSection(mine.replace(/\n/g, "\r\n"), snippet);
assert.equal(mergeFocusSection(crlf, snippet), crlf);
assert.ok(!/[^\r]\n/.test(crlf));

// 替换内容里的 $ 不被当成正则替换符
assert.ok(mergeFocusSection(mine, snippet.replace("不带 markdown", "不带 $1 markdown")).includes("不带 $1 markdown"));
console.log("claude-md ok");
