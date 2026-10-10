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

const ctx: {
  orgId: string;
  userId: string;
  campusScope: string[] | null;
  role: string;
  /** 家長身分時是他的孩子；其他角色 null（同 authMiddleware） */
  studentScope: string[] | null;
} = {
  orgId: '',
  userId: '',
  campusScope: null,
  role: 'admin',
  studentScope: null,
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
      set('studentScope', ctx.studentScope);
      set('childDb', createChildDb(supabase as never, ctx.studentScope, ctx.orgId));
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
  '/api/students/{id}/attendance-days from': '{monthStart}',
  '/api/students/{id}/attendance-days to': '{today}',
  '/api/classes/{id}/sessions/preview from': '{monthStart}',
  '/api/classes/{id}/sessions/preview to': '{today}',
  '/api/me/attendance childId': '{child}',
  '/api/me/grades childId': '{child}',
  '/api/me/renewal-preview childId': '{child}',
  '/api/me/meals childId': '{child}',
  '/api/me/meals dateFrom': '{monthStart}',
  '/api/me/meals dateTo': '{today}',
  '/api/me/billing childId': '{child}',
  '/api/me/class-logs childId': '{child}',
  '/api/me/sessions childId': '{child}',
  '/api/me/sessions dateFrom': '{monthStart}',
  '/api/me/sessions dateTo': '{today}',
  '/api/me/catalog childId': '{child}',
};

/**
 * 單筆端點的 path 參數 —— `<path> <param>` → seed 裡撈到的 id（beforeAll 填）。
 * 跟 `REQUIRED` 一樣：文件有 `{param}` 而表裡沒有 → 紅，新端點不會默默漏掉。
 * ⚠️ 很多單筆路由把查詢錯誤折成 404（`if (error || !data)`），所以**這裡要的是 200** ——
 * 撈不到真的列就測不到形狀，id 一定要是 seed 裡存在、且互相對得上的。
 */
const PARAMS: Record<string, string> = {
  '/api/courses/{id} id': '{course}',
  '/api/campuses/{id} id': '{campus}',
  '/api/staff/{id} id': '{teacher}',
  '/api/classes/{id} id': '{class}',
  '/api/classes/{id}/sessions/preview id': '{class}',
  '/api/sessions/{id}/changes id': '{session}',
  '/api/sessions/{id}/makeup-candidates id': '{session}',
  '/api/students/{id} id': '{student}',
  '/api/students/{id}/attendance-days id': '{student}',
  '/api/parents/{id} id': '{parent}',
  '/api/attendance/roster/{eventId} eventId': '{event}',
  '/api/academy-exams/{id} id': '{academyExam}',
  '/api/academy-exams/{id}/scores id': '{academyExam}',
  '/api/school-exams/{id} id': '{schoolExam}',
  '/api/school-exams/{id}/scores id': '{schoolExam}',
  '/api/school-exams/{id}/recent-students id': '{schoolExam}',
  '/api/school-exams/{id}/students id': '{schoolExam}',
  '/api/school-exams/by-student/{studentId} studentId': '{student}',
  '/api/scores/student/{studentId}/summary studentId': '{student}',
  '/api/scores/class/{classId}/exam/{examId} classId': '{examClass}',
  '/api/scores/class/{classId}/exam/{examId} examId': '{academyExam}',
  '/api/invoices/{id} id': '{invoice}',
  '/api/invoices/{id}/reminders id': '{invoice}',
};

/** 文件沒標 required、但路由邏輯要求至少一個的（不帶回 400）—— 每次都帶 */
const ALWAYS: Record<string, string> = {
  '/api/scores/students': 'studentId={student}',
  '/api/meals': 'date={today}',
};

/** 不是 admin 身分的收件匣類端點，用這個角色打 */
const ROLE: Record<string, string> = {
  '/api/announcements/inbox': 'teacher',
};

