/**
 * 正式 DB 的 migration 差集與「能不能自動套」的判斷（#963，`migrate.yml` 用）。
 *
 * **比的是全部 version，不是窗口。** #915 的洞是「最新那支在、比它早的漏了一支」——
 * 窗口式檢查（`git log <上次截線>..<這次截線>`）與 `max(version)` 都看不出來，差集才看得出來。
 *
 * 規則與 `supabase db push` 一致（`apps/cli-go/pkg/migration/apply.go` 的
 * `FindPendingMigrations`）：遠端有本機沒有、或本機有一支比遠端最新還舊卻沒套 ——
 * 兩種 CLI 都會拒絕。這裡先判一次，是為了在**碰 DB 之前**就把原因寫進 step summary，
 * 而不是讓人去讀 CLI 的錯誤訊息猜。
 *
 * **CI 永遠不帶 `--include-all`**：補舊的那一支要人決定，不是腳本決定。
 */

/** backfill 類的檔頭標記：部署完才套（`review-steward.md` ⓪ 的分類，#905） */
export const AFTER_DEPLOY_MARKER = '-- clessia:apply after-deploy';

/** 只認**第一個非空行** —— 寫在註解中段的不算，免得說明文字裡提到它就誤判 */
export function isAfterDeploy(sql) {
  const first = sql.split('\n').find((line) => line.trim() !== '');
  return first?.trim() === AFTER_DEPLOY_MARKER;
}

/**
 * supabase CLI（v2.119.0，`apps/cli-go/pkg/migration/file.go` 的 `isPipelineIncompatible`）遇到這些語句
 * 會先 flush、再單獨執行 —— **同一支檔被拆成多個 transaction**（#1242）。
 */
