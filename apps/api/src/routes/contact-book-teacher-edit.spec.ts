import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #2499（計畫席 11-13 裁）：老師只能改**自己寫的、當天的**那一則；新寫（含補寫前幾天的缺漏）不受限，
 * 管理端不受限（`contact-book.spec.ts` 的「內容沒變不寫」那組是管理員改老師前幾天寫的，照常 200）。
 * 任課範圍與「今天」用替身固定 —— 這裡守的是判準，不是任課範圍的查法。
 */
vi.mock('../lib/teacher-scope', async (orig) => ({
  ...(await orig<typeof import('../lib/teacher-scope')>()),
  loadTeachingScope: async () => ({ teacherStaffId: 'staff-me' }),
  taughtStudentIds: async () => [STUDENT],
  taughtClassIds: async () => [],
}));
vi.mock('../lib/taipei-date', async (orig) => ({
  ...(await orig<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => TODAY,
}));

const { default: contactBookApp } = await import('./contact-book');

const ORG = 'org-1';
const STUDENT = '00000000-0000-0000-0000-000000000031';
const TODAY = '2026-11-13';
const YESTERDAY = '2026-11-12';

function setup(entry?: { entry_date: string; last_edited_by: string }) {
  const db = createMultiOrgDb({
    students: [{ id: STUDENT, org_id: ORG, name: '甲' }],
    contact_book_entries: entry
      ? [{ id: 'e1', org_id: ORG, student_id: STUDENT, content: '原文', ...entry }]
      : [],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'me');
    set('roles', ['teacher']);
    set('permissions', []);
    set('campusScope', null);
    await next();
  });
  app.route('/', contactBookApp as unknown as Hono);
  const put = (entryDate: string) =>
    app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT, entryDate, content: '改過' }),
    });
  return { db, put };
}

describe('PUT /api/contact-book —— 老師只能改自己當天寫的（#2499）', () => {
  it('自己今天寫的：可以改', async () => {
    const { db, put } = setup({ entry_date: TODAY, last_edited_by: 'me' });
    expect((await put(TODAY)).status).toBe(200);
    expect(db.rows('contact_book_entries')[0]).toMatchObject({ content: '改過' });
  });

  it('別人今天寫的：403，原文不動', async () => {
    const { db, put } = setup({ entry_date: TODAY, last_edited_by: 'other-teacher' });
    const res = await put(TODAY);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'CONTACT_BOOK_NOT_EDITABLE' });
    expect(db.rows('contact_book_entries')[0]).toMatchObject({ content: '原文' });
  });

  it('自己寫的、但不是今天：403，原文不動', async () => {
    const { db, put } = setup({ entry_date: YESTERDAY, last_edited_by: 'me' });
    expect((await put(YESTERDAY)).status).toBe(403);
    expect(db.rows('contact_book_entries')[0]).toMatchObject({ content: '原文' });
  });

  it('還沒有人寫的前幾天：照常可以補寫（防過度擋）', async () => {
    const { db, put } = setup();
    expect((await put(YESTERDAY)).status).toBe(200);
    expect(db.rows('contact_book_entries')).toHaveLength(1);
  });
});
