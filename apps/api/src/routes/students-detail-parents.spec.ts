import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * 學生詳情的家長清單（#1625 把這段抽成 `lib/student-parents.ts`，跟單張帳單共用）。
 * 抽出前後行為要逐字相同：順序照 relations、電話與 email 來自 ba_user、找不到 ba_user 是 null、
 * 沒有 parents 的 relation 略過、**不**過濾 placeholder email（那是帳單端的事）。
 */
const ORG = '00000000-0000-0000-0000-00000000000a';
const SID = '00000000-0000-0000-0000-000000000101';

describe('GET /api/students/:id 的家長清單', () => {
  it('主要家長在前，電話與 email 來自 ba_user，找不到是 null，沒有 parents 的略過', async () => {
    const db = createMultiOrgDb({
      students: [
        {
          id: SID,
          org_id: ORG,
          name: '王小明',
          schools: null,
          parent_student_relations: [
            {
              id: 'r1',
              is_primary: false,
              relation: '父親',
              parents: { id: 'p2', name: '王爸爸', user_id: 'u2' },
            },
            {
              id: 'r2',
              is_primary: true,
              relation: '母親',
              parents: { id: 'p1', name: '王媽媽', user_id: 'u1' },
            },
            { id: 'r3', is_primary: false, relation: null, parents: null },
            {
              id: 'r4',
              is_primary: false,
              relation: '祖母',
              parents: { id: 'p3', name: '王奶奶', user_id: 'u-missing' },
            },
          ],
        },
      ],
      ba_user: [
        { id: 'u1', email: '0912@phone.internal', phone: '0912' },
        { id: 'u2', email: 'dad@example.com', phone: null },
      ],
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db.client);
      set('orgId', ORG);
      set('userId', 'admin-a');
      set('roles', ['admin']);
      set('permissions', []);
      set('campusScope', null);
      await next();
    });
    app.route('/', studentsRoute as unknown as Hono);
    const res = await app.request(`/${SID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { parents: unknown[] } };
    // 主要家長排第一（路由後段的既有排序），其餘照 relations 順序
    expect(body.data.parents).toEqual([
      {
        id: 'p1',
        name: '王媽媽',
        phone: '0912',
        email: '0912@phone.internal',
        relation: '母親',
        isPrimary: true,
      },
      {
        id: 'p2',
        name: '王爸爸',
        phone: null,
        email: 'dad@example.com',
        relation: '父親',
        isPrimary: false,
      },
      { id: 'p3', name: '王奶奶', phone: null, email: null, relation: '祖母', isPrimary: false },
    ]);
  });
});
