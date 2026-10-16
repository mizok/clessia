import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteClasses } from './class-delete';

/**
 * #1652 交易的「形狀」：BEGIN／COMMIT／ROLLBACK、release、哪一步之後停。
 * 真正的 SQL 語意（org 條件、範圍、守門、FK）在 `contract/class-delete.contract.ts` 對真 Postgres 驗。
 */

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

type Rows = Array<Record<string, unknown>>;

/** 依 SQL 關鍵字回答；`fail` 命中的那句丟例外 */
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
  const deletes = () => sent.filter((q) => /^DELETE/.test(q.sql.trim()));
  return { pool, sent, release, verbs, deletes };
}

/** 兩班都在範圍、沒有任何守門命中 */
const clean =
  (over: Partial<Record<'invoice' | 'past' | 'pack' | 'deleteClasses', Rows | Error>> = {}) =>
  (sql: string): Rows | Error => {
    if (/FROM classes .*FOR UPDATE/s.test(sql))
      return [
        { id: A, campus_id: 'c1' },
        { id: B, campus_id: 'c2' },
      ];
    if (/invoice_items/.test(sql)) return over.invoice ?? [];
    if (/FROM sessions/.test(sql)) return over.past ?? [];
    if (/session_packs/.test(sql)) return over.pack ?? [];
    if (/^DELETE FROM classes/.test(sql.trim())) return over.deleteClasses ?? [];
    return [];
  };

const run = (pool: Pool, onBlocked: 'abort' | 'skip', scope: readonly string[] | null = null) =>
  deleteClasses(pool, { orgId: 'org-1', ids: [A, B], scope, onBlocked });

describe('deleteClasses —— 交易形狀（#1652）', () => {
  afterEach(() => vi.useRealTimers());

  it('乾淨：先刪報名再刪班級，COMMIT，release', async () => {
    const db = fakePool(clean());
    expect(await run(db.pool, 'skip')).toMatchObject({ status: 'done', deletedIds: [A, B] });
    expect(db.deletes().map((q) => q.sql.split(/\s+/)[2])).toEqual(['enrollments', 'classes']);
    expect(db.verbs().at(0)).toBe('BEGIN');
    expect(db.verbs().at(-1)).toBe('COMMIT');
    expect(db.release).toHaveBeenCalledWith(undefined);
  });

  it('每一句都帶 org 參數', async () => {
    const db = fakePool(clean());
    await run(db.pool, 'skip');
    for (const q of db.sent.filter((x) => x.params)) {
      expect(q.sql).toMatch(/org_id = \$2/);
      expect(q.params?.[1]).toBe('org-1');
    }
  });

  it('有一班不在分校範圍 → not-found，什麼都不刪', async () => {
    const db = fakePool(clean());
    expect(await run(db.pool, 'skip', ['c1'])).toEqual({ status: 'not-found' });
    expect(db.deletes()).toEqual([]);
  });

  it.each(['abort', 'skip'] as const)(
    '有帳單明細（%s）→ has-invoice-items 標出班級，整批不刪',
    async (mode) => {
      const db = fakePool(clean({ invoice: [{ class_id: B }] }));
      expect(await run(db.pool, mode)).toEqual({ status: 'has-invoice-items', classIds: [B] });
      expect(db.deletes()).toEqual([]);
    },
  );

  it('過去課堂：abort 全不刪；skip 只刪另一班', async () => {
    const abort = fakePool(clean({ past: [{ class_id: A }] }));
    expect(await run(abort.pool, 'abort')).toMatchObject({ deletedIds: [], pastSessionIds: [A] });
    expect(abort.deletes()).toEqual([]);

    const skip = fakePool(clean({ pack: [{ class_id: A }] }));
    expect(await run(skip.pool, 'skip')).toMatchObject({ deletedIds: [B], sessionPackIds: [A] });
    expect(skip.deletes().every((q) => (q.params?.[0] as string[]).join() === B)).toBe(true);
  });

  it('FK 擋下（23503）→ ROLLBACK、in-use', async () => {
    const fk = Object.assign(new Error('fk'), { code: '23503' });
    const db = fakePool(clean({ deleteClasses: fk }));
    expect(await run(db.pool, 'skip')).toEqual({ status: 'in-use' });
    expect(db.verbs().at(-1)).toBe('ROLLBACK');
    expect(db.verbs()).not.toContain('COMMIT');
  });

  it('其他錯誤 → ROLLBACK 後原樣丟出（呼叫端回 500）', async () => {
    const db = fakePool(clean({ deleteClasses: new Error('boom') }));
    await expect(run(db.pool, 'skip')).rejects.toThrow('boom');
    expect(db.verbs().at(-1)).toBe('ROLLBACK');
  });

  it('ROLLBACK 也失敗 → release(err) 讓池丟掉這條連線', async () => {
    const dead = new Error('connection lost');
    const db = fakePool((sql) =>
      sql === 'ROLLBACK'
        ? dead
        : /^DELETE FROM classes/.test(sql)
          ? new Error('boom')
          : clean()(sql),
    );
    await expect(run(db.pool, 'skip')).rejects.toThrow('boom');
    expect(db.release).toHaveBeenCalledWith(dead);
  });

  it('「今天」用台北日期（UTC 前一天傍晚 = 台北隔天凌晨，M8 那個窗）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z')); // 台北 09-06 01:00
    const db = fakePool(clean());
    await run(db.pool, 'skip');
    const past = db.sent.find((q) => /FROM sessions/.test(q.sql));
    expect(past?.params?.[2]).toBe('2026-09-06');
  });
});
