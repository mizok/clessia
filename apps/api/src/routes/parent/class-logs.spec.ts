import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import classLogsRoute from './class-logs';

const CHILD_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CHILD_ID = '00000000-0000-0000-0000-000000000002';
const CLASS_A = 'class-a';
const CLASS_B = 'class-b';

interface EnrollmentFixture {
  class_id: string;
  effective_from: string;
  effective_to: string | null;
}

interface ClassLogFixture {
  id: string;
  class_id: string;
  log_date: string;
  teaching_record: string;
  homework: string;
  last_edited_by: string | null;
  published_at: string | null;
  classes?: { name: string } | null;
  editor?: { name: string } | null;
}

/**
 * `fromScopedIds('class_logs', ...)` 這支路由呼叫了兩次：候選集合
 * （`.select(CLASS_LOG_SELECT)`）與 recentCount（`.select('class_id, log_date')`）。
 * 靠 `.select()` 收到的欄位字串分流，不用另外開一支假 DB。
 */
function chainable<T>(resolve: () => { data: T[]; error: unknown }) {
  const obj: any = {
    not: () => obj,
    gte: () => obj,
    lte: () => obj,
    order: () => obj,
    limit: () => obj,
    then: (onfulfilled: (value: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onfulfilled),
  };
  return obj;
}

function fakeChildDb(config: {
  enrollmentRows: EnrollmentFixture[];
  classLogRows: ClassLogFixture[];
}) {
  return {
    from: (_table: string, _studentIdColumn: string) => ({
      async pluck(_columns: string, idColumn: string) {
        const rows = config.enrollmentRows as unknown as Record<string, unknown>[];
        const ids = [...new Set(rows.map((row) => row[idColumn] as string))];
        return { rows, ids, error: null };
      },
    }),
    fromScopedIds: (_table: string, _column: string, _ids: readonly string[]) => {
      let selectedColumns = '';
      const builder = chainable(() => ({
        data:
          selectedColumns === 'class_id, log_date'
            ? config.classLogRows.map((row) => ({ class_id: row.class_id, log_date: row.log_date }))
            : config.classLogRows,
        error: null,
      }));
      // `chainable()` 沒有內建 `select`，這裡補一個：只記錄呼叫端傳了哪個欄位字串
      // 用來分流候選集合查詢（CLASS_LOG_SELECT）跟 recentCount 查詢（'class_id, log_date'）
      builder.select = (columns: string) => {
        selectedColumns = columns;
        return builder;
      };
      return builder;
    },
  };
}

function appWith(roles: string[], studentScope: readonly string[] | null, childDb: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', studentScope);
    set('childDb', childDb);
    await next();
  });
  app.route('/', classLogsRoute as unknown as Hono);
  return app;
}

function buildLog(overrides: Partial<ClassLogFixture>): ClassLogFixture {
  return {
    id: 'log-1',
    class_id: CLASS_A,
    log_date: '2026-04-01',
    teaching_record: '內部教學紀錄，不該外流',
    homework: '第 3 章習題',
    last_edited_by: 'staff-1',
    published_at: '2026-04-01T10:00:00Z',
    classes: { name: '數學 A' },
    editor: { name: '陳老師' },
    ...overrides,
  };
}

describe('GET /api/me/class-logs', () => {
  it('不是家長身分回 403', async () => {
    const res = await appWith(
      ['teacher'],
      [CHILD_ID],
      fakeChildDb({ enrollmentRows: [], classLogRows: [] }),
    ).request(`/?childId=${CHILD_ID}`);
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'NOT_PARENT' });
  });

  it('childId 不在 studentScope 裡回 403，不是空清單', async () => {
    const res = await appWith(
      ['parent'],
      [OTHER_CHILD_ID],
      fakeChildDb({ enrollmentRows: [], classLogRows: [] }),
    ).request(`/?childId=${CHILD_ID}`);
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'CHILD_OUT_OF_SCOPE' });
  });

  it('孩子沒有任何在籍紀錄時回空清單，不查 class_logs', async () => {
    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb({ enrollmentRows: [], classLogRows: [] }),
    ).request(`/?childId=${CHILD_ID}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; meta: Record<string, unknown> };
    expect(body.data).toEqual([]);
    expect(body.meta).toMatchObject({ total: 0, recentCount: 0 });
  });

  it('回應不含 teachingRecord，只回 allowlist 允許的欄位', async () => {
    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb({
        enrollmentRows: [{ class_id: CLASS_A, effective_from: '2026-01-01', effective_to: null }],
        classLogRows: [buildLog({})],
      }),
    ).request(`/?childId=${CHILD_ID}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('teachingRecord');
    expect(body.data[0]).toMatchObject({
      id: 'log-1',
      classId: CLASS_A,
      className: '數學 A',
      logDate: '2026-04-01',
      homework: '第 3 章習題',
      publishedAt: '2026-04-01T10:00:00Z',
      lastEditedByName: '陳老師',
    });
  });

  /**
   * 這是設計文件點死要測的：孩子 3 月從 A 班轉到 B 班，兩個方向都要驗——
   * 只用「曾經在籍過的班級清單」查 class_logs 會過度曝光：看到 A 班在他
   * 離開之後、或 B 班在他加入之前寫的日誌。
   */
  it('轉班：漏掉「A 班他離開之後」與「B 班他加入之前」的日誌，兩個方向都要對', async () => {
    const enrollmentRows: EnrollmentFixture[] = [
      { class_id: CLASS_A, effective_from: '2026-01-01', effective_to: '2026-03-31' },
      { class_id: CLASS_B, effective_from: '2026-04-01', effective_to: null },
    ];
    const classLogRows: ClassLogFixture[] = [
      buildLog({ id: 'a-before', class_id: CLASS_A, log_date: '2026-02-15' }), // 在籍，該留
      buildLog({ id: 'a-after', class_id: CLASS_A, log_date: '2026-04-15' }), // 已轉出，該濾掉
      buildLog({ id: 'b-before', class_id: CLASS_B, log_date: '2026-03-15' }), // 還沒加入，該濾掉
      buildLog({ id: 'b-after', class_id: CLASS_B, log_date: '2026-05-01' }), // 在籍，該留
    ];

    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb({ enrollmentRows, classLogRows }),
    ).request(`/?childId=${CHILD_ID}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      meta: Record<string, unknown>;
    };
    const ids = body.data.map((row) => row.id).sort();

    expect(ids).toEqual(['a-before', 'b-after']);
    expect(body.meta).toMatchObject({ total: 2 });
  });

  it('recentCount 也套用轉班的在籍過濾，不是候選集合的原始筆數', async () => {
    const enrollmentRows: EnrollmentFixture[] = [
      { class_id: CLASS_A, effective_from: '2026-01-01', effective_to: '2026-03-31' },
    ];
    // 這篇 published_at 落在最近 7 天內，但 log_date 是轉出之後 —— recentCount 不該算它
    const recentButNotEnrolled = buildLog({
      id: 'a-after-recent',
      class_id: CLASS_A,
      log_date: '2026-04-15',
      published_at: new Date().toISOString(),
    });

    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb({ enrollmentRows, classLogRows: [recentButNotEnrolled] }),
    ).request(`/?childId=${CHILD_ID}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: Record<string, unknown> };
    expect(body.meta).toMatchObject({ recentCount: 0 });
  });
});
