// node core/strings.test.mjs —— 中英两份字对不对得上，页面那边有没有留第二份。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STRINGS } from "./strings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const zh = Object.keys(STRINGS.zh).sort();
const en = Object.keys(STRINGS.en).sort();

assert.deepEqual(zh, en, "两种语言的 key 得一一对上：少一条，那句话在那个语言下就会变成 undefined");
for (const k of zh) {
  assert.equal(typeof STRINGS.zh[k], typeof STRINGS.en[k], `${k}：两边得同是字符串或同是函数`);
  if (typeof STRINGS.zh[k] === "function") assert.equal(STRINGS.zh[k].length, STRINGS.en[k].length, `${k}：两边的参数个数得一样`);
  else assert.ok(STRINGS.zh[k] && STRINGS.en[k], `${k}：不能是空的`);
}

// 页面那份是发的时候内联进去的（onboard.mjs 替换这行标记），所以标记得在，字典不能再有第二份。
const page = fs.readFileSync(path.join(HERE, "..", "ui", "app.html"), "utf8");
assert.ok(page.includes("// __STRINGS__"), "app.html 里的 // __STRINGS__ 标记没了，页面就拿不到字");
assert.ok(page.includes("const T = STRINGS;"), "app.html 得用内联进去的 STRINGS");
assert.ok(!/const T = \{/.test(page), "app.html 里不该再有第二份字典");

// 内联是把 export 去掉当普通 const 用的：这个文件只能有一处 export，也不能 import 别的（浏览器那边没有）。
const src = fs.readFileSync(path.join(HERE, "strings.mjs"), "utf8");
assert.equal(src.match(/^export /gm)?.length, 1, "strings.mjs 只能有一处 export");
assert.equal(src.match(/^import /gm), null, "strings.mjs 不能 import：它要整段塞进浏览器");

console.log("strings：", zh.length, "条 × 2 种语言，对得上。");