const PIPELINE_INCOMPATIBLE = [
  /^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY(\s|$)/i,
  /^DROP\s+INDEX\s+CONCURRENTLY(\s|$)/i,
  /^REINDEX(\s|\().*\sCONCURRENTLY(\s|$)/is,
  /^VACUUM(\s|\(|$)/i,
  /^ALTER\s+SYSTEM(\s|$)/i,
  /^CLUSTER(\s|$)/i,
];

/**
 * 把 SQL 切成語句（去掉註解）。只為了數語句與看開頭，不是完整的 parser —— 但要正確跳過
 * `--`／`/* *\/` 註解、單引號字串、`$tag$ … $tag$` 函式本體，否則函式裡的 `;` 會被當成語句結尾。
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length);
      const stop = end === -1 ? sql.length : end + dollar[0].length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (sql[i] === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += sql[i];
    i += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/**
 * 這支檔會不會被 CLI 拆成多個 transaction，而且拆開會出事（#1242）：
 * **同時有** CONCURRENTLY 這類語句**與**其他語句。
 *
 * #1146 用 CLI 2.119.0 對拋棄式 DB 實測：兩顆 apply 同時被按時，一般檔靠 `schema_migrations`
 * 主鍵＋單一 transaction 只套一次（計數 +1）；**含 CONCURRENTLY 的檔計數 +2 —— 檔內的 UPDATE
 * 被套了兩次**（它在 flush 時已經自己 commit 了）。只有那一句的檔沒有這個問題，放行。
 */
export function splitsTransaction(sql) {
  const statements = splitStatements(sql);
  return (
    statements.length > 1 &&
    statements.some((statement) => PIPELINE_INCOMPATIBLE.some((re) => re.test(statement)))
  );
}

/**
 * @param {{ local: Array<{version: string, file: string, afterDeploy: boolean, splitsTransaction?: boolean}>,
 *           remote: string[], deployed?: boolean }} input
 *   `deployed` = 部署者確認這一批的程式碼已經上線（手動 dispatch 時給）
 * @returns {{ state: 'clean' | 'apply' | 'after-deploy' | 'blocked', reason: string,
 *             pending: Array<{version: string, file: string, afterDeploy: boolean}>,
 *             missingLocal: string[], outOfOrder: string[] }}
 */
export function planMigrations({ local, remote, deployed = false }) {
  const localSorted = [...local].sort((a, b) => a.version.localeCompare(b.version));
  const localVersions = new Set(localSorted.map((m) => m.version));
  const remoteSet = new Set(remote);
  const remoteMax = [...remote].sort().at(-1) ?? '';

  const missingLocal = [...remoteSet].filter((v) => !localVersions.has(v)).sort();
  const unapplied = localSorted.filter((m) => !remoteSet.has(m.version));
  const outOfOrder = unapplied.filter((m) => m.version < remoteMax).map((m) => m.version);
  const pending = unapplied;

  const result = (state, reason) => ({ state, reason, pending, missingLocal, outOfOrder });

  if (missingLocal.length > 0) {
    return result(
      'blocked',
      `正式 DB 有 repo 裡沒有的 version：${missingLocal.join(', ')}。` +
        '通常是手動補記 schema_migrations 時寫錯 —— 由使用者看 `supabase migration list` 決定 repair。',
    );
  }
  if (outOfOrder.length > 0) {
    return result(
      'blocked',
      `有比正式 DB 最新那支（${remoteMax}）還舊、卻沒套的 migration：${outOfOrder.join(', ')}。` +
        '這是 #915 的形狀（中間漏套）。CI 不帶 --include-all —— 要補哪一支由使用者決定。',
    );
  }
  if (pending.length === 0) return result('clean', '差集 0：repo 的每一支都已套上正式 DB。');

  const splitting = pending.filter((m) => m.splitsTransaction).map((m) => m.file);
  if (splitting.length > 0) {
    return result(
      'blocked',
      `${splitting.join(', ')} 同時有 CONCURRENTLY／VACUUM 這類語句與其他語句 —— CLI 會把它拆成多個 ` +
        'transaction，兩顆 apply 同時被按時其他語句會被套兩次（#1146 實測）。' +
        '把那一句獨立成一支只有它的 migration（#1242）。',
    );
  }

  const backfills = pending.filter((m) => m.afterDeploy);
  if (backfills.length === 0) return result('apply', `待套 ${pending.length} 支 schema。`);

  if (backfills.length < pending.length) {
    return result(
      'blocked',
      'schema（套完才部署）與 after-deploy backfill（部署完才套）同批待套 —— ' +
        '一次 db push 拆不開兩者的順序。請分批合併：先合 schema、部署，再合 backfill。',
    );
  }
  return deployed
    ? result('apply', `待套 ${pending.length} 支 after-deploy backfill，部署者已確認程式碼上線。`)
    : result(
        'after-deploy',
        `待套 ${pending.length} 支 after-deploy backfill —— 先部署，再手動觸發 migrate（填部署截線 SHA）。`,
      );
}

/**
 * 本分支**新增**的 migration 裡，時間戳不比 base（origin/main）最新一支新的那些（#1248）。
 *
 * PR 開著的期間 main 合進了更新的 migration，這支合下去之後就是「比遠端最新還舊卻沒套」——
 * `migrate.yml` 的 plan 會被 CLI 以 `inserted before the last migration` 拒絕（我們永不帶
 * `--include-all`）。但 verify 在合併前不會紅，只有人眼看得到（#1216 撞到）。
 * 修法是 `git mv` 成新的時間戳 —— 檔案還沒進 main，改名不違反 c3。
 *
 * 只看新增檔：既有的檔由 A16（c3）管，這裡不碰。
 *
 * @param {string[]} addedFiles 本分支新增的檔名（basename）
 * @param {string[]} baseFiles base 上 supabase/migrations/ 的檔名（basename）
 * @returns {{ stale: string[], baseLatest: string | null }}
 */
export function staleNewMigrations(addedFiles, baseFiles) {
  const version = (file) => /^(\d{14})_/.exec(file)?.[1] ?? null;
  const baseLatest = baseFiles.map(version).filter(Boolean).sort().at(-1) ?? null;
  if (baseLatest === null) return { stale: [], baseLatest };
  const stale = addedFiles.filter((file) => {
    const v = version(file);
    return v !== null && v <= baseLatest;
  });
  return { stale, baseLatest };
}
