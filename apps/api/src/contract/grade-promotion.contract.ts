import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { promoteGrades, revertPromotion } from '../lib/grade-promotion';

/**
 * #1820：學年升級的交易對**真的** Postgres 跑 —— org 條件、只升在讀、畢業停用、
 * 部分唯一索引擋重複、復原跳過手改過的，這些是 SQL 語意，替身驗不出來。
 *
 * 自己建兩個 org 的學生、測完刪掉（見 afterAll），不碰 seed。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('學年升級交易對真 Postgres（#1820）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];
  /** 真的 ba_user id（text，不是 uuid）—— executed_by／reverted_by 的型別要對得上（計畫席讀 diff 抓到的） */
  let userId = '';

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;

  async function org() {
    const [{ id }] = await q<{ id: string }>(
      `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
      [`c1820-${randomUUID()}`],
    );
    orgs.push(id!);
    return id!;
  }
  async function student(orgId: string, grade: string, active = true) {
    const [{ id }] = await q<{ id: string }>(
      `INSERT INTO students (org_id, name, grade, is_active) VALUES ($1, $2, $3, $4) RETURNING id`,
      [orgId, `s-${grade}`, grade, active],
    );
    return id!;
  }
  const state = async (id: string) =>
    (
      await q<{ grade: string; is_active: boolean }>(
        `SELECT grade::text AS grade, is_active FROM students WHERE id = $1`,
        [id],
      )
    )[0]!;

  beforeAll(async () => {
    userId = (await q<{ id: string }>('SELECT id FROM ba_user LIMIT 1'))[0]!.id;
  });

  afterAll(async () => {
    if (orgs.length) {
      await pool.query('DELETE FROM grade_promotions WHERE org_id = ANY($1)', [orgs]);
      await pool.query('DELETE FROM students WHERE org_id = ANY($1)', [orgs]);
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgs]);
    }
    await pool.end();
  });

  it('只升這個 org 的在讀學生；國三→高一、高三停用年級不變、停用的不動；別 org 不動', async () => {
    const orgId = await org();
    const other = await org();
    const j3 = await student(orgId, 'J3');
    const s3 = await student(orgId, 'S3');
    const gone = await student(orgId, 'P1', false);
    const elsewhere = await student(other, 'J1');

    const r = await promoteGrades(pool, { orgId, userId, academicYear: 115 });
    expect(r).toMatchObject({ status: 'done', promotedCount: 1, graduatedCount: 1 });
    expect(await state(j3)).toEqual({ grade: 'S1', is_active: true });
    expect(await state(s3)).toEqual({ grade: 'S3', is_active: false });
    expect(await state(gone)).toEqual({ grade: 'P1', is_active: false });
    expect(await state(elsewhere)).toEqual({ grade: 'J1', is_active: true });

    const items = await q(`SELECT student_id FROM grade_promotion_items WHERE org_id = $1`, [
      orgId,
    ]);
    expect(items).toHaveLength(2);
  });

  it('同學年再按一次 → already-promoted，學生不會被升兩次', async () => {
    const orgId = await org();
    const j1 = await student(orgId, 'J1');
    await promoteGrades(pool, { orgId, userId, academicYear: 115 });
    expect(await promoteGrades(pool, { orgId, userId, academicYear: 115 })).toEqual({
      status: 'already-promoted',
    });
    expect((await state(j1)).grade).toBe('J2');
  });

  it('兩個人同時按：只有一筆成功，另一筆 already-promoted（部分唯一索引＋交易回滾）', async () => {
    const orgId = await org();
    const p1 = await student(orgId, 'P1');
    const results = await Promise.all([
      promoteGrades(pool, { orgId, userId, academicYear: 115 }),
      promoteGrades(pool, { orgId, userId, academicYear: 115 }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual(['already-promoted', 'done']);
    expect((await state(p1)).grade).toBe('P2');
  });

  it('復原：還原沒被手改的、畢業的恢復在讀；手改過的跳過並列出；復原後同學年可以再升', async () => {
    const orgId = await org();
    const j3 = await student(orgId, 'J3');
    const s3 = await student(orgId, 'S3');
    const edited = await student(orgId, 'J2');
    const r = await promoteGrades(pool, { orgId, userId, academicYear: 115 });
    if (r.status !== 'done') throw new Error('promote failed');
    // 升級後行政手改了一位（J3 → S2）
    await q(`UPDATE students SET grade = 'S2' WHERE id = $1`, [edited]);

    const back = await revertPromotion(pool, {
      orgId,
      userId,
      promotionId: r.promotionId,
      now: new Date(),
    });
    expect(back).toMatchObject({ status: 'done', revertedCount: 2 });
    expect(back.status === 'done' && back.skipped.map((x) => x.studentId)).toEqual([edited]);
    expect(await state(j3)).toEqual({ grade: 'J3', is_active: true });
    expect(await state(s3)).toEqual({ grade: 'S3', is_active: true });
    expect((await state(edited)).grade).toBe('S2');

    // 再復原一次 → already-reverted；同學年可以重新升
    expect(
      await revertPromotion(pool, {
        orgId,
        userId,
        promotionId: r.promotionId,
        now: new Date(),
      }),
    ).toEqual({ status: 'already-reverted' });
    expect((await promoteGrades(pool, { orgId, userId, academicYear: 115 })).status).toBe('done');
  });

  it('別 org 的升級 id 復原不到（not-found）', async () => {
    const orgId = await org();
    const other = await org();
    await student(orgId, 'P2');
    const r = await promoteGrades(pool, { orgId, userId, academicYear: 115 });
    if (r.status !== 'done') throw new Error('promote failed');
    expect(
      await revertPromotion(pool, {
        orgId: other,
        userId,
        promotionId: r.promotionId,
        now: new Date(),
      }),
    ).toEqual({ status: 'not-found' });
  });
});
