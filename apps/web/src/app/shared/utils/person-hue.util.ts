/**
 * 由人員 id 算出頭像色相。**同一個人在任何頁面都要是同一個顏色** ——
 * 這是它唯一的契約，也是為什麼它必須只有一份實作。
 *
 * 2026-09-02 抽出來之前，這段有**六份一模一樣的副本**（parents / students /
 * student-detail / staff / class-detail / student-picker），兩個函式名，零測試。
 * 任何一份被改（有人覺得太暗想調一下），使用者會看到同一個學生在兩頁不同色 ——
 * 而顏色不同**看起來像有意義**，那才是真正的傷害。常數與演算法的漂移不會有
 * 任何測試變紅，所以這裡留了一支釘住它的測試。
 *
 * 色相**不編碼任何語意**（不是年級、不是狀態、不是身分類別），純粹用來區辨個體 ——
 * 所以它不違反「色相只編碼嚴重度」那條法則。用途僅限頭像底色。
 */

/** 落在 [45, 320) 之外的色相會被推進來 —— 避開紅褐一帶，免得跟 danger 撞色 */
const HUE_RANGE = 320;
const HUE_FLOOR = 45;
const HUE_SHIFT = 160;

export function personHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xfffffff;
  }
  const raw = hash % HUE_RANGE;
  return raw < HUE_FLOOR ? raw + HUE_SHIFT : raw;
}
