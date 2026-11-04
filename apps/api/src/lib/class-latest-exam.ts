import type { Queryable } from './identity-sql';
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

/**
 * 三支批次查詢（不是每班一支），走 pg（#2240，同 #2226 的乙′）。
 *
 * 原本是三層 PostgREST `.in()`（links、enrollments 的 `class_id`，scores 的 `exam_id`）：`GET /classes`
 * `pageSize=0` 班一多就 414，而任一支失敗都回 `null` → 路由整欄不回 `latestExam`、照樣 200。
 * `classIds` 是列表已授權過的集合，這裡只拿它當參數，`org_id` 只是防呆。挑哪一場、怎麼算平均仍由
 * `buildLatestExams` 一份規則決定，SQL 只回它要的原料（形狀同原本 REST）。失敗丟例外（路由回 500）。
 */
export async function loadLatestExams(
  db: Queryable,
  orgId: string,
  classIds: readonly string[],
): Promise<Map<string, LatestExam | null>> {
  if (classIds.length === 0) return new Map();
  const [links, enrollments] = await Promise.all([
    db.query(
      `select coalesce(json_agg(json_build_object(
          'class_id', aec.class_id, 'exam_id', aec.exam_id,
          'academy_exams', json_build_object(
            'id', ae.id, 'name', ae.name, 'exam_date', ae.exam_date,
            'total_score', ae.total_score, 'pass_score', ae.pass_score,
            'academy_scores', json_build_array(json_build_object('count',
              (select count(*) from public.academy_scores s where s.exam_id = ae.id)))))), '[]'::json) as result
         from public.academy_exam_classes aec
         join public.academy_exams ae on ae.id = aec.exam_id
        where ae.org_id = $1::uuid and aec.class_id = any($2::uuid[])`,
      [orgId, [...classIds]],
    ),
    db.query(
      `select class_id, student_id from public.enrollments
        where org_id = $1::uuid and status <> 'void' and class_id = any($2::uuid[])`,
      [orgId, [...classIds]],
    ),
  ]);
  const linkRows = ((links.rows[0] as { result?: Row[] } | undefined)?.result ?? []) as Row[];

  const firstPass = buildLatestExams({ classIds, links: linkRows, scores: [], enrollments: [] });
  const examIds = [...new Set([...firstPass.values()].flatMap((e) => (e ? [e.examId] : [])))];
  const scores =
    examIds.length === 0
      ? { rows: [] }
      : await db.query(
          `select s.exam_id, s.student_id, s.score, s.status
             from public.academy_scores s
             join public.academy_exams ae on ae.id = s.exam_id
            where ae.org_id = $1::uuid and s.exam_id = any($2::uuid[])`,
          [orgId, examIds],
        );

  return buildLatestExams({
    classIds,
    links: linkRows,
    scores: scores.rows as Row[],
    enrollments: enrollments.rows as Row[],
  });
}
