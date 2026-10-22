import type { Pool } from 'pg';

import { withTx } from './pg-tx';

/**
 * 學年升級（#1820，設計稿 `kb/wiki/specs/admin/system/grade-promotion.md`，已裁定）。
 *
 * - 純函式：升級表 `nextGrade`、學年 `academicYearOf`、預覽 `promotionPlan`。
 * - 交易：`promoteGrades`／`revertPromotion` 各一支 `withTx`（repo 不引入 RPC，見 `pg-pool-writes.md`）。
 *   每一句都帶 `org_id`；要動的學生在交易裡 `FOR UPDATE` 重新撈，交易外的預覽只拿來顯示。
 * - **只動學生**：高三畢業改停用，報名、帳單、月結都不動（計畫席 10-22）—— 預覽把「高三還有在籍報名」列給行政自己處理。
 */

export type Grade =
  'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'J1' | 'J2' | 'J3' | 'S1' | 'S2' | 'S3';
export type SchoolLevel = 'elementary' | 'junior' | 'senior';

const ORDER: readonly Grade[] = [
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'J1',
  'J2',
  'J3',
  'S1',
  'S2',
  'S3',
];

/** 升一個年級；高三回 `null`（畢業）—— 呼叫端決定畢業怎麼處理（裁定 A：停用） */
export function nextGrade(grade: Grade): Grade | null {
  const i = ORDER.indexOf(grade);
  return i < 0 || i === ORDER.length - 1 ? null : ORDER[i + 1]!;
}

/** 年級屬於哪個學制 —— 對學校的 `level`，不合就是「學校要更新」 */
export function levelOfGrade(grade: Grade): SchoolLevel {
  return grade.startsWith('P') ? 'elementary' : grade.startsWith('J') ? 'junior' : 'senior';
}

/** 台北日期 `YYYY-MM-DD` 屬於哪個民國學年（8/1 起算新學年） */
export function academicYearOf(taipeiDate: string): number {
  const year = Number(taipeiDate.slice(0, 4));
  const month = Number(taipeiDate.slice(5, 7));
  return (month >= 8 ? year : year - 1) - 1911;
}

/** 復原期限（裁定 C） */
export const REVERT_WINDOW_DAYS = 30;

export interface PlanStudent {
  id: string;
  name: string;
  grade: Grade;
  schoolName: string | null;
  schoolLevel: SchoolLevel | null;
  /** 在籍報名的班名（`status = 'active'`）；只有高三會用到 */
  activeClassNames: readonly string[];
}

export interface PromotionPlan {
  /** 每一種變動的人數，照年級順序；`to = null` 是畢業 */
  transitions: Array<{ from: Grade; to: Grade | null; count: number }>;
  promotedCount: number;
  graduatedCount: number;
  /** 新年級的學制跟學校不合（裁定 D：不動 school_id，列名單） */
  schoolMismatch: Array<{ studentId: string; name: string; schoolName: string; newGrade: Grade }>;
  /** 高三而且還有在籍報名：停用不連動報名，交給行政（計畫席 10-22） */
  graduatesWithEnrollments: Array<{ studentId: string; name: string; classNames: string[] }>;
}

/** 預覽（只算、不寫）。學生清單要是「在讀」的 —— 停用的不升 */
export function promotionPlan(students: readonly PlanStudent[]): PromotionPlan {
  const counts = new Map<Grade, number>();
  const schoolMismatch: PromotionPlan['schoolMismatch'] = [];
  const graduatesWithEnrollments: PromotionPlan['graduatesWithEnrollments'] = [];
  for (const s of students) {
    counts.set(s.grade, (counts.get(s.grade) ?? 0) + 1);
    const to = nextGrade(s.grade);
    if (to === null) {
      if (s.activeClassNames.length > 0) {
        graduatesWithEnrollments.push({
          studentId: s.id,
          name: s.name,
          classNames: [...s.activeClassNames],
        });
      }
    } else if (s.schoolLevel && s.schoolName && s.schoolLevel !== levelOfGrade(to)) {
      schoolMismatch.push({
        studentId: s.id,
        name: s.name,
        schoolName: s.schoolName,
        newGrade: to,
      });
    }
  }
  const transitions = ORDER.filter((g) => counts.has(g)).map((from) => ({
    from,
    to: nextGrade(from),
    count: counts.get(from)!,
  }));
  const graduatedCount = counts.get('S3') ?? 0;
  return {
    transitions,
    promotedCount: students.length - graduatedCount,
    graduatedCount,
    schoolMismatch,
    graduatesWithEnrollments,
  };
}

export type PromoteResult =
  | { status: 'done'; promotionId: string; promotedCount: number; graduatedCount: number }
  | { status: 'already-promoted' };

/**
 * 執行升級：一個交易裡鎖住在讀學生、批次改年級（高三改停用）、寫明細、寫一列升級紀錄。
 * 同學年已有未復原的紀錄 → `already-promoted`（交易裡先查；兩個人同時按時，後到的撞部分唯一索引 23505 → 同一個結果）。
 */
