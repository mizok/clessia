/**
 * 守「不要再手刻第二份手機版表格」。
 *
 * ## 問題形狀
 *
 * 同一份資料在模板裡宣告兩次：一個 `<table>` 給桌機、一組 `__mobile-*` 標記給手機，
 * 靠斷點 `display: none` 互相切換。**改欄位時要記得改兩處，而忘記的那一次不會有任何錯誤** ——
 * 跟 `page-actions` 那一刀的理由同源（專案已有三個「同一件事宣告兩次就會分岔」的實例）。
 *
 * 正解是走 `responsive-table` 共用元件：宣告一次，由元件決定桌機表格還是手機卡片。
 *
 * ## 偵測訊號：**模板**同時有 `<table>` 與平行的手機標記
 *
 * 為什麼看模板不看 SCSS：SCSS 那一側有**兩種互補的寫法**，而且四支檔案不一致 ——
 * 有的是 `&__mobile-list { display: none }`（桌機藏手機版），
 * 有的是斷點裡 `&__table-wrap { display: none }`（手機藏表格）。
 * 只掃其中一種會漏掉另一種；而模板裡「兩份平行標記同時存在」是這件事的**定義**，
 * 不是它的其中一種表現。
 *
 * ## 這支看不到什麼
 *
 * - **命名慣例以外的手刻手機版**。訊號認的是 `__mobile*`，那是本 repo 目前三支的寫法。
 *   有人改叫 `__phone-list` 或 `__card-view` 就抓不到 —— 這是**已知且刻意**的邊界：
 *   與其猜一堆可能的名字，不如認一個真實存在的慣例，並把限制寫在這裡。
 * - **手機版做得好不好**。它只知道有兩份，不知道哪份對。
 * - **只有表格、完全沒有手機版**的頁面 —— 那是**另一種缺陷**（破版），不是雙軌。
 *   `student-score-detail-dialog` 就是那一種：有 `<table>`、零個 `__mobile`。
 *   兩者的修法與驗收方式都不同，混在一起會讓報告失焦。
 */

const TABLE = /<table[\s>]/;
const MOBILE_MARKUP = /__mobile[a-z-]*/;

/**
 * @param {Array<{path: string, source: string}>} templates `.html` 檔（path 用 repo 相對路徑）
 * @returns {Array<{file: string, mobileMarks: number}>} 雙軌實作，已排序
 */
export function dualTrackTables(templates) {
  const found = [];
  for (const { path, source } of templates) {
    if (!TABLE.test(source)) continue;
    if (!MOBILE_MARKUP.test(source)) continue;
    const mobileMarks = new Set([...source.matchAll(/__mobile[a-z-]*/g)].map((m) => m[0])).size;
    found.push({ file: path, mobileMarks });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}
