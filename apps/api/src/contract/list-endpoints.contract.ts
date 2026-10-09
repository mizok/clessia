import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';

/**
 * **列表端點對真 PostgREST 的契約測試**（#1435）。
 *
 * 一般 spec 都走替身，替身不解析 select —— #1423 的 `order('subjects(sort_order)')` 沒把
 * `sort_order` 選進 embed，spec 全綠、上線回 400。這支走**路由程式碼本身**（import 整個 app），
 * 只把 `authMiddleware` 換成「真的 service role client＋seed 裡的 admin」，然後打每一支
 * GET 列表斷言 200。不驗內容 —— 要抓的是「查詢形狀 PostgREST 不收」這一族。
 *
 * 端點清單**不手抄**（c11）：從 app 的 OpenAPI 文件取所有 GET、path 沒有 `{param}` 的路由。
 * required query 參數從 `REQUIRED` 補；文件要求了而表裡沒有 → 紅，新端點不會默默漏掉。
 * `BRANCHES` 是會走到另一條查詢分支（alias embed、搜尋）的參數，每支多打一次。
 *
 * 需要本機 Supabase（`npm run db:start`）。環境變數 `SUPABASE_URL`／`SUPABASE_SERVICE_ROLE_KEY`，
 * 由 `npm run test:contract` 從 `supabase status` 帶進來。
 */

const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

const ctx: { orgId: string; userId: string; campusScope: string[] | null; role: string } = {
  orgId: '',
  userId: '',
  campusScope: null,
  role: 'admin',
};

vi.mock('../middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const supabase = createClient(URL!, KEY!);
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', [ctx.role]);
      set('permissions', ctx.role === 'admin' ? [...PERMISSIONS] : []);
      set('activeRole', ctx.role);
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.campusScope);
      await next();
    }),
  };
});

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

/**
 * 文件標 required 的 query 參數要帶什麼值 —— `<path> <param>` → 值。
 * `{teacher}`／`{student}`／`{enrollment}` 在 beforeAll 換成 seed 裡撈到的 id，
 * `{today}`／`{monthStart}` 是台北日期。
 */
const REQUIRED: Record<string, string> = {
  '/api/sessions/substituted-away teacherId': '{teacher}',
  '/api/sessions/substituted-away from': '{monthStart}',
  '/api/sessions/substituted-away to': '{today}',
  '/api/sessions/changes from': '{monthStart}',
  '/api/sessions/changes to': '{today}',
  '/api/attendance/student-day studentId': '{student}',
  '/api/attendance/student-day date': '{today}',
  '/api/contact-book/missing date': '{today}',
  '/api/contact-book/missing/summary dateFrom': '{monthStart}',
  '/api/contact-book/missing/summary dateTo': '{today}',
  '/api/session-packs enrollmentId': '{enrollment}',
  '/api/reports/revenue dateFrom': '{monthStart}',
  '/api/reports/revenue dateTo': '{today}',
  '/api/reports/revenue.csv dateFrom': '{monthStart}',
  '/api/reports/revenue.csv dateTo': '{today}',
};

/** 文件沒標 required、但路由邏輯要求至少一個的（不帶回 400）—— 每次都帶 */
const ALWAYS: Record<string, string> = {
  '/api/scores/students': 'studentId={student}',
};

/** 不是 admin 身分的收件匣類端點，用這個角色打 */
const ROLE: Record<string, string> = {
  '/api/announcements/inbox': 'teacher',
};

/** 會走到另一條查詢分支的參數（每支多打一次）。值裡的 `{campus}` 換成 seed 的分校 */
const BRANCHES: Record<string, string[]> = {
  '/api/sessions/changes': ['q=英文'],
  '/api/courses': ['search=數學'],
  '/api/invoices': ['outstanding=true', 'issuedMonth=' + TODAY.slice(0, 7)],
  '/api/invoices/summary': [],
};

/**
 * 不在這支測試範圍的前綴：`/api/me/*` 是家長／個人身分（要 seed 的家長與孩子，下一輪補），
 * `/api/public/*` 走公開 org middleware（要 `PUBLIC_ORG_SLUG`）。
 */
const SKIP_PREFIX = ['/api/me', '/api/public/'];

const ids: Record<string, string> = {};
const fill = (value: string) => value.replace(/\{\w+\}/g, (token) => ids[token] ?? token);

