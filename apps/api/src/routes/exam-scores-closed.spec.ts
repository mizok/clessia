import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #1931：考試標完成後仍可修改（照 A6 scores）。兩支 `POST /{id}/scores` 的路由層：
 * 完成的考試不再回 `EXAM_CLOSED`、寫入走交易（池不在就 500，不退回逐句寫）、交易結果怎麼對成 HTTP。
 * 交易本身（舊值→新值、created_by 不覆蓋、稽核失敗回滾、三段鍵刪除）在
 * `contract/exam-scores-write.contract.ts` 對真 Postgres 驗，這裡替身掉。
 */

const h = vi.hoisted(() => ({
  pool: {} as unknown,
  write: vi.fn(),
}));
vi.mock('../lib/get-auth', () => ({ getAuth: () => ({ pool: h.pool }) }));
vi.mock('../lib/exam-scores-write', () => ({ writeExamScores: h.write }));

const { default: academyRoute } = await import('./academy-exams');
const { default: schoolRoute } = await import('./school-exams');

const ORG = '00000000-0000-0000-0000-00000000000a';
const EXAM = '00000000-0000-0000-0000-000000000e01';
const STU = '00000000-0000-0000-0000-000000000501';
const STU2 = '00000000-0000-0000-0000-000000000502';
const MATH = '00000000-0000-0000-0000-000000000901';

const DONE = { status: 'done', examClosed: true, upsertChanges: [], deleteChanges: [] };

async function call(route: unknown, body: Record<string, unknown>) {
  const db = createMultiOrgDb({
    academy_exams: [
      {
        id: EXAM,
        org_id: ORG,
        name: '第三次小考',
        status: 'closed',
        created_by: null,
        total_score: 100,
        exam_date: '2026-10-20',
      },
    ],
    school_exams: [
      { id: EXAM, org_id: ORG, label: '第一次段考', status: 'closed', subject_id: null },
    ],
    students: [
      { id: STU, org_id: ORG },
      { id: STU2, org_id: ORG },
    ],
    subjects: [{ id: MATH, org_id: ORG }],
    ba_user: [],
    audit_logs: [],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
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

describe('POST /api/academy-exams/{id}/scores —— 完成後仍可修改（#1931）', () => {
  beforeEach(() => {
    h.pool = {};
    h.write.mockReset().mockResolvedValue(DONE);
  });

  it('完成的考試照樣寫：不回 EXAM_CLOSED，新增／清空分開交給交易', async () => {
    const r = await call(academyRoute, {
      scores: [
        { studentId: STU, score: 85, status: 'scored' },
        { studentId: STU2, score: null, status: 'scored' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, affected: 1, removed: 1 });
    expect(h.write).toHaveBeenCalledWith(h.pool, {
      kind: 'academy',
      orgId: ORG,
      userId: 'admin-a',
      userName: null,
      examId: EXAM,
      examName: '第三次小考',
      toUpsert: [{ studentId: STU, score: 85, status: 'scored', notes: null }],
      toDelete: [{ studentId: STU2 }],
    });
  });

  it('連線池不在 → 500，不退回沒有交易的逐句寫', async () => {
    h.pool = null;
    const r = await call(academyRoute, {
      scores: [{ studentId: STU, score: 85, status: 'scored' }],
    });
    expect(r.status).toBe(500);
    expect(r.body['code']).toBe('DB_POOL_UNAVAILABLE');
    expect(h.write).not.toHaveBeenCalled();
  });

  it('交易丟例外（含稽核寫不進去）→ 500，說成績沒有變動', async () => {
    h.write.mockRejectedValue(new Error('audit insert failed'));
    const r = await call(academyRoute, {
      scores: [{ studentId: STU, score: 85, status: 'scored' }],
    });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'DB_ERROR', error: '儲存失敗，成績沒有變動' });
  });

  it('交易裡重驗考試不在這個機構 → 404', async () => {
    h.write.mockResolvedValue({ status: 'not-found' });
    const r = await call(academyRoute, {
      scores: [{ studentId: STU, score: 85, status: 'scored' }],
    });
    expect(r.status).toBe(404);
  });
});

describe('POST /api/school-exams/{id}/scores —— 完成後仍可修改（#1931）', () => {
  beforeEach(() => {
    h.pool = {};
    h.write.mockReset().mockResolvedValue(DONE);
  });

  it('完成的段考照樣寫：清空一科時帶著科目交給交易（三段鍵）', async () => {
    const r = await call(schoolRoute, {
      scores: [
        { studentId: STU, subjectId: MATH, score: 88, status: 'scored' },
        { studentId: STU2, subjectId: MATH, score: null, status: 'scored' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, affected: 1, removed: 1 });
    expect(h.write).toHaveBeenCalledWith(
      h.pool,
      expect.objectContaining({
        kind: 'school',
        examName: '第一次段考',
        toUpsert: [{ studentId: STU, subjectId: MATH, score: 88, status: 'scored', notes: null }],
        toDelete: [{ studentId: STU2, subjectId: MATH }],
      }),
    );
  });

  it('連線池不在 → 500', async () => {
    h.pool = null;
    const r = await call(schoolRoute, {
      scores: [{ studentId: STU, subjectId: MATH, score: 88, status: 'scored' }],
    });
    expect(r.status).toBe(500);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('交易丟例外 → 500；交易裡找不到考試 → 404', async () => {
    h.write.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ status: 'not-found' });
    const body = { scores: [{ studentId: STU, subjectId: MATH, score: 88, status: 'scored' }] };
    expect((await call(schoolRoute, body)).status).toBe(500);
    expect((await call(schoolRoute, body)).status).toBe(404);
  });
});
