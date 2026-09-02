/**
 * 守「桌機優先的寫法只准變少」。
 *
 * 2026-09 使用者裁定全站改成手機優先。專案的 `respond-to` mixin 是 **`max-width`** ——
 * 也就是以桌機為基準往小螢幕覆寫。41 支 SCSS 這樣寫。
 *
 * 那些**不是錯的，只是方向舊**，所以不能一次全改（會是一支動 41 檔的 PR，
 * 沒有人 review 得動）。做法是加一支 `respond-from`（min-width）並存，
 * 新東西用新的，舊的逐頁遷移 —— 而這支 gate 負責讓那個「逐頁」真的會走完：
 *
 * - **檔案第一次出現在清單裡 → 紅燈**（有人又寫了桌機優先）
 * - **檔案從清單消失 → 提醒更新基線**（有人遷移完了，把成果記下來）
 *
 * 沒有這道 ratchet 的話，遷移會停在「大家都同意要做」然後永遠不動 ——
 * 因為每一次「就這一次先照舊寫」都是局部理性的。
 *
 * ## 這支看得到什麼、看不到什麼
 *
 * 它只數 `respond-to` / `respond-to-container` 的**出現與否**，不判斷寫得好不好。
 * 一支檔案可能已經是手機優先的思路、只是還留著一個 `respond-to` 收尾 ——
 * 那仍然會被算進來。**這是刻意的**：判斷「思路是不是手機優先」需要人看，
 * 而這支 gate 的價值正在於它不需要人判斷。
 *
 * 反過來，一支檔案完全沒有斷點（teacher 那四支就是）**不會被這支抓到** ——
 * 它沒有桌機優先的寫法，但它也沒有任何響應式。那是另一個問題，不歸這支管。
 */

/** 桌機優先的兩支 mixin */
const DESKTOP_FIRST = /@include\s+[\w.]*respond-to(-container)?\s*\(/g;

/**
 * @param {Array<{path: string, source: string}>} files SCSS 檔案（path 用 repo 相對路徑）
 * @returns {string[]} 還在用桌機優先寫法的檔案路徑，已排序
 */
export function desktopFirstFiles(files) {
  const hits = [];
  for (const { path, source } of files) {
    // 每次都要重設 lastIndex —— `g` flag 的正則是有狀態的，
    // 沿用同一個實例跑第二個檔案會從上一次的位置繼續找（漏報）。
    DESKTOP_FIRST.lastIndex = 0;
    if (DESKTOP_FIRST.test(source)) hits.push(path);
  }
  return hits.sort();
}

/**
 * 一支檔案裡有幾處桌機優先的寫法。只用在報告裡給人看規模，不參與紅綠判定 ——
 * 判定用的是「檔案在不在清單裡」，因為那才是遷移的單位。
 */
export function countDesktopFirst(source) {
  DESKTOP_FIRST.lastIndex = 0;
  return (source.match(DESKTOP_FIRST) ?? []).length;
}
