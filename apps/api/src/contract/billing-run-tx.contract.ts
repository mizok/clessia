import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **帳務作業每位學生一筆交易**（#1943），對真的本機 Postgres 跑。
 *
 * 原本每位學生依序打幾支 supabase-js 寫入、錯誤幾乎沒檢查：學費明細寫失敗就留下空帳單，回應照樣成功。
 * 這支自建一個 org、100 位學生（月繳＋訂餐），驗：
 * - 一位學生的學費明細寫入失敗（測試用 trigger 注入）→ **他沒有帳單、餐也沒被蓋章**，其他 99 位照開，
 *   回應 200 並在 `failedStudents` 列出他的名字；拿掉 trigger 再跑一次 → 剛好補開他那一張
 * - 同一個月**同時**按兩次 run → 每筆報名只開一次、不留空帳單
 * 測完 trigger 與整個 org 都刪掉。
 */

const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const DB = process.env['DATABASE_URL'];
if ((!URL || !KEY || !DB) && process.env['CONTRACT_REQUIRED']) {
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY／DATABASE_URL',
  );
}
const run = URL && KEY && DB ? describe : describe.skip;

const pool = DB ? new Pool({ connectionString: DB }) : null;
afterAll(() => pool?.end());

const ctx: { orgId: string; userId: string; campusScope: string[] | null } = {
  orgId: '',
  userId: '',
  campusScope: null,
};

vi.mock('../middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const supabase = createServiceClientFromEnv({
        SUPABASE_URL: URL!,
        SUPABASE_SECRET_KEY: KEY!,
      } as never);
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.campusScope);
      // 開帳寫入走 withTx（#1943），要 connect
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => undefined,
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const STUDENTS = 100;
const TRIGGER_FN = 'contract_1943_fail_one_tuition';

interface RunBody {
  invoicesCreated: number;
  tuitionItems: number;
  mealRecordsSettled: number;
  failedStudents: Array<{ studentId: string; studentName: string | null; code: string }>;
}

