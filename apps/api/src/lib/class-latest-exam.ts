import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages } from './fetch-all-pages';
import { isFailingScore } from './score-threshold';

/**
 * 班級列表每列的「最近一場考試」（#1314 G6，A6 列尾「86 分 平均」）。
 *
 * - **哪一場**：連到這班的校內考（`academy_exams`；學校段考不綁班）裡，考試日最新、
 *   且有任一筆成績的那場（同日取 id 大者，只為穩定）。
 * - **誰的成績**：一場考試可綁多班 → 成績歸給學生**有非作廢報名**的那班（同
 *   `academy-exam-roster` 排除 `void`、保留退班）。
 * - **平均**：只含 `scored` 且有分數，該場自己的分數尺度（前端用 `totalScore` 畫分母）；
 *   缺考＝`absent`，不進平均。不及格走 `isFailingScore`。
 *
 * ponytail: 「有成績」看整場不看這班 —— 多班考試只有別班登了的話，這班 `avgScore` 為 null；
 * 要精確就把候選考試的成績全撈回來逐班挑。
 */
export interface LatestExam {
  examId: string;
  name: string;
  examDate: string;
  totalScore: number;
  avgScore: number | null;
  failCount: number;
  absentCount: number;
}

type Row = Record<string, unknown>;

interface ExamInfo {
  id: string;
  name: string;
  examDate: string;
  totalScore: number;
  passScore: number | null;
}

export function buildLatestExams(input: {
  classIds: readonly string[];
  /** `academy_exam_classes` 列，帶 `academy_exams(…, academy_scores(count))` */
  links: readonly Row[];
  /** 被選中的考試的成績 */
  scores: readonly Row[];
  /** 本頁班的非作廢報名（`class_id, student_id`） */
  enrollments: readonly Row[];
}): Map<string, LatestExam | null> {
  const latest = new Map<string, ExamInfo>();
  for (const link of input.links) {
    const exam = link['academy_exams'] as Row | null;
    const scoreCount = ((exam?.['academy_scores'] as Array<{ count: number }> | null) ?? [])[0]
      ?.count;
    if (!exam || !scoreCount) continue;
    const info: ExamInfo = {
      id: exam['id'] as string,
      name: exam['name'] as string,
      examDate: exam['exam_date'] as string,
      totalScore: Number(exam['total_score']),
      passScore: exam['pass_score'] == null ? null : Number(exam['pass_score']),
    };
    const classId = link['class_id'] as string;
    const current = latest.get(classId);
    if (
      !current ||
      info.examDate > current.examDate ||
      (info.examDate === current.examDate && info.id > current.id)
    ) {
      latest.set(classId, info);
    }
  }

  const studentsByClass = new Map<string, Set<string>>();
  for (const e of input.enrollments) {
    const classId = e['class_id'] as string;
    const set = studentsByClass.get(classId) ?? new Set<string>();
    set.add(e['student_id'] as string);
    studentsByClass.set(classId, set);
  }

  const result = new Map<string, LatestExam | null>();
  for (const classId of input.classIds) {
    const exam = latest.get(classId);
    if (!exam) {
      result.set(classId, null);
      continue;
    }
    const students = studentsByClass.get(classId) ?? new Set<string>();
    let sum = 0;
    let scored = 0;
    let failCount = 0;
    let absentCount = 0;
    for (const s of input.scores) {
      if (s['exam_id'] !== exam.id || !students.has(s['student_id'] as string)) continue;
      if (s['status'] === 'absent') absentCount += 1;
      // postgrest 的 numeric 回來是字串
      if (s['status'] !== 'scored' || s['score'] == null) continue;
      const score = Number(s['score']);
      sum += score;
      scored += 1;
      if (isFailingScore(score, exam)) failCount += 1;
    }
    result.set(classId, {
      examId: exam.id,
      name: exam.name,
      examDate: exam.examDate,
      totalScore: exam.totalScore,
      avgScore: scored === 0 ? null : sum / scored,
      failCount,
      absentCount,
    });
  }
  return result;
}

/** 三支批次查詢（不是每班一支）。任一支失敗回 null —— 呼叫端不回這欄，不把「查不到」說成「沒考」 */
export async function loadLatestExams(
  supabase: SupabaseClient,
  orgId: string,
  classIds: readonly string[],
): Promise<Map<string, LatestExam | null> | null> {
  if (classIds.length === 0) return new Map();
  const linkSelect: string =
    'class_id, exam_id, academy_exams!inner(id, name, exam_date, total_score, pass_score, org_id, academy_scores(count))';
  const [links, enrollments] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from('academy_exam_classes')
        .select(linkSelect)
        .in('class_id', classIds)
        .eq('academy_exams.org_id', orgId)
        .order('exam_id')
        .order('class_id')
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from('enrollments')
        .select('id, class_id, student_id')
        .eq('org_id', orgId)
        .neq('status', 'void')
        .in('class_id', classIds)
        .order('id')
        .range(from, to),
    ),
  ]);
  if (links.error || enrollments.error) return null;

  const firstPass = buildLatestExams({ classIds, links: links.rows, scores: [], enrollments: [] });
  const examIds = [...new Set([...firstPass.values()].flatMap((e) => (e ? [e.examId] : [])))];
  const scores =
    examIds.length === 0
      ? { rows: [], error: null }
      : await fetchAllPages((from, to) =>
          supabase
            .from('academy_scores')
            .select('id, exam_id, student_id, score, status')
            .in('exam_id', examIds)
            .order('id')
            .range(from, to),
        );
  if (scores.error) return null;

  return buildLatestExams({
    classIds,
    links: links.rows,
    scores: scores.rows,
    enrollments: enrollments.rows,
  });
}
