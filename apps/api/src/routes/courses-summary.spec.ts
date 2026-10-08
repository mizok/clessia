import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import coursesApp from './courses';

/**
 * `GET /api/courses` 的 `summary.bySubject`（#1314 C1）：依科目分章的章節計數。
 * 每科一支 head count、跟列表同一個分校範圍、帶 org、不吃 search／isActive／subjectId。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';
const MATH = '00000000-0000-0000-0000-0000000000f1';
const CHINESE = '00000000-0000-0000-0000-0000000000f2';
const ART = '00000000-0000-0000-0000-0000000000f3';

let n = 0;
const course = (subject: string, campus: string, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
  org_id: ORG,
  campus_id: campus,
  subject_id: subject,
  name: `課程${n}`,
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  ...over,
});

function seed() {
  return createMultiOrgDb({
    subjects: [
      { id: CHINESE, org_id: ORG, name: '國文', sort_order: 1 },
      { id: MATH, org_id: ORG, name: '數學', sort_order: 2 },
      { id: ART, org_id: ORG, name: '美術', sort_order: 3 },
      { id: '00000000-0000-0000-0000-0000000000ff', org_id: OTHER, name: '別org', sort_order: 0 },
    ],
    courses: [
      course(CHINESE, CA),
      course(CHINESE, CA, { is_active: false, name: '停用的國文' }),
      course(CHINESE, CB),
      course(MATH, CA),
      course(MATH, CA, { org_id: OTHER }),
    ],
  });
}

async function list(path: string, scope: readonly string[] | null = null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', seed().client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', coursesApp as unknown as Hono);
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}

const counts = (body: any) =>
  Object.fromEntries(
    body.summary.bySubject.map((s: { subjectName: string; count: number }) => [
      s.subjectName,
      s.count,
    ]),
  );

describe('GET /api/courses —— summary.bySubject（#1314 C1）', () => {
  it('依科目排序、含 0 門的科目、只算本 org', async () => {
    const { status, body } = await list('/');
    expect(status).toBe(200);
    expect(body.summary.bySubject.map((s: { subjectName: string }) => s.subjectName)).toEqual([
      '國文',
      '數學',
      '美術',
    ]);
    expect(counts(body)).toEqual({ 國文: 3, 數學: 1, 美術: 0 });
  });

  it('不吃 isActive／subjectId（章名是全體，不是本次結果；search 同理，替身沒有 ilike）', async () => {
    const { body } = await list(`/?isActive=false&subjectId=${MATH}`);
    expect(body.meta.total).toBe(0);
    expect(counts(body)).toEqual({ 國文: 3, 數學: 1, 美術: 0 });
  });

  it('跟列表同一個分校範圍：受限 A 校只數 A 校；指名分校也縮', async () => {
    expect(counts((await list('/', [CA])).body)).toEqual({ 國文: 2, 數學: 1, 美術: 0 });
    expect(counts((await list(`/?campusId=${CB}`)).body)).toEqual({ 國文: 1, 數學: 0, 美術: 0 });
  });
});
