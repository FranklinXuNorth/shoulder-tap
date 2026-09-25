// 更新：临时 HOME + 一个假的「GitHub」（裸仓库）+ 装的时候那份 clone。上游多一个提交 → 查得到落后 1 → 更新后拉平。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "st-update-"));
process.env.HOME = process.env.USERPROFILE = path.join(tmp, "home");
const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

const origin = path.join(tmp, "origin.git"), repo = path.join(tmp, "repo"), dev = path.join(tmp, "dev");
git(tmp, "init", "--bare", origin);
git(tmp, "clone", origin, dev);
// 假的 install.mjs：只留个记号，证明更新真的重跑了它，且带着 --update
fs.writeFileSync(path.join(dev, "install.mjs"), 'import fs from "node:fs";\nfs.writeFileSync(import.meta.dirname + "/ran", process.argv.slice(2).join(" "));\n');
git(dev, "add", "."); git(dev, "commit", "-m", "v1"); git(dev, "push", "origin", "HEAD");
git(tmp, "clone", origin, repo);

const { repoDir, check, update, readUpdate } = await import("./update.mjs");
const { writeConfig } = await import("./store.mjs");

assert.equal(repoDir(), null, "没记仓库位置 → null");
writeConfig({ repo });
assert.equal(repoDir(), repo);
assert.equal(check(), 0, "刚 clone 下来，不落后");

fs.writeFileSync(path.join(dev, "new.txt"), "v2");
git(dev, "add", "."); git(dev, "commit", "-m", "v2"); git(dev, "push", "origin", "HEAD");
assert.equal(check(), 1, "上游多一个提交");
assert.equal(readUpdate().behind, 1);

assert.equal(update(repo, "ignore"), 0);
assert.ok(fs.existsSync(path.join(repo, "new.txt")), "拉下来了");
assert.equal(fs.readFileSync(path.join(repo, "ran"), "utf8"), "--update", "重跑了 install.mjs --update");
assert.equal(readUpdate().behind, 0);
console.log("update ok");
