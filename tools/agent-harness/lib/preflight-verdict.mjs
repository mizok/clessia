/**
 * 「現在推安不安全」的判斷。**純函式，不碰 git 也不碰網路** ——
 * 因為第三種情況（遠端 CI 停在別的 SHA）在不真的推出去的前提下**做不出來**，
 * 而那正是最糟的一種。抽出來才驗得到。
 *
 * 判準與理由見 `../preflight.mjs` 的檔頭。
 */

/**
 * @param {{tracking: string, localHead: string, run: {status: string, headSha: string, conclusion: string｜null}｜null}} input
 * @returns {{level: 'ok'|'warn', code: string, message: string}}
 */
export function preflightVerdict({ tracking, localHead, run }) {
  if (tracking.includes('[gone]')) {
    return {
      level: 'warn',
      code: 'branch-gone',
      message:
        '遠端分支已經不存在（PR 多半已合併並刪支）。往這裡推的 commit 永遠不會進 main —— ' +
        '先從最新 origin/main 開新分支重放。',
    };
  }

  if (!run) {
    return { level: 'ok', code: 'no-run', message: '這支分支還沒有 CI 紀錄，可以推' };
  }

  const sha = run.headSha.slice(0, 8);
  const head = localHead.slice(0, 8);

  // **最糟的一種，而且只看 status 看不到它。**
  if (sha !== head) {
    return {
      level: 'warn',
      code: 'remote-ahead',
      message:
        `遠端跑在 ${sha}，本地 HEAD 是 ${head} —— 遠端已經跑掉了（多半是別人 update-branch 過）。` +
        '先 git fetch 對齊，不要直接推。',
    };
  }

  if (run.status === 'in_progress' || run.status === 'queued') {
    return {
      level: 'warn',
      code: 'ci-running',
      message: `CI 正跑在你這顆（${sha}）。有人在等它的結果 —— 要再推的話先知會 steward。`,
    };
  }

  return {
    level: 'ok',
    code: 'ci-done',
    message: `CI 已完成（${sha} / ${run.conclusion}）。再推會換掉這顆，先知會一聲。`,
  };
}
