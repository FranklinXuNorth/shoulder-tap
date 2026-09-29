// Hermes 已停止接入，只剩卸载清理：config.yaml 按行删 shoulder-tap 那一段，别的内容一个字不能动。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HERMES_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "st-hermes-"));
const { removeFromHermes, hermesConfig } = await import("./other-agents.mjs");
const f = hermesConfig();
const read = () => fs.readFileSync(f, "utf8");
const put = (s) => fs.writeFileSync(f, s);

assert.equal(removeFromHermes(), null); // 文件不存在：什么都不做

put('model: x\nmcp_servers:\n    shoulder-tap:\n      command: "node"\n      args: ["/m.mjs"]\n    github:\n        command: gh\nother: 1\n'); // 以前接过，旁边还有别的服务器，4 格缩进
assert.equal(removeFromHermes(), f);
assert.equal(read(), "model: x\nmcp_servers:\n    github:\n        command: gh\nother: 1\n");

put('mcp_servers:\n  shoulder-tap:\n    command: "node"\n    args: ["C:\\\\Users\\\\a b\\\\mcp.mjs"]\nx: 1\n'); // 只有它一个：删完写成空表
removeFromHermes();
assert.equal(read(), "mcp_servers: {}\nx: 1\n");
assert.equal(removeFromHermes(), null);
console.log("other-agents ok");