/** 會走到另一條查詢分支的參數（每支多打一次）。值裡的 `{campus}` 換成 seed 的分校 */
const BRANCHES: Record<string, string[]> = {
  '/api/sessions/changes': ['q=英文'],
  '/api/courses': ['search=數學'],
  '/api/students': ['search=國中', 'grade=J1&isActive=true', 'today=any', 'today=missing'],
  '/api/invoices': [
    'search=王',
    'search=王&outstanding=true',
    'search=INV-',
    'outstanding=true',
    'issuedMonth=' + TODAY.slice(0, 7),
  ],
  '/api/invoices/summary': [],
};

/**
 * 家長／個人身分的端點（`/api/me` 與 `/api/me/*`）用 seed 的家長打。
 * ⚠️ 不能寫成 `startsWith('/api/me')` —— 那會把 `/api/meals` 一起吃掉（#1435 之 1 就這樣漏了它）。
 */
const isMe = (path: string) => path === '/api/me' || path.startsWith('/api/me/');

/** 不在這支測試範圍的前綴：`/api/public/*` 走公開 org middleware（要 `PUBLIC_ORG_SLUG`） */
const SKIP_PREFIX = ['/api/public/'];

const ids: Record<string, string> = {};
const parentUser: { userId: string; children: string[] } = { userId: '', children: [] };
const fill = (value: string) => value.replace(/\{\w+\}/g, (token) => ids[token] ?? token);

if ((!URL || !KEY) && process.env['CONTRACT_REQUIRED']) {
  // CI 設了 CONTRACT_REQUIRED：拿不到就紅 —— skip 會顯示成綠（#1435 第三跑就是這樣）
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY');
}
if (!URL || !KEY) {
  console.warn(
    '[contract] 沒有 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY —— 跳過（本機請先 npm run db:start）',
  );
}
const run = URL && KEY ? describe : describe.skip;

