import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import dailyCheckinsApp from './daily-checkins';

/**
 * 掃碼是**自動寫入**：機器讀到一張卡，就替該學生當天所有課程記一筆 `present`。
 *
 * **它不得覆蓋人工改過的紀錄。** 老師把某個學生改成缺席、學生事後補掃了碼，
 * 原本的 upsert（`ignoreDuplicates: false`）會把它改回 present，而且不留痕跡 ——
 * 老師的判斷被一張卡推翻，沒有人會知道。
 *
 * 這裡守的是 upsert 的**選項**，不是結果：兩種寫法在假 supabase 的回傳上看不出差別，
 * 差別只存在於「送給 PostgREST 的是哪一組參數」。
 */
function createCheckinApp(
  fixture: {
    events?: Array<{ id: string; sessions: unknown }>;
    enrollments?: Array<{ class_id: string; effective_from: string; effective_to: string | null }>;
    /** `organizations.attendance_mode`；預設日到班（DB 預設，#976） */
    mode?: 'daily_checkin' | 'per_session';
    /** `campuses.attendance_mode`（#1112）；null = 沿用機構預設 */
    campusMode?: 'daily_checkin' | 'per_session' | null;
    orgError?: boolean;
    /** 當天已經打過卡（#1127）：衝突時 upsert 什麼都不回，路由要讀回原本那筆 */
    existingCheckedInAt?: string;
    /** #1127：誰在打（預設不受分校限制的管理員） */
    roles?: string[];
    campusScope?: readonly string[] | null;
    /** #1127 確認畫面：當天的課堂（`sessions` 表，`class_id` 會照 `.in()` 過濾） */
    sessions?: Array<Record<string, unknown>>;
  } = {},
) {
  const upsertCalls: Array<{ table: string; rows: unknown; options: unknown }> = [];
  const checkinRow = (checkedInAt: string) => ({
    id: '00000000-0000-4000-8000-000000000001',
    org_id: '00000000-0000-4000-8000-0000000000a1',
    student_id: '00000000-0000-4000-8000-0000000000b1',
    campus_id: null,
    checkin_date: '2026-04-01',
    checked_in_at: checkedInAt,
    created_at: '2026-04-01T00:00:00Z',
  });
  const insertCalls: Array<{ table: string; row: unknown }> = [];

  const supabase = {
    from(table: string) {
      let classIdFilter: readonly string[] | null = null;
      const query = {
        // `logAudit` 走 `.insert()` —— 替身少了它，稽核就會靜默失敗，
        // 而這個檔的 setup 會把「靜默失敗」變成紅燈（那是對的）。
        insert(row: unknown) {
          insertCalls.push({ table, row });
          return Promise.resolve({ error: null });
        },
        upsert(rows: unknown, options: unknown) {
          upsertCalls.push({ table, rows, options });
          return {
            // `ignoreDuplicates` 衝突時 PostgREST 回空陣列 —— 不能接 `.single()`
            select: () =>
              Promise.resolve({
                data: fixture.existingCheckedInAt ? [] : [checkinRow('2026-04-01T00:00:00Z')],
                error: null,
              }),
            then: (onfulfilled?: ((value: { error: null }) => unknown) | null) =>
              Promise.resolve({ error: null }).then(onfulfilled ?? undefined),
          };
        },
        select: () => query,
        eq: () => query,
        // 受分校限制的人（機台）打卡時，events 會再帶一次 `.in('campus_id', scope)`
        in: (column: string, values: readonly string[]) => {
          if (column === 'class_id') classIdFilter = values;
          return query;
        },
        limit: () => query,
        // `logAudit` 先查 `profiles` 拿 `user_name` 才寫 `audit_logs`，
        // 鏈是 select().eq().maybeSingle() —— 少一段就靜默失敗。
        // #966 B6：寫入前先驗學生屬於本 org（`students` 的 findInOrg）
        maybeSingle: () =>
          Promise.resolve(
            table === 'daily_checkins'
              ? { data: checkinRow(fixture.existingCheckedInAt ?? ''), error: null }
              : table === 'organizations'
                ? fixture.orgError
                  ? { data: null, error: { message: 'boom' } }
                  : { data: { attendance_mode: fixture.mode ?? 'daily_checkin' }, error: null }
                : table === 'campuses'
                  ? { data: { attendance_mode: fixture.campusMode ?? null }, error: null }
                  : {
                      data: table === 'students' ? { id: 'stu-1', name: '王小明' } : null,
                      error: null,
                    },
          ),
        then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
          const data =
            table === 'enrollments'
              ? (fixture.enrollments ?? [
                  { class_id: 'class-1', effective_from: '2020-01-01', effective_to: null },
                ])
              : table === 'sessions'
                ? (fixture.sessions ?? []).filter(
                    (row) => !classIdFilter || classIdFilter.includes(row['class_id'] as string),
                  )
                : (fixture.events ?? [
                    { id: 'event-1', sessions: [{ class_id: 'class-1' }] },
                    { id: 'event-2', sessions: [{ class_id: 'class-1' }] },
                  ]);
          return Promise.resolve({ data }).then(onfulfilled ?? undefined);
        },
      };
      return query;
    },
  };

  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const context = c as unknown as { set: (key: string, value: unknown) => void };
    context.set('supabase', supabase);
    context.set('orgId', '00000000-0000-4000-8000-0000000000a1');
    context.set('userId', 'user-1');
    context.set('roles', fixture.roles ?? ['admin']);
    // 這組測試的主題不是分校範圍 —— 宣告成「不受分校限制」，那也是正式站對
    // 老師／家長的實際值（`resolveCampusScope` 對非管理員回 null）。**不宣告的話
    // 會走進 `getCampusScope` 的缺席分支，那是 authMiddleware 沒跑的錯誤狀態。**
    context.set('campusScope', fixture.campusScope ?? null);
    await next();
  });
  app.route('/api/daily-checkins', dailyCheckinsApp);

  return { app, upsertCalls, insertCalls };
}

