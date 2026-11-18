/**
 * ESLint bulk suppressions 檔（`eslint-suppressions.json`）的總筆數（#2542，A31）。
 *
 * 格式是 ESLint 9.24+ 原生：`{ "<檔案>": { "<規則>": { "count": N } } }`。
 * 壞掉的 JSON 直接丟 —— 帳讀不懂時不能當成 0 放行。
 *
 * @param {string} text 檔案內容
 * @returns {number}
 */
export function suppressionTotal(text) {
  const data = JSON.parse(text);
  let total = 0;
  for (const rules of Object.values(data)) {
    for (const entry of Object.values(rules)) total += entry.count;
  }
  return total;
}
