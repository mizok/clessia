import { createClient } from '@supabase/supabase-js';
import { createServiceClientFromEnv } from '../lib/supabase';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
 * 分支以 `!` 開頭時取代 `ALWAYS`（那支端點的必帶參數跟這條分支互斥時用，例：`scope=all`）。
 *
 * 需要本機 Supabase（`npm run db:start`）。環境變數 `SUPABASE_URL`／`SUPABASE_SERVICE_ROLE_KEY`，
 * 由 `npm run test:contract` 從 `supabase status` 帶進來。
 */

const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const sqlPool = process.env['DATABASE_URL']
  ? new Pool({ connectionString: process.env['DATABASE_URL'] })
  : null;
afterAll(() => sqlPool?.end());

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
      // 正式的 client 工廠：fetch 包裝（#1612 重試、#1455 超出頁數＝空頁）跟上線一樣
      const supabase = createServiceClientFromEnv({
        SUPABASE_URL: URL!,
        SUPABASE_SECRET_KEY: KEY!,
      } as never);
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
      // /api/me 讀的顯示欄位（#1595 P2a）—— 真的 middleware 跟身分查詢一起帶，替身不查 staff/parents
      // `/api/me` 先走 SQL（Hyperdrive A）：有 DATABASE_URL 就給真的 pool，讓每支端點也走過 SQL 那條。
      // `end` 是 no-op —— authPoolCleanup 每個請求都會呼叫它，而這裡所有請求共用同一個 pool
      set('auth', {
        pool: sqlPool
          ? { query: sqlPool.query.bind(sqlPool), end: async () => undefined }
          : { end: async () => undefined },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
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
  '/api/contact-logs studentId': '{student}',
  '/api/reports/revenue dateFrom': '{monthStart}',
  '/api/reports/revenue dateTo': '{today}',
  '/api/reports/revenue.csv dateFrom': '{monthStart}',
  '/api/reports/revenue.csv dateTo': '{today}',
  '/api/students/{id}/attendance-days from': '{monthStart}',
  '/api/students/{id}/attendance-days to': '{today}',
  '/api/leave-streaks studentIds': '{student}',
  '/api/classes/{id}/sessions/preview from': '{monthStart}',
  '/api/classes/{id}/sessions/preview to': '{today}',
  '/api/me/attendance childId': '{child}',
  '/api/me/attendance/checkins childId': '{child}',
  '/api/me/attendance/checkins dateFrom': '{monthStart}',
  '/api/me/attendance/checkins dateTo': '{today}',
  '/api/me/attendance/days childId': '{child}',
  '/api/me/attendance/days dateFrom': '{monthStart}',
  '/api/me/attendance/days dateTo': '{today}',
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
  // 第一版只開家長的通知偏好（#1659）
  '/api/me/notification-preferences role': 'parent',
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
  '/api/campuses/{id}/classrooms id': '{campus}',
  '/api/staff/{id} id': '{teacher}',
  '/api/classes/{id} id': '{class}',
  '/api/classes/{id}/sessions/preview id': '{class}',
  '/api/sessions/{id}/changes id': '{session}',
  '/api/sessions/{id}/makeup-candidates id': '{session}',
  '/api/students/{id} id': '{student}',
  '/api/students/{id}/attendance-days id': '{student}',
  '/api/leave-streaks/students/{id} id': '{student}',
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
  '/api/leaves/{id}/impact id': '{leave}',
  // #1100 #49：beforeAll 替 seed 的家長插一則課務異動通知（指到他孩子班上的一堂），afterAll 刪
  '/api/notifications/{id}/schedule-change id': '{changeNote}',
};

/** 文件沒標 required、但路由邏輯要求至少一個的（不帶回 400）—— 每次都帶 */
const ALWAYS: Record<string, string> = {
  '/api/scores/students': 'studentId={student}',
  '/api/meals': 'date={today}',
  // 老師端課務異動（#1488）：用「有異動的課堂的老師」打、區間框住那一天，才會真的走到 schedule_changes 的查詢
  '/api/teacher/session-changes': 'from={changeDate}&to={changeDate}',
};

/** 不是 admin 身分的收件匣類端點，用這個角色打 */
const ROLE: Record<string, string> = {
  '/api/announcements/inbox': 'teacher',
  '/api/teacher/session-changes': 'teacher',
  // 家長身分才讀得到（用 seed 那位家長打，見 hitAll）
  '/api/notifications/{id}/schedule-change': 'parent',
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
    'campusId={campus}',
  ],
  // 分校篩選（#1314 DB-campus）：BRANCHES 也過 fill()，{campus} 換成 seed 的一間
  '/api/invoices/summary': ['campusId={campus}'],
  '/api/billing-periods/upcoming-unbilled': ['campusId={campus}'],
  // 成績總覽（#1314 G5）：academy_exams 的巢狀 embed＋分校篩選＋分頁撈齊
  '/api/scores/overview': ['days=30', 'days=365&campusId={campus}'],
  // 全部學生的成績聚合（#1314 G8）：scope=all 走分頁撈齊＋分校交集
  '/api/scores/students': ['!scope=all', '!scope=all&campusId={campus}', '!scope=all&sort=grade'],
  // 管理端請假頁（#1314 LV1）：待處理＝endFrom 今天、依開始日排序
  '/api/leaves': ['endFrom=' + TODAY + '&order=start_asc', 'order=start_desc'],
  // 報名進出（#1507）：事件條件是 `and(…)` 包在 `.or()` 裡、退班截到今天 —— 替身驗不了 PostgREST 的解析
  '/api/enrollments': [
    'from=' + TODAY.slice(0, 7) + '-01&to=' + TODAY,
    'event=left&from=' + TODAY.slice(0, 7) + '-01&to=2099-12-31',
    'event=paused',
    // #1100 #30：部分姓名 → students!inner＋巢狀 ilike（含要跳脫的 %）
    'studentName=' + encodeURIComponent('王'),
    'studentName=' + encodeURIComponent('50%_'),
  ],
  '/api/enrollments/event-counts': [
    'from=' + TODAY.slice(0, 7) + '-01&to=' + TODAY,
    'studentName=' + encodeURIComponent('王'),
  ],
};

