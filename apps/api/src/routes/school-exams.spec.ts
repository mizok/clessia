import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import schoolExamsRoute from './school-exams';

/**
 * 段考目錄（`school_exams`）**只有管理員能維護** —— 它沒有 `created_by`、沒有班級
 * 關聯，是「學年 × 學期 × 考試類型」的機構層參照資料。兩個老師各自建一筆
 * 「第一次段考」只會製造重複。
 *
 * 這組測試守的是**路由層真的擋**，不是靠「沒有把 teacher 加進 mount」——
 * mount 已經開給老師了（成績要登錄），所以擋在哪裡必須是明確的。
 */
function appAs(roles: string[]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('orgId', '00000000-0000-0000-0000-0000000000aa');
    set('userId', 'u1');
    set('supabase', { from: () => ({}) });
    await next();
  });
  app.route('/', schoolExamsRoute as unknown as Hono);
  return app;
}

// 民國年（schema 是 100–999），且 schoolId 必填 —— 要讓請求通過驗證才碰得到權限檢查
const body = {
  academicYear: 115,
  semester: 1,
  examType: 'term_exam',
  schoolId: '00000000-0000-0000-0000-0000000000cc',
};

describe('school-exams 的寫入只有管理員', () => {
  it('老師建立段考回 403', async () => {
    const res = await appAs(['teacher']).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('ORG_EXAM_ADMIN_ONLY');
  });

  it('老師關閉段考回 403', async () => {
    const res = await appAs(['teacher']).request('/00000000-0000-0000-0000-000000000001/close', {
      method: 'PATCH',
    });

    expect(res.status).toBe(403);
  });

  // fail-closed：沒有角色的一律拒絕，不是當成管理員
  it('沒有角色也回 403', async () => {
    const res = await appAs([]).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(403);
  });
});
