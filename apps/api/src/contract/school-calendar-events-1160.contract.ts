import { Pool, type PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * **#1160：學校行事曆的 schema 約束**，對真的本機 Postgres 跑。
 *
 * 驗的是 migration 自己擋的東西（API 的驗證另外有 spec）：結束日不早於開始日、備註 ≤200 字、
 * kind 只收 enum、學校刪掉時行事曆跟著走（CASCADE）、RLS 開著且沒有 policy（fail-closed）。
 * 每個 case 包在交易裡、最後 ROLLBACK，不留資料。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('#1160 school_calendar_events 約束', () => {
  const pool = new Pool({ connectionString: DB });
  afterAll(() => pool.end());

  /** 開交易、建一個 org＋一所學校，跑完 ROLLBACK */
  const inTx = async (fn: (db: PoolClient, orgId: string, schoolId: string) => Promise<void>) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const orgId = (
        await db.query<{ id: string }>(
          `INSERT INTO organizations (name) VALUES ('c1160') RETURNING id`,
        )
      ).rows[0]!.id;
      const schoolId = (
        await db.query<{ id: string }>(
          `INSERT INTO schools (org_id, name) VALUES ($1, 'c1160 國中') RETURNING id`,
          [orgId],
        )
      ).rows[0]!.id;
      await fn(db, orgId, schoolId);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  };

  const insert = (
    db: PoolClient,
    orgId: string,
    schoolId: string,
    kind: string,
    start: string,
    end: string,
    note: string | null = null,
  ) =>
    db.query(
      `INSERT INTO school_calendar_events (org_id, school_id, kind, start_date, end_date, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orgId, schoolId, kind, start, end, note],
    );

  /** 失敗的 insert 會讓整個交易作廢，包一層 savepoint 才能接著驗下一句 */
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

  it('區間與單日都收；結束早於開始、備註超過 200 字、不在 enum 的 kind 擋下', () =>
    inTx(async (db, org, school) => {
      await insert(db, org, school, 'winter_break', '2027-01-20', '2027-02-10', '縣市統一');
      await insert(db, org, school, 'semester_start', '2027-02-11', '2027-02-11');

      expect(
        await rejects(db, () => insert(db, org, school, 'other', '2027-02-10', '2027-02-09')),
      ).toBe('school_calendar_events_dates_check');
      expect(
        await rejects(db, () =>
          insert(db, org, school, 'other', '2027-02-10', '2027-02-10', '字'.repeat(201)),
        ),
      ).toBe('school_calendar_events_note_len');
      // 22P02 = invalid_text_representation（enum 不認得的值）
      expect(
        await rejects(db, () => insert(db, org, school, 'holiday', '2027-02-10', '2027-02-10')),
      ).toBe('22P02');

      const { rows } = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM school_calendar_events WHERE school_id = $1',
        [school],
      );
      expect(Number(rows[0]!.n)).toBe(2);
    }));

  it('學校刪掉時行事曆跟著刪（CASCADE）', () =>
    inTx(async (db, org, school) => {
      await insert(db, org, school, 'no_class', '2027-03-01', '2027-03-01');
      await db.query('DELETE FROM schools WHERE id = $1', [school]);
      const { rows } = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM school_calendar_events WHERE org_id = $1',
        [org],
      );
      expect(Number(rows[0]!.n)).toBe(0);
    }));

  it('RLS 開著且沒有任何 policy（fail-closed）', async () => {
    const { rows } = await pool.query<{ rls: boolean; policies: string }>(
      `SELECT c.relrowsecurity AS rls,
              (SELECT count(*) FROM pg_policies WHERE tablename = 'school_calendar_events') AS policies
         FROM pg_class c WHERE c.relname = 'school_calendar_events'`,
    );
    expect(rows[0]).toEqual({ rls: true, policies: '0' });
  });
});
