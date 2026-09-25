/**
 * 更新：install.mjs 把仓库位置记在 config.json 的 repo 里，更新就是在那儿 git pull 再重跑 install.mjs。
 *
 * 检查（有没有新版本）一天最多一次，由 UserPromptSubmit 钩子甩到后台：git fetch，然后数一下
 * 落后 upstream 几个提交，结果写进 update.json。钩子、设置页都只读这个文件，不碰网络。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { STATE_DIR, readConfig } from "./store.mjs";

const FILE = path.join(STATE_DIR, "update.json");
const DAY = 24 * 3600_000;

const git = (repo, ...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true });

export const readUpdate = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; } };
export const writeUpdate = (patch) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ ...readUpdate(), ...patch }, null, 2));
};

/** 装的时候记下的仓库；不是 git 仓库（比如下载的 zip）就是 null。 */
export function repoDir() {
  const repo = readConfig().repo;
  return repo && git(repo, "rev-parse", "--is-inside-work-tree").stdout.trim() === "true" ? repo : null;
}

export const dueForCheck = () => Date.now() - (readUpdate().checkedAt ?? 0) > DAY;

/** 去 GitHub 看一眼。落后几个提交写进 update.json；网络不通就当没有更新，明天再看。 */
export function check(repo = repoDir()) {
  writeUpdate({ checkedAt: Date.now() }); // 先记时间：检查失败也别每句话都重试
  if (!repo || git(repo, "fetch", "--quiet").status !== 0) return 0;
  const behind = Number(git(repo, "rev-list", "--count", "HEAD..@{u}").stdout.trim()) || 0;
  writeUpdate({ behind });
  return behind;
}

/** 拉新代码，重跑 install.mjs。stdio 给调用方决定：命令行里直接看，设置页那边写进日志。 */
export function update(repo, stdio = "inherit") {
  const pull = spawnSync("git", ["-C", repo, "pull", "--ff-only"], { stdio, windowsHide: true });
  if (pull.status !== 0) return pull.status || 1;
  const install = spawnSync(process.execPath, [path.join(repo, "install.mjs"), "--update"], { stdio, windowsHide: true });
  if (install.status === 0) writeUpdate({ behind: 0, checkedAt: Date.now() });
  return install.status ?? 1;
}
