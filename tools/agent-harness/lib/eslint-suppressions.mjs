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

/**
 * A31 的基準：main 上有這份帳就用它的總筆數；沒有時（已歸零刪檔，或帳還沒建）用 `seed`
 * （預設 0）。`seed` 是**一次性的立帳上限** —— 重新開規則（例：#2558 a11y）要記一份新帳時，
 * 在 check-harness 的 A31_SEED 登記該路徑與筆數；那份帳歸零刪檔的 PR 同時刪掉這筆登記。
 *
 * @param {string|null} mainText main 上同一份檔的內容，沒有就 null
 * @param {number} [seed]
 * @returns {number}
 */
export function suppressionBase(mainText, seed = 0) {
  return mainText == null ? seed : suppressionTotal(mainText);
}
