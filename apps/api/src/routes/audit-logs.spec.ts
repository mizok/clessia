import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import auditLogsApp from './audit-logs';
import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #2496：稽核紀錄分分校。`campus_ids` 由 DB trigger 填（契約 `audit-logs-scope.contract.ts` 對真 DB 驗），
 * 這裡守**讀取端的篩選**：受限的管理員只看得到跟自己範圍有交集的、或機構層級（{}）的；
 * 推不出分校的（NULL）看不到；`meta.total` 跟看得到的列數一致（總數不能洩漏看不到的列數）。
 */
const ORG = 'org-1';
const C1 = 'campus-1';
const C2 = 'campus-2';

const log = (id: string, campus_ids: string[] | null, org_id = ORG) => ({
  id,
  org_id,
  user_id: 'u',
  user_name: '某人',
  resource_type: 'class',
  resource_id: null,
  resource_name: id,
  action: 'update',
  details: {},
  created_at: `2026-11-13T00:00:0${id.length % 10}Z`,
  campus_ids,
});

async function request(campusScope: string[] | null) {
  const db = createMultiOrgDb({
    audit_logs: [
      log('c1', [C1]),
      log('c2', [C2]),
      log('both', [C1, C2]),
      log('org-level', []),
      log('unknown', null),
      log('other-org', [C1], 'org-2'),
    ],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('roles', ['admin']);
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', auditLogsApp as unknown as Hono);
  const res = await app.request('/');
  return (await res.json()) as { data: { resourceName: string }[]; meta: { total: number } };
}

const names = (body: { data: { resourceName: string }[] }) =>
  body.data.map((r) => r.resourceName).sort();

describe('GET /api/audit-logs 分校範圍（#2496）', () => {
  it('不受限：本 org 全部（含推不出分校的）', async () => {
    const body = await request(null);
    expect(names(body)).toEqual(['both', 'c1', 'c2', 'org-level', 'unknown']);
    expect(body.meta.total).toBe(5);
  });

  it('受限 C1：C1、跨 C1／C2、機構層級；看不到 C2 與推不出分校的；total 只算看得到的', async () => {
    const body = await request([C1]);
    expect(names(body)).toEqual(['both', 'c1', 'org-level']);
    expect(body.meta.total).toBe(3);
  });

  it('受限但一個分校都沒有：只剩機構層級', async () => {
    const body = await request([]);
    expect(names(body)).toEqual(['org-level']);
    expect(body.meta.total).toBe(1);
  });
});