run('GET 列表與單筆端點對真 PostgREST 回 200（#1435）', () => {
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
    // 有報名的學生 —— 分校範圍判準要推得出分校（#1394）
    ids['{student}'] = await first('enrollments', 'student_id');
    ids['{enrollment}'] = await first('enrollments');
    ids['{course}'] = await first('courses');
    ids['{campus}'] = await first('campuses');
    ids['{class}'] = await first('classes');
    ids['{session}'] = await first('sessions');
    ids['{event}'] = await first('events');
    ids['{academyExam}'] = await first('academy_exams');
    ids['{schoolExam}'] = await first('school_exams');
    ids['{invoice}'] = await first('invoices');

    // 有班的那場校內考，classId／examId 要對得上
    const { data: examClass, error: examClassError } = await supabase
      .from('academy_exam_classes')
      .select('exam_id, class_id, academy_exams!inner(org_id)')
      .eq('academy_exams.org_id', ctx.orgId)
      .limit(1)
      .single();
    if (examClassError || !examClass)
      throw new Error(`seed 裡找不到 academy_exam_classes：${examClassError?.message}`);
    ids['{academyExam}'] = examClass.exam_id as string;
    ids['{examClass}'] = examClass.class_id as string;

    // 有孩子的家長：家長端點用他的身分打
    const { data: parent, error: parentError } = await supabase
      .from('parents')
      .select('id, user_id, parent_student_relations!inner(student_id)')
      .eq('org_id', ctx.orgId)
      .not('user_id', 'is', null)
      .limit(1)
      .single();
    if (parentError || !parent)
      throw new Error(`seed 裡找不到有孩子的家長：${parentError?.message}`);
    ids['{parent}'] = parent.id as string;
    parentUser.userId = parent.user_id as string;
    parentUser.children = (parent.parent_student_relations as Array<{ student_id: string }>).map(
      (r) => r.student_id,
    );
    ids['{child}'] = parentUser.children[0]!;
    ids['{today}'] = TODAY;
    ids['{monthStart}'] = `${TODAY.slice(0, 7)}-01`;

    app = (await import('../index')).default as never;
    doc = (await app.request('/openapi.json', {}, env).then((r) => r.json())) as never;
  });

  const endpoints = (which: 'staff' | 'me') =>
    Object.entries(doc.paths)
      .filter(
        ([path, ops]) =>
          ops['get'] &&
          !SKIP_PREFIX.some((p) => path.startsWith(p)) &&
          isMe(path) === (which === 'me'),
      )
      .map(([path, ops]) => ({
        path,
        required: (ops['get']!.parameters ?? [])
          .filter((p) => p.in === 'query' && p.required)
          .map((p) => p.name),
      }));

  /** 一支端點的所有請求 URL；required 或 path 參數缺 fixture 回錯誤訊息 */
  const urls = (template: string, required: string[]): string[] | string => {
    let path = template;
    for (const [, name] of template.matchAll(/\{(\w+)\}/g)) {
      const value = PARAMS[`${template} ${name}`];
      if (value === undefined) return `path 參數 {${name}}，PARAMS 表沒有值`;
      path = path.replace(`{${name}}`, fill(value));
    }
    const base: string[] = [];
    for (const name of required) {
      const value = REQUIRED[`${template} ${name}`];
      if (value === undefined)
        return `文件要求 required query [${required.join(', ')}]，REQUIRED 表沒有值`;
      base.push(`${name}=${encodeURIComponent(fill(value))}`);
    }
    if (ALWAYS[template]) base.push(fill(ALWAYS[template]));
    return [[], ...(BRANCHES[template] ?? []).map((b) => [b])].map((extra) => {
      const qs = [...base, ...extra].join('&');
      return qs ? `${path}?${qs}` : path;
    });
  };

  async function hitAll(which: 'staff' | 'me' = 'staff'): Promise<string[]> {
    const failures: string[] = [];
    for (const { path, required } of endpoints(which)) {
      const list = urls(path, required);
      if (typeof list === 'string') {
        failures.push(`${path}：${list}`);
        continue;
      }
      ctx.role = which === 'me' ? 'parent' : (ROLE[path] ?? 'admin');
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

  it('家長（seed 裡有孩子的那位）：/api/me 與 /api/me/* 每支都 200', async () => {
    const staffUser = ctx.userId;
    ctx.userId = parentUser.userId;
    ctx.studentScope = parentUser.children;
    try {
      expect(await hitAll('me')).toEqual([]);
    } finally {
      ctx.userId = staffUser;
      ctx.studentScope = null;
    }
  });

  it('不受限的管理員：每支都 200', async () => {
    ctx.campusScope = null;
    expect(await hitAll()).toEqual([]);
  });

  // 分校範圍的 `!inner`／alias embed 只在受限時（scope 非 null）才出現在查詢裡。
  // 範圍給**全部分校**而不是一間：查詢形狀一樣，但單筆端點的 id 才必在範圍內 ——
  // 範圍外是 404，而 404 跟「查詢形狀錯被折成 404」分不出來
  // 替身比字串、驗不出 enum 的列舉序（P1…S3）—— 這條只有真 PostgREST 驗得了
  it('學生列表依年級列舉序、高年級在前（S3…P1），不是字串序', async () => {
    ctx.campusScope = null;
    const ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'];
    const res = await app.request('/api/students?pageSize=100&withToday=false', {}, env);
    const body = (await res.json()) as { data: Array<{ grade: string }> };
    const ranks = body.data.map((s) => ORDER.indexOf(s.grade));
    expect(new Set(body.data.map((s) => s.grade)).size).toBeGreaterThan(1); // seed 要有多個年級才驗得到
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it('受限（範圍＝全部分校，非 null）的管理員：每支都 200', async () => {
    const supabase = createClient(URL!, KEY!);
    const { data: campuses } = await supabase.from('campuses').select('id').eq('org_id', ctx.orgId);
    ctx.campusScope = (campuses ?? []).map((row) => row.id as string);
    try {
      expect(await hitAll()).toEqual([]);
    } finally {
      ctx.campusScope = null;
    }
  });
});