/**
 * 家長／個人身分的端點（`/api/me` 與 `/api/me/*`）用 seed 的家長打。
 * ⚠️ 不能寫成 `startsWith('/api/me')` —— 那會把 `/api/meals` 一起吃掉（#1435 之 1 就這樣漏了它）。
 */
const isMe = (path: string) => path === '/api/me' || path.startsWith('/api/me/');

/**
 * 公開端點（`/api/public/*`，免登入）走 `publicOrgMiddleware`，**不走 authMiddleware**：
 * org 從部署設定 `PUBLIC_ORG_SLUG` 解析、service client 自己從 env 建（`lib/public-org.ts`），
 * 所以這組用 `publicEnv`（帶真的 URL／金鑰＋seed org 的 slug）打，不靠上面的替身 middleware。
 */
const isPublic = (path: string) => path.startsWith('/api/public/');

/**
 * 公開端點裡**不打**的非 GET —— 每一支都要寫理由（新的公開寫入端點會讓「清單對得上」那條紅）。
 * 兩支都是送出表單，`guardSubmission` 依序擋 honeypot → 頻率限制 → 機器人驗證（`verifyCaptcha`，
 * ALTCHA PoW 或 Turnstile），沒過就回 400 `CAPTCHA_FAILED`，後面的查詢跑不到。要過就得在測試裡解 PoW
 * 或連 Cloudflare，而且會真的寫一筆申請進共用的 DB。
 * ⚠️ 所以它們送出之後的查詢形狀（開課班名額、寫入申請）**這支驗不到**，是已知缺口；目前只有各自的 spec 走替身。
 */
const PUBLIC_WRITES_SKIPPED: Record<string, string> = {
  'POST /api/public/enrollment-applications': '要過機器人驗證（captcha），且會寫入申請',
  'POST /api/public/trial-applications': '要過機器人驗證（captcha），且會寫入申請',
};

