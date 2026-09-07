/**
 * 課堂狀態的篩選詞彙 —— **單一來源**（#640）。
 *
 * 這組東西原本有兩份：`features/admin/pages/sessions/components/session-filters`
 * 與 `shared/components/session-advanced-filters-dialog` 各自宣告了一份
 * `SESSION_STATUS_OPTIONS` 與 `DEFAULT_STATUSES`，而「這組狀態算不算一個條件」
 * 的判斷更是有**三份實作、兩種寫法**：
 *
 * | 位置 | 舊寫法 | |
 * | --- | --- | --- |
 * | `sessions.page.ts` | 排序後 join 比內容 | ✅ |
 * | `mobile-filter-dialog` | 逐字相同的第二份 | ✅ |
 * | `session-advanced-filters-dialog` | `length !== DEFAULT_STATUSES.length` | ❌ |
 *
 * 第三份只比長度，於是「正常 + 已停課」（長度同樣是 2）也被算成 0 個條件。
 *
 * **放在 `shared/` 而不是 feature 裡**，因為使用者之一是 `shared/components` 的對話框
 * —— shared 依賴 feature 是反方向（c5）。
 */

// **不用 `ReadonlyArray`** —— PrimeNG 的 `[options]` 收的是可變 `any[]`，
// 唯讀陣列在模板型別檢查會紅（TS4104）。
export const SESSION_STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '正常', value: 'scheduled' },
  { label: '已完成', value: 'completed' },
  { label: '已停課', value: 'cancelled' },
];

export const ALL_SESSION_STATUSES = SESSION_STATUS_OPTIONS.map((option) => option.value);

/**
 * 課堂列表的預設狀態 —— **不含已停課**。
 *
 * 日常操作不想看到停課的課堂，這個預設本身是合理的。**問題從來不是它存在，
 * 是它不可見**：停完課那堂就從列表消失，而畫面上沒有任何東西說有篩選在作用
 * （#640，可用性測試席以為自己按錯了）。可見性由頁首的「已隱藏 N 堂」處理。
 */
export const DEFAULT_STATUSES = ['scheduled', 'completed'];

/**
 * 這組狀態有沒有**正在濾掉東西**。
 *
 * **不是問「跟預設一不一樣」** —— 那個問題回答不了使用者真正在問的
 * 「我現在有沒有看到全部」。預設值本身就在濾掉已停課，所以它**是**一個生效中的條件。
 *
 * 實測舊版的計數是**反過來的**：三種全選（沒有濾掉任何東西）報「1 個進階條件」，
 * 而預設（正在濾掉停課）報「0 個進階條件」。
 */
export function statusesAreFiltering(statuses: readonly string[]): boolean {
  return statuses.length > 0 && statuses.length < ALL_SESSION_STATUSES.length;
}
