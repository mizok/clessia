/**
 * 報名的稽核識別字串與 details。
 *
 * ## 為什麼 enrollment 需要一支專用的
 *
 * `audit_logs.resource_name` 對大多數實體就是那個實體的名字（分校名、科目名）——
 * **而報名沒有名字**。行政上追問的形狀是「誰把**這個學生**加進**這個班**」，
 * 所以識別字串要把兩者都帶上。
 *
 * 形狀照 `routes/leaves.ts` 的 `buildLeaveAuditResourceName`（`學生 / 期間`）——
 * **不自創第二種寫法**：兩張稽核表要能並排讀。
 *
 * ## 為什麼 details 不記帳單欄位
 *
 * `enrollments` 有 `billing_mode` / `fee_template_id` / `agreed_amount`，
 * 而 **`PATCH /:id` 改不到它們**（它只收 `effectiveFrom` / `effectiveTo` / `notes`）。
 * 建立時它們會被寫入，所以 `create` 的 details 帶得到 —— **那是刻意的**：
 * 議價金額是最常被追問的東西之一，而它只在建立那一刻被決定。
 *
 * ⚠️ **這一支不參與任何金額計算**，只把已經決定好的值抄進稽核紀錄。
 * 要改金額怎麼算，那是別的地方的事（#846 的邊界：enrollments 是金額上游，
 * 動到帳單欄位的**邏輯**要先報）。
 */

/**
 * ⚠️ **關聯欄位要同時接受「物件」與「陣列」。**
 *
 * supabase-js 的型別推導把 `students(name)` 這種單一關聯推成 **`{…}[]`**，
 * 而 **runtime 回的是單一物件**（實測：`resource_name` 正確產出「王小明 / 國三數學 A 班」）。
 * 只宣告物件會 TS2345，只宣告陣列會在 runtime 取不到值 —— **兩種都收，取第一個。**
 */
type MaybeRelation<T> = T | readonly T[] | null | undefined;

interface EnrollmentAuditRow {
  readonly students?: MaybeRelation<{ name?: string | null }>;
  readonly classes?: MaybeRelation<{ name?: string | null }>;
  readonly student_id?: string | null;
  readonly class_id?: string | null;
}

function relationName(relation: MaybeRelation<{ name?: string | null }>): string | null {
  const one = Array.isArray(relation) ? relation[0] : relation;

  return (one as { name?: string | null } | null | undefined)?.name?.trim() || null;
}

/**
 * `學生名 / 班名`。任一邊查不到就退成 id —— **不要退成空字串**：
 * 稽核列上的空白讀起來像「這筆沒有學生」，而那跟「我沒讀到名字」是兩件事。
 */
export function buildEnrollmentAuditResourceName(
  row: EnrollmentAuditRow | null | undefined,
): string {
  const student = relationName(row?.students) || row?.student_id || '（學生未知）';
  const klass = relationName(row?.classes) || row?.class_id || '（班級未知）';

  return `${student} / ${klass}`;
}

/**
 * 建立時的 details：學生、班級、期間、狀態，**以及帳單欄位的當下值**。
 *
 * 帳單欄位是刻意帶上的 —— `agreed_amount`（議價）只在建立那一刻被決定，
 * 而「這個學生為什麼收這個價」是行政上會被追問的事。
 */
export function buildEnrollmentCreateDetails(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    student_id: row['student_id'] ?? null,
    class_id: row['class_id'] ?? null,
    status: row['status'] ?? null,
    effective_from: row['effective_from'] ?? null,
    billing_mode: row['billing_mode'] ?? null,
    fee_template_id: row['fee_template_id'] ?? null,
    agreed_amount: row['agreed_amount'] ?? null,
  };
}
