import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  adminsForCampuses,
  notify,
  teachersForSessionGroups,
  teachersForSessions,
} from '../lib/notify';
import { groupByClass } from '../lib/notify-schedule';

/**
 * #1693：收件人推導對**真的** PostgREST 跑，結果要跟「同一題用 SQL 獨立算一次」逐筆相同
 * （照 identity-sql.contract 的做法）。**只讀 seed** —— user_roles 是全域的（不分 org），
 * 改它會影響別人，所以不造管理員，拿 seed 現有的 13 位（3 位全分校、其餘被指派分校）來對。
 * 寫入那一條自己建 org、測完刪掉。
 */

const DB = process.env['DATABASE_URL'];
const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if ((!DB || !URL || !KEY) && process.env['CONTRACT_REQUIRED']) {
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL／SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY',
  );
}
const run = DB && URL && KEY ? describe : describe.skip;

run('站內通知的收件人推導對真 DB（#1693）', () => {
  const pool = new Pool({ connectionString: DB });
  const supabase = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const testOrgs: string[] = [];
  afterAll(async () => {
    if (testOrgs.length)
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [testOrgs]);
    await pool.end();
  });

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const sorted = (xs: string[]) => [...xs].sort();

  /** 獨立的 SQL 版：角色與權限取聯集，範圍 = 全分校權限 或 被指派到其中一個分校 */
  const adminsBySql = async (orgId: string, campusIds: string[], permission?: string) =>
    (
      await q<{ user_id: string }>(
        `WITH ids AS (
           SELECT s.id AS staff_id, s.user_id,
                  array_agg(DISTINCT ur.role::text) AS roles,
                  COALESCE(jsonb_agg(p) FILTER (WHERE p IS NOT NULL), '[]'::jsonb) AS perms
           FROM staff s
           JOIN user_roles ur ON ur.user_id = s.user_id
           LEFT JOIN LATERAL jsonb_array_elements_text(ur.permissions) AS p ON true
           WHERE s.org_id = $1 AND s.status = 'active'
           GROUP BY s.id, s.user_id)
         SELECT user_id FROM ids
         WHERE 'admin' = ANY(roles)
           AND ($3::text IS NULL OR perms ? $3 OR perms ? '*')
           AND (perms ? 'all_campuses' OR perms ? '*'
                OR EXISTS (SELECT 1 FROM staff_campuses sc
                           WHERE sc.staff_id = ids.staff_id AND sc.campus_id = ANY($2::uuid[])))`,
        [orgId, campusIds, permission ?? null],
      )
    ).map((r) => r.user_id);

  it('每個分校：adminsForCampuses 與 SQL 逐筆相同（含 manage_finance 版）；有被指派分校的管理員才有鑑別力', async () => {
    const campuses = await q<{ id: string; org_id: string }>(
      `SELECT c.id, c.org_id FROM campuses c
       WHERE EXISTS (SELECT 1 FROM staff s WHERE s.org_id = c.org_id)`,
    );
    expect(campuses.length).toBeGreaterThan(1); // 至少兩個分校，「別的分校收不到」才驗得到
    let discriminating = 0;
    for (const c of campuses) {
      const viaLib = sorted(await adminsForCampuses(supabase, c.org_id, [c.id]));
      expect(viaLib).toEqual(sorted(await adminsBySql(c.org_id, [c.id])));
      expect(
        sorted(
          await adminsForCampuses(supabase, c.org_id, [c.id], { permission: 'manage_finance' }),
        ),
      ).toEqual(sorted(await adminsBySql(c.org_id, [c.id], 'manage_finance')));
      const allInOrg = await adminsBySql(
        c.org_id,
        campuses.filter((x) => x.org_id === c.org_id).map((x) => x.id),
      );
      if (viaLib.length < allInOrg.length) discriminating++; // 有人被排除 = 分校範圍真的在作用
    }
    expect(discriminating).toBeGreaterThan(0);
  });

  it('課堂的老師：teachersForSessions 與 SQL 逐筆相同', async () => {
    const sessions = await q<{ id: string; org_id: string }>(
      `SELECT id, org_id FROM sessions ORDER BY session_date DESC, id LIMIT 30`,
    );
    expect(sessions.length).toBeGreaterThan(0);
    let nonEmpty = 0;
    for (const s of sessions) {
      const bySql = (
        await q<{ user_id: string }>(
          `SELECT DISTINCT st.user_id FROM staff st
           JOIN user_roles ur ON ur.user_id = st.user_id AND ur.role = 'teacher'
           WHERE st.org_id = $1 AND st.status = 'active' AND st.id IN (
             SELECT teacher_id FROM sessions WHERE id = $2 AND org_id = $1 AND teacher_id IS NOT NULL
             UNION
             SELECT sc.teacher_id FROM schedules sc JOIN classes c ON c.id = sc.class_id
             JOIN sessions ss ON ss.id = $2 AND ss.org_id = $1 AND ss.class_id = sc.class_id
             WHERE c.org_id = $1 AND sc.teacher_id IS NOT NULL
               -- 那堂課當天有效的時段（#1100 #22 Q3）；課堂沒排日期就不篩 —— 跟 lib 同一條規則
               AND (ss.session_date IS NULL OR (sc.effective_from <= ss.session_date
                    AND (sc.effective_to IS NULL OR sc.effective_to >= ss.session_date))))`,
          [s.org_id, s.id],
        )
      ).map((r) => r.user_id);
      const viaLib = await teachersForSessions(supabase, s.org_id, [s.id]);
      expect(sorted(viaLib)).toEqual(sorted(bySql));
      if (bySql.length > 0) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(0); // 全空的話什麼都沒比到
  });

  it('課務異動一批跨班：groupByClass＋teachersForSessionGroups 每班與 SQL 逐筆相同（#1693）', async () => {
    // 同一個 org 裡挑兩個班、各兩堂，當成同一批
    const picked = await q<{
      id: string;
      org_id: string;
      class_id: string;
      name: string;
      campus_id: string | null;
    }>(
      `WITH k AS (
         SELECT s.org_id, s.class_id FROM sessions s GROUP BY s.org_id, s.class_id
         HAVING count(*) >= 2 ORDER BY s.org_id, s.class_id LIMIT 2)
       SELECT s.id, s.org_id, s.class_id, c.name, c.campus_id FROM k
       CROSS JOIN LATERAL (SELECT id, org_id, class_id FROM sessions
         WHERE class_id = k.class_id ORDER BY session_date, id LIMIT 2) s
       JOIN classes c ON c.id = s.class_id`,
    );
    const orgId = picked[0]!.org_id;
    const rows = picked
      .filter((p) => p.org_id === orgId)
      .map((p) => ({ session_id: p.id, change_type: 'cancellation' as const }));
    expect(new Set(picked.filter((p) => p.org_id === orgId).map((p) => p.class_id)).size).toBe(2);

    const groups = await groupByClass(supabase, orgId, rows);
    const recipients = await teachersForSessionGroups(supabase, orgId, groups);
    for (const p of picked.filter((x) => x.org_id === orgId)) {
      expect(groups.get(p.class_id)?.name).toBe(p.name); // classes(name) 的嵌入真的取得到
      // #1023：管理員依班的分校挑，campus_id 要真的從嵌入取得到
      expect(groups.get(p.class_id)?.campusId).toBe(p.campus_id);
    }
    let nonEmpty = 0;
    for (const [classId, g] of groups) {
      const bySql = (
        await q<{ user_id: string }>(
          `SELECT DISTINCT st.user_id FROM staff st
           JOIN user_roles ur ON ur.user_id = st.user_id AND ur.role = 'teacher'
           WHERE st.org_id = $1 AND st.status = 'active' AND st.id IN (
             SELECT teacher_id FROM sessions WHERE id = ANY($2) AND org_id = $1 AND teacher_id IS NOT NULL
             UNION
             SELECT sc.teacher_id FROM schedules sc JOIN classes c ON c.id = sc.class_id
             JOIN sessions ss ON ss.id = ANY($2) AND ss.org_id = $1 AND ss.class_id = sc.class_id
             WHERE c.org_id = $1 AND sc.class_id = $3 AND sc.teacher_id IS NOT NULL
               AND (ss.session_date IS NULL OR (sc.effective_from <= ss.session_date
                    AND (sc.effective_to IS NULL OR sc.effective_to >= ss.session_date))))`,
          [orgId, g.sessionIds, classId],
        )
      ).map((r) => r.user_id);
      expect(sorted(recipients.get(classId) ?? [])).toEqual(sorted(bySql));
      if (bySql.length > 0) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(0);
  });

  it('notify：寫進去就是 skipped／ROLE_PUSH_DISABLED；同一個鍵再寫一次不會多一則', async () => {
    const orgId = (
      await q<{ id: string }>(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [
        `c1693-${randomUUID()}`,
      ])
    )[0]!.id;
    testOrgs.push(orgId);
    const [user] = await q<{ user_id: string }>(
      `SELECT user_id FROM user_roles WHERE role = 'admin' ORDER BY user_id LIMIT 1`,
    );
    const row = {
      orgId,
      userId: user!.user_id,
      role: 'admin' as const,
      kind: 'application_received' as const,
      dedupeKey: `application:${randomUUID()}`,
      title: '新的報名申請',
      body: 'x',
      url: '/admin/applications',
    };
    expect(await notify(supabase, [row])).toBe(1);
    expect(await notify(supabase, [row])).toBe(0);
    expect(
      await q(
        `SELECT role, kind, push_status, push_error, read_at FROM notifications WHERE org_id = $1`,
        [orgId],
      ),
    ).toEqual([
      {
        role: 'admin',
        kind: 'application_received',
        push_status: 'skipped',
        push_error: 'ROLE_PUSH_DISABLED',
        read_at: null,
      },
    ]);
  });
});
