/**
 * SCSS 歸零帳面（#991 T2，gate A24）。
 *
 * 使用者 2026-10-02 裁定全站 SCSS 改 Tailwind，終點是 **SCSS 歸零**。帳面的單位是**檔**：
 * 一頁重做完，那頁的 `.scss` 刪掉，帳面 −1。行數會被格式化與修 bug 上下抖，拿來當閘門
 * 會讓維護舊頁的正常修正紅燈 —— 所以行數只印、不擋。
 *
 * 帳面上的條目有兩種：`.scss` 檔，以及寫了內嵌 `styles:` 的元件 `.ts`（`inlineStyleLanguage`
 * 是 scss，那也是 SCSS）。
 *
 * **@source 是帳面的另一面**（計畫席裁定）：`tailwind.css` 的 `@source` 只列已遷移的目錄。
 * 列在那裡的目錄底下不得還有帳面上的條目 —— 否則同一個目錄同時被 SCSS 與 utility 管，
 * 未分層的 SCSS 會贏、utility 看起來像「沒效」（tailwind-adoption.md 2.2）。
 */

/** 元件裡的內嵌 `styles:`（陣列、樣板字串或字串） */
export function hasInlineStyles(tsSource) {
  return /^\s*styles:\s*[[`'"]/m.test(tsSource);
}

/** `tailwind.css` 裡的 `@source '…'`（註解要先抹白 —— 檔頭的說明就寫著 `@source './app/…'`） */
export function sourcePaths(css) {
  const code = css.replace(/\/\*[^]*?\*\//g, (m) => ' '.repeat(m.length));
  return [...code.matchAll(/@source\s+(?!not\b)['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/**
 * @param {string[]} current  現在 repo 裡的帳面條目（repo 相對路徑）
 * @param {string[]} baseline 帳面
 * @returns {{ added: string[], gone: string[] }}
 */
export function ledgerDiff(current, baseline) {
  const now = new Set(current);
  const book = new Set(baseline);
  return {
    added: current.filter((p) => !book.has(p)).sort(),
    gone: baseline.filter((p) => !now.has(p)).sort(),
  };
}

/**
 * @param {string[]} sourceDirs `@source` 解析成的 repo 相對目錄
 * @param {string[]} entries    帳面上還在的條目
 * @returns {Array<{dir: string, entries: string[]}>} 已列入 @source、底下卻還有 SCSS 的目錄
 */
export function sourceConflicts(sourceDirs, entries) {
  return sourceDirs
    .map((dir) => ({
      dir,
      entries: entries.filter((e) => e === dir || e.startsWith(`${dir.replace(/\/$/, '')}/`)),
    }))
    .filter((c) => c.entries.length > 0);
}
