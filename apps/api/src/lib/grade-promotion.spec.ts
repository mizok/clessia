import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  academicYearOf,
  levelOfGrade,
  nextGrade,
  promoteGrades,
  promotionPlan,
  promotionReminderDue,
  revertPromotion,
  schoolMismatchClause,
  type PlanStudent,
} from './grade-promotion';

/**
 * #1820 學年升級。純函式在這裡驗；交易的「形狀」用替身 pool 驗（哪幾句、哪一步停、回什麼）；
 * 真正的 SQL 語意（org 條件、部分唯一索引、FOR UPDATE、復原）在 `contract/grade-promotion.contract.ts` 對真 Postgres 驗。
 */

describe('nextGrade／levelOfGrade／academicYearOf', () => {
  it('升級表：小六→國一、國三→高一、高三→畢業（null）', () => {
    expect(nextGrade('P1')).toBe('P2');
    expect(nextGrade('P6')).toBe('J1');
    expect(nextGrade('J3')).toBe('S1');
    expect(nextGrade('S2')).toBe('S3');
    expect(nextGrade('S3')).toBeNull();
  });

  it('學制', () => {
    expect(levelOfGrade('P6')).toBe('elementary');
    expect(levelOfGrade('J1')).toBe('junior');
    expect(levelOfGrade('S3')).toBe('senior');
  });

  it('學年：8/1 起算新學年（民國年）', () => {
    expect(academicYearOf('2026-07-31')).toBe(114);
    expect(academicYearOf('2026-08-01')).toBe(115);
    expect(academicYearOf('2027-01-15')).toBe(115);
  });
});

describe('promotionReminderDue（升級前提醒）', () => {
  it('升級日前 N 天內（含當天）該提醒，帶距離與學年', () => {
    expect(promotionReminderDue('09-01', 7, '2026-08-25')).toEqual({
      date: '2026-09-01',
      daysUntil: 7,
      academicYear: 115,
    });
    expect(promotionReminderDue('09-01', 7, '2026-09-01')?.daysUntil).toBe(0);
  });

  it('還沒進窗、或今年的升級日已過且明年的還遠 → null', () => {
    expect(promotionReminderDue('09-01', 7, '2026-08-24')).toBeNull();
    expect(promotionReminderDue('09-01', 7, '2026-09-02')).toBeNull();
  });

  it('學年照升級日算：今天 7/30（114 學年）、升級日 8/2 → 115', () => {
    expect(promotionReminderDue('08-02', 7, '2026-07-30')).toEqual({
      date: '2026-08-02',
      daysUntil: 3,
      academicYear: 115,
    });
  });

  it('天數 0＝不提醒', () => {
    expect(promotionReminderDue('09-01', 0, '2026-09-01')).toBeNull();
  });

  it('跨年：升級日 1/5、今天 12/30 → 明年那天', () => {
    expect(promotionReminderDue('01-05', 7, '2026-12-30')).toEqual({
      date: '2027-01-05',
      daysUntil: 6,
      academicYear: 115,
    });
  });

  it('2/29 在平年落到 2/28', () => {
    expect(promotionReminderDue('02-29', 3, '2027-02-26')?.date).toBe('2027-02-28');
    expect(promotionReminderDue('02-29', 3, '2028-02-26')?.date).toBe('2028-02-29');
  });
});

describe('schoolMismatchClause（名冊「學制跟年級不合」）', () => {
  it('每個學制的年級配上「別的學制」的學校；未分類的學校不算', () => {
    expect(
      schoolMismatchClause([
        { id: 'e', level: 'elementary' },
        { id: 'j', level: 'junior' },
        { id: 's', level: 'senior' },
        { id: 'n', level: null },
      ]),
    ).toBe(
      [
        'and(grade.in.(P1,P2,P3,P4,P5,P6),school_id.in.(j,s))',
        'and(grade.in.(J1,J2,J3),school_id.in.(e,s))',
        'and(grade.in.(S1,S2,S3),school_id.in.(e,j))',
      ].join(','),
    );
  });

  it('沒有別的學制可對時略過那一支', () => {
    expect(schoolMismatchClause([{ id: 'j', level: 'junior' }])).toBe(
      'and(grade.in.(P1,P2,P3,P4,P5,P6),school_id.in.(j)),and(grade.in.(S1,S2,S3),school_id.in.(j))',
    );
  });

  it('沒有學校或全是未分類 → null（呼叫端要回空，不是不篩）', () => {
    expect(schoolMismatchClause([])).toBeNull();
    expect(schoolMismatchClause([{ id: 'n', level: null }])).toBeNull();
  });
});

