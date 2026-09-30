/**
 * 守「icon-only 的按鈕必須有可及名稱」。
 *
 * ## 為什麼是 gate 而不是 review 項
 *
 * 一顆只有圖示的按鈕，螢幕閱讀器唸出來是 **「按鈕」** —— 沒有別的。
 * 這種缺漏**在畫面上完全看不出來**：視覺上那顆鈕跟隔壁有 aria-label 的長得一模一樣，
 * 所以 code review 抓不到、手動點也抓不到，只有**讀 DOM 或用輔助技術**才會發現。
 * 「看不出來的缺漏」正是 gate 該守的那一類。
 *
 * ## 三種形狀，判準各不相同
 *
 * ### 1. `<p-button icon="…">` 沒有 `label` 也沒有 `ariaLabel`
 *
 * PrimeNG 的 `p-button` 在沒有 `label` 時只渲染 `<span class="pi …">`，
 * 按鈕裡**一個文字節點都沒有**。它有 `ariaLabel` 這個 input 就是為了這種用法。
 *
 * ### 2. 原生 `<button>` 內容只有標籤、而且沒有 `aria-label`
 *
 * 判的是「把 HTML 標籤與註解都拿掉之後**剩不剩下文字**」——
 * `{{ }}` 插值算文字（那是動態名稱，不是沒有名稱）。
 *
 * ### 3. ⚠️ 原生 `<button>` 上寫 `ariaLabel` / `[ariaLabel]` —— **靜默失效**
 *
 * 這一條是這支 gate 最值得存在的理由。`ariaLabel` 是 **PrimeNG 元件的 input**，
 * 原生元素上對應的 DOM 屬性叫 `aria-label`。在原生 `<button>` 上寫：
 *
 * ```html
 * <button [ariaLabel]="'關閉'">   <!-- ✗ 什麼都不會發生 -->
 * ```
 *
 * Angular 會把它當成 property binding，而原生 `HTMLButtonElement` **沒有 `ariaLabel`
 * 這個 property**（`ariaLabel` 的 DOM reflection 是新標準，Angular 不保證映射到屬性）——
 * 於是 **DOM 上沒有 `aria-label`，畫面完全正常，而作者以為自己已經處理好了**。
 * 正確寫法是 `aria-label="關閉"` 或 `[attr.aria-label]="…"`。
 *
 * > 這跟「加了 aria 但寫錯載體」是同一族：**做了一半比沒做更難發現**，
 * > 因為 grep 「aria」會命中它，而它其實沒有生效。
 *
 * ## 邊界
 *
 * - 只掃 `apps/web/src/app/**\/*.html` —— Angular template 不是嚴格 HTML，
 *   這裡跟 A13（`*ngIf`）一樣用正則，接受它抓不到跨檔組裝出來的標籤。
 * - `<button pButton label="…">`（directive 版）**算合規** —— PrimeNG 會把 label 渲染成文字。
 * - `routerLink` / `<a>` 不在範圍內：連結有自己的可及名稱規則（A17 的觸控範圍才管它們）。
 */

const ATTR = (name) =>
  new RegExp(`(?:\\[|\\(|\\[\\()?${name.replace('.', '\\.')}(?:\\)|\\])?\\s*=`);

const HAS_ICON = ATTR('icon');
const HAS_LABEL = ATTR('label');
const HAS_ARIA_LABEL_INPUT = ATTR('ariaLabel');
const HAS_NATIVE_ARIA = /aria-label\s*=|\[attr\.aria-label\]\s*=/;
/** 原生元素上的 PrimeNG input 寫法 —— 這一條抓的是「寫了但不生效」 */
const WRONG_ARIA_ON_NATIVE = /(?:\[ariaLabel\]|\bariaLabel)\s*=/;

/**
 * @param {Array<{ path: string, text: string }>} files
 * @returns {Array<{ path: string, kind: 'p-button'|'native'|'wrong-aria-label', snippet: string }>}
 */
export function ariaIconButtonViolations(files) {
  const out = [];

  for (const { path, text } of files) {
    for (const m of text.matchAll(/<p-button\b([^>]*?)\/?>/gs)) {
      const attrs = m[1];
      if (!HAS_ICON.test(attrs)) continue;
      if (HAS_LABEL.test(attrs)) continue;
      if (HAS_ARIA_LABEL_INPUT.test(attrs) || HAS_NATIVE_ARIA.test(attrs)) continue;
      out.push({ path, kind: 'p-button', snippet: squash(m[0]) });
    }

    for (const m of text.matchAll(/<button\b([^>]*?)>(.*?)<\/button>/gs)) {
      const attrs = m[1];
      const inner = m[2];

      // 先判「寫錯載體」—— 它比「沒有名稱」更值得報，因為作者以為自己做過了
      if (WRONG_ARIA_ON_NATIVE.test(attrs)) {
        out.push({ path, kind: 'wrong-aria-label', snippet: squash(m[0].slice(0, 120)) });
        continue;
      }

      if (HAS_NATIVE_ARIA.test(attrs) || HAS_LABEL.test(attrs)) continue;

      const visible = inner
        .replace(/<!--.*?-->/gs, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (visible) continue; // `{{ }}` 插值也算 —— 那是動態名稱不是沒有名稱

      out.push({ path, kind: 'native', snippet: squash(m[0].slice(0, 120)) });
    }
  }

  return out;
}

function squash(s) {
  return s.replace(/\s+/g, ' ').trim();
}
