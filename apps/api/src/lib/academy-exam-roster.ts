import type { SupabaseClient } from '@supabase/supabase-js';
import { isEnrolledOn } from './session-roster';

/**
 * 補習班考試的「應登錄人數」（分母）。
 *
 * **這個數字在 2026-09-06 之前不存在** —— 畫面只有「已登錄 N」沒有分母，使用者
 * 無法判斷還差多少（Tester P2 #19）。定義由使用者裁定（issue #424）：
 *
 * > **分母 = 考試那天在籍的學生 ∪ 已經登錄成績的學生**
 *
 * 三個問題一次答完：
 *
 * | 問題 | 答案 | 為什麼 |
 * | --- | --- | --- |
 * | 分母是班級在籍人數嗎 | 是，但是**考試那天**的在籍 | 「現在在籍」會讓過去的考試分母隨人事異動漂移 |
 * | 退班的算不算 | **考試日還在籍就算** | 他當天確實該有成績；退班日之後的考試才不算他 |
 * | 中途轉入的算不算 | **不算** | 他考試那天還沒進來，永遠補不了那一筆 |
 *
 * 最後一條是這個定義最重要的理由：沿用「現在 `status='active'`」的話，考完才轉入的
 * 學生會**永久掛在分母上**，那場考試永遠差一筆而且補不了。**警示型的數字，誤報比
 * 欠準致命** —— 一個補不滿的 N/M 會訓練使用者忽略這個訊號，然後真正沒登完的那場
 * 也一起被忽略。
 *
 * 「在籍」的判斷走 `lib/session-roster.ts` 的 `isEnrolledOn`，**跟出勤名單同一份規則**。
 * 這裡不重寫日期比較 —— 考試名單原本自己寫了一次 `status='active'`，而那跟出勤用的
 * 「某天在籍」**語意本來就不同**，所以不是重複而是其中一份是錯的。
 */

