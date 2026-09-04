/**
 * 守「不要再手刻第二份手機版表格」。
 *
 * ## 問題形狀
 *
 * 同一份資料在元件裡宣告兩次：一個 `<table>` 給桌機、一組平行標記給手機，
 * 靠斷點 `display` 互相切換。**改欄位時要記得改兩處，而忘記的那一次不會有任何錯誤** ——
 * 跟 `page-actions` 那一刀的理由同源。正解是走 `responsive-table` 共用元件：
 * 宣告一次，由元件決定桌機表格還是手機卡片。
 *
 * ## 偵測訊號：**互補的 display 開關**，不是命名
 *
 * ```scss
 * .b { &__cards { display: none; } }                 // 桌機：藏手機版
 * @include respond-to('tablet-portrait') {
 *   .b {
 *     &__table-wrap { display: none; }               // 手機：藏表格
 *     &__cards      { display: grid; }               // 手機：放出手機版
 *   }
 * }
 * ```
 *
 * 判準要三個條件同時成立：模板有 `<table>`、某個 selector 被「基準藏 / 條件顯」
 * 翻面、另一個不同的 selector 在條件裡被藏掉。**那組翻面就是「兩條軌道」本身。**
 *
 * ### 為什麼不用命名（這裡踩過一次）
 *
 * 第一版認 `__mobile*`，理由是「repo 現存三支都這樣寫」。
 * **它漏掉第四支** —— `student-score-detail-dialog` 的手機版叫 `__record-cards`，
 * 名字裡沒有 mobile。更糟的是漏得很安靜：那支被判成「有表格、沒手機版」的**破版**，
 * 於是連帶推出一個「表格無手機路徑」的新 gate 提案 —— 一個**建立在誤判上的需求**。
 *
 * 教訓不是「該多列幾個名字」，是**命名慣例不能當結構訊號**：
 * 慣例只描述已經寫出來的那幾支，而 gate 要擋的是還沒寫出來的下一支。
 *
 * ## 這支看不到什麼
 *
 * - **不用 `display` 切換的雙軌**（`visibility`、`@if` 條件渲染、TS 端判斷寬度）。
 * - **手機版做得好不好**。它只知道有兩條軌道，不知道哪條對。
 * - **跨檔案繼承的 display**（父層 SCSS 或全域 token 藏起來的）。
 * - 反過來，**基準藏 A、條件藏 B 但兩者無關**（例如列印用的隱藏節點碰上某個
 *   媒體查詢）理論上會誤報。「條件裡把 A 放出來」這一條就是為了擋這種：
 *   `invoice-detail-dialog` 有 `<table>` 也有基準 `display:none`（列印節點），
 *   因為沒有翻面而正確放行。
 *
 * `responsive-table` 自己**零個 `display:none`** —— 它是一張表加展開列，單軌。
 * 正解不會踩到這個訊號，這是它是對的訊號的旁證。
 */

import { blocks } from './scss-blocks.mjs';

const TABLE = /<table[\s>]/;
const DISPLAY = /(^|[;{\s])display\s*:\s*([a-z-]+)/;

/** 這個區塊宣告的 display 值（沒宣告回 null） */
function displayOf(decls) {
  const m = DISPLAY.exec(decls);
  return m ? m[2] : null;
}

/**
 * @param {Array<{path: string, template: string, scss: string}>} components
 *   `path` 用 repo 相對路徑（回報用），`template` / `scss` 是兩個檔的內容
 * @returns {Array<{file: string, shown: string, hidden: string}>} 雙軌實作，已排序
 */
export function dualTrackTables(components) {
  const found = [];
  for (const { path, template, scss } of components) {
    if (!TABLE.test(template)) continue;

    const hiddenAtBase = new Set();
    const shownInCond = new Set();
    const hiddenInCond = new Set();
    for (const b of blocks(scss)) {
      const d = displayOf(b.decls);
      if (!d) continue;
      if (b.cond) (d === 'none' ? hiddenInCond : shownInCond).add(b.selector);
      else if (d === 'none') hiddenAtBase.add(b.selector);
    }

    // 基準藏起來、條件裡放出來 —— 這是手機軌道
    const shown = [...hiddenAtBase].find((s) => shownInCond.has(s));
    if (!shown) continue;
    // 條件裡被藏掉的**另一個** selector —— 這是桌機軌道
    const hidden = [...hiddenInCond].find((s) => s !== shown);
    if (!hidden) continue;

    found.push({ file: path, shown, hidden });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}
