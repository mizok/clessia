/**
 * 稽核紀錄的「改了什麼」。
 *
 * ## 為什麼需要 before
 *
 * 只記改完後的值，稽核就只答得出「現在是什麼」—— 而那個問題查資料表就有答案。
 * 真正要問稽核的是**「改成什麼」的另一半：原本是什麼**。
 * #837 的實例：分校的五筆稽核 `details` 全是 `{}`，`update` 只留改完後的名字，
 * 於是「這一筆改了什麼」完全查不到（labor-8 比對六種 `resource_type` 時發現）。
 *
 * ## 只記這次真的送出的欄位
 *
 * 一次只改一個欄位時，稽核紀錄不該看起來像整筆都動了 ——
 * 那會讓「誰改了 X」這個問題在**每一筆**變更上都得到「可能是他」的答案（#828 的原則）。
 *
 * 所以 `fields` 是 payload 的 key，`from` / `to` 都只取那些欄位。
 *
 * ## 為什麼是一支共用函式而不是兩邊各寫
 *
 * `campuses` 與 `schools` 是同一個形狀，而**兩處各自推論同一件事就會分岔一次**
 * （#815 的教訓）—— 尤其「from 取哪些欄位」這種選擇，兩邊寫得不一樣時
 * 兩張稽核表就不能互相對照了。
 */
// `extends Record<string, unknown>` 是為了能指派給 `AuditLogParams.details` ——
// 沒有 index signature 的 interface 過不去（TS2322）。
export interface AuditFieldDiff extends Record<string, unknown> {
  readonly fields: string[];
  readonly from: Record<string, unknown>;
  readonly to: Record<string, unknown>;
}

/**
 * @param before 改動前的整列（`select('*')` 的結果；`null` 代表讀不到）
 * @param payload 這次實際送出的欄位（**DB 欄位名**，不是 API 的 camelCase）
 */
export function auditFieldDiff(
  before: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown>,
): AuditFieldDiff {
  const fields = Object.keys(payload);

  return {
    fields,
    // **讀不到 before 時每個欄位給 `null`，而不是整個 `from` 省略** ——
    // 省略的話「原本是空的」與「我沒讀到」在稽核上長得一樣。
    from: Object.fromEntries(fields.map((field) => [field, before?.[field] ?? null])),
    to: payload,
  };
}

/**
 * 刪除的稽核 details：刪前的快照。
 *
 * **刪完就查不到了**，所以這是唯一一次機會。只挑會被追問的欄位而不是整列 ——
 * 整列會把 `created_at` / `updated_at` 這些「不是人改的」欄位一起塞進去。
 */
export function auditDeleteSnapshot(
  before: Record<string, unknown> | null | undefined,
  fields: readonly string[],
): Record<string, unknown> {
  if (!before) return {};

  return Object.fromEntries(fields.map((field) => [field, before[field] ?? null]));
}
