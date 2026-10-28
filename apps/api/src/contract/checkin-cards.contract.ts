import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { printCards, reissueCard, revokeCard } from '../lib/checkin-cards';

/**
 * #1100 #42：到班卡的 SQL 對**真的** Postgres 跑 —— org／分校範圍、交易、
 * 「一位學生只有一張有效卡」（部分唯一索引）、卡片 org＝學生 org。替身驗不出這些。
 *
 * 自己建兩個 org 的資料、測完逐張刪掉（見 afterAll），不碰 seed。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('到班卡對真 Postgres（#1100 #42）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  /** 一個 org、一個分校、一個班；`student()` 建一位報名這班的學生 */
  async function org() {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c42-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    const campusId = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const subjectId = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const courseId = await one(
      `INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, 'x')`,
      [orgId, campusId, subjectId],
    );
    const classId = await one(
      `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, 'x')`,
      [orgId, campusId, courseId],
    );
    const student = async (name = 'x') => {
      const id = await one(`INSERT INTO students (org_id, name, grade) VALUES ($1, $2, 'J1')`, [
        orgId,
        name,
      ]);
      await q(`INSERT INTO enrollments (org_id, class_id, student_id) VALUES ($1, $2, $3)`, [
        orgId,
        classId,
        id,
      ]);
      return id;
    };
    // userId 是 ba_user 的 FK；契約不建使用者（c2），所以用 null 不行 —— 借 seed 裡任一個
    const [user] = await q<{ id: string }>(`SELECT id FROM ba_user LIMIT 1`);
    const actor = { orgId, userId: user!.id, scope: null as readonly string[] | null };
    return { orgId, campusId, student, actor };
  }
  const cardsOf = (studentId: string) =>
    q<{ org_id: string; code: string; revoked_at: Date | null; revoke_reason: string | null }>(
      `SELECT org_id, code, revoked_at, revoke_reason FROM checkin_cards
        WHERE student_id = $1 ORDER BY issued_at`,
      [studentId],
    );

  afterAll(async () => {
    // 子表先刪（students／classes 的 org FK 不是 CASCADE）
    for (const table of [
      'checkin_cards',
      'enrollments',
      'students',
      'classes',
      'courses',
      'subjects',
      'campuses',
    ]) {
      await q(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, [orgs]);
    }
    await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [orgs]);
    await pool.end();
  });

  it('第一次印＝開卡（org 用學生的 org）；再印＝同一張，不換碼', async () => {
    const a = await org();
    const s = await a.student();
    const first = await printCards(pool, a.actor, [s], true);
    const again = await printCards(pool, a.actor, [s], false);

    expect(first).toMatchObject({ ok: true, cards: [{ studentId: s, issued: true }] });
    expect(again).toMatchObject({ ok: true, cards: [{ issued: false }] });
    const [card] = await cardsOf(s);
    expect(first.ok && first.cards[0]!.code).toBe(card!.code);
    expect(again.ok && again.cards[0]!.code).toBe(card!.code);
    expect(card!.org_id).toBe(a.orgId);
  });

  it('不能新開而有人沒卡：整批不動（有卡的那位也不算印過）', async () => {
    const a = await org();
    const [has, none] = [await a.student(), await a.student()];
    await printCards(pool, a.actor, [has], true);

    const out = await printCards(pool, a.actor, [has, none], false);
    expect(out).toEqual({ ok: false, reason: 'NEEDS_ISSUE', studentIds: [none] });
    expect(await cardsOf(none)).toHaveLength(0);
  });

  it('別 org 的學生：整批 404，誰都沒開卡（卡片 org＝學生 org）', async () => {
    const [a, b] = [await org(), await org()];
    const mine = await a.student();
    const theirs = await b.student();

    expect(await printCards(pool, a.actor, [mine, theirs], true)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(await reissueCard(pool, a.actor, theirs, 'x')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(await cardsOf(mine)).toHaveLength(0);
    expect(await cardsOf(theirs)).toHaveLength(0);
  });

  it('分校範圍外：跟不存在一樣 404；範圍內照常', async () => {
    const a = await org();
    const s = await a.student();
    const outside = { ...a.actor, scope: [randomUUID()] };
    const inside = { ...a.actor, scope: [a.campusId] };

    expect(await printCards(pool, outside, [s], true)).toMatchObject({ ok: false });
    expect(await revokeCard(pool, outside, s, 'x')).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await printCards(pool, inside, [s], true)).toMatchObject({ ok: true });
  });

  it('補發：舊卡作廢（記理由）＋新卡有效，同一位學生只剩一張有效卡', async () => {
    const a = await org();
    const s = await a.student();
    const printed = await printCards(pool, a.actor, [s], true);
    const out = await reissueCard(pool, a.actor, s, '遺失');

    expect(out).toMatchObject({ ok: true, revokedCode: printed.ok && printed.cards[0]!.code });
    const cards = await cardsOf(s);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ revoke_reason: '遺失' });
    expect(cards[0]!.revoked_at).not.toBeNull();
    expect(cards[1]).toMatchObject({ revoked_at: null, code: out.ok && out.code });
  });

  it('並行補發：只留一張有效卡（學生列鎖＋部分唯一索引）', async () => {
    const a = await org();
    const s = await a.student();
    await printCards(pool, a.actor, [s], true);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => reissueCard(pool, a.actor, s, '並行')),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const active = (await cardsOf(s)).filter((k) => k.revoked_at === null);
    expect(active).toHaveLength(1);
  });

  it('作廢：沒有有效卡回 NO_ACTIVE_CARD；作廢後再印＝開新卡', async () => {
    const a = await org();
    const s = await a.student();
    expect(await revokeCard(pool, a.actor, s, 'x')).toEqual({
      ok: false,
      reason: 'NO_ACTIVE_CARD',
    });
    await printCards(pool, a.actor, [s], true);
    expect(await revokeCard(pool, a.actor, s, '退班')).toMatchObject({ ok: true });
    expect(await printCards(pool, a.actor, [s], false)).toMatchObject({
      ok: false,
      reason: 'NEEDS_ISSUE',
    });
  });
});