if (!URL || !KEY) {
  console.warn(
    '[contract] 沒有 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY —— 跳過（本機請先 npm run db:start）',
  );
}
const run = URL && KEY ? describe : describe.skip;

run('GET 列表端點對真 PostgREST 回 200（#1435）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  let doc: {
    paths: Record<
      string,
      Record<string, { parameters?: Array<{ name: string; in: string; required?: boolean }> }>
    >;
  };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };

  beforeAll(async () => {
    const supabase = createClient(URL!, KEY!);
    // seed 裡的第一個 admin 與他所屬的 org（org 的真相在 staff／ba_user，user_roles 沒有 org 欄）
    const { data: roles, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');
    if (rolesError) throw new Error(`讀 user_roles 失敗：${rolesError.message}`);
    const { data: admin, error } = await supabase
      .from('staff')
      .select('user_id, org_id')
      .in(
        'user_id',
        (roles ?? []).map((r) => r.user_id as string),
      )
      .limit(1)
      .maybeSingle();
    if (error || !admin) throw new Error(`seed 裡找不到 admin：${error?.message ?? '沒有列'}`);
    ctx.orgId = admin.org_id as string;
    ctx.userId = admin.user_id as string;

    const first = async (table: string, column = 'id') => {
      const { data, error: e } = await supabase
        .from(table)
        .select(column)
        .eq('org_id', ctx.orgId)
        .limit(1)
        .single();
      if (e || !data) throw new Error(`seed 裡找不到 ${table}：${e?.message}`);
      return (data as unknown as Record<string, string>)[column]!;
    };
    ids['{teacher}'] = await first('staff');
    ids['{student}'] = await first('students');
    ids['{enrollment}'] = await first('enrollments');
    ids['{today}'] = TODAY;
    ids['{monthStart}'] = `${TODAY.slice(0, 7)}-01`;

    app = (await import('../index')).default as never;
    doc = (await app.request('/openapi.json', {}, env).then((r) => r.json())) as never;
  });

  const endpoints = () =>
    Object.entries(doc.paths)
      .filter(
        ([path, ops]) =>
          ops['get'] && !path.includes('{') && !SKIP_PREFIX.some((p) => path.startsWith(p)),
      )
      .map(([path, ops]) => ({
        path,
        required: (ops['get']!.parameters ?? [])
          .filter((p) => p.in === 'query' && p.required)
          .map((p) => p.name),
      }));

  /** 一支端點的所有請求 URL；required 缺 fixture 回 null */
  const urls = (path: string, required: string[]): string[] | null => {
    const base: string[] = [];
    for (const name of required) {
      const value = REQUIRED[`${path} ${name}`];
      if (value === undefined) return null;
      base.push(`${name}=${encodeURIComponent(fill(value))}`);
    }
    if (ALWAYS[path]) base.push(fill(ALWAYS[path]));
    return [[], ...(BRANCHES[path] ?? []).map((b) => [b])].map((extra) => {
      const qs = [...base, ...extra].join('&');
      return qs ? `${path}?${qs}` : path;
    });
  };

  async function hitAll(): Promise<string[]> {
    const failures: string[] = [];
    for (const { path, required } of endpoints()) {
      const list = urls(path, required);
      if (!list) {
        failures.push(
          `${path}：文件要求 required query [${required.join(', ')}]，REQUIRED 表沒有值`,
        );
        continue;
      }
      ctx.role = ROLE[path] ?? 'admin';
      for (const url of list) {
        const res = await app.request(url, {}, env);
        if (res.status !== 200) {
          failures.push(`${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      }
    }
    ctx.role = 'admin';
    return failures;
  }

  it('不受限的管理員：每支都 200', async () => {
    ctx.campusScope = null;
    expect(await hitAll()).toEqual([]);
  });

  // 分校範圍的 `!inner`／alias embed 只在受限時才出現在查詢裡
  it('受限一間分校的管理員：每支都 200', async () => {
    const supabase = createClient(URL!, KEY!);
    const { data: campus } = await supabase
      .from('campuses')
      .select('id')
      .eq('org_id', ctx.orgId)
      .limit(1)
      .single();
    ctx.campusScope = [campus!.id as string];
    try {
      expect(await hitAll()).toEqual([]);
    } finally {
      ctx.campusScope = null;
    }
  });
});
