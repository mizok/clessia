import { describe, expect, it } from 'vitest';

import { buildAcademyScoreRows, isPassScoreValid } from './academy-exams';

describe('isPassScoreValid', () => {
  it('null / undefined 一律合法（未設，不是設成 0）', () => {
    expect(isPassScoreValid(null, 100)).toBe(true);
    expect(isPassScoreValid(undefined, 100)).toBe(true);
  });

  it('0 是有效值（這場不當人）', () => {
    expect(isPassScoreValid(0, 100)).toBe(true);
  });

  it('等於總分合法，超過總分不合法', () => {
    expect(isPassScoreValid(100, 100)).toBe(true);
    expect(isPassScoreValid(101, 100)).toBe(false);
  });

  it('負數不合法', () => {
    expect(isPassScoreValid(-1, 100)).toBe(false);
  });
});

const student = (name: string, grade = 'J2') => ({ name, grade });

describe('buildAcademyScoreRows', () => {
  it('把在籍但尚未登錄成績的學生也列出來', () => {
    const rows = buildAcademyScoreRows(
      [{ student_id: 's1', class_id: 'c1', students: student('王小明') }],
      [],
    );

    expect(rows).toEqual([
      {
        studentId: 's1',
        studentName: '王小明',
        studentGrade: 'J2',
        score: null,
        status: 'scored',
        notes: null,
        updatedAt: null,
        classIds: ['c1'],
      },
    ]);
  });

  it('跨班學生的 classIds 要累積，不能只留最後一個班', () => {
    // 同一個學生報了這場考試的兩個班（例如數學 A 班 + 數學進階班），
    // enrollments 會回兩筆。只保留一個的話，按另一班篩選時這個學生就消失了。
    const rows = buildAcademyScoreRows(
      [
        { student_id: 's1', class_id: 'c1', students: student('王小明') },
        { student_id: 's1', class_id: 'c2', students: student('王小明') },
      ],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].classIds).toEqual(['c1', 'c2']);
  });

  it('重複的 class_id 不會重複累積', () => {
    const rows = buildAcademyScoreRows(
      [
        { student_id: 's1', class_id: 'c1', students: student('王小明') },
        { student_id: 's1', class_id: 'c1', students: student('王小明') },
      ],
      [],
    );

    expect(rows[0].classIds).toEqual(['c1']);
  });

  it('已登錄的成績會覆蓋分數欄位，但不能洗掉 classIds', () => {
    const rows = buildAcademyScoreRows(
      [
        { student_id: 's1', class_id: 'c1', students: student('王小明') },
        { student_id: 's1', class_id: 'c2', students: student('王小明') },
      ],
      [
        {
          student_id: 's1',
          score: 88,
          status: 'scored',
          notes: '進步很多',
          updated_at: '2026-04-02T00:00:00Z',
          students: student('王小明'),
        },
      ],
    );

    expect(rows[0].score).toBe(88);
    expect(rows[0].notes).toBe('進步很多');
    expect(rows[0].classIds).toEqual(['c1', 'c2']);
  });

  it('有成績的學生排在沒成績的前面，同組內依更新時間新到舊', () => {
    const rows = buildAcademyScoreRows(
      [
        { student_id: 's1', class_id: 'c1', students: student('甲') },
        { student_id: 's2', class_id: 'c1', students: student('乙') },
        { student_id: 's3', class_id: 'c1', students: student('丙') },
      ],
      [
        {
          student_id: 's3',
          score: 70,
          status: 'scored',
          notes: null,
          updated_at: '2026-04-01T00:00:00Z',
          students: student('丙'),
        },
        {
          student_id: 's2',
          score: 90,
          status: 'scored',
          notes: null,
          updated_at: '2026-04-03T00:00:00Z',
          students: student('乙'),
        },
      ],
    );

    expect(rows.map((r) => r.studentId)).toEqual(['s2', 's3', 's1']);
  });

  it('沒有 class_id 的 enrollment 不會塞 null 進 classIds', () => {
    const rows = buildAcademyScoreRows(
      [{ student_id: 's1', class_id: null, students: student('王小明') }],
      [],
    );

    expect(rows[0].classIds).toEqual([]);
  });
});