const ids: Record<string, string> = {};
let changeUser = '';
/** beforeAll 插的家長課務異動通知（#1100 #49），afterAll 刪 */
let changeNoteId = '';
const parentUser: { userId: string; children: string[] } = { userId: '', children: [] };
let publicSlug = '';
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
  const env = {
    ENVIRONMENT: 'contract',
    WEB_URL: 'http://localhost:4200',
    ALLOWED_ORIGINS: '',
    // 推播（#1659）：契約要驗的是「開了推播的部署」那條路；沒設時的 404 由 me-push.spec 驗。
    // 這是 RFC 8291 §5 範例的公鑰（公開測試向量，不是誰的金鑰）
    VAPID_PUBLIC_KEY:
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  };

  afterAll(async () => {
    if (changeNoteId) {
      await createClient(URL!, KEY!)
        .from('notifications')
        .delete()
        .eq('id', changeNoteId)
        .eq('org_id', ctx.orgId);
    }
  });

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
    ids['{leave}'] = await first('leave_requests');

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
    // 家長的課務異動通知（#1100 #49）：孩子在籍班上的一堂，一則 role=parent 的通知帶它的 sessionId
    const { data: childEnrollments } = await supabase
      .from('enrollments')
      .select('class_id')
      .in('student_id', parentUser.children)
      .neq('status', 'void');
    const { data: childSession } = await supabase
      .from('sessions')
      .select('id')
      .in(
        'class_id',
        (childEnrollments ?? []).map((e) => e['class_id'] as string),
      )
      .limit(1)
      .maybeSingle();
    if (!childSession) throw new Error('seed 裡家長的孩子沒有課堂，課務異動通知的契約驗不到');
    const { data: note, error: noteError } = await supabase
      .from('notifications')
      .insert({
        org_id: ctx.orgId,
        user_id: parentUser.userId,
        role: 'parent',
        kind: 'schedule_change',
        dedupe_key: `contract:schedule-change:${crypto.randomUUID()}`,
        payload: { title: '契約', body: '契約', sessionIds: [childSession['id']] },
        push_status: 'skipped',
      })
      .select('id')
      .single();
    if (noteError || !note) throw new Error(`插課務異動通知失敗：${noteError?.message}`);
    ids['{changeNote}'] = note['id'] as string;
    changeNoteId = note['id'] as string;
    // 有課務異動的課堂與它的老師（沒有就退回 admin 的 userId、今天 —— 查詢形狀就驗不到）
    const { data: change } = await supabase
      .from('schedule_changes')
      .select('sessions!inner(session_date, staff!inner(user_id))')
      .eq('org_id', ctx.orgId)
      .limit(1)
      .maybeSingle();
    const changeSession = change?.['sessions'] as unknown as
      { session_date: string; staff: { user_id: string } } | undefined;
    ids['{changeDate}'] = changeSession?.session_date ?? TODAY;
    changeUser = changeSession?.staff.user_id ?? '';
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', ctx.orgId)
      .single();
    if (orgError || !org?.slug) throw new Error(`seed 的 org 沒有 slug：${orgError?.message}`);
    publicSlug = org.slug as string;
    ids['{today}'] = TODAY;
    ids['{monthStart}'] = `${TODAY.slice(0, 7)}-01`;

    app = (await import('../index')).default as never;
    doc = (await app.request('/openapi.json', {}, env).then((r) => r.json())) as never;
  });

  const endpoints = (which: 'staff' | 'me') =>
    Object.entries(doc.paths)
      .filter(([path, ops]) => ops['get'] && !isPublic(path) && isMe(path) === (which === 'me'))
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
    const always = ALWAYS[template] ? [fill(ALWAYS[template])] : [];
    // 分支以 `!` 開頭＝取代 ALWAYS（例：scope=all 不能再帶 studentId）
    return [null, ...(BRANCHES[template] ?? [])].map((branch) => {
      const extra =
        branch === null
          ? always
          : branch.startsWith('!')
            ? [fill(branch.slice(1))]
            : [...always, fill(branch)];
      const qs = [...base, ...extra].join('&');
      return qs ? `${path}?${qs}` : path;
    });
  };

  async function hitAll(which: 'staff' | 'me' = 'staff'): Promise<string[]> {
    const failures: string[] = [];
    const userBefore = ctx.userId;
    for (const { path, required } of endpoints(which)) {
      const list = urls(path, required);
      if (typeof list === 'string') {
        failures.push(`${path}：${list}`);
        continue;
      }
      ctx.role = which === 'me' ? 'parent' : (ROLE[path] ?? 'admin');
      if (path === '/api/teacher/session-changes' && changeUser) ctx.userId = changeUser;
      const scopeBefore = ctx.studentScope;
      if (path === '/api/notifications/{id}/schedule-change') {
        ctx.userId = parentUser.userId;
        ctx.studentScope = parentUser.children;
      }
      for (const url of list) {
        const res = await app.request(url, {}, env);
        if (res.status !== 200) {
          failures.push(`${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      }
      ctx.userId = userBefore;
      ctx.studentScope = scopeBefore;
    }
    ctx.role = 'admin';
    ctx.userId = userBefore;
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

  // #1455：頁數超出結果（PostgREST 416 PGRST103）要是空頁 200、total 照實，不是 500／400
  // 只斷言 200：有的端點收 page 但某些模式不分頁（例：/api/meals 的單日名冊），回的就不是空的。
  // 「空頁＋total 照實」由 lib/empty-page-on-416.spec 用真的 supabase-js 驗
  it('有 page 參數的列表：page=999 也 200（不是 500／400）', async () => {
    ctx.campusScope = null;
    const paged = Object.entries(doc.paths)
      .filter(([path, ops]) => {
        const params = ops['get']?.parameters ?? [];
        return (
          !isPublic(path) &&
          !isMe(path) &&
          params.some((p) => p.in === 'query' && p.name === 'page')
        );
      })
      .map(([path, ops]) => ({
        path,
        required: (ops['get']!.parameters ?? [])
          .filter((p) => p.in === 'query' && p.required)
          .map((p) => p.name),
      }));
    expect(paged.length).toBeGreaterThan(5); // 文件抽不到就是測了個寂寞
    const failures: string[] = [];
    for (const { path, required } of paged) {
      const list = urls(path, required);
      if (typeof list === 'string') continue; // 缺 fixture 的已由「每支都 200」那條報
      ctx.role = ROLE[path] ?? 'admin';
      const url = `${list[0]}${list[0]!.includes('?') ? '&' : '?'}page=999`;
      const res = await app.request(url, {}, env);
      if (res.status !== 200) {
        failures.push(`${url} → ${res.status} ${(await res.text()).slice(0, 120)}`);
      }
    }
    ctx.role = 'admin';
    expect(failures).toEqual([]);
  });

  it('公開端點（/api/public/*）：每支 GET 都 200（catalog、org、captcha）', async () => {
    const publicEnv = {
      ...env,
      SUPABASE_URL: URL!,
      SUPABASE_SECRET_KEY: KEY!,
      PUBLIC_ORG_SLUG: publicSlug,
      // ALTCHA 的 HMAC 金鑰沒設時從這裡衍生（captcha 那支出題要用）；CAPTCHA_PROVIDER 不設＝altcha，不連外
      BETTER_AUTH_SECRET: 'contract',
    };
    const gets = Object.entries(doc.paths)
      .filter(([path, ops]) => isPublic(path) && ops['get'])
      .map(([path]) => path);
    expect(gets.length).toBeGreaterThanOrEqual(3); // 文件抽不到就是測了個寂寞
    const failures: string[] = [];
    for (const path of gets) {
      if (/\{\w+\}/.test(path)) {
        failures.push(`${path}：公開端點有 path 參數，這支測試還沒有 fixture`);
        continue;
      }
      const res = await app.request(path, {}, publicEnv);
      if (res.status !== 200) {
        failures.push(`${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('公開端點的非 GET：不打的每一支都寫了理由，清單跟文件對得上', () => {
    const writes = Object.entries(doc.paths).flatMap(([path, ops]) =>
      isPublic(path)
        ? Object.keys(ops)
            .filter((m) => m !== 'get')
            .map((m) => `${m.toUpperCase()} ${path}`)
        : [],
    );
    expect(writes.sort()).toEqual(Object.keys(PUBLIC_WRITES_SKIPPED).sort());
  });

  it('不受限的管理員：每支都 200', async () => {
    ctx.campusScope = null;
    expect(await hitAll()).toEqual([]);
  });

  // #1100 #40：成績匯出帶上限 3000 個學生 id。成績走 pg pool 的 SQL（`= ANY($2::uuid[])`）——
  // 走 PostgREST 的話 id 進 GET URL 會 414、切批又會撞 Workers 的 subrequest 上限。
  // 這條對真 DB 跑那條 SQL（欄位名、型別轉換、org 條件），替身驗不到
  it('成績匯出：帶 3000 個學生 id 也 200（.in() 有切批，不撞 URL 長度）', async () => {
    ctx.campusScope = null;
    const studentIds = [
      ids['{student}']!,
      ...Array.from(
        { length: 2999 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    ];
    const res = await app.request(
      '/api/scores/export',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentIds }),
      },
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    // 那位真的學生有成績 → 不只有標頭（SQL 真的撈得到，不是空結果也綠）
    if (sqlPool) expect((await res.text()).split('\r\n').length).toBeGreaterThan(1);
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
      // 學年升級（#1820）看的是 `all_campuses` 權限、不是列了幾間分校（計畫席裁 E）：
      // 升級是整個機構一次，只被指派分校的管理員就算每間都列了，也不能代表全機構按 → 預期 403。
      // 只放過「403＋REQUIRES_ALL_CAMPUSES」這一種回應，別的狀態照樣算失敗
      const expected403 =
        /^\/api\/grade-promotions(\/preview)?(\?.*)? → 403 .*REQUIRES_ALL_CAMPUSES/;
      const failures = await hitAll();
      expect(failures.filter((f) => !expected403.test(f))).toEqual([]);
      expect(failures.filter((f) => expected403.test(f))).toHaveLength(2);
    } finally {
      ctx.campusScope = null;
    }
  });
});
