/**
 * 從 `.ts` 裡把 inline template 與 inline styles 挖出來。
 *
 * ## 為什麼需要這支
 *
 * 2026-09-04 的 gate 載體盲區掃描結論：**在 Angular 裡，`.ts` 檔同時也是模板、
 * 也是樣式表。** 而 12 道 gate 裡剛好只有 1 道伸手進 `.ts`（orphan-imports，
 * 它把整份 `.ts` 併進 haystack），剛好只有 1 道伸手進 `index.html`（ghost-token）——
 * 而且是不同的兩道。沒有人系統性問過載體，都是各自撞到才補。
 *
 * repo 現況：**15 支 inline template、3 支 inline styles**，其中
 * `leave-form-dialog.component.ts` 兩者皆是（沒有 `.html` 也沒有 `.scss`），
 * 於是它同時對 c7、雙軌表格、對比、ghost-token、page-actions **五道 gate 隱形**。
 *
 * 那個盲區裡真的躺過一個 bug：它寫 `color: var(--red-500)` 而 `--red-500`
 * 從未定義（專案用 `--error-*`），沒有 fallback，所以必填星號根本不是紅的。
 * **抓這種的 gate 存在、而且當天還在報別的 token** —— 它抓不到只因為載體。
 *
 * ## 這支看不到什麼
 *
 * - **不是 TS 解析器**，是抓 `template:` / `styles:` 後面第一段反引號字串。
 *   模板裡自己含反引號會截斷（Angular 模板實務上不會，repo 現況 0 例）。
 * - **`${}` 內插**原樣留著。對 regex 型的 gate（找 `*ngIf`、找 `90vw`）沒差，
 *   對要解析結構的 gate 可能會看到怪東西。
 * - 只認**單引號/雙引號以外**的樣板字串。`styles: ['...']` 這種字串陣列抓不到
 *   （repo 現況 0 例；真出現的話它會安靜地被跳過，這是刻意的保守方向：
 *   **漏報比誤報便宜**）。
 */

/** `template:` 或 `styles:` 後面的第一段反引號字串（沒有就回空字串） */
function backtickAfter(source, key) {
  const at = source.search(new RegExp(`\\b${key}\\s*:`));
  if (at === -1) return '';
  const open = source.indexOf('`', at);
  if (open === -1) return '';
  const close = source.indexOf('`', open + 1);
  return close === -1 ? '' : source.slice(open + 1, close);
}

/** inline template 的內容；用 `templateUrl` 的元件回空字串 */
export function inlineTemplate(source) {
  return backtickAfter(source, 'template');
}

/** inline styles 的內容；用 `styleUrl(s)` 的元件回空字串 */
export function inlineStyles(source) {
  return backtickAfter(source, 'styles');
}

/**
 * 把一批 `.ts` 檔攤成「模板載體」與「樣式載體」兩份清單，
 * 好讓既有 gate 直接吃 —— 它們本來就在吃 `{path, source}` 這個形狀。
 *
 * @param {Array<{path: string, source: string}>} tsFiles
 * @returns {{templates: Array<{path: string, source: string}>, styles: Array<{path: string, source: string}>}}
 */
export function inlineCarriers(tsFiles) {
  const templates = [];
  const styles = [];
  for (const { path, source } of tsFiles) {
    if (!source.includes('@Component')) continue;
    const t = inlineTemplate(source);
    if (t.trim()) templates.push({ path, source: t });
    const s = inlineStyles(source);
    if (s.trim()) styles.push({ path, source: s });
  }
  return { templates, styles };
}
