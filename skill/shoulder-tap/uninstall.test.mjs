// 在临时 HOME 里演一遍卸载：装好的样子先摆出来，跑完看还剩什么。PATH 清空，claude / powershell / launchctl 都找不到，只看文件。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "st-uninstall-"));
const claude = path.join(home, ".claude");
const skills = path.join(claude, "skills");
fs.cpSync(path.join(repo, "skill", "shoulder-tap"), path.join(skills, "shoulder-tap"), { recursive: true });
fs.cpSync(path.join(repo, "skill", "shoulder-tap-uninstall"), path.join(skills, "shoulder-tap-uninstall"), { recursive: true });
fs.mkdirSync(path.join(claude, "shoulder-tap", "app"), { recursive: true });
fs.writeFileSync(path.join(claude, "shoulder-tap", "data.json"), "{}");
fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify({
  permissions: { allow: ["x"] },
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: 'node "$HOME/.claude/skills/shoulder-tap/watch.mjs"' }] }, { hooks: [{ type: "command", command: "echo other" }] }],
    PreToolUse: [{ matcher: "AskUserQuestion", hooks: [{ type: "command", command: 'node "$HOME/.claude/skills/shoulder-tap/watch.mjs"' }] }],
  },
}));
fs.writeFileSync(path.join(claude, "CLAUDE.md"), "# mine\n\nkeep this\n\n## 专注\n\n拍拍的规则\n- 一条\n\n## 别的\n\n也留着\n");
fs.mkdirSync(path.join(home, ".codex"));
fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "x"\n\n[mcp_servers.shoulder-tap]\ncommand = "node"\nargs = ["a"]\n\n[mcp_servers.other]\ncommand = "y"\n');

// Claude Desktop（普通版的位置）：接上过 shoulder-tap，还有别的服务器和偏好设置
const appdata = path.join(home, "AppData", "Roaming"), local = path.join(home, "AppData", "Local");
const desk = path.join(appdata, "Claude", "claude_desktop_config.json");
fs.mkdirSync(path.dirname(desk), { recursive: true });
fs.writeFileSync(desk, JSON.stringify({ preferences: { a: 1 }, mcpServers: { "shoulder-tap": { command: "node" }, other: { command: "x" } } }));

// Hermes：mcp_servers 下有 shoulder-tap 和别的；OpenClaw：接过，但 PATH 上没有 openclaw，只能提示手动 unset
const hermes = path.join(home, ".hermes", "config.yaml");
fs.mkdirSync(path.dirname(hermes));
fs.writeFileSync(hermes, 'model: x\nmcp_servers:\n  shoulder-tap:\n    command: "node"\n    args: ["a"]\n  other:\n    command: y\n');
fs.mkdirSync(path.join(home, ".openclaw"));
fs.writeFileSync(path.join(home, ".openclaw", "openclaw.json"), '{"mcp":{"servers":{"shoulder-tap":{"command":"node"}}}}');

const r = spawnSync(process.execPath, [path.join(skills, "shoulder-tap", "uninstall.mjs")], { encoding: "utf8", env: { HOME: home, USERPROFILE: home, APPDATA: appdata, LOCALAPPDATA: local, PATH: "" } });
console.log(r.stdout, r.stderr);
assert.equal(r.status, 0);
assert.ok(!fs.existsSync(path.join(skills, "shoulder-tap")), "skill 删了");
assert.ok(!fs.existsSync(path.join(skills, "shoulder-tap-uninstall")), "卸载 skill 也删了");
assert.ok(!fs.existsSync(path.join(claude, "shoulder-tap", "app")), "app 删了");
assert.ok(fs.existsSync(path.join(claude, "shoulder-tap", "data.json")), "数据留着");
const settings = JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8"));
assert.deepEqual(settings.permissions, { allow: ["x"] });
assert.deepEqual(Object.keys(settings.hooks), ["Stop"]);
assert.equal(settings.hooks.Stop[0].hooks[0].command, "echo other");
assert.equal(fs.readFileSync(path.join(claude, "CLAUDE.md"), "utf8"), "# mine\n\nkeep this\n\n## 别的\n\n也留着\n");
assert.equal(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"), 'model = "x"\n\n[mcp_servers.other]\ncommand = "y"\n');
assert.deepEqual(JSON.parse(fs.readFileSync(desk, "utf8")), { preferences: { a: 1 }, mcpServers: { other: { command: "x" } } }, "Claude Desktop：只去掉 shoulder-tap");
assert.equal(fs.readFileSync(hermes, "utf8"), "model: x\nmcp_servers:\n  other:\n    command: y\n", "Hermes：只去掉 shoulder-tap");
assert.match(r.stdout, /OpenClaw → 没去掉/);
console.log("uninstall ok");
