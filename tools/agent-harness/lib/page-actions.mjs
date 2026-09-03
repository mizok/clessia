/**
 * 守拇指區那個決定的兩條規則。
 *
 * 2026-09 使用者裁定：行政 80% 以上在手機工作，主要行動要搬進拇指範圍。
 * 做法是 `app-page-actions` —— 頁面宣告一次，元件決定渲染在桌機標頭還是手機停靠列。
 *
 * 沒有 gate 的話這個決定會慢慢被磨掉：下一個人加新頁面時，最順手的寫法仍然是
 * 「在標頭放一顆 p-button」，而那在桌機上看起來完全正常 ——
 * **手機上按不到這件事，寫的人不會在自己的螢幕上發現。**
 */

/** 破壞性動作的關鍵字。命中就不准當主要行動。 */
const DESTRUCTIVE = ['刪除', '移除', '停用', '結束', '註銷', '作廢', '清除', '解除'];

/**
 * 規則一：頁面模板不得在 `__header-actions` 裡直接放 `p-button`。
 *
 * **能力邊界**：它只認 `__header-actions` 這個命名。一個頁面把主要行動放在
 * 別的地方（例如卡片裡、或自己取別的 class 名），這條抓不到。
 * 它守的是「既有的那個寫法不要再長出來」，不是「所有主要行動都用了元件」。
 *
 * @param {Array<{path: string, source: string}>} files 模板檔
 * @returns {string[]} 違規的檔案路徑，已排序
 */
export function headerActionButtons(files) {
  const hits = [];
  for (const { path, source } of files) {
    // 從 __header-actions 開始，抓到該區塊結束為止。用「下一個同縮排的 </div>」
    // 太脆，改成看接下來 1200 字元內有沒有 p-button —— 標頭區塊不會比這更長。
    const idx = source.indexOf('__header-actions');
    if (idx === -1) continue;
    if (/<p-button/.test(source.slice(idx, idx + 1200))) hits.push(path);
  }
  return hits.sort();
}

/**
 * 規則二：**破壞性行動永不進停靠列。**
 *
 * 拇指範圍是最容易誤觸的地方。誤觸「新增」只是多一筆草稿，誤觸「刪除」是資料沒了。
 *
 * **能力邊界**：這是**關鍵字啟發**，不是語意判斷。一個叫「歸檔」或「結案」的
 * 破壞性動作它抓不到；反過來，一個叫「清除篩選」的無害動作它會誤報
 * （那種請改名或加豁免註解，不要為了過 gate 把它塞進停靠列）。
 *
 * 它的價值在於**擋住最直白的那幾種**，而那正是趕時間的人會寫的。
 *
 * @param {Array<{path: string, source: string}>} files TS 檔
 * @returns {{path: string, label: string, word: string}[]}
 */
export function destructivePrimaryActions(files) {
  const hits = [];
  for (const { path, source } of files) {
    // `primaryAction: PageAction = { label: '…' }` —— 專案的慣例寫法
    for (const m of source.matchAll(/PageAction\s*=\s*\{[^}]*label:\s*['"]([^'"]+)['"]/g)) {
      const label = m[1];
      const word = DESTRUCTIVE.find((w) => label.includes(w));
      if (word) hits.push({ path, label, word });
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path));
}
