import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// 老師的任課學生：只給 S1（taughtStudentIds 本身由 teacher-scope 的 spec 守）
vi.mock('../lib/teacher-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/teacher-scope')>()),
  taughtStudentIds: vi.fn(async () => [S1]),
}));

import scoresApp from './scores';

/**
 * #1100 #40：成績匯出 CSV（保留類 —— 匯出是把資料帶出系統，範圍錯了就是外洩）。
 * 替身依表名回 fixture，**成績查詢照 `in('student_id', …)` 過濾、照 `range` 分頁**，
 * 這樣範圍有沒有套上看得出來（不只是斷言送了什麼）。
 */
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const CAMPUS_A = '33333333-3333-4333-8333-333333333333';
const CAMPUS_B = '44444444-4444-4444-8444-444444444444';

interface Op {
  readonly name: string;
  readonly args: readonly unknown[];
}
interface Q {
  readonly table: string;
  readonly ops: Op[];
}

const academyRow = (
  id: string,
  studentId: string,
  name: string,
  score: number | null,
  status = 'scored',
) => ({
  id,
  exam_id: 'ex-1',
  student_id: studentId,
  score,
  status,
  created_at: '2026-10-01T00:00:00Z',
  academy_exams: {
    name: '第一次段考',
    exam_date: '2026-10-01',
    total_score: 100,
    pass_score: 60,
    scope_note: null,
    org_id: 'org-1',
    subjects: { name: '數學' },
  },
  students: { name },
});

function setup(opts: {
  roles?: string[];
  campusScope?: string[] | null;
  academy?: ReturnType<typeof academyRow>[];
  staffRow?: boolean;
}) {
  const queries: Q[] = [];
  const academy = opts.academy ?? [
    academyRow('a1', S1, '=HYPERLINK("evil")', 88),
    // 缺考那筆就算存了分數也不寫（舊資料可能留著）
    academyRow('a2', S2, '王小明', 5, 'absent'),
  ];
  const inArg = (q: Q, col: string) =>
    q.ops.find((o) => o.name === 'in' && o.args[0] === col)?.args[1] as string[] | undefined;
  const page = <T>(q: Q, rows: T[]) => {
    const r = q.ops.find((o) => o.name === 'range')?.args as [number, number] | undefined;
    return r ? rows.slice(r[0], r[1] + 1) : rows;
  };
  const resolve = (q: Q): unknown => {
    if (q.table === 'staff') return opts.staffRow === false ? null : { id: 'staff-1' };
    if (q.table === 'enrollments' && inArg(q, 'classes.campus_id')) {
      // 分校 A 只有 S1
      return inArg(q, 'classes.campus_id')!.includes(CAMPUS_A) ? [{ student_id: S1 }] : [];
    }
    if (q.table === 'enrollments' && inArg(q, 'class_id'))
      return [{ student_id: S1, class_id: 'cl-1' }];
    if (q.table === 'academy_scores') {
      const ids = inArg(q, 'student_id');
      return page(q, ids ? academy.filter((r) => ids.includes(r.student_id)) : academy);
    }
    if (q.table === 'academy_exam_classes')
      return [
        {
          exam_id: 'ex-1',
          class_id: 'cl-1',
          classes: { name: '數學 A 班', courses: { name: '國三數學' } },
        },
      ];
    return [];
  };
  const supabase = {
    from(table: string) {
      const q: Q = { table, ops: [] };
      queries.push(q);
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then')
              return (ok?: (v: unknown) => unknown) =>
                Promise.resolve({ data: resolve(q), error: null }).then(ok);
            return (...args: unknown[]) => (q.ops.push({ name: prop, args }), proxy);
          },
        },
      );
      return proxy;
    },
  };
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', supabase);
    ctx.set('orgId', 'org-1');
    ctx.set('userId', 'user-1');
    ctx.set('roles', opts.roles ?? ['admin']);
    ctx.set('campusScope', opts.campusScope ?? null);
    await next();
  });
  app.route('/api/scores', scoresApp);
  const post = (body: unknown) =>
    app.request('/api/scores/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { post, queries };
}

const lines = async (res: Response) => (await res.text()).replace(/^﻿/, '').split('\r\n');

describe('POST /api/scores/export（#1100 #40）', () => {
  it('欄位照規格；開課班／課程取學生有報名的那班；姓名的公式注入被跳脫', async () => {
    const { post } = setup({});
    const res = await post({});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(await lines(res)).toEqual([
      '學生姓名,開課班,考試名稱,課程,日期,分數,狀態',
      `"'=HYPERLINK(""evil"")",數學 A 班,第一次段考,國三數學,2026-10-01,88,正常`,
      // S2 在那個班沒有報名 → 開課班／課程留空；缺考不寫分數
      '王小明,,第一次段考,,2026-10-01,,缺考',
    ]);
  });

  it('「照目前的篩選」：只匯出帶來的學生', async () => {
    const { post } = setup({});
    const out = await lines(await post({ studentIds: [S2] }));
    expect(out).toHaveLength(2);
    expect(out[1]).toContain('王小明');
  });

  it('老師：只匯出自己的學生 —— 帶了別人的學生 id 也撈不到', async () => {
    const { post } = setup({ roles: ['teacher'] });
    const out = await lines(await post({ studentIds: [S1, S2] }));
    expect(out).toHaveLength(2);
    expect(out[1]).toContain('HYPERLINK');
    expect(out.join()).not.toContain('王小明');
  });

  it('不是老師也不是管理員（查不到教職員列）→ 403', async () => {
    const { post } = setup({ roles: ['teacher'], staffRow: false });
    expect((await post({})).status).toBe(403);
  });

  it('受限管理員：分校範圍套上 —— 只有範圍內的學生', async () => {
    const { post } = setup({ campusScope: [CAMPUS_A] });
    const out = await lines(await post({}));
    expect(out).toHaveLength(2);
    expect(out.join()).not.toContain('王小明');
  });

  it('受限管理員＋照目前的篩選：帶範圍外的學生 → 撈不到（取交集，不是用帶來的名單）', async () => {
    const { post } = setup({ campusScope: [CAMPUS_A] });
    const out = await lines(await post({ studentIds: [S2] }));
    expect(out).toEqual(['學生姓名,開課班,考試名稱,課程,日期,分數,狀態']);
  });

  it('受限管理員帶別分校的 campusId → 只有標頭，連成績都不查', async () => {
    const { post, queries } = setup({ campusScope: [CAMPUS_A] });
    const out = await lines(await post({ campusId: CAMPUS_B }));
    expect(out).toEqual(['學生姓名,開課班,考試名稱,課程,日期,分數,狀態']);
    expect(queries.some((q) => q.table === 'academy_scores')).toBe(false);
  });

  it('超過 20000 列 → 413，不截斷', async () => {
    const many = Array.from({ length: 20001 }, (_, i) => academyRow(`r${i}`, S1, '王', 1));
    const { post } = setup({ academy: many });
    const res = await post({});
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('TOO_MANY_ROWS');
  });

  it('studentIds 超過 3000 → 400', async () => {
    const { post } = setup({});
    const ids = Array.from(
      { length: 3001 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect((await post({ studentIds: ids })).status).toBe(400);
  });
});
