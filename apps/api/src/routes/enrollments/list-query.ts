/**
 * 報名列表的查詢條件組裝。
 *
 * 抽出來是因為「本月進出」的期間條件跨兩個欄位：新報名看 `effective_from`、
 * 退班看 `effective_to`（退班時會把 effective_to 寫成當天）。這是一個 OR，
 * 不是單一欄位的範圍，而 PostgREST 的 `.or()` 字串很容易寫錯又不會報錯 ——
 * 錯的結果是「篩選看起來有作用但漏掉一半的列」，安靜且難以察覺。
 */

/** 一個欄位落在 [from, to] 的條件；只給單邊就只比單邊 */
function columnInRange(column: string, from?: string, to?: string): string | null {
  const parts: string[] = [];
  if (from) parts.push(`${column}.gte.${from}`);
  if (to) parts.push(`${column}.lte.${to}`);

  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `and(${parts.join(',')})`;
}

/**
 * 期間內「發生過事情」的報名：這段期間開始生效（新報名），或這段期間結束（退班）。
 *
 * 回傳的字串直接餵給 PostgREST 的 `.or()`；沒有任何期間條件時回 null（代表不篩）。
 */
export function buildPeriodFilter(from?: string, to?: string): string | null {
  const started = columnInRange('effective_from', from, to);
  const ended = columnInRange('effective_to', from, to);

  if (!started || !ended) return null;
  return `${started},${ended}`;
}

const SELECT_COLUMNS =
  'id, org_id, class_id, student_id, status, billing_mode, fee_template_id, agreed_amount, adjustment_note, effective_from, effective_to, notes, created_by, created_at, updated_at';
const SELECT_RELATIONS =
  '(name, campus_id, campuses(name), courses(id, name)), students(name, grade, schools(id, name, short_name)), creator:ba_user!created_by(name)';

/**
 * 依分校過濾時，classes 的關聯必須是 inner join。
 *
 * PostgREST 的巢狀過濾預設走 left join —— 少了 `!inner`，`classes.campus_id` 條件不成立的
 * 報名不會被排除，只會把 classes 關聯變成 null 留在結果裡。那看起來像「篩選壞掉」，
 * 而且班級欄位會整排空白。
 */
export function buildSelect(campusId?: string): string {
  return `${SELECT_COLUMNS}, ${campusId ? 'classes!inner' : 'classes'}${SELECT_RELATIONS}`;
}

export type EnrollmentSort = 'createdAt' | 'updatedAt';

/**
 * 排序欄位。預設維持 `created_at` —— 班級花名冊與學生在籍清單都吃這支 API，
 * 改成 updated_at 會讓學生在狀態一變動就跳到名單最上面。
 *
 * 進出總覽才要 `updated_at`：新報名的 updated_at 就是建立時間、退班的就是退班時間，
 * 兩種列的最後異動時間剛好等於它的事件日。
 */
export function sortColumn(sort?: EnrollmentSort): string {
  return sort === 'updatedAt' ? 'updated_at' : 'created_at';
}
