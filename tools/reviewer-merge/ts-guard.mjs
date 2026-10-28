#!/usr/bin/env node
/**
 * 合併 migration 前重驗時間戳（等於合併當下重跑 A16b，計畫席 10-23 指派，#2025）。
 *
 * 各 PR 的 A16b 只在自己的 CI 跑，並行的兩張看不到對方：#1989（033540）在 #1988（034048）
 * 先套上正式之後才合，migrate plan 判成「中間漏套」擋下、deploy 全停。所以合併的那一刻，
 * 要拿這張的每一支 migration 跟 **origin/main 最新** 與 **正式 DB 最新** 各比一次。
 *
 *   node tools/reviewer-merge/ts-guard.mjs --main <14碼> --prod <14碼> <migration 路徑>...
 *
 * 全部晚於兩者 → exit 0；任一支不晚於 → 印出哪一支、exit 1。
 */

/** migration 路徑 → 14 碼時間戳；不是 migration 檔回 null */
export function migrationStamp(path) {
  const m = /(?:^|\/)(\d{14})_[^/]+\.sql$/.exec(path);
  return m ? m[1] : null;
}

/**
 * @param {string[]} files PR 動到的路徑（只看 supabase/migrations/ 底下的 .sql）
 * @param {string} mainMax origin/main 最新那支的時間戳
 * @param {string} prodMax 正式 DB 最新已套的時間戳
 * @returns {{ file: string, stamp: string }[]} 不晚於兩者的那幾支（空陣列＝可以合）
 */
export function staleMigrations(files, mainMax, prodMax) {
  const floor = mainMax > prodMax ? mainMax : prodMax;
  return files
    .filter((f) => f.startsWith('supabase/migrations/'))
    .map((file) => ({ file, stamp: migrationStamp(file) }))
    .filter((x) => x.stamp !== null && x.stamp <= floor);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0 || !/^\d{14}$/.test(args[i + 1] ?? '')) {
      console.error(`缺 ${flag} <14碼時間戳>`);
      process.exit(2);
    }
    return args.splice(i, 2)[1];
  };
  const mainMax = take('--main');
  const prodMax = take('--prod');
  const stale = staleMigrations(args, mainMax, prodMax);
  for (const { file, stamp } of stale) {
    console.log(`!! ${file}：${stamp} 不晚於 main ${mainMax}／正式 ${prodMax}`);
  }
  if (stale.length === 0) console.log(`時間戳 OK（main ${mainMax}、正式 ${prodMax}）`);
  process.exit(stale.length === 0 ? 0 : 1);
}
