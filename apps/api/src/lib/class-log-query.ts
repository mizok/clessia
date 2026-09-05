/**
 * 教務日誌的 select 字串與 row→回應的映射 —— **唯一定義**，`routes/class-logs.ts`
 * （admin）與 `routes/parent/class-logs.ts`（家長）共用，形狀照 `lib/attendance-query.ts`
 * 的先例（查詢條件可以不一樣，形狀不行）。
 */
export const CLASS_LOG_SELECT =
  'id, class_id, log_date, teaching_record, homework, last_edited_by, published_at, ' +
  'classes(name), editor:ba_user!last_edited_by(name)';

interface ClassLogRow {
  id: string;
  class_id: string;
  log_date: string;
  teaching_record: string;
  homework: string;
  last_edited_by: string | null;
  published_at: string | null;
  classes?: { name: string } | null;
  editor?: { name: string } | null;
}

export function toClassLogResponse(row: Record<string, unknown>) {
  const typed = row as unknown as ClassLogRow;
  return {
    id: typed.id,
    classId: typed.class_id,
    className: typed.classes?.name ?? null,
    logDate: typed.log_date,
    teachingRecord: typed.teaching_record,
    homework: typed.homework,
    lastEditedByName: typed.editor?.name ?? null,
    publishedAt: typed.published_at,
    isPublished: Boolean(typed.published_at),
  };
}
