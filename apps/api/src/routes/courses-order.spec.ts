import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import coursesApp from './courses';

/**
 * `GET /api/courses` 的排序（#1314 C1）：前端依科目分章、跨頁接續，所以列表要先依科目排。
 * 順序＝ subjects.sort_order → subject_id → 課名 → id。**sort_order 預設 0 且不唯一**，
 * 少了 subject_id 那一鍵，同序兩科的課會交錯。章節（summary.bySubject）同一個順序。
 *
 * 課程列直接帶 `subjects` embed（替身不解析 select；`order('subjects(sort_order)')` 讀它）。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const CA = '00000000-0000-0000-0000-0000000000ca';
// 英文、國文同為 sort_order 0：靠 id 定先後（英文 e1 < 國文 e2）；數學 sort_order -1 排最前
const ENGLISH = { id: '00000000-0000-0000-0000-0000000000e1', name: '英文', sort_order: 0 };
const CHINESE = { id: '00000000-0000-0000-0000-0000000000e2', name: '國文', sort_order: 0 };
const MATH = { id: '00000000-0000-0000-0000-0000000000e3', name: '數學', sort_order: -1 };

let n = 0;
const course = (subject: typeof ENGLISH, name: string, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
  org_id: ORG,
  campus_id: CA,
  subject_id: subject.id,
  name,
  is_active: true,
  // 越後面建的越新 —— 舊的 created_at desc 排法會把順序整個倒過來
  created_at: `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`,
  subjects: { name: subject.name, sort_order: subject.sort_order },
  campuses: { name: 'A' },
  ...over,
});

function seed() {
  n = 0;
  return createMultiOrgDb({
    subjects: [CHINESE, ENGLISH, MATH].map((s) => ({ ...s, org_id: ORG })),
    courses: [
      course(CHINESE, 'B 國文'),
      course(ENGLISH, 'B 英文'),
      course(MATH, 'Z 數學'),
      course(CHINESE, 'A 國文'),
      course(ENGLISH, 'A 英文'),
      // 同名：靠 id —— 種子順序排在後面、id 卻最小，沒有末鍵 id 就會照種子順序
      course(ENGLISH, 'A 英文', { id: '00000000-0000-0000-0000-000000000000' }),
      course(MATH, 'A 數學'),
    ],
  });
}

async function list(path: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', seed().client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', coursesApp as unknown as Hono);
  const res = await app.request(path);
  return (await res.json()) as any;
}

const names = (body: any) =>
  body.data.map((c: { name: string; id: string }) => `${c.name}#${c.id.slice(-1)}`);

describe('GET /api/courses —— 依科目分章的排序（#1314 C1）', () => {
  it('科目 sort_order → 同序依科目 id → 課名 → id', async () => {
    const body = await list('/?pageSize=0');
    expect(names(body)).toEqual([
      'A 數學#7',
      'Z 數學#3',
      'A 英文#0',
      'A 英文#5',
      'B 英文#2',
      'A 國文#4',
      'B 國文#1',
    ]);
  });

  it('跨頁接續：第二頁接在第一頁後面，不交錯', async () => {
    const page1 = await list('/?page=1&pageSize=3');
    const page2 = await list('/?page=2&pageSize=3');
    expect([...names(page1), ...names(page2)]).toEqual([
      'A 數學#7',
      'Z 數學#3',
      'A 英文#0',
      'A 英文#5',
      'B 英文#2',
      'A 國文#4',
    ]);
  });

  it('章節順序跟列表一致（同序的英文、國文也依 id）', async () => {
    const body = await list('/?pageSize=0');
    expect(body.summary.bySubject.map((s: { subjectName: string }) => s.subjectName)).toEqual([
      '數學',
      '英文',
      '國文',
    ]);
  });

  // 替身不解析 select，看不出 PostgREST 的規則：排序用的 embed 欄位必須在 select 裡，否則 400
  // （#1423 上線即壞）。這條只能釘字串 —— 形狀本身的證據是本機實打（PR 留言）
  it('order 用到的 subjects(sort_order) 有選進 embed', async () => {
    const selects: string[] = [];
    const db = seed();
    const client = new Proxy(db.client as any, {
      get(target, prop) {
        if (prop !== 'from') return Reflect.get(target, prop);
        return (table: string) => {
          const builder = target.from(table);
          if (table !== 'courses') return builder;
          return new Proxy(builder, {
            get(b, p) {
              if (p !== 'select') return Reflect.get(b, p);
              return (cols: string, opts?: unknown) => {
                selects.push(cols);
                return b.select(cols, opts);
              };
            },
          });
        };
      },
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', client);
      set('orgId', ORG);
      set('userId', 'admin-a');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', coursesApp as unknown as Hono);
    expect((await app.request('/')).status).toBe(200);
    expect(selects[0]).toMatch(/subjects\([^)]*\bsort_order\b/);
  });
});
