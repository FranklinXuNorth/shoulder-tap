// Hermes 的 config.yaml 按行改：在临时 HERMES_HOME 里过一遍增删，别的内容一个字不能动。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HERMES_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "st-hermes-"));
const { addToHermes, removeFromHermes, hermesConnected, hermesConfig } = await import("./other-agents.mjs");
const f = hermesConfig();
const read = () => fs.readFileSync(f, "utf8");
const put = (s) => fs.writeFileSync(f, s);
const win = "C:\\Users\\a b\\mcp.mjs";

addToHermes("node", win); // 文件不存在
assert.equal(read(), `mcp_servers:\n  shoulder-tap:\n    command: "node"\n    args: ["C:\\\\Users\\\\a b\\\\mcp.mjs"]\n`);
assert.ok(hermesConnected());

put("model: x\nmcp_servers:\n    github:\n        command: gh\nother: 1\n"); // 已有别的服务器，4 格缩进
addToHermes("node", "/m.mjs");
assert.equal(read(), 'model: x\nmcp_servers:\n    shoulder-tap:\n      command: "node"\n      args: ["/m.mjs"]\n    github:\n        command: gh\nother: 1\n');
addToHermes("node2", "/n.mjs"); // 再接一次：换掉，不重复
assert.equal(read().match(/shoulder-tap/g).length, 1);
assert.ok(read().includes('"node2"'));
removeFromHermes();
assert.equal(read(), "model: x\nmcp_servers:\n    github:\n        command: gh\nother: 1\n");

put("mcp_servers: {}\nx: 1\n"); // 行内空表
addToHermes("node", "/m.mjs");
assert.ok(hermesConnected());
removeFromHermes();
assert.equal(read(), "mcp_servers: {}\nx: 1\n");
assert.equal(removeFromHermes(), null);
console.log("other-agents ok");