/**
 * #1127：掃碼機台（kiosk 角色）。放在門口的平板 —— 只能打卡，不能讀任何東西；
 * 分校取帳號綁的那一個、日期取台北今天，body 給別的一律 403（不是默默改掉）。
 */
describe('daily-checkins —— 掃碼機台（kiosk，#1127）', () => {
  const CAMPUS = '00000000-0000-4000-8000-0000000000c1';
  const OTHER = '00000000-0000-4000-8000-0000000000c2';
  const STUDENT = '00000000-0000-4000-8000-0000000000b1';
  const kiosk = (campusScope: readonly string[] = [CAMPUS]) =>
    createCheckinApp({ roles: ['kiosk'], campusScope });
  const post = (app: ReturnType<typeof kiosk>['app'], body: object) =>
    app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: STUDENT,
        checkinDate: getCurrentTaipeiDateString(),
        ...body,
      }),
    });

  it('沒給 campusId：用帳號綁的分校寫入', async () => {
    const { app, upsertCalls } = kiosk();
    const res = await post(app, {});

    expect(res.status).toBe(201);
    const row = upsertCalls.find((c) => c.table === 'daily_checkins')?.rows as {
      campus_id: string;
    };
    expect(row.campus_id).toBe(CAMPUS);
  });

  it('body 指定別的分校：403，沒寫', async () => {
    const { app, upsertCalls } = kiosk();
    expect((await post(app, { campusId: OTHER })).status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
  });

  it('不是今天：403（機台不補登），沒寫', async () => {
    const { app, upsertCalls } = kiosk();
    expect((await post(app, { checkinDate: '2020-01-01' })).status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
  });

  it('帳號沒有綁剛好一個分校：403（不猜是哪一校）', async () => {
    expect((await post(kiosk([]).app, {})).status).toBe(403);
    expect((await post(kiosk([CAMPUS, OTHER]).app, {})).status).toBe(403);
  });

  it('只能打卡：GET 與 DELETE 都 403', async () => {
    const { app } = kiosk();
    expect((await app.request('/api/daily-checkins?date=2026-04-01')).status).toBe(403);
    expect((await app.request(`/api/daily-checkins/${STUDENT}`, { method: 'DELETE' })).status).toBe(
      403,
    );
  });
});

