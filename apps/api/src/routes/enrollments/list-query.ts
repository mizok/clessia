/**
 * 報名列表的查詢條件組裝。
 *
 * 抽出來是因為「本月進出」的期間條件跨兩個欄位：新報名看 `effective_from`、
 * 退班看 `effective_to`（退班時會把 effective_to 寫成當天）。這是一個 OR，
 * 不是單一欄位的範圍，而 PostgREST 的 `.or()` 字串很容易寫錯又不會報錯 ——
 * 錯的結果是「篩選看起來有作用但漏掉一半的列」，安靜且難以察覺。
 */

/** 一個欄位落在 [from, to] 的條件；只給單邊就只比單邊 */
function columnInRange(column: string, from?: string, to?: string): string[] {
  return [...(from ? [`${column}.gte.${from}`] : []), ...(to ? [`${column}.lte.${to}`] : [])];
}

/** 報名進出的四種事件（A6 / #1314 EN5；字面跟前端 `enrollment-event.util.ts` 對齊） */
export const ENROLLMENT_EVENT_KINDS = ['joined', 'left', 'paused', 'voided'] as const;
export type EnrollmentEventKind = (typeof ENROLLMENT_EVENT_KINDS)[number];

/**
 * 某一種事件「在期間內發生過」的條件（#1507）。計數與列表共用這一份 —— 兩邊各寫一份，
 * 摘要的數字就會跟列對不上。
 *
 * 數的是**發生過的事，不是列**：報了又退的人，新報名、退班各算一次（計畫席 10-10 裁 A）。
 *
 * - `joined`：`effective_from` 在期間內，不論現在狀態
 * - `left`：`effective_to` 在期間內且不是作廢 —— 辦理退班**與到期結束**都算：active 列的
 *   `effective_to` 過了就真的離開名冊（today-attendance／attendance／billing-periods 同判準）。
 *   另加 `effective_to <= today`：期間的迄日在未來時，排定日還沒到的人還沒走
 * - `voided`：作廢，日期也在 `effective_to`（updateStatus 寫當天）
 * - `paused`：暫停不寫 `effective_to`，日期在 `status_changed_at` —— 那是「最近一次」變更，
 *   恢復也會寫它，所以要配 `status=suspended`
 *
 * 回傳的是 PostgREST `.or()` 的一個元素；條件為空（`joined` 又沒給期間）時回 null ＝不篩。
 */
export function eventFilter(
  kind: EnrollmentEventKind,
  from: string | undefined,
  to: string | undefined,
  today: string,
): string | null {
  const conditions = {
    joined: columnInRange('effective_from', from, to),
    left: [
      'status.neq.void',
      ...columnInRange('effective_to', from, to && to < today ? to : today),
    ],
    voided: ['status.eq.void', ...columnInRange('effective_to', from, to)],
    paused: ['status.eq.suspended', ...columnInRange('status_changed_at', from, to)],
  }[kind];

  if (conditions.length === 0) return null;
  return conditions.length === 1 ? conditions[0] : `and(${conditions.join(',')})`;
}

/**
 * 期間內「發生過事情」的報名＝四種事件的聯集，直接餵給 `.or()`；沒有期間時回 null（不篩）。
 *
 * 抽出來是因為這個 OR 跨三個欄位，而 PostgREST 的 `.or()` 字串很容易寫錯又不會報錯 ——
 * 錯的結果是「篩選看起來有作用但漏掉一半的列」，安靜且難以察覺。
 */
export function buildPeriodFilter(
  from: string | undefined,
  to: string | undefined,
  today: string,
): string | null {
  if (!from && !to) return null;
  return ENROLLMENT_EVENT_KINDS.map((kind) => eventFilter(kind, from, to, today)).join(',');
}

const SELECT_COLUMNS =
  'id, org_id, class_id, student_id, status, billing_mode, fee_template_id, agreed_amount, adjustment_note, effective_from, effective_to, notes, status_changed_at, status_reason, created_by, created_at, updated_at';
// `schedules(...)`：學生檔案「這學期的課」要星期時段與老師（#1314 SD1）
const SELECT_RELATIONS =
  '(name, campus_id, campuses(name), courses(id, name), schedules(weekday, start_time, end_time, effective_to, staff(display_name))), students(name, grade, schools(id, name, short_name)), creator:ba_user!created_by(name)';

/**
 * 依分校過濾時，classes 的關聯必須是 inner join。
 *
 * PostgREST 的巢狀過濾預設走 left join —— 少了 `!inner`，`classes.campus_id` 條件不成立的
 * 報名不會被排除，只會把 classes 關聯變成 null 留在結果裡。那看起來像「篩選壞掉」，
 * 而且班級欄位會整排空白。
 *
 * ⚠️ **第一個參數是「這次查詢會不會下分校條件」，不是「使用者有沒有傳 campusId」。**
 * 原本收的是 `campusId?: string`，於是只被指派一個分校的管理員**不帶參數**時
 * ——條件由 campusScope 下去了、join 卻還是 left —— 他看得到全機構的報名（#815）。
 * 呼叫端一律用 `filtersCampus(scope, campusId)` 算它，**跟 `applyCampusFilter` 同一個判準**。
 */
export function buildSelect(filtersCampus?: boolean, hasInvoice?: boolean): string {
  const invoiceJoin =
    hasInvoice === undefined
      ? ''
      : // `true` 要 inner join（只留下有帳單項目的），`false` 要 left join 再配
        // `invoice_items=is.null` 的過濾（沒有任何帳單項目的）。
        // **兩種都跟 `count: 'exact'` 相容** —— 本機 PostgREST 實測：
        // 全部 24、有帳單 1、沒帳單 23，加起來對得上。
        // #898：帶上帳單的 voided_at —— 作廢單上的明細不算開過帳，過濾
        // （`invoice_items.invoices.voided_at is null`）下在路由上。
        // ⚠️ 這條巢狀過濾配 `is.null` 的語意要打真的 PostgREST 驗（charter：join 語意實測）。
        hasInvoice
        ? ', invoice_items!inner(id, invoices!inner(voided_at))'
        : ', invoice_items(id, invoices!inner(voided_at))';

  return `${SELECT_COLUMNS}, ${filtersCampus ? 'classes!inner' : 'classes'}${SELECT_RELATIONS}${invoiceJoin}`;
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
