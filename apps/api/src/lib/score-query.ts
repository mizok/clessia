/**
 * 成績的 select 字串與 row→回應的映射 —— **唯一定義**，`routes/scores.ts`（admin）
 * 與 `routes/parent/grades.ts`（家長）共用，形狀照 `lib/session-summary.ts` 的先例。
 *
 * **不含 `students(name)`** —— 兩邊都各自決定要不要撈學生資訊：admin 端要顯示
 * 「哪個學生」（列表混著多個學生），家長端已經知道自己在看哪個孩子，
 * 不需要這個欄位（見 kb/wiki/architecture/parent-read-endpoints.md 「班級排名」
 * 那段：家長端點只查單一學生，排名這種班級層級的資訊天生就沒有管道流進來）。
 */
export const ACADEMY_SCORE_SELECT = `
  id,
  exam_id,
  student_id,
  score,
  status,
  created_at,
  academy_exams!inner ( name, exam_date, total_score, pass_score, org_id, subject_id, subjects ( name ) )
`;

export const SCHOOL_SCORE_SELECT = `
  id,
  school_exam_id,
  student_id,
  score,
  status,
  created_at,
  school_exams!inner ( label, exam_date, created_at, org_id ),
  subjects!inner ( name )
`;

export interface ScoreRecordBase {
  id: string;
  type: 'academy' | 'school';
  examName: string;
  examDate: string;
  subjectName: string | null;
  score: number | null;
  totalScore: number | null;
  status: 'scored' | 'absent' | 'makeup';
  /** 這筆成績的登錄時間（不是考試日期）—— 逐筆 NEW 標籤要靠它，聚合的 recentCount 分不出是哪幾筆 */
  createdAt: string;
  /**
   * 及格線。**只有 academy_exams 有這個欄位**，school 成績一律 `null`——
   * 沒有設定及格線時前端要退化成比例算（`score < totalScore * 0.6`），
   * 這是刻意的降級路徑，不是漏欄位（見 migration 20260905035442 的說明）。
   */
  passScore: number | null;
}

export function mapAcademyScoreRow(row: any): ScoreRecordBase {
  const exam = row.academy_exams;
  return {
    id: row.id,
    type: 'academy',
    examName: exam.name,
    examDate: exam.exam_date,
    subjectName: exam.subjects?.name ?? null,
    score: row.score,
    totalScore: exam.total_score,
    status: row.status,
    createdAt: row.created_at,
    passScore: exam.pass_score ?? null,
  };
}

export function mapSchoolScoreRow(row: any): ScoreRecordBase {
  const exam = row.school_exams;
  const subject = row.subjects;
  return {
    id: row.id,
    type: 'school',
    examName: exam.label,
    examDate: exam.exam_date ?? exam.created_at?.split('T')[0] ?? '',
    subjectName: subject.name,
    score: row.score,
    totalScore: null,
    status: row.status,
    createdAt: row.created_at,
    passScore: null,
  };
}