run('帳務作業每位學生一筆交易（#1943）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const victim = { studentId: '', enrollmentId: '', name: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1943 契約：逐生交易') returning id",
      )
    )[0]!.id;
    const [campus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '本校') returning id",
      [ctx.orgId],
    );
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const [course] = await q<{ id: string }>(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3) returning id",
      [ctx.orgId, campus!.id, subject!.id],
    );
    const [klass] = await q<{ id: string }>(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '班') returning id",
      [ctx.orgId, campus!.id, course!.id],
    );
    await q(
      `with s as (
         insert into students (org_id, name, grade)
         select $1, '學生' || g, 'J1' from generate_series(1, $3::int) g
         returning id
       )
       insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       select $1, $2, s.id, 'active', 'monthly', 1000, '2026-01-01' from s`,
      [ctx.orgId, klass!.id, STUDENTS],
    );
    // 3 月、4 月各 3 天餐
    await q(
      `insert into meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price)
       select $1, s.id, m + d, true, true, 65
         from students s
         cross join unnest(array[date '2026-03-02', date '2026-04-01']) m
         cross join generate_series(0, 2) d
        where s.org_id = $1`,
      [ctx.orgId],
    );
    const [v] = await q<{ student_id: string; enrollment_id: string; name: string }>(
      `select s.id as student_id, e.id as enrollment_id, s.name from students s
         join enrollments e on e.student_id = s.id
        where s.org_id = $1 order by s.id offset 37 limit 1`,
      [ctx.orgId],
    );
    Object.assign(victim, {
      studentId: v!.student_id,
      enrollmentId: v!.enrollment_id,
      name: v!.name,
    });
    // 只擋這一筆報名的學費明細（id 寫死在函式裡，不影響本機其他資料）
    await q(`create or replace function ${TRIGGER_FN}() returns trigger language plpgsql as $f$
      begin
        if new.enrollment_id = '${victim.enrollmentId}'::uuid then
          raise exception '#1943 契約：注入的學費寫入失敗';
        end if;
        return new;
      end $f$`);
    await q(
      `create trigger ${TRIGGER_FN} before insert on invoice_items
         for each row execute function ${TRIGGER_FN}()`,
    );

    app = (await import('../index')).default as never;
  }, 120_000);

  const dropTrigger = () =>
    q(`drop trigger if exists ${TRIGGER_FN} on invoice_items;
       drop function if exists ${TRIGGER_FN}();`);

  afterAll(async () => {
    await dropTrigger();
    if (!ctx.orgId) return;
    await q('delete from meal_records where org_id = $1', [ctx.orgId]);
    await q('delete from invoices where org_id = $1', [ctx.orgId]);
    await q('delete from enrollments where org_id = $1', [ctx.orgId]);
    await q('delete from students where org_id = $1', [ctx.orgId]);
    await q('delete from audit_logs where org_id = $1', [ctx.orgId]);
    await q('delete from organizations where id = $1', [ctx.orgId]);
  }, 120_000);

  const runMonth = async (periodMonth: string) => {
    const res = await app.request(
      '/api/billing-runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ periodMonth }),
      },
      env,
    );
    return { status: res.status, body: (await res.json()) as RunBody };
  };

  /** 這個月：每筆報名開了幾次、有沒有沒有明細的空帳單 */
  const ledger = async (month: string) => {
    const [row] = await q<{ dup: string; tuition: string; empty: string }>(
      `select
         (select count(*) from (
            select ii.enrollment_id from invoice_items ii join invoices i on i.id = ii.invoice_id
             where i.org_id = $1 and ii.type = 'tuition' and ii.period_month = $2::date
             group by ii.enrollment_id having count(*) > 1) d) as dup,
         (select count(*) from invoice_items ii join invoices i on i.id = ii.invoice_id
           where i.org_id = $1 and ii.type = 'tuition' and ii.period_month = $2::date) as tuition,
         (select count(*) from invoices i where i.org_id = $1
             and not exists (select 1 from invoice_items ii where ii.invoice_id = i.id)) as empty`,
      [ctx.orgId, month],
    );
    return { dup: Number(row!.dup), tuition: Number(row!.tuition), empty: Number(row!.empty) };
  };

  it('一位學生寫入失敗 → 只有他沒開（沒有帳單、餐沒蓋章），其他 99 位照開，回應列出他', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = await runMonth('2026-03');
    expect(first.status).toBe(200);
    expect(first.body.invoicesCreated).toBe(STUDENTS - 1);
    expect(first.body.mealRecordsSettled).toBe((STUDENTS - 1) * 3);
    expect(first.body.failedStudents).toEqual([
      { studentId: victim.studentId, studentName: victim.name, code: 'WRITE_FAILED' },
    ]);

    const [mine] = await q<{ invoices: string; stamped: string }>(
      `select (select count(*) from invoices where org_id = $1 and student_id = $2) as invoices,
              (select count(*) from meal_records where org_id = $1 and student_id = $2
                 and invoice_item_id is not null) as stamped`,
      [ctx.orgId, victim.studentId],
    );
    expect(Number(mine!.invoices)).toBe(0);
    expect(Number(mine!.stamped)).toBe(0); // 回滾連蓋章一起退，不是只退學費
    expect(await ledger('2026-03-01')).toEqual({ dup: 0, tuition: STUDENTS - 1, empty: 0 });
  }, 300_000);

  it('拿掉故障再跑同一個月 → 剛好補開他那一張', async () => {
    await dropTrigger();
    const again = await runMonth('2026-03');
    expect(again.status).toBe(200);
    expect(again.body.invoicesCreated).toBe(1);
    expect(again.body.mealRecordsSettled).toBe(3);
    expect(again.body.failedStudents).toEqual([]);
    expect(await ledger('2026-03-01')).toEqual({ dup: 0, tuition: STUDENTS, empty: 0 });
  }, 300_000);

  it('同一個月同時按兩次 run → 每筆報名只開一次、每餐只蓋一次、沒有空帳單', async () => {
    const [a, b] = await Promise.all([runMonth('2026-04'), runMonth('2026-04')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.invoicesCreated + b.body.invoicesCreated).toBe(STUDENTS);
    expect(a.body.mealRecordsSettled + b.body.mealRecordsSettled).toBe(STUDENTS * 3);
    expect([...a.body.failedStudents, ...b.body.failedStudents]).toEqual([]);
    expect(await ledger('2026-04-01')).toEqual({ dup: 0, tuition: STUDENTS, empty: 0 });
  }, 300_000);

  // 上面那段兩個 run 誰先誰後看排程，拿掉 FOR UPDATE 不一定撞得到（突變 M2 在那段存活過）。
  // 這段把競態釘死：別的交易已經替某筆報名寫了 5 月學費、還沒 COMMIT 時，run 必須等它、再重查
  it('別的交易開到一半（鎖著報名、明細還沒 COMMIT）→ run 等它結束再重查，不重複開', async () => {
    const [target] = await q<{ id: string; student_id: string }>(
      'select id, student_id from enrollments where org_id = $1 order by id limit 1 offset 10',
      [ctx.orgId],
    );
    const [held] = await q<{ id: string }>(
      `insert into invoices (org_id, student_id, issued_at, due_date, created_by)
       values ($1, $2, '2026-05-01', '2026-05-15', $3) returning id`,
      [ctx.orgId, target!.student_id, ctx.userId],
    );
    const other = await pool!.connect();
    try {
      await other.query('BEGIN');
      await other.query('select id from enrollments where id = $1 for update', [target!.id]);
      await other.query(
        `insert into invoice_items (invoice_id, type, enrollment_id, amount, period_month)
         values ($1, 'tuition', $2, 1000, '2026-05-01')`,
        [held!.id, target!.id],
      );

      let done = false;
      const pending = runMonth('2026-05').finally(() => (done = true));
      // 等到 run 卡在這把鎖上（或已經跑完 —— 那就是沒鎖，下面會看到重複）
      for (let i = 0; i < 300 && !done; i += 1) {
        const [w] = await q<{ n: string }>(
          `select count(*) as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
            where not l.granted and a.query ilike '%from public.enrollments%for update%'`,
        );
        if (Number(w!.n) > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await other.query('COMMIT');

      const may = await pending;
      expect(may.status).toBe(200);
      expect(may.body.invoicesCreated).toBe(STUDENTS - 1);
      expect(await ledger('2026-05-01')).toEqual({ dup: 0, tuition: STUDENTS, empty: 0 });
    } finally {
      await other.query('ROLLBACK').catch(() => undefined);
      other.release();
    }
  }, 300_000);

  // 交易外看到有待開餐費、交易裡卻被別的 run 先蓋走（#1977）：billStudent 要把剛開的 0 元餐費 item 刪掉。
  // 把競態釘死：另一筆交易先蓋走這位學生的餐、還沒 COMMIT，run 的蓋章 UPDATE 卡在列鎖上，
  // 等對方 COMMIT 後重查條件（invoice_item_id is null）不再成立 → 蓋到 0 筆。學費還在，所以帳單會開、不會被 NothingToBill 整筆回滾
  it('餐記錄在 run 的交易裡被別的交易先蓋走 → 開學費帳單，但不留 0 元餐費 item', async () => {
    const [target] = await q<{ id: string; student_id: string }>(
      'select id, student_id from enrollments where org_id = $1 order by id limit 1 offset 20',
      [ctx.orgId],
    );
    await q(
      `insert into meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price)
       select $1, $2, date '2026-06-02' + d, true, true, 65 from generate_series(0, 2) d`,
      [ctx.orgId, target!.student_id],
    );
    const [held] = await q<{ id: string }>(
      `insert into invoices (org_id, student_id, issued_at, due_date, created_by)
       values ($1, $2, '2026-06-01', '2026-06-15', $3) returning id`,
      [ctx.orgId, target!.student_id, ctx.userId],
    );
    const other = await pool!.connect();
    try {
      await other.query('BEGIN');
      const { rows } = await other.query(
        `insert into invoice_items (invoice_id, type, amount, period_month)
         values ($1, 'meal', 195, '2026-06-01') returning id`,
        [held!.id],
      );
      await other.query(
        `update meal_records set invoice_item_id = $2
          where org_id = $1 and student_id = $3 and meal_date between '2026-06-01' and '2026-06-30'`,
        [ctx.orgId, (rows[0] as { id: string }).id, target!.student_id],
      );

      let done = false;
      const pending = runMonth('2026-06').finally(() => (done = true));
      // 等到 run 卡在蓋章的列鎖上（跑完了就是沒卡到，下面會看到失敗）
      for (let i = 0; i < 300 && !done; i += 1) {
        const [w] = await q<{ n: string }>(
          `select count(*) as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
            where not l.granted and a.query ilike '%update public.meal_records%'`,
        );
        if (Number(w!.n) > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await other.query('COMMIT');

      const june = await pending;
      expect(june.status).toBe(200);
      expect(june.body.failedStudents).toEqual([]);
      expect(june.body.invoicesCreated).toBe(STUDENTS);
      expect(june.body.mealRecordsSettled).toBe(0); // 三餐是對方蓋的，這次 run 一筆都沒蓋到
      const meals = await q<{ amount: string }>(
        `select ii.amount from invoice_items ii join invoices i on i.id = ii.invoice_id
          where i.org_id = $1 and i.student_id = $2 and ii.type = 'meal' and ii.period_month = '2026-06-01'`,
        [ctx.orgId, target!.student_id],
      );
      expect(meals.map((m) => Number(m.amount))).toEqual([195]); // 只有對方那一筆，沒有 0 元的
      expect(await ledger('2026-06-01')).toEqual({ dup: 0, tuition: STUDENTS, empty: 0 });
    } finally {
      await other.query('ROLLBACK').catch(() => undefined);
      other.release();
    }
  }, 300_000);
});