describe('POST /api/daily-checkins', () => {
  /**
   * #1127：一天最多打卡一次（specs/public/qr-checkin.md）。原本的 upsert 沒有
   * `ignoreDuplicates`，重掃一次就把 `checked_in_at` 改成重掃的時間 —— 「幾點到的」被後來那張卡蓋掉。
   */
  it('重掃不覆寫第一次的打卡時間', async () => {
    const { app, upsertCalls } = createCheckinApp({ existingCheckedInAt: '2026-04-01T08:00:00Z' });

    const response = await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-01',
      }),
    });

    const checkinUpsert = upsertCalls.find((call) => call.table === 'daily_checkins');
    expect(checkinUpsert?.options).toMatchObject({ ignoreDuplicates: true });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { checkedInAt: string }).checkedInAt).toBe(
      '2026-04-01T08:00:00Z',
    );
  });

  it('never overwrites an existing attendance record', async () => {
    const { app, upsertCalls } = createCheckinApp();

    const response = await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-01',
      }),
    });

    expect(response.status).toBe(201);

    const attendanceUpsert = upsertCalls.find((call) => call.table === 'attendance_records');
    expect(attendanceUpsert).toBeDefined();
    // 已經有紀錄的就跳過 —— 那筆可能是老師手動改的
    expect(attendanceUpsert?.options).toMatchObject({ ignoreDuplicates: true });
  });

  it('records the scan as an automatic write', async () => {
    const { app, upsertCalls } = createCheckinApp();

    await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-01',
      }),
    });

    const rows = upsertCalls.find((call) => call.table === 'attendance_records')?.rows as Array<
      Record<string, unknown>
    >;

    // 掃碼是機器寫的，不是人 —— 這一欄之後要用來分辨「能不能覆蓋」
    expect(rows.every((row) => row['recorded_by_role'] === 'system')).toBe(true);
    expect(rows.every((row) => row['status'] === 'present')).toBe(true);
  });

  /**
   * 取消打卡一直有稽核、建立卻沒有（#919）—— 於是「這個人今天被標成到班過」
   * 在 `audit_logs` 上**只留得下後半段**：查稽核的人會看到一筆
   * `cancel_checkin`，而那筆取消的東西在紀錄裡從來沒有出現過。
   */
  it('把建立到班也寫進 audit_logs —— 不是只有取消才留痕（#919）', async () => {
    const { app, insertCalls } = createCheckinApp();

    await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-01',
      }),
    });

    const audit = insertCalls.find((call) => call.table === 'audit_logs')?.row as Record<
      string,
      unknown
    >;

    expect(audit).toBeDefined();
    expect(audit['action']).toBe('checkin');
    expect(audit['resource_type']).toBe('attendance');
    // 衍生出勤列的筆數要跟得上 —— `cancel_checkin` 那支記的是
    // `attendanceRecordsRemoved`，兩邊對得起來才查得出「建了幾筆、刪了幾筆」
    expect(audit['details']).toMatchObject({
      studentId: '00000000-0000-4000-8000-0000000000b1',
      checkinDate: '2026-04-01',
      attendanceRecordsCreated: 2,
    });
  });
});

/**
 * **掃碼只算報名的課**（使用者 2026-09-03 裁定）。
 *
 * 原本是「當天這個分校的所有課堂」都寫 present —— 包含學生根本沒報名的班，
 * 於是出勤紀錄裡冒出他從來沒上過的課，而那些紀錄會流進扣課與月結。
 *
 * 純函式（`enrolled-events.spec.ts`）守的是過濾規則本身；這裡守的是
 * **路由真的去查了在籍、而且真的拿去濾** —— 完全不濾的版本一樣通過那些測試。
 */
