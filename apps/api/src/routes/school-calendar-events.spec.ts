import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import schoolsApp from './schools';

/**
 * 學校行事曆（#1160 PR2）。用 `multi-org-db`：它**真的照條件過濾**，所以拿掉 `eq('org_id')`、
 * 重疊條件或「屬於網址上那所學校」的條件，這裡會紅（回固定資料的替身驗不出來）。
 */
type Row = Record<string, unknown>;

const ORG = 'org-1';
const OTHER = 'org-2';
const S1 = '00000000-0000-4000-8000-0000000000a1';
const S2 = '00000000-0000-4000-8000-0000000000a2';
const SX = '00000000-0000-4000-8000-0000000000b1'; // 別 org 的學校
const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';
const E3 = '00000000-0000-4000-8000-0000000000e3';
const E4 = '00000000-0000-4000-8000-0000000000e4';
const EX = '00000000-0000-4000-8000-0000000000e9'; // 別 org 的事件

const event = (over: Row): Row => ({
  org_id: ORG,
  school_id: S1,
  kind: 'winter_break',
  start_date: '2027-01-20',
  end_date: '2027-02-10',
  note: null,
  created_at: '2026-11-12',
  updated_at: '2026-11-12',
  ...over,
});

function seed(): Record<string, Row[]> {
  return {
    schools: [
      { id: S1, org_id: ORG, name: '大安國中' },
      { id: S2, org_id: ORG, name: '仁愛國中' },
      { id: SX, org_id: OTHER, name: '別人的國中' },
    ],
    school_calendar_events: [
      event({ id: E1 }),
      event({ id: E2, kind: 'semester_start', start_date: '2027-02-11', end_date: '2027-02-11' }),
      event({ id: E3, kind: 'semester_end', start_date: '2026-06-30', end_date: '2026-06-30' }),
      event({ id: E4, school_id: S2 }),
      event({ id: EX, org_id: OTHER, school_id: SX }),
    ],
    billing_periods: [
      {
        id: 'p1',
        org_id: ORG,
        name: '2027 下學期',
        start_date: '2027-02-01',
        end_date: '2027-06-30',
      },
      {
        id: 'p2',
        org_id: OTHER,
        name: '別人的期',
        start_date: '2027-02-01',
        end_date: '2027-06-30',
      },
    ],
    audit_logs: [],
  };
}

async function call(method: string, path: string, body?: unknown, tables = seed()) {
  const db = createMultiOrgDb(tables);
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', db.client);
    ctx.set('orgId', ORG);
    ctx.set('userId', 'user-1');
    ctx.set('roles', ['admin']);
    ctx.set('campusScope', null);
    await next();
  });
  app.route('/api/schools', schoolsApp);
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any, db };
}

const base = `/api/schools/${S1}/calendar-events`;

describe('GET /api/schools/:id/calendar-events', () => {
  it('只回本 org、這所學校、跟區間重疊的事件，依開始日排；期只回本 org 的', async () => {
    const { status, body } = await call('GET', `${base}?from=2027-02-01&to=2027-06-30`);
    expect(status).toBe(200);
    // 寒假 1/20–2/10 跨進區間（重疊即列）；開學 2/11 在內；6/30（2026）休業式在區間外；S2、別 org 的不列
    expect(body.data.map((e: Row) => e['id'])).toEqual([E1, E2]);
    expect(body.meta.periods).toEqual([
      { id: 'p1', name: '2027 下學期', startDate: '2027-02-01', endDate: '2027-06-30' },
    ]);
  });

  it('不給區間 → 這所學校全部事件', async () => {
    const { body } = await call('GET', base);
    expect(body.data.map((e: Row) => e['id'])).toEqual([E3, E1, E2]);
  });

  it('別 org 的學校 404', async () => {
    const { status } = await call('GET', `/api/schools/${SX}/calendar-events`);
    expect(status).toBe(404);
  });
});

describe('POST /api/schools/:id/calendar-events', () => {
  it('單日：不給結束日就等於開始日；備註去空白、空字串存 null', async () => {
    const { status, body, db } = await call('POST', base, {
      kind: 'makeup_day',
      startDate: '2027-03-06',
      note: '   ',
    });
    expect(status).toBe(201);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      schoolId: S1,
      kind: 'makeup_day',
      startDate: '2027-03-06',
      endDate: '2027-03-06',
      note: null,
    });
    const created = db.rows('school_calendar_events').find((r) => r['start_date'] === '2027-03-06');
    expect(created?.['org_id']).toBe(ORG);
  });

  it('同時加到其他學校：一所一筆、自己那所排第一，各寫一筆稽核', async () => {
    const { status, body, db } = await call('POST', base, {
      kind: 'no_class',
      startDate: '2027-04-03',
      endDate: '2027-04-06',
      alsoSchoolIds: [S2, S1],
    });
    expect(status).toBe(201);
    expect(body.data.map((e: Row) => e['schoolId'])).toEqual([S1, S2]);
    const audits = db.rows('audit_logs');
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      resource_type: 'school',
      action: 'calendar_event.create',
    });
  });

  it('「同時加到」裡有別 org 的學校 → 404，一筆都不寫', async () => {
    const { status, db } = await call('POST', base, {
      kind: 'no_class',
      startDate: '2027-04-03',
      alsoSchoolIds: [S2, SX],
    });
    expect(status).toBe(404);
    expect(db.rows('school_calendar_events')).toHaveLength(5);
  });

  it('結束日早於開始日 → 400', async () => {
    const { status, body } = await call('POST', base, {
      kind: 'other',
      startDate: '2027-04-06',
      endDate: '2027-04-03',
    });
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_RANGE');
  });
});

describe('PATCH／DELETE /api/schools/:id/calendar-events/:eventId', () => {
  it('改區間；只改結束日也照「合併後」驗區間', async () => {
    const ok = await call('PATCH', `${base}/${E1}`, { endDate: '2027-02-12' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ startDate: '2027-01-20', endDate: '2027-02-12' });
    expect(ok.db.rows('audit_logs')[0]).toMatchObject({ action: 'calendar_event.update' });

    const bad = await call('PATCH', `${base}/${E1}`, { endDate: '2027-01-01' });
    expect(bad.status).toBe(400);
  });

  it('事件不屬於網址上的學校（S2 的事件掛在 S1 底下）→ 404，不改', async () => {
    const { status, db } = await call('PATCH', `${base}/${E4}`, { note: 'x' });
    expect(status).toBe(404);
    expect(db.rows('school_calendar_events').find((r) => r['id'] === E4)?.['note']).toBeNull();
  });

  it('別 org 的事件刪不到', async () => {
    const { status, db } = await call('DELETE', `/api/schools/${SX}/calendar-events/${EX}`);
    expect(status).toBe(404);
    expect(db.rows('school_calendar_events')).toHaveLength(5);
  });

  it('刪除：列消失、稽核留快照', async () => {
    const { status, db } = await call('DELETE', `${base}/${E1}`);
    expect(status).toBe(200);
    expect(db.rows('school_calendar_events').some((r) => r['id'] === E1)).toBe(false);
    expect(db.rows('audit_logs')[0]).toMatchObject({ action: 'calendar_event.delete' });
  });
});