export interface ExamEnrollmentRow {
  readonly class_id: string;
  readonly student_id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

export interface ExamExpectedCountInput {
  readonly exams: ReadonlyArray<{ readonly id: string; readonly examDate: string }>;
  readonly examClasses: ReadonlyArray<{ readonly exam_id: string; readonly class_id: string }>;
  /** 這些班級的報名。呼叫端要先排除 `void`（見 `loadAcademyExamExpectedCounts`） */
  readonly enrollments: ReadonlyArray<ExamEnrollmentRow>;
  readonly scores: ReadonlyArray<{ readonly exam_id: string; readonly student_id: string }>;
}

/**
 * 每場考試的應登錄人數。回傳的 Map **只含傳進來的考試**，沒有的鍵代表沒算過，
 * 不是零 —— 呼叫端不要用 `?? 0` 把「沒算過」壓成「零個人」。
 */
export function buildAcademyExamExpectedCounts(input: ExamExpectedCountInput): Map<string, number> {
  const enrollmentsByClass = new Map<string, ExamEnrollmentRow[]>();
  for (const row of input.enrollments) {
    const list = enrollmentsByClass.get(row.class_id);
    if (list) list.push(row);
    else enrollmentsByClass.set(row.class_id, [row]);
  }

  const classesByExam = new Map<string, string[]>();
  for (const row of input.examClasses) {
    const list = classesByExam.get(row.exam_id);
    if (list) list.push(row.class_id);
    else classesByExam.set(row.exam_id, [row.class_id]);
  }

  const scoredByExam = new Map<string, Set<string>>();
  for (const row of input.scores) {
    const set = scoredByExam.get(row.exam_id);
    if (set) set.add(row.student_id);
    else scoredByExam.set(row.exam_id, new Set([row.student_id]));
  }

  const result = new Map<string, number>();

  for (const exam of input.exams) {
    // 一個學生可能同時在這場考試的多個班裡（數學 A 班 + 數學進階班），
    // 所以是「不重複的學生集合」而不是報名筆數
    const students = new Set<string>();

    for (const classId of classesByExam.get(exam.id) ?? []) {
      for (const row of enrollmentsByClass.get(classId) ?? []) {
        if (
          isEnrolledOn(
            { effectiveFrom: row.effective_from, effectiveTo: row.effective_to },
            exam.examDate,
          )
        ) {
          students.add(row.student_id);
        }
      }
    }

    // 已經登錄成績的一定算進分母 —— 否則「退班的人考過了」會讓 N > M
    for (const studentId of scoredByExam.get(exam.id) ?? []) {
      students.add(studentId);
    }

    result.set(exam.id, students.size);
  }

  return result;
}

/**
 * 撈齊三份資料再交給上面的純函式。**三支批次查詢，不是每場考試各發一次** ——
 * 延遲 ≈ 每請求的固定成本 × 一頁打幾支，減次數比減單次划算。
 */
export async function loadAcademyExamExpectedCounts(
  supabase: SupabaseClient,
  orgId: string,
  exams: ReadonlyArray<{ id: string; examDate: string }>,
): Promise<Map<string, number>> {
  if (exams.length === 0) return new Map();

  const examIds = exams.map((exam) => exam.id);

  const { data: examClasses } = await supabase
    .from('academy_exam_classes')
    .select('exam_id, class_id')
    .in('exam_id', examIds);

  const classIds = Array.from(
    new Set(((examClasses ?? []) as Array<{ class_id: string }>).map((row) => row.class_id)),
  );

  const { data: enrollments } =
    classIds.length === 0
      ? { data: [] }
      : await supabase
          .from('enrollments')
          .select('class_id, student_id, effective_from, effective_to')
          .eq('org_id', orgId)
          // **排除 `void`，保留 `withdrawal`**：作廢的報名是「這筆不算數」，
          // 退班的是「他真的來過然後走了」——後者在考試日還在籍就該算進分母。
          // 其餘（`pending_payment` / `suspended`）都是真的在這個班上，由日期區間決定。
          .neq('status', 'void')
          .in('class_id', classIds);

  const { data: scores } = await supabase
    .from('academy_scores')
    .select('exam_id, student_id')
    .in('exam_id', examIds);

  return buildAcademyExamExpectedCounts({
    exams,
    examClasses: (examClasses ?? []) as Array<{ exam_id: string; class_id: string }>,
    enrollments: (enrollments ?? []) as ExamEnrollmentRow[],
    scores: (scores ?? []) as Array<{ exam_id: string; student_id: string }>,
  });
}

export type AcademyExamTodoLevel = 'none' | 'partial';

/**
 * 這場考試「還沒登完」嗎，是哪一級。回 `null` = 不是待辦。
 *
 * | 情況 | 回傳 | 意思 |
 * | --- | --- | --- |
 * | 分母是 0 | `null` | 沒有人要考。**舊實作會把它算成待辦，而那是一個永遠清不掉的告警** |
 * | `N === 0` | `'none'` | 一筆都沒有（高） |
 * | `0 < N < M` | `'partial'` | 登到一半（低） |
 * | `N >= M` | `null` | 登完了 |
 *
 * 兩級不合併的理由（issue #424 使用者裁定）：告警量會上升（現在完全看不到
 * 「登到一半」的那些），一級化會讓原本最急的那類被稀釋進去。
 *
 * **列表的 `todo` 過濾與橫幅的 `todo-count` 共用這一支** —— 判定各寫一份的話，
 * 「告警說 3 場、點進去篩出 8 場」就是遲早的事，而那正是這個工單要修的東西。
 * 缺考／補考算「已登錄」（`academy_scores` 不濾 status），所以 N 到得了 M。
 */
export function classifyAcademyExamTodo(
  recorded: number,
  expected: number,
): AcademyExamTodoLevel | null {
  if (expected === 0) return null;
  if (recorded === 0) return 'none';
  if (recorded < expected) return 'partial';
  return null;
}