describe('POST /api/daily-checkins —— 只寫有報名的課堂', () => {
  async function checkin(fixture: Parameters<typeof createCheckinApp>[0], campusId?: string) {
    const { app, upsertCalls } = createCheckinApp(fixture);
    const response = await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-06',
        campusId,
      }),
    });
    const attendance = upsertCalls.find((call) => call.table === 'attendance_records');
    return {
      status: response.status,
      wroteCheckin: upsertCalls.some((call) => call.table === 'daily_checkins'),
      eventIds: ((attendance?.rows ?? []) as Array<Record<string, unknown>>).map(
        (row) => row['event_id'],
      ),
    };
  }

  it('沒報名的班不寫出勤', async () => {
    const { eventIds } = await checkin({
      events: [
        { id: 'ev-enrolled', sessions: [{ class_id: 'class-1' }] },
        { id: 'ev-other', sessions: [{ class_id: 'class-2' }] },
      ],
      enrollments: [{ class_id: 'class-1', effective_from: '2020-01-01', effective_to: null }],
    });

    expect(eventIds).toEqual(['ev-enrolled']);
  });

  it('一堂都沒報名時 —— 到班紀錄照建，只是不產生課堂出勤', async () => {
    const { status, eventIds } = await checkin({
      events: [{ id: 'ev-other', sessions: [{ class_id: 'class-2' }] }],
      enrollments: [],
    });

    // 人到了就是到了，即使他今天一堂課都沒有 —— 兩層分開
    expect(status).toBe(201);
    expect(eventIds).toEqual([]);
  });

  /**
   * #1099：課堂模式（per_session）下打卡只記到班時間，不直接完成課堂出勤
   * （rules/attendance-rules.md 1.2）。原本整支沒讀 attendance_mode，兩種模式都替課堂寫 present。
   */
  it('課堂模式：到班紀錄照建，但不寫任何課堂出勤', async () => {
    const { status, wroteCheckin, eventIds } = await checkin({ mode: 'per_session' });

    expect(status).toBe(201);
    expect(wroteCheckin).toBe(true);
    expect(eventIds).toEqual([]);
  });

  it('日到班模式：照舊替有報名的課堂寫 present', async () => {
    const { eventIds } = await checkin({ mode: 'daily_checkin' });

    expect(eventIds).toEqual(['event-1', 'event-2']);
  });

  // #1112：出勤模式是分校層級 —— 打卡帶了分校，就看那個分校的設定
  const CAMPUS = '00000000-0000-4000-8000-0000000000c1';

  it('分校設課堂模式、機構是日到班：照分校，不寫課堂出勤', async () => {
    const { wroteCheckin, eventIds } = await checkin(
      { mode: 'daily_checkin', campusMode: 'per_session' },
      CAMPUS,
    );

    expect(wroteCheckin).toBe(true);
    expect(eventIds).toEqual([]);
  });

  it('分校設日到班、機構是課堂模式：照分校，寫課堂出勤', async () => {
    const { eventIds } = await checkin(
      { mode: 'per_session', campusMode: 'daily_checkin' },
      CAMPUS,
    );

    expect(eventIds).toEqual(['event-1', 'event-2']);
  });

  it('分校沒設定（null）：沿用機構預設', async () => {
    const { eventIds } = await checkin({ mode: 'per_session', campusMode: null }, CAMPUS);

    expect(eventIds).toEqual([]);
  });

  // 讀不到模式就不知道該不該寫出勤 —— 在任何寫入之前停下，不猜
  it('讀機構設定失敗：500，到班紀錄也不寫', async () => {
    const { status, wroteCheckin, eventIds } = await checkin({ orgError: true });

    expect(status).toBe(500);
    expect(wroteCheckin).toBe(false);
    expect(eventIds).toEqual([]);
  });

  it('在籍已經結束的班不寫', async () => {
    const { eventIds } = await checkin({
      events: [{ id: 'ev-1', sessions: [{ class_id: 'class-1' }] }],
      enrollments: [
        { class_id: 'class-1', effective_from: '2020-01-01', effective_to: '2026-04-05' },
      ],
    });

    expect(eventIds).toEqual([]);
  });
});

/**
 * 取消打卡。**兩件事只在路由層看得到**：走的是既有的補登窗（不是另一套），
 * 以及衍生紀錄是**刪掉而不是改成 absent**。
 */
