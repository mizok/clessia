import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #2232 ②：老師存成績時「這些學生在不在我任課的班」那支 enrollments 查詢（分段送）**讀錯**，
 * 要回 400 `DB_ERROR` —— 不能吞成「讀到 0 筆」，再落到「不在範圍 → 403」誤報老師沒權限。
 * 任課範圍本身（staff、任期）替身掉，只讓 enrollments 那支回錯。
 */

const CLS = '00000000-0000-0000-0000-0000000000c1';
vi.mock('../lib/teacher-scope', async (orig) => ({
  ...(await orig<typeof import('../lib/teacher-scope')>()),
  loadTeachingScope: async () => ({ teacherStaffId: 'staff-t' }),
  loadTenure: async () => ({ current: [CLS], past: new Map() }),
  taughtClassIds: async () => [CLS],
}));
vi.mock('../lib/get-auth', () => ({ getAuth: () => ({ pool: {} }) }));
const write = vi.hoisted(() => vi.fn());
vi.mock('../lib/exam-scores-write', () => ({ writeExamScores: write }));

const { default: academyRoute } = await import('./academy-exams');
const { default: schoolRoute } = await import('./school-exams');

const ORG = '00000000-0000-0000-0000-00000000000a';
const EXAM = '00000000-0000-0000-0000-000000000e01';
const STU = '00000000-0000-0000-0000-000000000501';
const MATH = '00000000-0000-0000-0000-000000000901';

/** enrollments 的查詢（不管怎麼串）一律回錯；其他表照替身 DB */
function failingEnrollments(client: { from: (t: string) => unknown }) {
  const broken: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: null, error: { code: '57014', message: 'statement timeout' } }),
  };
  for (const m of ['select', 'eq', 'in']) broken[m] = () => broken;
  return new Proxy(client, {
    get: (target, key) =>
      key === 'from'
        ? (table: string) => (table === 'enrollments' ? broken : target.from(table))
        : Reflect.get(target, key),
  });
}

async function call(route: unknown, body: Record<string, unknown>) {
  const db = createMultiOrgDb({
    academy_exams: [
      {
        id: EXAM,
        org_id: ORG,
        name: '第三次小考',
        status: 'open',
        created_by: null,
        total_score: 100,
        exam_date: '2026-10-20',
      },
    ],
    academy_exam_classes: [{ exam_id: EXAM, class_id: CLS }],
    school_exams: [
      { id: EXAM, org_id: ORG, label: '第一次段考', status: 'open', subject_id: null },
    ],
    students: [{ id: STU, org_id: ORG }],
    subjects: [{ id: MATH, org_id: ORG }],
    ba_user: [],
    audit_logs: [],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', failingEnrollments(db.client as never));
    set('orgId', ORG);
    set('userId', 'teacher-u');
    set('roles', ['teacher']);
    set('permissions', []);
    set('campusScope', null);
    await next();
  });
  app.route('/', route as Hono);
  const res = await app.request(
    `/${EXAM}/scores`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    {},
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('老師存成績：任課範圍讀錯 → 400 DB_ERROR，不是 403（#2232 ②）', () => {
  it('補習班考試', async () => {
    const r = await call(academyRoute, {
      scores: [{ studentId: STU, score: 85, status: 'scored' }],
    });
    expect(r.status).toBe(400);
    expect(r.body['code']).toBe('DB_ERROR');
    expect(write).not.toHaveBeenCalled();
  });

  it('學校段考', async () => {
    const r = await call(schoolRoute, {
      scores: [{ studentId: STU, subjectId: MATH, score: 88, status: 'scored' }],
    });
    expect(r.status).toBe(400);
    expect(r.body['code']).toBe('DB_ERROR');
    expect(write).not.toHaveBeenCalled();
  });
});
