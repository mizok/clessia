import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { splitSchedule, type ScheduleSplitInput } from './schedule-split';

/**
 * #1100 #22 交易的「形狀」：dryRun 一定 ROLLBACK、排除約束 23P01 對成 overlap 並回滾。
 * SQL 語意（org 條件、哪些課堂刪／留、X 前後落在哪一段）在 `contract/schedule-split.contract.ts`。
 */

function fakePool(answer: (sql: string) => Array<Record<string, unknown>> | Error) {
  const verbs: string[] = [];
  const release = vi.fn();
  const client = {
    query: async (sql: string) => {
      verbs.push(sql.trim().split(/\s+/)[0]!);
      const out = answer(sql);
      if (out instanceof Error) throw out;
      return { rows: out, rowCount: out.length };
    },
    release,
  };
  return { pool: { connect: async () => client } as unknown as Pool, verbs, release };
}

const ok = (sql: string) => {
  if (/FROM classes WHERE id/.test(sql)) return [{ campus_id: 'c1' }];
  if (/FROM schedules s/.test(sql)) return [{ effective_from: '2030-01-01', effective_to: null }];
  if (/^INSERT INTO schedules/.test(sql.trim())) return [{ id: 'new' }];
  return [];
};

const input = (over: Partial<ScheduleSplitInput> = {}): ScheduleSplitInput => ({
  orgId: 'org-1',
  classId: 'cls',
  scheduleId: 'sch',
  scope: null,
  fromDate: '2030-02-01',
  weekday: 3,
  startTime: '10:00',
  endTime: '11:00',
  teacherId: null,
  classroomId: null,
  createdBy: null,
  dryRun: false,
  ...over,
});

describe('splitSchedule —— 交易形狀（#1100 #22）', () => {
  it('正常：COMMIT', async () => {
    const db = fakePool(ok);
    expect(await splitSchedule(db.pool, input())).toMatchObject({ status: 'done', dryRun: false });
    expect(db.verbs.at(-1)).toBe('COMMIT');
  });

  it('dryRun：照跑但 ROLLBACK，回同樣的結果', async () => {
    const db = fakePool(ok);
    expect(await splitSchedule(db.pool, input({ dryRun: true }))).toMatchObject({
      status: 'done',
      dryRun: true,
    });
    expect(db.verbs).not.toContain('COMMIT');
    expect(db.verbs.at(-1)).toBe('ROLLBACK');
    expect(db.release).toHaveBeenCalledWith(undefined);
  });

  it('排除約束 23P01 → overlap、ROLLBACK；其他錯誤原樣丟出', async () => {
    const clash = fakePool((sql) =>
      /^INSERT INTO schedules/.test(sql.trim())
        ? Object.assign(new Error('x'), { code: '23P01' })
        : ok(sql),
    );
    expect(await splitSchedule(clash.pool, input())).toEqual({ status: 'overlap' });
    expect(clash.verbs.at(-1)).toBe('ROLLBACK');

    const withSessions = fakePool((sql) =>
      /FROM sessions s/.test(sql)
        ? [{ id: 's1', session_date: '2030-02-03', start_time: '10:00:00', status: 'scheduled' }]
        : /^DELETE/.test(sql.trim())
          ? new Error('boom')
          : ok(sql),
    );
    await expect(splitSchedule(withSessions.pool, input())).rejects.toThrow('boom');
    expect(withSessions.verbs.at(-1)).toBe('ROLLBACK');
  });
});
