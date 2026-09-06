/**
 * 守「分校過濾參數不得繞過 `campusRequestGuard`」。
 *
 * ## 問題形狀
 *
 * `campusRequestGuard`（`middleware/auth.ts:197`）攔的是**列舉出來的那幾個參數名**：
 * 它逐一讀 `campusId` / `campus_id` / `campusIds` / `campus_ids`，比對使用者的
 * `campusScope`，不在範圍內就擋。
 *
 * **所以任何叫別的名字的分校參數都會直接穿過它** —— 例如 `campusFilter`、
 * `homeCampusId`。程式編得過、測試也綠，而**使用者拿得到別的分校的資料**。
 *
 * 那不是「少了一道檢查」，是**授權的漏洞**：守衛還在，只是這個請求它沒認出來。
 *
 * ## 判準：名字裡有 campus 的 query 參數，必須在守衛的列舉集合裡
 *
 * **集合從 `auth.ts` 的原始碼推導，不在這裡複製一份。** 複製的話就有兩份清單，
 * 而有人往守衛加第五個名字時它們會漂 —— 那正是這道 gate 要防的病的變體。
 *
 * ## 這支看不到什麼（**這段也寫進 fail 訊息，不能只寫在這裡**）
 *
 * - **只看 query 參數。** `body` 與 path 參數在它視野外 ——
 *   `POST /api/x { campusId }` 這種它完全看不到，而 `campusRequestGuard`
 *   讀的也只有 `url.searchParams`，所以那一半**目前沒有任何機制在守**。
 * - **只看 `GET`**（沿用 `collectApiParams` 的範圍）。
 * - **不驗語意**：一個叫 `campusId` 的參數如果實際上不是分校 id，它照樣放行。
 *
 * 一道只蓋一半的 gate，**如果不說，會被讀成蓋全部** —— 而那比沒有 gate 更糟。
 */

/** 名字裡有 campus 就該被守衛認得 */
const CAMPUS_NAME = /campus/i;

/**
 * 從 `middleware/auth.ts` 的原始碼抽出守衛實際列舉的參數名。
 *
 * 抓的是 `url.searchParams.getAll('<name>')` —— 那是守衛**真正讀的東西**，
 * 而不是註解或型別。有人加了第五個名字，這裡自動跟上。
 */
export function guardedParamNames(authSource) {
  return new Set(
    [...authSource.matchAll(/searchParams\.getAll\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  );
}

/**
 * @param {Record<string, string[]>} apiParams `{ '/api/x': ['a','b'] }`
 * @param {Set<string>} guarded
 * @returns {Array<{path: string, param: string}>} 已排序
 */
export function unguardedCampusParams(apiParams, guarded) {
  const hits = [];
  for (const [path, params] of Object.entries(apiParams)) {
    for (const name of params) {
      if (CAMPUS_NAME.test(name) && !guarded.has(name)) hits.push({ path, param: name });
    }
  }
  return hits.sort((a, b) => `${a.path}|${a.param}`.localeCompare(`${b.path}|${b.param}`));
}
