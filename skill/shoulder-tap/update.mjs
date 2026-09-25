#!/usr/bin/env node
/**
 * 更新到最新版：node ~/.claude/skills/shoulder-tap/update.mjs
 *
 * 在装的时候那个仓库里 git pull，再重跑 install.mjs（skill、钩子、桌面端都换成新的，数据和设置不动）。
 * --check：只看有没有新版本，不装（钩子每天在后台跑一次这个）。
 */
import { repoDir, check, update } from "./core/update.mjs";

const repo = repoDir();
if (!repo) {
  console.log("找不到装 shoulder-tap 时的那个 git 仓库（可能是下载的 zip，或者仓库挪走了）。\n" +
    "重新 git clone https://github.com/FranklinXuNorth/shoulder-tap.git，在里面跑 node install.mjs，以后就能用这条更新了。");
  process.exit(process.argv.includes("--check") ? 0 : 1);
}
if (process.argv.includes("--check")) {
  const behind = check(repo);
  console.log(behind ? `有新版本：落后 ${behind} 个提交。跑 node ${process.argv[1]} 更新。` : "已经是最新的。");
  process.exit(0);
}
console.log(`更新 ${repo} …`);
const code = update(repo);
console.log(code === 0 ? "\n更新好了。已经开着的 Claude Code 会话重开一次就用上新版。" : "\n没更新成功，看上面的报错（仓库里有没提交的改动的话，先处理掉再跑）。");
process.exit(code);
