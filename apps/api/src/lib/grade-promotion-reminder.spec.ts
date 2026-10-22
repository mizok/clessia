import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { enqueueGradePromotionReminders } from './staff-digests';

/**
 * #1820 學年升級前提醒的 JS 端：誰收、什麼時候、鍵與文案。SQL 對真 DB 的形狀由
 * `contract/grade-promotion-reminder.contract.ts` 驗。替身依 SQL 分流，並記下每一句送出的參數。
 */

const TODAY = '2026-08-28';

interface Org {
  org_id: string;
  month_day: string;
  days: number;
}
interface Staff {
  org_id: string;
  user_id: string;
  roles: string[];
  permissions: string[];
  campus_ids: string[];
}

function fakeDb(orgs: Org[], staff: Staff[], closed: string[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('grade_promotion_month_day')) return { rows: orgs };
      if (sql.includes('FROM unnest($1::uuid[], $2::text[], $3::int[])')) {
        const ids = params[0] as string[];
        return { rows: ids.filter((id) => !closed.includes(id)).map((org_id) => ({ org_id })) };
      }
      if (sql.includes('FROM staff st')) {
        const ids = params[0] as string[];
        return { rows: staff.filter((s) => ids.includes(s.org_id)) };
      }
      if (sql.includes('INSERT INTO notifications')) {
        return { rows: [], rowCount: (params[0] as unknown[]).length };
      }
      throw new Error(`沒預期的 SQL：${sql}`);
    },
  } as unknown as PoolClient;
  const inserted = () => {
    const insert = calls.find((c) => c.sql.includes('INSERT INTO notifications'));
    if (!insert) return [];
    const [orgIds, userIds, keys, payloads] = insert.params as [
      string[],
      string[],
      string[],
      string[],
    ];
    return userIds.map((user_id, i) => ({
      org_id: orgIds[i],
      user_id,
      dedupe_key: keys[i],
      payload: JSON.parse(payloads[i]!) as { title: string; body: string; url: string },
    }));
  };
  return { db, calls, inserted };
}

const admin = (user_id: string, permissions: string[], campus_ids: string[] = []): Staff => ({
  org_id: 'org-a',
  user_id,
  roles: ['admin'],
  permissions,
  campus_ids,
});

describe('enqueueGradePromotionReminders（#1820）', () => {
  it('提醒窗內：只給 manage_students＋all_campuses（或 *）的管理員；鍵帶升級日', async () => {
    const f = fakeDb(
      [{ org_id: 'org-a', month_day: '09-01', days: 7 }],
      [
        admin('full', ['manage_students', 'all_campuses']),
        admin('star', ['*']),
        admin('scoped', ['manage_students'], ['c1']), // 只管部分分校：不能代表全機構按
        admin('nostudents', ['all_campuses', 'manage_finance']),
      ],
    );

    const n = await enqueueGradePromotionReminders(f.db, TODAY, null);

    expect(n).toBe(2);
    // 二讀 D7／D8：不推播（同摘要），同一人同一鍵只一則
    const insert = f.calls.find((c) => c.sql.includes('INSERT INTO notifications'))!;
    expect(insert.sql).toMatch(/'skipped', 'ROLE_PUSH_DISABLED'/);
    expect(insert.sql).toMatch(/ON CONFLICT \(user_id, dedupe_key\) DO NOTHING/);
    expect(f.inserted().map((r) => r.user_id)).toEqual(['full', 'star']);
    expect(f.inserted()[0]).toEqual({
      org_id: 'org-a',
      user_id: 'full',
      dedupe_key: 'grade_promotion_reminder:org-a:2026-09-01',
      payload: {
        title: '學年升級',
        body: '學年升級日（9/1）還有 4 天，到設定預覽並執行',
        url: '/admin/settings/general',
      },
    });
  });

  it('升級日當天的文案', async () => {
    const f = fakeDb([{ org_id: 'org-a', month_day: '08-28', days: 3 }], [admin('full', ['*'])]);

    await enqueueGradePromotionReminders(f.db, TODAY, null);

    expect(f.inserted()[0]!.payload.body).toBe('今天是學年升級日（8/28），到設定預覽並執行');
  });

  it('還沒進窗：只跑第一句', async () => {
    const f = fakeDb([{ org_id: 'org-a', month_day: '09-10', days: 7 }], [admin('full', ['*'])]);

    expect(await enqueueGradePromotionReminders(f.db, TODAY, null)).toBe(0);
    expect(f.calls).toHaveLength(1);
  });

  it('已排過或那一學年已升級（第二句篩掉）→ 不寫；第二句帶升級日與學年', async () => {
    const f = fakeDb(
      [{ org_id: 'org-a', month_day: '09-01', days: 7 }],
      [admin('full', ['*'])],
      ['org-a'],
    );

    expect(await enqueueGradePromotionReminders(f.db, TODAY, null)).toBe(0);
    expect(f.calls[1]!.params).toEqual([['org-a'], ['2026-09-01'], [115]]);
    // 二讀 D10：只有沒復原的升級才擋（復原過要能再提醒）
    expect(f.calls[1]!.sql).toMatch(/g\.academic_year = x\.year AND g\.reverted_at IS NULL/);
    expect(f.calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  // 二讀 N6：學年要照升級日算，不是今天 —— 7/30 提醒 8/2 的升級，那天按執行寫的是新學年
  it('跨 8/1：今天 7/30、升級日 8/2 → 第二句帶升級日那一學年（115），不是今天的（114）', async () => {
    const f = fakeDb(
      [{ org_id: 'org-a', month_day: '08-02', days: 7 }],
      [admin('full', ['*'])],
      ['org-a'],
    );
    await enqueueGradePromotionReminders(f.db, '2026-07-30', null);
    expect(f.calls[1]!.params).toEqual([['org-a'], ['2026-08-02'], [115]]);
  });

  it('org 範圍照傳進第一句（只跑指定的 org）', async () => {
    const f = fakeDb([], []);

    await enqueueGradePromotionReminders(f.db, TODAY, ['org-a']);

    expect(f.calls[0]!.params).toEqual([['org-a']]);
  });
});
