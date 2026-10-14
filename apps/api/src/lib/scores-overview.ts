import { buildAcademyExamExpectedCounts, classifyAcademyExamTodo } from './academy-exam-roster';
import { buildLatestExams } from './class-latest-exam';
import { isFailingScore } from './score-threshold';

/**
 * 成績總覽（#1314 G5）的聚合。**判準全部借既有的**：分母／待辦（`academy-exam-roster`）、
 * 每班最近一場（`class-latest-exam`，同 G6 班級列）、不及格（`score-threshold`）。
 *
 * 口徑（計畫席 10-14 17:23 gate ①）：平均只含 `scored` 且有分數；缺考、補考未考、未登錄
 * 不進分子也不進分母。跨場比較（摘要平均、排序）換算 100 分制；單場列回該場自己的尺度＋`totalScore`。
 */

type Row = Record<string, unknown>;

export interface OverviewExam {
  id: string;
  name: string;
  examDate: string;
  totalScore: number;
  passScore: number | null;
  /** `academy_exam_classes(class_id, classes(name))` */
  classes: Array<{ classId: string; className: string }>;
}

export interface OverviewScore {
  examId: string;
  studentId: string;
  studentName: string;
  grade: string | null;
  score: number | null;
  status: string;
}

export interface OverviewEnrollment {
  class_id: string;
  student_id: string;
  effective_from: string;
  effective_to: string | null;
}

const pct = (score: number, total: number) => (score / total) * 100;
const byDateDesc = (a: OverviewExam, b: OverviewExam) =>
  a.examDate === b.examDate ? (a.id < b.id ? 1 : -1) : a.examDate < b.examDate ? 1 : -1;

export function buildScoresOverview(input: {
  windowDays: number;
  exams: readonly OverviewExam[];
  scores: readonly OverviewScore[];
  /** 這些考試綁的班的非作廢報名 */
  enrollments: readonly OverviewEnrollment[];
}) {
  const { exams, scores, enrollments } = input;
  const examById = new Map(exams.map((e) => [e.id, e]));
  const scored = scores.filter((s) => s.status === 'scored' && s.score !== null);

  // ── 摘要 ──
  const examClasses = exams.flatMap((e) =>
    e.classes.map((c) => ({ exam_id: e.id, class_id: c.classId })),
  );
  const expected = buildAcademyExamExpectedCounts({
    exams: exams.map((e) => ({ id: e.id, examDate: e.examDate })),
    examClasses,
    enrollments,
    scores: scores.map((s) => ({ exam_id: s.examId, student_id: s.studentId })),
  });
  const recorded = new Map<string, number>();
  for (const s of scores) recorded.set(s.examId, (recorded.get(s.examId) ?? 0) + 1);
  const pendingCount = exams.filter(
    (e) => classifyAcademyExamTodo(recorded.get(e.id) ?? 0, expected.get(e.id) ?? 0) !== null,
  ).length;
  const pcts = scored.map((s) => pct(s.score as number, examById.get(s.examId)!.totalScore));
  const avgScore = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;

  // ── 每生最近一場有分數的考試 → 不及格者 ──
  const studentClasses = new Map<string, Set<string>>();
  for (const e of enrollments) {
    const set = studentClasses.get(e.student_id) ?? new Set<string>();
    set.add(e.class_id);
    studentClasses.set(e.student_id, set);
  }
  const latestByStudent = new Map<string, OverviewScore>();
  for (const s of scored) {
    const current = latestByStudent.get(s.studentId);
    if (!current || byDateDesc(examById.get(s.examId)!, examById.get(current.examId)!) < 0) {
      latestByStudent.set(s.studentId, s);
    }
  }
  const failing = [...latestByStudent.values()]
    .filter((s) => {
      const exam = examById.get(s.examId)!;
      return isFailingScore(s.score, exam);
    })
    .map((s) => {
      const exam = examById.get(s.examId)!;
      const mine = studentClasses.get(s.studentId) ?? new Set<string>();
      return {
        studentId: s.studentId,
        name: s.studentName,
        grade: s.grade,
        className:
          exam.classes
            .filter((c) => mine.has(c.classId))
            .map((c) => c.className)
            .sort((a, b) => a.localeCompare(b, 'zh-Hant'))[0] ?? null,
        examName: exam.name,
        examDate: exam.examDate,
        score: s.score as number,
        totalScore: exam.totalScore,
      };
    })
    .sort((a, b) => pct(a.score, a.totalScore) - pct(b.score, b.totalScore));

  // ── 每班最近一場（同 G6 判準）──
  const classNames = new Map(exams.flatMap((e) => e.classes.map((c) => [c.classId, c.className])));
  const classIds = [...classNames.keys()];
  const latestByClass = buildLatestExams({
    classIds,
    links: exams.flatMap((e) =>
      e.classes.map((c) => ({
        class_id: c.classId,
        academy_exams: {
          id: e.id,
          name: e.name,
          exam_date: e.examDate,
          total_score: e.totalScore,
          pass_score: e.passScore,
          academy_scores: [{ count: recorded.get(e.id) ?? 0 }],
        },
      })),
    ),
    scores: scores.map((s) => ({
      exam_id: s.examId,
      student_id: s.studentId,
      score: s.score,
      status: s.status,
    })),
    enrollments: enrollments as unknown as Row[],
  });
  const classRows = classIds.flatMap((classId) => {
    const latest = latestByClass.get(classId);
    return latest ? [{ classId, latest }] : [];
  });
  const lowestClasses = classRows
    .filter((r) => r.latest.avgScore !== null)
    .sort(
      (a, b) =>
        pct(a.latest.avgScore as number, a.latest.totalScore) -
        pct(b.latest.avgScore as number, b.latest.totalScore),
    )
    .slice(0, 3)
    .map(({ classId, latest }) => ({
      classId,
      className: classNames.get(classId) ?? '',
      examId: latest.examId,
      examName: latest.name,
      examDate: latest.examDate,
      totalScore: latest.totalScore,
      avgScore: latest.avgScore,
      failCount: latest.failCount,
      absentCount: latest.absentCount,
    }));

  // ── 最近的考試：一場一列 ──
  const recentExams = [...exams]
    .sort(byDateDesc)
    .slice(0, 50)
    .map((e) => {
      const mine = scores.filter((s) => s.examId === e.id);
      const values = mine.filter((s) => s.status === 'scored' && s.score !== null);
      return {
        examId: e.id,
        className: e.classes
          .map((c) => c.className)
          .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
          .join('、'),
        examName: e.name,
        examDate: e.examDate,
        totalScore: e.totalScore,
        avgScore: values.length
          ? values.reduce((sum, s) => sum + (s.score as number), 0) / values.length
          : null,
        failCount: values.filter((s) => isFailingScore(s.score, e)).length,
        absentCount: mine.filter((s) => s.status === 'absent').length,
        missingCount: Math.max((expected.get(e.id) ?? 0) - (recorded.get(e.id) ?? 0), 0),
      };
    });

  return {
    windowDays: input.windowDays,
    exams: { count: exams.length, pendingCount, avgScore },
    failingStudents: failing.slice(0, 5),
    failingTotal: failing.length,
    lowestClasses,
    totalClasses: classRows.length,
    recentExams,
  };
}
