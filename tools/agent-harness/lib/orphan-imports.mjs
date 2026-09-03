/**
 * 抓「import 了但模板沒用到」的 PrimeNG NgModule。
 *
 * ## 為什麼需要這個
 *
 * Angular 的 NG8113（unused import）**只對 standalone 元件／指令／pipe 發出診斷，
 * 不涵蓋 NgModule**。所以 `imports: [TagModule]` 在模板早就不用 `<p-tag>` 之後，
 * 編譯器一句話都不會說。
 *
 * 這個坑在這個 repo 已經長出來過兩次：
 * - 刀 3a-1（#119）：admin-pages 在 review 時人工發現三支孤兒
 * - 刀 3b-3 收尾（2026-09）：盤點時發現 **10 支**，而 build 的 NG8113 計數是 **0**
 *
 * 兩次都是靠人記得去對帳。**第三次不要再靠人。**
 *
 * ## 能力邊界
 *
 * - 只看 `templateUrl` 指向的那支 `.html`。inline template 一併掃 `.ts` 自己
 * - 只認**已知的 PrimeNG 模組 → 選擇器**對映（下面那張表）。表上沒有的模組不掃 ——
 *   寧可漏報也不要誤報，因為誤報的 gate 會被關掉
 * - 一個模組可能提供多個選擇器（例如 `ButtonModule` 也提供 `p-buttongroup`），
 *   所以對映的值是**陣列**，任一個出現就算有用到
 */

/**
 * PrimeNG 模組 → 它提供的選擇器。只列這個 repo 實際用到的。
 *
 * **一個模組常常同時提供元件與指令**，兩種都要列。第一版只列了元件選擇器，
 * 結果 `ButtonModule` 對 7 支用 `<button pButton>` 指令的檔案全部誤報 ——
 * 而誤報的 gate 會被關掉，那比沒有 gate 更糟（這句就寫在下面的能力邊界裡，
 * 我自己先違反了一次）。
 */
const MODULE_SELECTORS = {
  TagModule: ['<p-tag'],
  ButtonModule: ['<p-button', '<p-buttongroup', 'pButton'],
  SelectModule: ['<p-select'],
  MultiSelectModule: ['<p-multiselect'],
  DatePickerModule: ['<p-datepicker', '<p-datePicker'],
  InputNumberModule: ['<p-inputnumber', '<p-inputNumber'],
  InputTextModule: ['pInputText', '<p-inputtext'],
  CheckboxModule: ['<p-checkbox'],
  SelectButtonModule: ['<p-selectbutton', '<p-selectButton'],
  ToastModule: ['<p-toast'],
  DrawerModule: ['<p-drawer'],
};

/**
 * @param {Array<{path: string, ts: string, template: string}>} components
 *   `ts` 是元件原始碼，`template` 是模板內容（inline 的話傳同一份）
 * @returns {{path: string, module: string}[]} 孤兒，已排序
 */
export function orphanModuleImports(components) {
  const hits = [];
  for (const { path, ts, template } of components) {
    for (const [mod, selectors] of Object.entries(MODULE_SELECTORS)) {
      // 必須真的出現在 imports 陣列裡，不是只有 import 陳述式
      if (!new RegExp(`\\n\\s*${mod},`).test(ts) && !new RegExp(`imports:\\s*\\[[^\\]]*\\b${mod}\\b`, 's').test(ts)) {
        continue;
      }
      const haystack = `${template}\n${ts}`;
      if (!selectors.some((s) => haystack.includes(s))) hits.push({ path, module: mod });
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path) || a.module.localeCompare(b.module));
}
