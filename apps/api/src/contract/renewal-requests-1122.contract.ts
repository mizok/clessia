import { Pool, type PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * **#1122：續課異動申請的 schema 約束**，對真的本機 Postgres 跑。
 *
 * 一生同時只有一筆 pending（pending＝暫停自動開單，gate Q1 (a)；結案或撤回之後可以再送）、
 * 想怎麼改 1～500 字、kind 只收 enum、RLS 開著且沒有 policy（fail-closed）。
 * 借 seed 既有的在讀報名與使用者（不寫 ba_user，c2）；每個 case 包在交易裡、最後 ROLLBACK。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

interface Seed {
  org: string;
  student: string;
  enrollment: string;
  user: string;
}

run('#1122 renewal_requests 約束', () => {
  const pool = new Pool({ connectionString: DB });
  afterAll(() => pool.end());

  const inTx = async (fn: (db: PoolClient, s: Seed) => Promise<void>) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const { rows } = await db.query<Seed>(
        `SELECT e.org_id AS org, e.student_id AS student, e.id AS enrollment,
                (SELECT id FROM ba_user ORDER BY id LIMIT 1) AS user
           FROM enrollments e ORDER BY e.id LIMIT 1`,
      );
      await fn(db, rows[0]!);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  };

  const insert = (db: PoolClient, s: Seed, kind = 'transfer', detail = '想改到週六的班') =>
    db.query<{ id: string }>(
      `INSERT INTO renewal_requests (org_id, student_id, enrollment_id, kind, detail, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [s.org, s.student, s.enrollment, kind, detail, s.user],
    );

  const rejects = async (db: PoolClient, p: () => Promise<unknown>) => {
    await db.query('SAVEPOINT x');
    try {
      await p();
      return null;
    } catch (e) {
      return (
        (e as { constraint?: string; code?: string }).constraint ?? (e as { code: string }).code
      );
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT x');
    }
  };

  it('一生一筆 pending；結案或撤回之後可以再送', () =>
    inTx(async (db, s) => {
      const first = (await insert(db, s)).rows[0]!.id;
      expect(await rejects(db, () => insert(db, s, 'stop', '下期不續'))).toBe(
        'renewal_requests_pending_uniq',
      );
      await db.query(`UPDATE renewal_requests SET status = 'withdrawn' WHERE id = $1`, [first]);
      const second = (await insert(db, s, 'stop', '下期不續')).rows[0]!.id;
      await db.query(`UPDATE renewal_requests SET status = 'resolved' WHERE id = $1`, [second]);
      await insert(db, s, 'billing_mode', '想改成月繳');
    }));

  it('想怎麼改 1～500 字、備註 ≤200、kind 只收 enum', () =>
    inTx(async (db, s) => {
      expect(await rejects(db, () => insert(db, s, 'transfer', ''))).toBe(
        'renewal_requests_detail_len',
      );
      expect(await rejects(db, () => insert(db, s, 'transfer', '字'.repeat(501)))).toBe(
        'renewal_requests_detail_len',
      );
      expect(await rejects(db, () => insert(db, s, 'pause'))).toBe('22P02');
      const id = (await insert(db, s)).rows[0]!.id;
      expect(
        await rejects(db, () =>
          db.query('UPDATE renewal_requests SET note = $2 WHERE id = $1', [id, '字'.repeat(201)]),
        ),
      ).toBe('renewal_requests_note_len');
    }));

  it('RLS 開著且沒有任何 policy（fail-closed）', async () => {
    const { rows } = await pool.query<{ rls: boolean; policies: string }>(
      `SELECT c.relrowsecurity AS rls,
              (SELECT count(*) FROM pg_policies WHERE tablename = 'renewal_requests') AS policies
         FROM pg_class c WHERE c.relname = 'renewal_requests'`,
    );
    expect(rows[0]).toEqual({ rls: true, policies: '0' });
  });

  it('notification_kind 有 renewal_request_received', async () => {
    const { rows } = await pool.query<{ ok: boolean }>(
      `SELECT 'renewal_request_received' = ANY (enum_range(NULL::notification_kind)::text[]) AS ok`,
    );
    expect(rows[0]!.ok).toBe(true);
  });
});
