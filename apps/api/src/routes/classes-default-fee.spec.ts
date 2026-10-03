import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * #1175：班級的目錄參考價（`classes.default_fee_template_id`）。
 *
 * 它改的是家長在目錄上看到的價錢，所以寫入要 `manage_finance`（`/api/fee-templates` 連讀都要它），
 * 不是班級本身的 `manage_courses`。範本要屬於本 org（c1）且仍在使用（停用的價目表不再對外報價）。
 * 斷言一律寫 `code` —— 只看 status 的話別的 400／403 也會讓它綠。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CLASS_A = id(101);
const COURSE_A = id(111);
const FEE_A = id(201);
const FEE_A_INACTIVE = id(202);
const FEE_B = id(203);

/** `db.rows()` 回的是複本，改它不會進替身 —— 初始值從這裡給 */
function seed(currentFee: string | null = null) {
  return createMultiOrgDb({
    courses: [{ id: COURSE_A, org_id: ORG_A, campus_id: id(301), is_active: true }],
    classes: [
      {
        id: CLASS_A,
        org_id: ORG_A,
        name: 'A 班',
        is_active: true,
        default_fee_template_id: currentFee,
      },
    ],
    fee_templates: [
      { id: FEE_A, org_id: ORG_A, is_active: true },
      { id: FEE_A_INACTIVE, org_id: ORG_A, is_active: false },
      { id: FEE_B, org_id: ORG_B, is_active: true },
    ],
  });
}

type Db = ReturnType<typeof seed>;

function call(db: Db, method: string, path: string, body: unknown, permissions: string[]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG_A);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', permissions);
    set('campusScope', null);
    await next();
  });
  app.route('/', classesRoute as unknown as Hono);
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const feeOf = (db: Db) =>
  db.rows('classes').find((r) => r['id'] === CLASS_A)?.['default_fee_template_id'];

describe('PUT /api/classes/:id —— defaultFeeTemplateId（#1175）', () => {
  it('有 manage_finance：寫入，回應帶 id', async () => {
    const db = seed();
    const res = await call(db, 'PUT', `/${CLASS_A}`, { defaultFeeTemplateId: FEE_A }, [
      'manage_courses',
      'manage_finance',
    ]);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.defaultFeeTemplateId).toBe(FEE_A);
    expect(feeOf(db)).toBe(FEE_A);
  });

  it('可以清空（null）', async () => {
    const db = seed(FEE_A);
    expect(feeOf(db)).toBe(FEE_A);
    const res = await call(db, 'PUT', `/${CLASS_A}`, { defaultFeeTemplateId: null }, [
      'manage_finance',
    ]);

    expect(res.status).toBe(200);
    expect(feeOf(db)).toBeNull();
  });

  it('沒有 manage_finance：403 FEE_TEMPLATE_FORBIDDEN，整筆沒寫（連清空也不行）', async () => {
    const db = seed();
    const res = await call(db, 'PUT', `/${CLASS_A}`, { name: '改名', defaultFeeTemplateId: null }, [
      'manage_courses',
    ]);

    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('FEE_TEMPLATE_FORBIDDEN');
    expect(db.rows('classes')[0]!['name']).toBe('A 班');
  });

  it('沒有 manage_finance、body 不帶這個 key：其他欄位照改（前端不畫就不送）', async () => {
    const db = seed();
    const res = await call(db, 'PUT', `/${CLASS_A}`, { name: '改名' }, ['manage_courses']);

    expect(res.status).toBe(200);
    expect(db.rows('classes')[0]!['name']).toBe('改名');
  });

  it('別 org 的範本：400 INVALID_FEE_TEMPLATE', async () => {
    const db = seed();
    const res = await call(db, 'PUT', `/${CLASS_A}`, { defaultFeeTemplateId: FEE_B }, ['*']);

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe('INVALID_FEE_TEMPLATE');
    expect(feeOf(db)).toBeNull();
  });

  it('停用的範本：400 INVALID_FEE_TEMPLATE', async () => {
    const db = seed();
    const res = await call(db, 'PUT', `/${CLASS_A}`, { defaultFeeTemplateId: FEE_A_INACTIVE }, [
      '*',
    ]);

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe('INVALID_FEE_TEMPLATE');
  });
});

describe('POST /api/classes —— defaultFeeTemplateId（#1175）', () => {
  const body = { courseId: COURSE_A, name: '新班', defaultFeeTemplateId: FEE_A };

  it('有 manage_finance：建班時一起寫', async () => {
    const db = seed();
    const res = await call(db, 'POST', '/', body, ['manage_courses', 'manage_finance']);

    expect(res.status).toBe(201);
    expect(db.rows('classes').find((r) => r['name'] === '新班')?.['default_fee_template_id']).toBe(
      FEE_A,
    );
  });

  it('沒有 manage_finance：403 FEE_TEMPLATE_FORBIDDEN，班沒建', async () => {
    const db = seed();
    const res = await call(db, 'POST', '/', body, ['manage_courses']);

    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('FEE_TEMPLATE_FORBIDDEN');
    expect(db.rows('classes').some((r) => r['name'] === '新班')).toBe(false);
  });

  it('別 org 的範本：400 INVALID_FEE_TEMPLATE，班沒建', async () => {
    const db = seed();
    const res = await call(db, 'POST', '/', { ...body, defaultFeeTemplateId: FEE_B }, ['*']);

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe('INVALID_FEE_TEMPLATE');
    expect(db.rows('classes').some((r) => r['name'] === '新班')).toBe(false);
  });
});
