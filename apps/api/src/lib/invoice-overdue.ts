/**
 * 「這張帳單逾期了嗎」的**唯一定義**：有到期日、而且**過了**到期日
 * （`kb/wiki/rules/billing-rules.md:63`「欠」的定義）。到期日當天不算。
 *
 * 這支存在的理由不是省行數 —— 是這條判斷原本有**兩個獨立實作**：
 * `routes/invoices.ts` 的繳費頁列表下在 SQL 上（`due_date < 今天`），
 * `lib/revenue-report.ts` 的營收報表算在記憶體裡（`dueDate !== null && dueDate < today`）。
 * 兩邊一致是因為碰巧寫得一樣，不是結構上不可能不一致：任何一邊把 `lt` 改成 `lte`、
 * 或改了 null 的處理，使用者就會**對同一張帳單在繳費頁與營收報表看到相反的結論**
 * （繳費頁說逾期、報表說沒有）。這個形狀在本專案發生過一次
 *（及格線 `passScore`：行政端不及格、家長端及格），所以這次主動收斂。
 *
 * **今天是哪一天不在這裡決定** —— 基準日一律由呼叫端從
 * `lib/taipei-date.ts` 的 `getCurrentTaipeiDateString()` 取（台北，不是 UTC）。
 * 這支只回答「相對於這個基準日，過期了沒」，跟 `addDaysToDateString` 一樣
 * 刻意不碰「現在」。
 *
 * **「未繳清」那一半刻意不收進來**：繳費頁要的是「這一列該不該出現」
 *（`status !== 'paid'`），報表要的是「還欠多少錢」（`max(0, billed - paid)`）——
 * 一個是成員資格、一個是金額，形狀不同，硬壓成同一支函式會讓其中一端拿到
 * 別人定義的子集。共用的是**日期那一半**，它在兩邊問的是同一個問題。
 */

/** 逾期判斷所在的欄位。SQL 與記憶體兩側共用同一個名字，改欄位時只有一處要改 */
export const OVERDUE_DUE_DATE_COLUMN = 'due_date';

/** 相對於 `today`（`YYYY-MM-DD`），這個到期日過了沒。沒有到期日 = 還沒發收費袋，不算欠 */
export function isOverdueOn(dueDate: string | null, today: string): boolean {
  return dueDate !== null && dueDate < today;
}

/**
 * 把同一條判斷下到 postgrest 查詢上。
 *
 * SQL 的 null 語意跟 `isOverdueOn` 的 `dueDate !== null` 在這裡是同一個結果：
 * `due_date < '2026-03-31'` 對 NULL 回 NULL，那一列不會被撈出來。
 */
export function whereOverdue<Q extends { lt(column: string, value: string): Q }>(
  query: Q,
  today: string,
): Q {
  return query.lt(OVERDUE_DUE_DATE_COLUMN, today);
}

/**
 * 「快到期」：到期日落在 `[today, today + days]` 這個**閉區間**裡。
 *
 * 邊界是刻意的:
 * - **`today` 含**（今天到期就是最急的那一批,不含它等於把最該提醒的漏掉）
 * - **`today + days` 含**（使用者說「七天內」時,第七天在裡面）
 * - **跟 `whereOverdue` 不重疊**:那支是 `< today`,這支從 `today` 開始 ——
 *   同一張帳單不會同時出現在兩批裡,所以 UI 的三選一才是真的互斥。
 *
 * **沒有到期日的帳單不在這裡**（SQL 對 NULL 的比較回 NULL,那些列撈不出來）——
 * 而那是對的:**還沒告訴家長什麼時候要繳,就談不上快到期**。
 * 它們仍然算「未繳清」（`outstanding`,那條沒有日期條件）。
 * 這個分界是使用者 2026-09-07 裁的,理由見 `routes/invoices.ts` 的 `outstanding` 註解。
 *
 * `until` 由呼叫端用 `lib/taipei-date.ts` 的 `addDaysToDateString` 算 ——
 * 跟 `whereOverdue` 一樣,**這支不碰「現在」**。
 */
export function whereDueWithin<
  Q extends { gte(column: string, value: string): Q; lte(column: string, value: string): Q },
>(query: Q, today: string, until: string): Q {
  return query.gte(OVERDUE_DUE_DATE_COLUMN, today).lte(OVERDUE_DUE_DATE_COLUMN, until);
}
