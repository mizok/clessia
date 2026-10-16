import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CampusScope } from '../lib/campus-scope';
import {
  enqueueStaffDigests,
  fetchOverdueCandidates,
  fetchUpcomingPeriods,
  overdueDigests,
  unbilledDigests,
} from '../lib/staff-digests';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import billingPeriodsRoute from '../routes/billing-periods';
import invoicesRoute from '../routes/invoices';

/**
 * #1693 管理員每日摘要對真 DB：SQL 撈回來的候選，經既有 JS 判準算出的張數，要跟**儀表板兩支真路由**
 * （`GET /api/invoices/summary` 的 overdue、`GET /api/billing-periods/upcoming-unbilled`）在每個範圍都相同。
 *
 * 自己建 org（5 分校、100 學生、200 張帳單、3 期），跑完刪掉。管理員**借 seed 既有的使用者**，
 * 只在自己的 org 建 staff 列（staff 的唯一鍵是 (user_id, org_id)）—— 不寫 user_roles／ba_user（c2）。
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

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

run('管理員每日摘要對真 DB（#1693）', () => {
  const pool = new Pool({ connectionString: DB });
  const supabase = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const today = getCurrentTaipeiDateString();
  let orgId = '';
  const campuses: string[] = [];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  beforeAll(async () => {
    orgId = await one(`INSERT INTO organizations (name, billing_reminder_days) VALUES ($1, 14)`, [
      `c1693-digest-${Date.now()}`,
    ]);
    const subject = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, '數學')`, [orgId]);
    const classes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const campus = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, $2)`, [
        orgId,
        `分校${i}`,
      ]);
      campuses.push(campus);
      const course = await one(
        `INSERT INTO courses (org_id, campus_id, name, subject_id) VALUES ($1, $2, $3, $4)`,
        [orgId, campus, `課${i}`, subject],
      );
      classes.push(
        await one(
          `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, $4)`,
          [orgId, campus, course, `班${i}`],
        ),
      );
    }
    // 100 位學生：各報一個分校的班，每 7 位多報隔壁分校（跨校生）
    const enrollmentsOf: string[][] = [];
    for (let s = 0; s < 100; s++) {
      const student = await one(
        `INSERT INTO students (org_id, name, grade) VALUES ($1, $2, 'J1')`,
        [orgId, `學生${s}`],
      );
      const mine = [s % 5, ...(s % 7 === 0 ? [(s + 1) % 5] : [])];
      enrollmentsOf.push([student]);
      for (const k of mine) {
        enrollmentsOf[s]!.push(
          await one(
            `INSERT INTO enrollments (org_id, class_id, student_id, billing_mode, effective_from, status)
             VALUES ($1, $2, $3, 'period', '2026-01-01', 'active')`,
            [orgId, classes[k], student],
          ),
        );
      }
    }
    // 200 張帳單：到期日前後各半、未繳／部分／繳清／作廢混著，每 3 張多一筆餐費（沒有報名的明細）
    for (let j = 0; j < 200; j++) {
      const [student, ...enrs] = enrollmentsOf[j % 100]!;
      const invoice = await one(
        `INSERT INTO invoices (org_id, student_id, due_date) VALUES ($1, $2, $3)`,
        [orgId, student, addDays(today, (j % 10) - 6)],
      );
      for (const e of j % 11 === 0 ? enrs : enrs.slice(0, 1)) {
        await q(
          `INSERT INTO invoice_items (invoice_id, type, amount, enrollment_id) VALUES ($1, 'tuition', 1000, $2)`,
          [invoice, e],
        );
      }
      if (j % 3 === 0) {
        await q(`INSERT INTO invoice_items (invoice_id, type, amount) VALUES ($1, 'meal', 200)`, [
          invoice,
        ]);
      }
      if (j % 4 !== 2) {
        await q(
          `INSERT INTO payment_records (org_id, invoice_id, amount, method) VALUES ($1, $2, $3, 'cash')`,
          [orgId, invoice, j % 4 === 0 ? 5000 : 500],
        );
      }
      // 作廢放最後：作廢的單不能再加明細；有收款的不能作廢（只挑沒收款的）
      if (j % 13 === 0 && j % 4 === 2) {
        await q(`UPDATE invoices SET voided_at = now(), void_reason = '測試作廢' WHERE id = $1`, [
          invoice,
        ]);
      }
    }
    // 分校 5：只有「不該算進待開單」的報名 —— 月繳、已退班、在期前就結束的期繳。
    // 待開單的每一道條件拿掉，這個分校就會冒出一則，所以每一道都有鑑別力
    const c5 = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, '分校5')`, [orgId]);
    campuses.push(c5);
    const course5 = await one(
      `INSERT INTO courses (org_id, campus_id, name, subject_id) VALUES ($1, $2, '課5', $3)`,
      [orgId, c5, subject],
    );
    const k5 = await one(
      `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, '班5')`,
      [orgId, c5, course5],
    );
    for (const [mode, status, to] of [
      ['monthly', 'active', null],
      ['period', 'withdrawal', null],
      ['period', 'active', addDays(today, 1)],
    ] as const) {
      const st = await one(
        `INSERT INTO students (org_id, name, grade) VALUES ($1, '分校5的學生', 'J1')`,
        [orgId],
      );
      await q(
        `INSERT INTO enrollments (org_id, class_id, student_id, billing_mode, effective_from, effective_to, status)
         VALUES ($1, $2, $3, $4, '2026-01-01', $5, $6)`,
        [orgId, k5, st, mode, to, status],
      );
    }
    // 三期：3 天後（都沒開）、5 天後（只開了分校 0 的）、40 天後（超過 14 天，不算）
    const p1 = await one(
      `INSERT INTO billing_periods (org_id, name, start_date, end_date) VALUES ($1, '近期', $2, $3)`,
      [orgId, addDays(today, 3), addDays(today, 33)],
    );
    // 「近期」開過一張、又作廢了（分校 3 的學生）：作廢的不算開過，「近期」仍然待開
    const voided = await one(
      `INSERT INTO invoices (org_id, student_id, due_date) VALUES ($1, $2, $3)`,
      [orgId, enrollmentsOf[3]![0], addDays(today, 30)],
    );
    await q(
      `INSERT INTO invoice_items (invoice_id, type, amount, enrollment_id, billing_period_id)
       VALUES ($1, 'tuition', 1000, $2, $3)`,
      [voided, enrollmentsOf[3]![1], p1],
    );
    await q(`UPDATE invoices SET voided_at = now(), void_reason = '測試作廢' WHERE id = $1`, [
      voided,
    ]);
    const p2 = await one(
      `INSERT INTO billing_periods (org_id, name, start_date, end_date) VALUES ($1, '下一期', $2, $3)`,
      [orgId, addDays(today, 5), addDays(today, 35)],
    );
    await q(
      `INSERT INTO billing_periods (org_id, name, start_date, end_date) VALUES ($1, '遠期', $2, $3)`,
      [orgId, addDays(today, 40), addDays(today, 70)],
    );
    // 日期窗的兩端（N＝14）：今天開始的不算（開始日 > 今天）、第 14 天開始的算（≤ 今天＋N）
    for (const [name, offset] of [
      ['今天開始', 0],
      ['第14天', 14],
      ['第15天', 15],
    ] as const) {
      await q(
        `INSERT INTO billing_periods (org_id, name, start_date, end_date) VALUES ($1, $2, $3, $4)`,
        [orgId, name, addDays(today, offset), addDays(today, offset + 30)],
      );
    }
    const inv = await one(
      `INSERT INTO invoices (org_id, student_id, due_date) VALUES ($1, $2, $3)`,
      [orgId, enrollmentsOf[0]![0], addDays(today, 30)],
    );
    await q(
      `INSERT INTO invoice_items (invoice_id, type, amount, enrollment_id, billing_period_id)
       VALUES ($1, 'tuition', 1000, $2, $3)`,
      [inv, enrollmentsOf[0]![1], p2],
    );
  }, 60_000);

  afterAll(async () => {
    if (orgId) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        await db.query(
          'DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE org_id = $1)',
          [orgId],
        );
        await db.query(
          'DELETE FROM staff_campuses WHERE staff_id IN (SELECT id FROM staff WHERE org_id = $1)',
          [orgId],
        );
        for (const t of [
          'notifications',
          'payment_records',
          'invoices',
          'billing_periods',
          'enrollments',
          'students',
          'staff',
          'classes',
          'courses',
          'subjects',
          'campuses',
        ]) {
          await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgId]);
        }
        await db.query('COMMIT');
      } finally {
        db.release();
      }
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
    await pool.end();
  });

  /** 儀表板的真路由，用指定的範圍呼叫 */
  async function viaRoute<T>(route: unknown, path: string, scope: CampusScope): Promise<T> {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', orgId);
      set('userId', 'contract');
      set('campusScope', scope);
      await next();
    });
    app.route('/', route as unknown as Hono);
    const res = await app.request(path);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  }

  const scopes = (): CampusScope[] => [
    null,
    [campuses[0]!],
    [campuses[1]!, campuses[2]!],
    [campuses[3]!],
    [campuses[4]!, campuses[0]!],
    [campuses[5]!],
  ];
  const me = (scope: CampusScope) => [{ org_id: orgId, user_id: 'u', scope }];

  it('逾期張數：每個範圍都跟 GET /api/invoices/summary 的 overdue.count 相同', async () => {
    const db = await pool.connect();
    try {
      const rows = await fetchOverdueCandidates(db, [orgId], today);
      let nonZero = 0;
      for (const scope of scopes()) {
        const route = await viaRoute<{ overdue: { count: number } }>(
          invoicesRoute,
          '/summary',
          scope,
        );
        const [digest] = overdueDigests(rows, me(scope), today);
        const ours = digest ? Number(/今天有 (\d+) 張/.exec(digest.payload.body)![1]) : 0;
        expect(ours, JSON.stringify(scope)).toBe(route.overdue.count);
        if (ours > 0) nonZero++;
      }
      expect(nonZero).toBeGreaterThan(1); // 全是 0 的話什麼都沒比到
    } finally {
      db.release();
    }
  });

  it('待開單：每個範圍都跟 GET /api/billing-periods/upcoming-unbilled 相同（第一期、期數）', async () => {
    const db = await pool.connect();
    try {
      const periods = await fetchUpcomingPeriods(db, [orgId], today);
      const seen = new Set<number>();
      for (const scope of scopes()) {
        const route = await viaRoute<{ data: Array<{ name: string }> }>(
          billingPeriodsRoute,
          '/upcoming-unbilled',
          scope,
        );
        const [digest] = unbilledDigests(periods, me(scope), today);
        const ours = digest
          ? {
              first: /「(.+?)」/.exec(digest.payload.body)![1],
              count: 1 + Number(/另有 (\d+) 期/.exec(digest.payload.body)?.[1] ?? 0),
            }
          : null;
        expect(ours, JSON.stringify(scope)).toEqual(
          route.data.length ? { first: route.data[0]!.name, count: route.data.length } : null,
        );
        seen.add(route.data.length);
      }
      // 分校 0：近期＋第14天；其他：近期＋下一期＋第14天；分校 5 沒有該開的：三種都比到
      expect([...seen].sort()).toEqual([0, 2, 3]);
    } finally {
      db.release();
    }
  });

  it('CPU：50 位管理員 × 200 張帳單，撈＋算（pg 解析也算在內）', async () => {
    // 50 位、範圍各不相同（5 個分校的 31 種組合＋全分校），盡量讓「同範圍只算一次」幫不上忙
    const recipients = Array.from({ length: 50 }, (_, k) => ({
      org_id: orgId,
      user_id: `u${k}`,
      scope: k % 16 === 0 ? null : campuses.filter((_, i) => ((k % 31) + 1) & (1 << i)),
    }));
    const db = await pool.connect();
    const samples: Array<{ total: number; compute: number }> = [];
    try {
      for (let i = 0; i < 7; i++) {
        const t0 = process.cpuUsage();
        const rows = await fetchOverdueCandidates(db, [orgId], today);
        const periods = await fetchUpcomingPeriods(db, [orgId], today);
        const t1 = process.cpuUsage();
        overdueDigests(rows, recipients, today);
        unbilledDigests(periods, recipients, today);
        const t2 = process.cpuUsage(t1);
        const all = process.cpuUsage(t0);
        samples.push({
          total: (all.user + all.system) / 1000,
          compute: (t2.user + t2.system) / 1000,
        });
      }
    } finally {
      db.release();
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const result = {
      totalMs: median(samples.map((s) => s.total)),
      computeMs: median(samples.map((s) => s.compute)),
    };
    console.log('[staff-digests] CPU 中位數（7 次，Node）', JSON.stringify(result));
    expect(result.totalMs).toBeLessThan(50); // 安全閥；實際數字看 log
  });

  it('端到端：只給在職、有 manage_finance 的管理員，照範圍算；同一天第二次 run 整段跳過', async () => {
    const [finance] = await q<{ user_id: string }>(
      `SELECT user_id FROM user_roles WHERE role = 'admin' AND permissions ? 'manage_finance'
         AND NOT permissions ? '*' AND NOT permissions ? 'all_campuses' ORDER BY user_id LIMIT 1`,
    );
    const [noFinance] = await q<{ user_id: string }>(
      `SELECT ur.user_id FROM user_roles ur WHERE ur.role = 'admin'
         AND NOT EXISTS (SELECT 1 FROM user_roles u2 WHERE u2.user_id = ur.user_id
                         AND (u2.permissions ? 'manage_finance' OR u2.permissions ? '*'))
       ORDER BY ur.user_id LIMIT 1`,
    );
    // 停用的財務管理員（保留類，二讀 @9eaffd9e）：有 manage_finance、範圍也對，但離職或停用了就收不到
    const [inactive] = await q<{ user_id: string }>(
      `SELECT user_id FROM user_roles WHERE role = 'admin'
         AND (permissions ? 'manage_finance' OR permissions ? '*')
         AND user_id <> $1 ORDER BY user_id LIMIT 1`,
      [finance?.user_id],
    );
    expect(finance && noFinance && inactive).toBeTruthy();
    for (const [u, status] of [
      [finance!.user_id, 'active'],
      [noFinance!.user_id, 'active'],
      [inactive!.user_id, 'inactive'],
    ] as const) {
      const staffId = await one(
        `INSERT INTO staff (org_id, user_id, status, display_name) VALUES ($1, $2, $3, '測試管理員')`,
        [orgId, u, status],
      );
      await q(`INSERT INTO staff_campuses (staff_id, campus_id) VALUES ($1, $2)`, [
        staffId,
        campuses[0],
      ]);
    }

    const db = await pool.connect();
    const sqls: string[] = [];
    const counting = new Proxy(db, {
      get: (t, p) =>
        p === 'query'
          ? (sql: string, params?: unknown[]) => (sqls.push(sql), t.query(sql, params))
          : Reflect.get(t, p),
    });
    try {
      expect(await enqueueStaffDigests(counting, today, [orgId])).toBe(2);
      const rows = await q<{
        user_id: string;
        kind: string;
        dedupe_key: string;
        role: string;
        push_status: string;
      }>(
        `SELECT user_id, kind::text, dedupe_key, role::text, push_status::text FROM notifications WHERE org_id = $1 ORDER BY kind`,
        [orgId],
      );
      expect(rows).toEqual([
        {
          user_id: finance!.user_id,
          kind: 'overdue_digest',
          dedupe_key: `overdue_digest:${orgId}:${today}`,
          role: 'admin',
          push_status: 'skipped',
        },
        {
          user_id: finance!.user_id,
          kind: 'unbilled_reminder',
          dedupe_key: `unbilled_reminder:${orgId}:${today}`,
          role: 'admin',
          push_status: 'skipped',
        },
      ]);

      sqls.length = 0;
      expect(await enqueueStaffDigests(counting, today, [orgId])).toBe(0);
      expect(sqls).toHaveLength(1); // 只有「今天排過沒」那一句

      // 兩則各自獨立：逾期那則今天排過了、待開單還沒（例如白天有人作廢帳單，某一期變成待開）
      // → 下一輪仍要算待開單，逾期不重發
      await q(`DELETE FROM notifications WHERE org_id = $1 AND kind = 'unbilled_reminder'`, [
        orgId,
      ]);
      expect(await enqueueStaffDigests(counting, today, [orgId])).toBe(1);
      expect(
        await q(`SELECT kind::text FROM notifications WHERE org_id = $1 ORDER BY kind`, [orgId]),
      ).toEqual([{ kind: 'overdue_digest' }, { kind: 'unbilled_reminder' }]);
    } finally {
      db.release();
    }
  });
});
