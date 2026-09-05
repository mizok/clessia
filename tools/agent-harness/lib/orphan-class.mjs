/**
 * 守「**可點的東西看起來不可點**」。
 *
 * ## 起因
 *
 * 2026-09-05 tester 回報「課程管理的『需介入 N 個課程』告警不可點」。
 * 那一則的成因後來查出是別的（它有樣式，只是被畫成徽章），**但形狀是真的**：
 * 一個 class 名同時活在兩個載體（template 與 SCSS），而**沒有任何東西檢查它們對得上**。
 *
 * 失效是完全沉默的 —— 編譯過（class 是字串，Angular 不驗）、測試過（測 DOM 與行為，
 * 不測視覺）、review 過（HTML 那行看起來很正常），**畫面上也「正常」，只是長得像別的東西**。
 *
 * ## 為什麼只守可互動元素，不守所有 class
 *
 * 全站掃出 81 個「用了但沒定義」的自家 class，**但嚴重度差太多**：
 * 10 筆是死修飾詞（基底有定義，`--x` 沒有 → 基底樣式照樣套，零視覺後果），
 * 多數是遷去共用元件之後的殘留。**一份 81 筆、大多無害的 baseline 沒有人會去清，
 * 而清不完的 ratchet 等於裝飾** —— 它長期發出「有債」的訊號，而那訊號永遠不變。
 *
 * 只有「**可互動元素的 class 全部沒定義**」這一種有使用者看得到的後果：
 * 它會吃全域 `button` reset，渲染成一段純文字，於是**沒有人會去點它**。
 *
 * ## 這支看不到什麼
 *
 * - **定義側一定要收齊三種載體**：`.scss`、`.ts` 的 `styles:` inline、
 *   以及 `index.html` 的 `<style>` 區塊。**我第一版只讀 `.scss`，
 *   當場把 `leave-form-dialog`（全 inline）的 12 個 class 判成孤兒** ——
 *   而那正是 2026-09-04 載體盲區調查的結論：**在 Angular 裡 `.ts` 同時也是樣式表**。
 *   自己寫的掃描器踩自己記過的坑，所以這條寫在最前面。
 * - **`definedClasses` 是全域集合**，不分元件。Angular 的 emulated encapsulation
 *   其實會讓「A 元件定義、B 元件使用」失效，但那樣判會誤報全域 utility 與
 *   `::ng-deep`，**代價不划算**。所以這裡刻意寬鬆：只要全庫任何一支 SCSS 定義過就算數。
 * - **動態組出來的 class**（`[class]="'x-' + kind"`）看不到。
 * - **外部 class**（`p-*` PrimeNG、`pi*` 圖示）一律跳過 —— 它們的定義不在本 repo。
 * - 元素**有任何一個 class 有定義**就放行：它至少有樣式，剩下的是設計判斷不是缺陷。
 */

import { blocks } from './scss-blocks.mjs';

/** 定義不在本 repo 的 class 前綴 */
const EXTERNAL = /^(p-|pi\b|pi-)/;

/**
 * 全庫 SCSS 定義過的 class 名。
 *
 * **一定要解析 `&` 巢狀。** `.courses { &__badge { … } }` 編出來是 `.courses__badge`，
 * 而那個字串在原始碼裡**根本不存在** —— 用字面 grep 找它會回零筆，
 * 於是這個 codebase 裡幾乎每一個 BEM class 都會被誤判成「沒定義」。
 * （2026-09-05 那則錯誤的 bug 診斷就是這樣來的。）
 */
export function definedClasses(scssSources) {
  const out = new Set();
  for (const source of scssSources) {
    for (const b of blocks(source)) {
      for (const m of b.selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)) out.add(m[1]);
    }
  }
  return out;
}

/**
 * 模板裡「可互動、而且 class 全部沒定義」的元素。
 *
 * @param {string} template
 * @param {Set<string>} defined
 * @returns {string[]} 每筆是那個元素的 class 字串
 */
export function unstyledInteractive(template, defined) {
  const hits = [];
  // `[^>]` **會**吃換行 —— 這很重要：Angular 模板經 prettier 之後，
  // 有幾個屬性的 button 幾乎一定是多行的。只配對單行的 regex
  // 會漏掉幾乎所有真實案例，而那樣得到的 0 跟真正的 0 在輸出上一模一樣。
  for (const m of template.matchAll(/<(?:button|a)\b[^>]*>|<[a-z][a-z-]*[^>]*\(click\)[^>]*>/g)) {
    const attr = /\bclass\s*=\s*"([^"]*)"/.exec(m[0]);
    if (!attr) continue;
    const classes = attr[1]
      .split(/\s+/)
      .filter((c) => /^[a-zA-Z][\w-]*$/.test(c) && !EXTERNAL.test(c));
    if (classes.length === 0) continue;
    if (classes.every((c) => !defined.has(c))) hits.push(classes.join(' '));
  }
  return hits;
}
