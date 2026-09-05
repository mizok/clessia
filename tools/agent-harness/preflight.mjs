#!/usr/bin/env node
/**
 * 推之前的分支狀態檢查。**不檢查程式碼，只檢查「現在推安不安全」。**
 *
 * ## 為什麼不是 pre-push hook
 *
 * 想過。但 review-steward 指出一件事：**它做的兩支守衛之所以有效，是因為它們掛在
 * 「同一個動作點」上**（都掛在合併，而合併是那一席的唯一收口）。
 *
 * push 沒有那種收口 —— 它可以從任何地方發生，所以 hook 得是 git 的 pre-push，
 * 而那是**每一席各裝一份**，正是計畫席否決過的方向（「12 席不用各裝各的」）。
 *
 * 所以改成掛在**已經會跑的那一步**：改 gate 判準本來就要跑 `harness` + `harness:test`，
 * 把這支接在後面（`npm run preflight`），它就搭上了一個已經不會忘的動作。
 *
 * ## 它要回答的兩個問題
 *
 * 2026-09-05 一天內踩了兩次，兩次都是「本地認知過期」：
 *
 * 1. **這支分支還在嗎** —— 推到一支已合併、遠端已刪的分支上，push 會成功、
 *    CI 不會抱怨，而那個 commit **永遠不會自己進 main**。
 * 2. **有沒有人在等這顆 SHA** —— 換掉別人正在收的 head，代價是他重跑一輪。
 *    收單端有 `--match-head-commit` 當後盾（合併會直接被拒，不會合到沒看過的東西），
 *    但那是**別人**的成本。
 *
 * ## 為什麼看 headSha 不只看 status
 *
 * `status=in_progress` 只說「有 CI 在跑」。加上 `headSha` 才分得出：
 *
 * | 情況 | 意思 |
 * | --- | --- |
 * | `in_progress` 且 sha == 本地 HEAD | **有人在等我這顆，別推** |
 * | `completed` 且 sha == 本地 HEAD | 結果已出，推之前先知會 |
 * | **sha != 本地 HEAD** | **遠端已經跑掉了**（別人 update-branch 過），先 fetch |
 *
 * 第三種是最糟的一種，而**只看 status 看不到它**。
 *
 * ## 這支不做的事
 *
 * **它不擋你。** 只印狀態，exit code 永遠是 0 —— 因為「該不該推」是判斷，
 * 不是規則：知會一聲之後推是合理的，而一個會擋人的檢查會被 `--no-verify` 繞過去。
 */

import { execFileSync } from 'node:child_process';

import { preflightVerdict } from './lib/preflight-verdict.mjs';

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const head = sh('git', ['rev-parse', 'HEAD']).slice(0, 8);

if (!branch || branch === 'HEAD') {
  console.log('preflight：不在具名分支上，跳過');
  process.exit(0);
}

const tracking = sh('git', ['status', '-sb']).split('\n')[0];
const raw = sh('gh', [
  'run',
  'list',
  '--branch',
  branch,
  '--limit',
  '1',
  '--json',
  'status,headSha,conclusion',
]);

// gh 叫不到就不要假裝有答案 —— 環境問題不該偽裝成「可以推」
if (!raw && !tracking.includes('[gone]')) {
  console.log(`preflight：查不到 ${branch} 的 CI（沒推過、或 gh 不可用）—— 推之前自己確認一次`);
  process.exit(0);
}

const { level, message } = preflightVerdict({
  tracking,
  localHead: head,
  run: raw ? (JSON.parse(raw)[0] ?? null) : null,
});
console.log(level === 'warn' ? `⚠ ${message}` : `preflight：${message}`);
