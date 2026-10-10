import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectCodex, codexState, removeCodexMcp, removeCodexHooks, removeCodexRules } from "./codex.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "st-codex-"));
const options = { home, node: "/node path/node", skill: "/user path/shoulder-tap", snippet: "## 专注\nCall check_focus.\n" };
const config = path.join(home, "config.toml"), hooks = path.join(home, "hooks.json"), agents = path.join(home, "AGENTS.md");
try {
  const other = 'model = "x"\n\n[mcp_servers.other]\ncommand = "other"\n';
  fs.writeFileSync(config, other + '\n[mcp_servers.shoulder-tap]\nurl = "https://old.example"\nenabled = false\n[mcp_servers.shoulder-tap.http_headers]\nX = "old"\n');
  const unrelated = { type: "command", command: "echo unrelated" };
  fs.writeFileSync(hooks, JSON.stringify({ description: "keep", hooks: { Stop: [{ hooks: [unrelated, { command: "node /user/shoulder-tap/watch.mjs" }] }] } }));
  fs.writeFileSync(agents, "# My custom rules\nKeep them.\n");
  assert.equal(codexState(options).connected, false, "remote MCP alone is not installed");
  assert.equal(connectCodex(options).connected, true);
  assert.ok(fs.readFileSync(config, "utf8").startsWith(other));
  assert.ok(!fs.readFileSync(config, "utf8").includes("old.example"));
  assert.ok(fs.readFileSync(agents, "utf8").startsWith("# My custom rules\nKeep them.\n"));
  const before = [config, hooks, agents].map((p) => fs.readFileSync(p, "utf8"));
  connectCodex(options);
  assert.deepEqual([config, hooks, agents].map((p) => fs.readFileSync(p, "utf8")), before, "repeated connection is idempotent");
  const partial = JSON.parse(before[1]);
  partial.hooks.Stop = partial.hooks.Stop.filter((g) => !g.hooks.some((h) => String(h.command).includes("watch.mjs")));
  fs.writeFileSync(hooks, JSON.stringify(partial));
  assert.equal(codexState(options).connected, false, "missing hooks must offer repair");
  connectCodex(options);
  const cleaned = removeCodexHooks(JSON.parse(fs.readFileSync(hooks, "utf8")));
  assert.deepEqual(cleaned, { description: "keep", hooks: { Stop: [{ hooks: [unrelated] }] } });
  assert.equal(removeCodexRules(fs.readFileSync(agents, "utf8")), "# My custom rules\nKeep them.\n");
  assert.ok(removeCodexMcp(fs.readFileSync(config, "utf8")).startsWith(other));
  assert.equal(removeCodexMcp('[mcp_servers."shoulder-tap"]\ncommand = "x"\n[mcp_servers.other]\ncommand = "y"\n'), '[mcp_servers.other]\ncommand = "y"\n');
  fs.writeFileSync(hooks, "{broken");
  const snapshot = [config, hooks, agents].map((p) => fs.readFileSync(p, "utf8"));
  assert.throws(() => connectCodex(options), SyntaxError);
  assert.deepEqual([config, hooks, agents].map((p) => fs.readFileSync(p, "utf8")), snapshot, "invalid existing config must not be overwritten");
  console.log("codex install/repair/preservation/uninstall ok");
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
