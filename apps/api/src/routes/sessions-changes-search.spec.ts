import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import sessionsApp from './sessions';

/**
 * `GET /api/sessions/changes?q=`（#1412）—— 老師或班級搜尋。
 *
 * 班名在 `sessions→classes` 底下，PostgREST 的 top-level `or` 比不到巢狀欄位，所以實作先撈
 * 名字符合的班級／老師 id，再拿 `class_match` embed 判空跟老師條件 OR。替身照 PostgREST 的語意
 * 評估主查詢下的 `in` 與 `or`（embed 被 `in` 篩掉 → null），所以「條件下錯」會反映在回傳上。
 * 真 PostgREST 的形狀另有本機實打（PR 留言）。
 */
interface Op {
  readonly name: string;
  readonly args: readonly unknown[];
}

interface Change {
  id: string;
  change_type: string;
  class_id: string;
  original_teacher_name: string | null;
  substitute_teacher_id: string | null;
}

const CLASSES = [
  { id: 'class-math', name: '國三數學 A 班' },
  { id: 'class-eng', name: '國二英文 B 班' },
];
const STAFF = [
  { id: 'staff-zhou', display_name: '周雅琳' },
  { id: 'staff-wu', display_name: '吳承恩' },
];
const CHANGES: Change[] = [
  {
    id: 'c-math-cancel',
    change_type: 'cancellation',
    class_id: 'class-math',
    original_teacher_name: null,
    substitute_teacher_id: null,
  },
  {
    id: 'c-math-sub',
    change_type: 'substitute',
    class_id: 'class-math',
    original_teacher_name: '周雅琳',
    substitute_teacher_id: 'staff-wu',
  },
  {
    id: 'c-eng-cancel',
    change_type: 'cancellation',
    class_id: 'class-eng',
    original_teacher_name: null,
    substitute_teacher_id: null,
  },
];

const ilike = (value: string, pattern: string) => value.includes(pattern.replace(/^%|%$/g, ''));

function evaluateChanges(ops: Op[]): Change[] {
  return CHANGES.filter((row) => {
    let classMatch = true;
    for (const { name, args } of ops) {
      if (name === 'eq' && args[0] === 'change_type' && row.change_type !== args[1]) return false;
      if (name === 'in' && args[0] === 'class_match.class_id') {
        classMatch = (args[1] as string[]).includes(row.class_id);
      }
    }
    const or = ops.find((op) => op.name === 'or');
    if (!or) return true;
    return (or.args[0] as string).split(',').some((term) => {
      if (term === 'class_match.not.is.null') return classMatch;
      const nameTerm = term.match(/^original_teacher_name\.ilike\.\*(.*)\*$/);
      if (nameTerm) return (row.original_teacher_name ?? '').includes(nameTerm[1] as string);
      const staffTerm = term.match(/^substitute_teacher_id\.in\.\((.*)$/);
      if (staffTerm) {
        const ids = (staffTerm[1] as string).replace(/\)$/, '').split(',').filter(Boolean);
        return row.substitute_teacher_id !== null && ids.includes(row.substitute_teacher_id);
      }
      throw new Error(`替身不認識的 or 條件：${term}`);
    });
  });
}

function createApp() {
  const queries: { table: string; ops: Op[] }[] = [];
  const supabase = {
    from(table: string) {
      const recorded = { table, ops: [] as Op[] };
      queries.push(recorded);
      const query: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') {
              return (onfulfilled?: (value: unknown) => unknown) => {
                const pattern = recorded.ops.find((op) => op.name === 'ilike')?.args[1] as string;
                let data: unknown[] = [];
                if (table === 'classes') data = CLASSES.filter((r) => ilike(r.name, pattern));
                if (table === 'staff') data = STAFF.filter((r) => ilike(r.display_name, pattern));
                if (table === 'schedule_changes') {
                  data = evaluateChanges(recorded.ops).map((row) => ({
                    ...row,
                    session_id: 's-1',
                    operation_source: 'single',
                    created_at: '2026-10-01T00:00:00Z',
                    sessions: {
                      session_date: '2026-10-01',
                      classes: { name: CLASSES.find((c) => c.id === row.class_id)?.name },
                    },
                    staff: null,
                  }));
                }
                return Promise.resolve({ data, count: data.length, error: null }).then(onfulfilled);
              };
            }
            return (...args: unknown[]) => {
              recorded.ops.push({ name: prop, args });
              return query;
            };
          },
        },
      );
      return query;
    },
  };

  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', supabase);
    ctx.set('orgId', 'org-1');
    ctx.set('userId', 'user-1');
    ctx.set('roles', ['admin']);
    ctx.set('campusScope', null);
    await next();
  });
  app.route('/api/sessions', sessionsApp);
  return { app, queries };
}

async function search(params: string) {
  const { app, queries } = createApp();
  const res = await app.request(`/api/sessions/changes?from=2026-10-01&to=2026-10-31&${params}`);
  const body = (await res.json()) as { data?: { id: string }[]; meta?: { total: number } };
  return { res, ids: (body.data ?? []).map((row) => row.id).sort(), body, queries };
}

describe('GET /api/sessions/changes?q=（#1412）', () => {
  it('命中班名：該班所有異動', async () => {
    const { res, ids } = await search(`q=${encodeURIComponent('數學')}`);
    expect(res.status).toBe(200);
    expect(ids).toEqual(['c-math-cancel', 'c-math-sub']);
  });

  it('命中原老師名', async () => {
    const { ids } = await search(`q=${encodeURIComponent('雅琳')}`);
    expect(ids).toEqual(['c-math-sub']);
  });

  it('命中代課老師名', async () => {
    const { ids } = await search(`q=${encodeURIComponent('承恩')}`);
    expect(ids).toEqual(['c-math-sub']);
  });

  it('不命中回空', async () => {
    const { res, ids, body } = await search(`q=${encodeURIComponent('物理')}`);
    expect(res.status).toBe(200);
    expect(ids).toEqual([]);
    expect(body.meta?.total).toBe(0);
  });

  it('與 changeType 並用是 AND', async () => {
    const { ids } = await search(`q=${encodeURIComponent('數學')}&changeType=cancellation`);
    expect(ids).toEqual(['c-math-cancel']);
  });

  it('班級／老師 id 只在本 org 找', async () => {
    const { queries } = await search(`q=${encodeURIComponent('數學')}`);
    for (const table of ['classes', 'staff']) {
      const q = queries.find((query) => query.table === table);
      expect(q?.ops).toContainEqual({ name: 'eq', args: ['org_id', 'org-1'] });
    }
  });

  it('q 只含保留字元：回空，不查 DB（剝光後不能變成「不篩」）', async () => {
    const { res, ids, queries } = await search(`q=${encodeURIComponent('(*,)')}`);
    expect(res.status).toBe(200);
    expect(ids).toEqual([]);
    expect(queries).toEqual([]);
  });

  it('q 裡的保留字元被剝掉，不會拆壞 or 條件', async () => {
    const { ids } = await search(`q=${encodeURIComponent('數,學)')}`);
    expect(ids).toEqual(['c-math-cancel', 'c-math-sub']);
  });

  it('q 超過 50 字回 400', async () => {
    const { res } = await search(`q=${'a'.repeat(51)}`);
    expect(res.status).toBe(400);
  });

  it('不帶 q：不撈班級／老師，也不下 or', async () => {
    const { ids, queries } = await search('');
    expect(ids).toHaveLength(3);
    expect(queries.map((q) => q.table)).toEqual(['schedule_changes']);
    expect(queries[0]?.ops.some((op) => op.name === 'or')).toBe(false);
  });
});