describe('promotionPlan（預覽）', () => {
  const s = (over: Partial<PlanStudent>): PlanStudent => ({
    id: 'x',
    name: '某某',
    grade: 'J1',
    schoolName: null,
    schoolLevel: null,
    activeClassNames: [],
    ...over,
  });

  it('各變動人數照年級順序、升級與畢業人數', () => {
    const plan = promotionPlan([
      s({ id: 'a', grade: 'J3' }),
      s({ id: 'b', grade: 'P6' }),
      s({ id: 'c', grade: 'J3' }),
      s({ id: 'd', grade: 'S3' }),
    ]);
    expect(plan.transitions).toEqual([
      { from: 'P6', to: 'J1', count: 1 },
      { from: 'J3', to: 'S1', count: 2 },
      { from: 'S3', to: null, count: 1 },
    ]);
    expect(plan.promotedCount).toBe(3);
    expect(plan.graduatedCount).toBe(1);
  });

  it('學校要更新：新年級的學制跟學校不合（國三升高一、學校是國中）；學校沒填學制的不列', () => {
    const plan = promotionPlan([
      s({ id: 'a', name: '甲', grade: 'J3', schoolName: '明湖國中', schoolLevel: 'junior' }),
      s({ id: 'b', name: '乙', grade: 'J1', schoolName: '明湖國中', schoolLevel: 'junior' }),
      s({ id: 'c', name: '丙', grade: 'J3', schoolName: '某校', schoolLevel: null }),
    ]);
    expect(plan.schoolMismatch).toEqual([
      { studentId: 'a', name: '甲', schoolName: '明湖國中', newGrade: 'S1' },
    ]);
  });

  it('高三還有在籍報名：列出來（停用不連動報名）；沒有報名的高三不列', () => {
    const plan = promotionPlan([
      s({ id: 'a', name: '甲', grade: 'S3', activeClassNames: ['高三數學'] }),
      s({ id: 'b', name: '乙', grade: 'S3' }),
    ]);
    expect(plan.graduatesWithEnrollments).toEqual([
      { studentId: 'a', name: '甲', classNames: ['高三數學'] },
    ]);
  });
});

type Rows = Array<Record<string, unknown>>;

/** 依 SQL 回答的替身 pool；記下送出的每一句 */
function fakePool(answer: (sql: string) => Rows | Error) {
  const sent: Array<{ sql: string; params?: unknown[] }> = [];
  const release = vi.fn();
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      sent.push({ sql, params });
      const out = answer(sql);
      if (out instanceof Error) throw out;
      return { rows: out, rowCount: out.length };
    },
    release,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const verbs = () => sent.map((q) => q.sql.trim().split(/\s+/)[0]);
  const find = (re: RegExp) => sent.find((q) => re.test(q.sql));
  return { pool, sent, verbs, find, release };
}

const PROMOTE = { orgId: 'org-1', userId: 'u-1', academicYear: 115 };

describe('promoteGrades —— 交易形狀', () => {
  it('同學年已有未復原的紀錄 → already-promoted，什麼都沒寫、ROLLBACK 也沒有（COMMIT 空交易）', async () => {
    const db = fakePool((sql) => (/FROM grade_promotions/.test(sql) ? [{ id: 'p0' }] : []));
    expect(await promoteGrades(db.pool, PROMOTE)).toEqual({ status: 'already-promoted' });
    expect(db.verbs().filter((v) => v === 'INSERT' || v === 'UPDATE')).toEqual([]);
  });

  it('升級：在讀學生 FOR UPDATE、批次 UPDATE（高三停用、年級不變）、寫明細，COMMIT', async () => {
    const db = fakePool((sql) => {
      if (/^INSERT INTO grade_promotions/.test(sql.trim())) return [{ id: 'p1' }];
      if (/FROM students/.test(sql))
        return [
          { id: 's1', grade: 'J3' },
          { id: 's2', grade: 'S3' },
        ];
      return [];
    });
    expect(await promoteGrades(db.pool, PROMOTE)).toEqual({
      status: 'done',
      promotionId: 'p1',
      promotedCount: 1,
      graduatedCount: 1,
    });
    // 撈學生只撈在讀的、而且鎖住
    expect(db.find(/FROM students/)!.sql).toMatch(/is_active = true[\s\S]*FOR UPDATE/);
    const update = db.find(/^\s*UPDATE students/)!;
    expect(update.params).toEqual(['org-1', ['s1', 's2'], ['S1', 'S3'], [false, true]]);
    expect(update.sql).toMatch(/is_active = NOT v\.graduated/);
    // ids 來自帶 org 的查詢，這一句的 org 是縱深防禦 —— 說明寫了「每句帶 org_id」就要有人守（二讀 G13）
    expect(update.sql).toMatch(/WHERE s\.id = v\.id AND s\.org_id = \$1/);
    const items = db.find(/INSERT INTO grade_promotion_items/)!;
    expect(items.params).toEqual([
      'p1',
      'org-1',
      ['s1', 's2'],
      ['J3', 'S3'],
      ['S1', 'S3'],
      [false, true],
    ]);
    expect(db.verbs().at(-1)).toBe('COMMIT');
    expect(db.release).toHaveBeenCalled();
  });

  it('兩個人同時按：後到的撞部分唯一索引（23505）→ already-promoted，整筆已回滾', async () => {
    const db = fakePool((sql) =>
      /^INSERT INTO grade_promotions/.test(sql.trim())
        ? Object.assign(new Error('dup'), { code: '23505' })
        : [],
    );
    expect(await promoteGrades(db.pool, PROMOTE)).toEqual({ status: 'already-promoted' });
    expect(db.verbs()).toContain('ROLLBACK');
  });

  it('其他錯誤：ROLLBACK 後原樣丟出（路由對成 500）', async () => {
    const db = fakePool((sql) =>
      /^\s*UPDATE students/.test(sql)
        ? new Error('boom')
        : /FROM students/.test(sql)
          ? [{ id: 's1', grade: 'J1' }]
          : /^INSERT INTO grade_promotions/.test(sql.trim())
            ? [{ id: 'p1' }]
            : [],
    );
    await expect(promoteGrades(db.pool, PROMOTE)).rejects.toThrow('boom');
    expect(db.verbs()).toContain('ROLLBACK');
  });

  it('每一句都帶 org_id 參數', async () => {
    const db = fakePool((sql) =>
      /^INSERT INTO grade_promotions/.test(sql.trim())
        ? [{ id: 'p1' }]
        : /FROM students/.test(sql)
          ? [{ id: 's1', grade: 'J1' }]
          : [],
    );
    await promoteGrades(db.pool, PROMOTE);
    for (const q of db.sent.filter((x) => !/^(BEGIN|COMMIT)/.test(x.sql))) {
      expect(q.params, q.sql).toContain('org-1');
    }
  });
});

