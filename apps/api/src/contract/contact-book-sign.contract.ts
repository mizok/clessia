import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createChildDb } from '../lib/child-db';

/**
 * #1100 #26 家長簽收的 SQL 對**真的** Postgres（替身不會跑 trigger，也不會判 `= any($3::uuid[])`）：
 * - 簽收後 `signed_at = updated_at`（同一個交易時間）—— 「簽收後有修改」的判準靠它
 * - 別的孩子的那則 → not-found，那一列沒動
 * - 已簽過 → already，第一位簽收者留著
 *
 * 整段在一個交易裡跑、最後 ROLLBACK，不留資料。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('家長簽收聯絡簿的 SQL（#1100 #26）', () => {
  const pool = new Pool({ connectionString: DB });
  afterAll(() => pool.end());

  it('只簽 scope 內的、兩欄同一個交易時間、已簽過不覆蓋', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      // 同一個 org 的兩則、不同學生；先清成未簽
      const { rows: entries } = await client.query<{
        id: string;
        org_id: string;
        student_id: string;
      }>(`select distinct on (student_id) id, org_id::text, student_id::text
          from public.contact_book_entries
          where org_id = (select org_id from public.contact_book_entries
                          group by org_id having count(distinct student_id) > 1 limit 1)
          order by student_id, entry_date desc limit 2`);
      expect(entries.length).toBe(2); // seed 沒有就什麼都沒驗到
      const [mine, other] = entries;
      await client.query(
        `update public.contact_book_entries set signed_by = null, signed_at = null where id = any($1::uuid[])`,
        [[mine.id, other.id]],
      );
      const { rows: users } = await client.query<{ id: string }>(
        `select id from public.ba_user where "orgId" = $1 order by id limit 2`,
        [mine.org_id],
      );
      expect(users.length).toBe(2);
      const [first, second] = users;

      const childDb = createChildDb(null as never, [mine.student_id], mine.org_id, client as never);
      const before = await client.query('select * from public.contact_book_entries where id = $1', [
        other.id,
      ]);

      expect(await childDb.signContactBookEntry(other.id, first.id)).toBe('not-found');
      const after = await client.query('select * from public.contact_book_entries where id = $1', [
        other.id,
      ]);
      expect(after.rows).toEqual(before.rows);

      // 別 org 的 orgId 也簽不到
      const wrongOrg = createChildDb(
        null as never,
        [mine.student_id],
        '00000000-0000-0000-0000-000000000000',
        client as never,
      );
      expect(await wrongOrg.signContactBookEntry(mine.id, first.id)).toBe('not-found');

      expect(await childDb.signContactBookEntry(mine.id, first.id)).toBe('signed');
      const { rows: signed } = await client.query<{
        signed_by: string;
        same: boolean;
      }>(
        `select signed_by, signed_at = updated_at as same from public.contact_book_entries where id = $1`,
        [mine.id],
      );
      expect(signed[0]).toEqual({ signed_by: first.id, same: true });

      expect(await childDb.signContactBookEntry(mine.id, second.id)).toBe('already');
      const { rows: still } = await client.query<{ signed_by: string }>(
        `select signed_by from public.contact_book_entries where id = $1`,
        [mine.id],
      );
      expect(still[0].signed_by).toBe(first.id);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