export async function promoteGrades(
  pool: Pool,
  input: { orgId: string; userId: string; academicYear: number },
): Promise<PromoteResult> {
  try {
    return await withTx(pool, async (db) => {
      const existing = await db.query(
        `SELECT id FROM grade_promotions
          WHERE org_id = $1 AND academic_year = $2 AND reverted_at IS NULL
          FOR UPDATE`,
        [input.orgId, input.academicYear],
      );
      if (existing.rows.length > 0) return { status: 'already-promoted' as const };

      const { rows: promo } = await db.query<{ id: string }>(
        `INSERT INTO grade_promotions (org_id, academic_year, executed_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [input.orgId, input.academicYear, input.userId],
      );
      const promotionId = promo[0]!.id;

      const { rows: students } = await db.query<{ id: string; grade: Grade }>(
        `SELECT id, grade::text AS grade FROM students
          WHERE org_id = $1 AND is_active = true
          FOR UPDATE`,
        [input.orgId],
      );

      const ids: string[] = [];
      const from: string[] = [];
      const to: string[] = [];
      const graduated: boolean[] = [];
      for (const s of students) {
        const next = nextGrade(s.grade);
        ids.push(s.id);
        from.push(s.grade);
        to.push(next ?? s.grade);
        graduated.push(next === null);
      }

      if (ids.length > 0) {
        await db.query(
          `UPDATE students AS s
              SET grade = v.to_grade::grade_level,
                  is_active = NOT v.graduated
             FROM (SELECT unnest($2::uuid[]) AS id, unnest($3::text[]) AS to_grade,
                          unnest($4::boolean[]) AS graduated) AS v
            WHERE s.id = v.id AND s.org_id = $1`,
          [input.orgId, ids, to, graduated],
        );
        await db.query(
          `INSERT INTO grade_promotion_items (promotion_id, org_id, student_id, from_grade, to_grade, graduated)
           SELECT $1, $2, v.id, v.from_grade::grade_level, v.to_grade::grade_level, v.graduated
             FROM (SELECT unnest($3::uuid[]) AS id, unnest($4::text[]) AS from_grade,
                          unnest($5::text[]) AS to_grade, unnest($6::boolean[]) AS graduated) AS v`,
          [promotionId, input.orgId, ids, from, to, graduated],
        );
      }

      const graduatedCount = graduated.filter(Boolean).length;
      return {
        status: 'done' as const,
        promotionId,
        promotedCount: ids.length - graduatedCount,
        graduatedCount,
      };
    });
  } catch (err) {
    // 兩個人同時按：後到的那筆撞部分唯一索引，整筆已回滾
    if ((err as { code?: unknown } | null)?.code === '23505') return { status: 'already-promoted' };
    throw err;
  }
}

export type RevertResult =
  | {
      status: 'done';
      revertedCount: number;
      /** 升級後又被手改過（年級或在讀狀態），不動、列出來（裁定 C） */
      skipped: Array<{ studentId: string; name: string }>;
    }
  | { status: 'not-found' }
  | { status: 'already-reverted' }
  | { status: 'expired' };

/** 復原：30 天內；只還原「現在仍是升級後狀態」的學生，其餘列出 */
export async function revertPromotion(
  pool: Pool,
  input: { orgId: string; userId: string; promotionId: string; now: Date },
): Promise<RevertResult> {
  return withTx(pool, async (db) => {
    const { rows: promo } = await db.query<{ executed_at: Date; reverted_at: Date | null }>(
      `SELECT executed_at, reverted_at FROM grade_promotions
        WHERE id = $1 AND org_id = $2
        FOR UPDATE`,
      [input.promotionId, input.orgId],
    );
    const row = promo[0];
    if (!row) return { status: 'not-found' as const };
    if (row.reverted_at) return { status: 'already-reverted' as const };
    if (
      input.now.getTime() - new Date(row.executed_at).getTime() >
      REVERT_WINDOW_DAYS * 86_400_000
    ) {
      return { status: 'expired' as const };
    }

    const { rows: items } = await db.query<{
      student_id: string;
      name: string;
      from_grade: Grade;
      to_grade: Grade;
      graduated: boolean;
      grade: Grade;
      is_active: boolean;
    }>(
      `SELECT i.student_id, s.name, i.from_grade::text AS from_grade, i.to_grade::text AS to_grade,
              i.graduated, s.grade::text AS grade, s.is_active
         FROM grade_promotion_items AS i
         JOIN students AS s ON s.id = i.student_id AND s.org_id = $2
        WHERE i.promotion_id = $1 AND i.org_id = $2
        FOR UPDATE OF s`,
      [input.promotionId, input.orgId],
    );

    const revert = items.filter((i) => i.grade === i.to_grade && i.is_active === !i.graduated);
    const skipped = items
      .filter((i) => !revert.includes(i))
      .map((i) => ({ studentId: i.student_id, name: i.name }));

    if (revert.length > 0) {
      await db.query(
        `UPDATE students AS s
            SET grade = v.from_grade::grade_level,
                is_active = true
           FROM (SELECT unnest($2::uuid[]) AS id, unnest($3::text[]) AS from_grade) AS v
          WHERE s.id = v.id AND s.org_id = $1`,
        [input.orgId, revert.map((i) => i.student_id), revert.map((i) => i.from_grade)],
      );
    }
    await db.query(
      `UPDATE grade_promotions SET reverted_at = $3, reverted_by = $4 WHERE id = $1 AND org_id = $2`,
      [input.promotionId, input.orgId, input.now.toISOString(), input.userId],
    );
    return { status: 'done' as const, revertedCount: revert.length, skipped };
  });
}