describe('revertPromotion —— 交易形狀', () => {
  const NOW = new Date('2026-09-10T00:00:00Z');
  const input = { orgId: 'org-1', userId: 'u-1', promotionId: 'p1', now: NOW };
  const promo = (over: Record<string, unknown> = {}) => [
    { executed_at: new Date('2026-09-01T01:00:00Z'), reverted_at: null, ...over },
  ];

  it('找不到 → not-found；已復原 → already-reverted；超過 30 天 → expired；都不寫', async () => {
    for (const [rows, status] of [
      [[], 'not-found'],
      [promo({ reverted_at: new Date() }), 'already-reverted'],
      [promo({ executed_at: new Date('2026-08-01T00:00:00Z') }), 'expired'],
    ] as const) {
      const db = fakePool((sql) => (/FROM grade_promotions/.test(sql) ? [...rows] : []));
      expect(await revertPromotion(db.pool, input)).toEqual({ status });
      expect(db.verbs().filter((v) => v === 'UPDATE')).toEqual([]);
    }
  });

  it('復原期限：剛好 30 天可以，再多 1 毫秒就 expired（二讀 G14）', async () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms);
    const dayMs = 30 * 86_400_000;
    for (const [executedAt, expired] of [
      [at(dayMs), false],
      [at(dayMs + 1), true],
    ] as const) {
      const db = fakePool((sql) =>
        /FROM grade_promotions/.test(sql) ? promo({ executed_at: executedAt }) : [],
      );
      const r = await revertPromotion(db.pool, input);
      expect(r.status === 'expired', String(executedAt)).toBe(expired);
    }
  });

  it('只還原「現在仍是升級後狀態」的學生；手改過的跳過並列出；畢業的恢復在讀', async () => {
    const db = fakePool((sql) => {
      if (/FROM grade_promotions/.test(sql)) return promo();
      if (/FROM grade_promotion_items/.test(sql))
        return [
          // 照升級後：還原
          {
            student_id: 's1',
            name: '甲',
            from_grade: 'J3',
            to_grade: 'S1',
            graduated: false,
            grade: 'S1',
            is_active: true,
          },
          // 畢業停用、還是停用：還原（恢復在讀）
          {
            student_id: 's2',
            name: '乙',
            from_grade: 'S3',
            to_grade: 'S3',
            graduated: true,
            grade: 'S3',
            is_active: false,
          },
          // 升級後被手改成 S2：跳過
          {
            student_id: 's3',
            name: '丙',
            from_grade: 'J3',
            to_grade: 'S1',
            graduated: false,
            grade: 'S2',
            is_active: true,
          },
          // 畢業後被手動恢復在讀：跳過
          {
            student_id: 's4',
            name: '丁',
            from_grade: 'S3',
            to_grade: 'S3',
            graduated: true,
            grade: 'S3',
            is_active: true,
          },
        ];
      return [];
    });
    expect(await revertPromotion(db.pool, input)).toEqual({
      status: 'done',
      revertedCount: 2,
      skipped: [
        { studentId: 's3', name: '丙' },
        { studentId: 's4', name: '丁' },
      ],
    });
    const update = db.find(/^\s*UPDATE students/)!;
    expect(update.params).toEqual(['org-1', ['s1', 's2'], ['J3', 'S3']]);
    expect(update.sql).toMatch(/is_active = true/);
    expect(update.sql).toMatch(/WHERE s\.id = v\.id AND s\.org_id = \$1/); // 二讀 G19
    expect(db.find(/UPDATE grade_promotions SET reverted_at/)!.params).toEqual([
      'p1',
      'org-1',
      NOW.toISOString(),
      'u-1',
    ]);
    expect(db.verbs().at(-1)).toBe('COMMIT');
  });
});
