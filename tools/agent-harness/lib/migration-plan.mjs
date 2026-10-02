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
 * @param {{ local: Array<{version: string, file: string, afterDeploy: boolean}>,
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
