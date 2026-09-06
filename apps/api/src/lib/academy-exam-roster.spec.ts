import { describe, it, expect } from 'vitest';

import { buildAcademyExamExpectedCounts } from './academy-exam-roster';

/**
 * 分母的定義（issue #424 使用者裁定）：**考試那天在籍 ∪ 已登錄成績**。
 *
 * 期望值全部是**手數出來的人數**，不是拿 `isEnrolledOn` 再跑一次 ——
 * 用被測程式碼自己的算法算期望值，測的只是「兩份抄本一不一致」。
 */
describe('buildAcademyExamExpectedCounts', () => {
  const exams = [{ id: 'exam-1', examDate: '2026-04-10' }];
  const examClasses = [{ exam_id: 'exam-1', class_id: 'class-1' }];

  it('考試日還在籍就算 —— 退班日在考試之後', () => {
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses,
      enrollments: [
        // 4/20 退班，考試是 4/10 → 他當天確實該有成績
        {
          class_id: 'class-1',
          student_id: 'stu-1',
          effective_from: '2026-01-01',
          effective_to: '2026-04-20',
        },
      ],
      scores: [],
    });

    expect(counts.get('exam-1')).toBe(1);
  });

  it('考試日之前就退班 → 不算，即使他曾經在這個班', () => {
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses,
      enrollments: [
        {
          class_id: 'class-1',
          student_id: 'stu-1',
          effective_from: '2026-01-01',
          effective_to: '2026-04-09',
        },
      ],
      scores: [],
    });

    expect(counts.get('exam-1')).toBe(0);
  });

  it('⚠️ 考完才轉入 → 不算　（沿用「現在在籍」的話他會永久掛在分母上）', () => {
    // 這是整個裁示最重要的那一條：舊實作用查詢當下的 `status='active'`，
    // 於是六月插班的學生會出現在四月那場考試的分母裡，而他根本沒考 ——
    // 那場永遠是 12/13，補不了。補不滿的警示數字會被學會忽略。
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses,
      enrollments: [
        {
          class_id: 'class-1',
          student_id: 'stu-late',
          effective_from: '2026-06-01',
          effective_to: null,
        },
      ],
      scores: [],
    });

    expect(counts.get('exam-1')).toBe(0);
  });

  it('考試日當天結束 → 算在籍（結束當天仍在籍）', () => {
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses,
      enrollments: [
        {
          class_id: 'class-1',
          student_id: 'stu-1',
          effective_from: '2026-01-01',
          effective_to: '2026-04-10',
        },
      ],
      scores: [],
    });

    expect(counts.get('exam-1')).toBe(1);
  });

  it('考試日當天才生效 → 算在籍（生效當天就在籍）', () => {
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses,
      enrollments: [
        {
          class_id: 'class-1',
          student_id: 'stu-1',
          effective_from: '2026-04-10',
          effective_to: null,
        },
      ],
      scores: [],
    });

    expect(counts.get('exam-1')).toBe(1);
  });

  it('同一個學生在這場考試的兩個班裡 → 只算一個人', () => {
    // 數學 A 班 + 數學進階班。用報名筆數當分母的話這裡會變成 2，
    // 於是分母永遠大於實際人數、N/M 到不了滿
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses: [
        { exam_id: 'exam-1', class_id: 'class-1' },
        { exam_id: 'exam-1', class_id: 'class-2' },
      ],
      enrollments: [
        {
          class_id: 'class-1',
          student_id: 'stu-1',
          effective_from: '2026-01-01',
          effective_to: null,
        },
        {
          class_id: 'class-2',
          student_id: 'stu-1',
          effective_from: '2026-01-01',
          effective_to: null,
        },
      ],
      scores: [],
    });

    expect(counts.get('exam-1')).toBe(1);
  });

  it('已登錄的一定算進分母 —— 否則退班的人考過了會讓 N > M', () => {
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses,
      enrollments: [],
      scores: [{ exam_id: 'exam-1', student_id: 'stu-gone' }],
    });

    expect(counts.get('exam-1')).toBe(1);
  });

  it('已登錄且仍在籍 → 只算一個人（聯集不是相加）', () => {
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses,
      enrollments: [
        {
          class_id: 'class-1',
          student_id: 'stu-1',
          effective_from: '2026-01-01',
          effective_to: null,
        },
      ],
      scores: [{ exam_id: 'exam-1', student_id: 'stu-1' }],
    });

    expect(counts.get('exam-1')).toBe(1);
  });

  it('別場考試的成績不會漏進來', () => {
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses,
      enrollments: [],
      scores: [{ exam_id: 'exam-other', student_id: 'stu-x' }],
    });

    expect(counts.get('exam-1')).toBe(0);
  });

  it('沒有綁班也沒有成績 → 0，而且鍵是存在的', () => {
    // 「沒算過」與「算出來是零」要分得開：鍵不存在才是沒算過
    const counts = buildAcademyExamExpectedCounts({
      exams,
      examClasses: [],
      enrollments: [],
      scores: [],
    });

    expect(counts.has('exam-1')).toBe(true);
    expect(counts.get('exam-1')).toBe(0);
  });

  it('兩場考試日期不同 → 各自用自己的日期判斷', () => {
    // 同一個班、同一筆報名，對 4/10 那場算在籍、對 6/10 那場不算
    const counts = buildAcademyExamExpectedCounts({
      exams: [
        { id: 'exam-apr', examDate: '2026-04-10' },
        { id: 'exam-jun', examDate: '2026-06-10' },
      ],
      examClasses: [
        { exam_id: 'exam-apr', class_id: 'class-1' },
        { exam_id: 'exam-jun', class_id: 'class-1' },
      ],
      enrollments: [
        {
          class_id: 'class-1',
          student_id: 'stu-1',
          effective_from: '2026-01-01',
          effective_to: '2026-05-01',
        },
      ],
      scores: [],
    });

    expect(counts.get('exam-apr')).toBe(1);
    expect(counts.get('exam-jun')).toBe(0);
  });
});