describe('DELETE /api/daily-checkins/:id', () => {
  function createCancelApp(options: {
    eventDate: string;
    responsible?: string;
    retroDays?: number;
  }) {
    const calls: Array<{ table: string; op: string; filters: Array<[string, unknown]> }> = [];
    const queriedTables: string[] = [];

    const supabase = {
      from(table: string) {
        queriedTables.push(table);
        const filters: Array<[string, unknown]> = [];
        const query: Record<string, unknown> = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          in: () => query,
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'daily_checkins'
                  ? {
                      id: 'checkin-1',
                      student_id: 'stu-1',
                      checkin_date: options.eventDate,
                      campus_id: null,
                    }
                  : table === 'students'
                    ? { id: 'stu-1' }
                    : table === 'organizations'
                      ? {
                          attendance_responsible: options.responsible ?? 'admin',
                          attendance_retroactive_days: options.retroDays ?? 0,
                        }
                      : null,
              error: null,
            }),
          delete: () => {
            calls.push({ table, op: 'delete', filters });
            return query;
          },
          update: () => {
            calls.push({ table, op: 'update', filters });
            return query;
          },
          insert: () => Promise.resolve({ error: null }),
          then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
            const data =
              table === 'events'
                ? [{ id: 'ev-1' }]
                : table === 'attendance_records'
                  ? [{ id: 'rec-1' }]
                  : [];
            return Promise.resolve({ data }).then(onfulfilled ?? undefined);
          },
        };
        return query;
      },
    };

    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', 'user-1');
      context.set('roles', ['admin']);
      context.set('campusScope', null);
      await next();
    });
    app.route('/api/daily-checkins', dailyCheckinsApp);

    return { app, calls, queriedTables };
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

  async function cancel(options: Parameters<typeof createCancelApp>[0]) {
    const { app, calls, queriedTables } = createCancelApp(options);
    const response = await app.request(
      '/api/daily-checkins/00000000-0000-4000-8000-000000000001',
      { method: 'DELETE' },
      undefined,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );
    return {
      status: response.status,
      body: await response.json().catch(() => null),
      calls,
      queriedTables,
    };
  }

  it('刪掉打卡與它寫出來的出勤紀錄 —— 不是改成 absent', async () => {
    const { status, body, calls } = await cancel({ eventDate: today });

    expect(status).toBe(200);
    expect(body).toMatchObject({ attendanceRecordsRemoved: 1 });
    expect(calls.some((call) => call.table === 'attendance_records' && call.op === 'delete')).toBe(
      true,
    );
    // 改成 absent 就是替沒發生過的判斷寫一個答案
    expect(calls.some((call) => call.table === 'attendance_records' && call.op === 'update')).toBe(
      false,
    );
    expect(calls.some((call) => call.table === 'daily_checkins' && call.op === 'delete')).toBe(
      true,
    );
  });

  it('只刪掃碼寫的那些 —— 老師手動改過的不能被一次取消打卡抹掉', async () => {
    const { calls } = await cancel({ eventDate: today });

    const del = calls.find((call) => call.table === 'attendance_records' && call.op === 'delete');
    expect(del?.filters).toContainEqual(['recorded_by_role', 'system']);
    expect(del?.filters).toContainEqual(['status', 'present']);
  });

  it('走既有的補登窗 —— 而不是另寫一份判斷', async () => {
    const { queriedTables } = await cancel({ eventDate: '2020-01-01' });

    // `assertAttendanceWindow` 讀 organizations 的 attendance_responsible /
    // attendance_retroactive_days。沒有這一步就代表這支端點自己判斷了時窗 ——
    // 那樣同一間補習班對「昨天還能不能改」會有兩個答案。
    expect(queriedTables).toContain('organizations');
  });
});

/**
 * #1127：機台掃完要讓學生看到「是我、今天有這些課」。確認資訊放在 POST 的回應裡
 * （不另開讀端點 —— 機台不能讀任何東西），而且**只回剛打卡的那一位**。
 */
describe('POST /api/daily-checkins —— 確認資訊（學生名＋今日課堂）', () => {
  const session = (id: string, classId: string, start: string, status = 'scheduled') => ({
    id,
    class_id: classId,
    start_time: start,
    end_time: '21:00:00',
    status,
    classes: { name: `班-${classId}` },
  });
  const sessions = [
    session('s-late', 'class-1', '19:00:00'),
    session('s-early', 'class-1', '17:00:00'),
    session('s-cancelled', 'class-1', '15:00:00', 'cancelled'),
    session('s-other', 'class-9', '16:00:00'),
  ];
  const post = async (mode: 'daily_checkin' | 'per_session') => {
    const { app } = createCheckinApp({ sessions, mode });
    const res = await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-06',
      }),
    });
    return {
      status: res.status,
      body: (await res.json()) as {
        student: { name: string };
        todaySessions: Array<{ sessionId: string; className: string; startTime: string }>;
      },
    };
  };

  it('回學生名與當天有報名、沒停課的課堂，依開始時間排序', async () => {
    const { status, body } = await post('daily_checkin');
    expect(status).toBe(201);
    expect(body.student).toEqual({ name: '王小明' });
    expect(body.todaySessions).toEqual([
      { sessionId: 's-early', className: '班-class-1', startTime: '17:00:00', endTime: '21:00:00' },
      { sessionId: 's-late', className: '班-class-1', startTime: '19:00:00', endTime: '21:00:00' },
    ]);
  });

  it('課堂模式也回今日課堂（顯示用，不寫出勤）', async () => {
    const { body } = await post('per_session');
    expect(body.todaySessions.map((s) => s.sessionId)).toEqual(['s-early', 's-late']);
  });
});
