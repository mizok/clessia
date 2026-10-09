import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import campusesApp from './campuses';
import classesApp from './classes';
import coursesApp from './courses';

/**
 * 列表主查詢的 org 範圍（#1398，c1）：courses／classes／campuses 三支原本只有分校範圍，
 * **不受限的管理員（campusScope = null）等於完全不濾 org**。替身照條件過濾，
 * 所以少一個 `.eq('org_id')` 別 org 的列就會出現在回應裡。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CX = '00000000-0000-0000-0000-0000000000cf'; // 別 org 的分校
const SUBJECT = '00000000-0000-0000-0000-0000000000f1';
const SUBJECT_X = '00000000-0000-0000-0000-0000000000f2';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function seed() {
  return createMultiOrgDb({
    campuses: [
      { id: CA, org_id: ORG, name: 'A 校', is_active: true, created_at: '2026-01-01' },
      { id: CX, org_id: OTHER, name: '別 org 分校', is_active: true, created_at: '2026-01-02' },
    ],
    subjects: [
      { id: SUBJECT, org_id: ORG, name: '數學', sort_order: 0 },
      { id: SUBJECT_X, org_id: OTHER, name: '別 org 科目', sort_order: 0 },
    ],
    courses: [
      {
        id: id(1),
        org_id: ORG,
        campus_id: CA,
        subject_id: SUBJECT,
        name: '本 org 課',
        is_active: true,
        created_at: '2026-01-01',
        subjects: { name: '數學', sort_order: 0 },
        campuses: { name: 'A 校' },
      },
      {
        id: id(2),
        org_id: OTHER,
        campus_id: CX,
        subject_id: SUBJECT_X,
        name: '別 org 課',
        is_active: true,
        created_at: '2026-01-02',
        subjects: { name: '別 org 科目', sort_order: 0 },
        campuses: { name: '別 org 分校' },
      },
    ],
    classes: [
      {
        id: id(11),
        org_id: ORG,
        campus_id: CA,
        course_id: id(1),
        name: '本 org 班',
        is_active: true,
        end_date: null,
        start_date: '2026-01-01',
        created_at: '2026-01-01',
        courses: { name: '本 org 課', grade_levels: [], subjects: null },
        campuses: { name: 'A 校' },
        schedules: [],
      },
      {
        id: id(12),
        org_id: OTHER,
        campus_id: CX,
        course_id: id(2),
        name: '別 org 班',
        is_active: true,
        end_date: null,
        start_date: '2026-01-01',
        created_at: '2026-01-02',
        courses: { name: '別 org 課', grade_levels: [], subjects: null },
        campuses: { name: '別 org 分校' },
        schedules: [],
      },
    ],
    sessions: [],
    enrollments: [],
  });
}

async function list(route: Hono, path = '/') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', seed().client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null); // 不受限 —— 洞就在這條路上
    await next();
  });
  app.route('/', route);
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}

const names = (body: any) => body.data.map((row: { name: string }) => row.name);

describe('列表主查詢只回本 org（#1398）', () => {
  it('GET /courses', async () => {
    const { status, body } = await list(coursesApp as unknown as Hono);
    expect(status).toBe(200);
    expect(names(body)).toEqual(['本 org 課']);
    expect(body.meta.total).toBe(1);
  });

  it('GET /classes', async () => {
    const { status, body } = await list(classesApp as unknown as Hono);
    expect(status).toBe(200);
    expect(names(body)).toEqual(['本 org 班']);
    expect(body.meta.total).toBe(1);
  });

  it('GET /campuses：列表與 summary 都只數本 org', async () => {
    const { status, body } = await list(campusesApp as unknown as Hono);
    expect(status).toBe(200);
    expect(names(body)).toEqual(['A 校']);
    expect(body.meta.total).toBe(1);
    expect(body.summary).toMatchObject({ total: 1 });
  });
});
