/**
 * 把註解換成等長空白，讓規則只看得到**程式碼**。
 *
 * ## 為什麼要有這支
 *
 * c6（禁 viewport 單位）的 regex 會打到註解裡的 `90vw` —— 於是
 *
 * ```scss
 * // 這裡不能用 90vw，容器不是視窗寬（c6）
 * ```
 *
 * 被判成違規。**它懲罰的正是最該留下的那種註解**：解釋「為什麼不這樣做」的那一行。
 * design-web 席 2026-09-04 實際中招。
 *
 * 同樣的問題在 c7（`*ngIf`）與 c8（`@Input()`）上也成立：註解掉的舊寫法是死程式碼，
 * 不是違規。判斷權在共用 matcher，所以 **gate 與 pre-write hook 兩邊同時有這個 bug**，
 * 修在這裡兩邊一起好。
 *
 * ## 為什麼是「換成空白」不是「刪掉」
 *
 * 刪掉會讓後面所有內容的**位移與行號整個偏掉**，而 gate 報的第幾行是要給人點的。
 * 換成等長空白（換行原樣保留）之後，位移完全不變，剝不剝都能對到同一個位置。
 *
 * ## 看不到什麼
 *
 * **字串字面值裡長得像註解的東西**會被一起洗掉（TS 的 `const s = '/* x *​/'`、
 * 正規式字面值裡的 `//`）。方向是安全的 —— 造成的是漏報不是誤報，
 * 而誤報的代價高得多（會讓人去關掉整個 gate）。
 */

/** 保留換行、其餘換成空白 —— 長度與行數都不變 */
const blank = (m) => m.replace(/[^\n]/g, ' ');

const BLOCK = /\/\*[\s\S]*?\*\//g;
// 前面那個 `[^:]` 是為了不打到 `https://` 這種；它被吃進 match 裡，要原樣還回去
const LINE = /(^|[^:])\/\/[^\n]*/g;
const HTML = /<!--[\s\S]*?-->/g;
// SQL 的行註解是 `--`。這裡沒有 `https://` 那種誤傷風險，所以不用前置守衛。
const SQL_LINE = /--[^\n]*/g;

/**
 * @param {string} text 原始檔內容
 * @param {string} filePath 用來決定註解語法（副檔名）
 * @returns {string} 與輸入等長、註解已抹白的內容
 */
export function blankComments(text, filePath) {
  if (/\.html$/.test(filePath)) return text.replace(HTML, blank);
  // SQL：`ba_user` 這種表名幾乎一定會在註解裡被提到（migrations 就有好幾處
  // 「使用 ba_user(id) 而非 profiles(id)」的說明），不抹白會把說明判成違規。
  if (/\.sql$/.test(filePath)) return text.replace(BLOCK, blank).replace(SQL_LINE, blank);
  if (/\.(scss|css|ts|js|mjs)$/.test(filePath)) {
    return text
      .replace(BLOCK, blank)
      .replace(LINE, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  }
  return text;
}
