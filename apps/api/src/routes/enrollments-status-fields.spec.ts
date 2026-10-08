import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-08',
}));

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import enrollmentsRoute from './enrollments';

/**
 * #1314 EN5：狀態變更要留下**日期**與**原因**，報名進出才分得出四種事件。
 *
 * 原本原因是覆寫 `notes`（行政寫的備註被吃掉），暫停則沒有任何日期落地 ——
 * 退班／作廢靠 `effective_to`，暫停不寫它（暫停不是離開）。所以另開兩欄：
 * `status_changed_at`（台北日期）與 `status_reason`。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ENR = '00000000-0000-0000-0000-000000000101';

function seed(over: Record<string, unknown> = {}) {
  return createMultiOrgDb({
    enrollments: [
      {
        id: ENR,
        org_id: ORG,
        class_id: 'cls-1',
        student_id: 'stu-1',
        status: 'active',
        effective_from: '2026-09-01',
        effective_to: null,
        notes: '原備註',
        status_changed_at: null,
        status_reason: null,
        ...over,
      },
    ],
  });
}

async function patch(db: ReturnType<typeof seed>, body: Record<string, unknown>) {
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
  app.route('/', enrollmentsRoute as unknown as Hono);
  const res = await app.request(`/${ENR}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { data: Record<string, unknown> } };
}

const row = (db: ReturnType<typeof seed>) => db.rows('enrollments')[0]!;

describe('PATCH /api/enrollments/:id/status —— 狀態日期與原因（#1314 EN5）', () => {
  it('暫停：寫日期與原因，不動 effective_to，備註不被覆寫', async () => {
    const db = seed();
    expect(row(db)['status_changed_at']).toBeNull();

    const res = await patch(db, { status: 'suspended', notes: '家長出國' });

    expect(res.status).toBe(200);
    expect(row(db)).toMatchObject({
      status: 'suspended',
      status_changed_at: '2026-10-08',
      status_reason: '家長出國',
      notes: '原備註',
      effective_to: null,
    });
    expect(res.body.data).toMatchObject({
      statusChangedAt: '2026-10-08',
      statusReason: '家長出國',
      notes: '原備註',
    });
  });

  it('退班：effective_to 與狀態日期都是今天，原因獨立一欄', async () => {
    const db = seed();

    await patch(db, { status: 'withdrawal', notes: '轉學' });

    expect(row(db)).toMatchObject({
      effective_to: '2026-10-08',
      status_changed_at: '2026-10-08',
      status_reason: '轉學',
      notes: '原備註',
    });
  });

  it('從暫停恢復：日期更新、上一次的原因清掉', async () => {
    const db = seed({
      status: 'suspended',
      status_changed_at: '2026-09-15',
      status_reason: '家長出國',
    });

    await patch(db, { status: 'active' });

    expect(row(db)).toMatchObject({
      status: 'active',
      status_changed_at: '2026-10-08',
      status_reason: null,
    });
  });
});
