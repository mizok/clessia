import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import contactBookApp from './contact-book';

/**
 * #1100 #27 提醒那堂老師補寫聯絡簿（計畫席 10-23：收件人只有實際上課的老師；同班同天一則）。
 * 用會照條件過濾的 multi-org-db：髒資料每筆只讓一個條件擋住，拿掉哪個條件就會多一個人收到。
 */
const ORG = 'org-a';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const CLASS = id(1);
const CLASS_OTHER_CAMPUS = id(2);
const CLASS_OTHER_ORG = id(3);
const CAMPUS = id(11);
const DATE = '2026-10-20';
const [S1, S2, S3] = [id(21), id(22), id(23)];

function seed(over: Record<string, Record<string, unknown>[]> = {}) {
  const cls = { name: '小五英文', uses_contact_book: true };
  return createMultiOrgDb({
    classes: [
      { id: CLASS, org_id: ORG, campus_id: CAMPUS, name: '小五英文' },
      { id: CLASS_OTHER_CAMPUS, org_id: ORG, campus_id: id(12), name: '別校' },
      { id: CLASS_OTHER_ORG, org_id: 'org-b', campus_id: CAMPUS, name: '別 org' },
    ],
    enrollments: [
      {
        org_id: ORG,
        class_id: CLASS,
        student_id: S1,
        status: 'active',
        students: { name: '甲' },
        classes: cls,
      },
      {
        org_id: ORG,
        class_id: CLASS,
        student_id: S2,
        status: 'active',
        students: { name: '乙' },
        classes: cls,
      },
      // 已經寫了
      {
        org_id: ORG,
        class_id: CLASS,
        student_id: S3,
        status: 'active',
        students: { name: '丙' },
        classes: cls,
      },
      // 退班的不算
      {
        org_id: ORG,
        class_id: CLASS,
        student_id: id(24),
        status: 'withdrawn',
        students: { name: '丁' },
        classes: cls,
      },
    ],
    contact_book_entries: [{ org_id: ORG, student_id: S3, entry_date: DATE, content: '寫了' }],
    sessions: [
      // 實際上課＝代課的林老師（排課表上的王老師不收）
      {
        org_id: ORG,
        class_id: CLASS,
        session_date: DATE,
        status: 'scheduled',
        teacher_id: 'staff-lin',
      },
      // 停課那堂的老師不收
      {
        org_id: ORG,
        class_id: CLASS,
        session_date: DATE,
        status: 'cancelled',
        teacher_id: 'staff-chen',
      },
      // 同一天**別班**的老師不收（review3：拿掉 sessions 的 class_id 篩選要紅）
      {
        org_id: ORG,
        class_id: CLASS_OTHER_CAMPUS,
        session_date: DATE,
        status: 'scheduled',
        teacher_id: 'staff-huang',
      },
      // 髒資料：這堂的 teacher_id 指到別 org 的 staff —— staff 查詢的 org_id 是第二道防線
      {
        org_id: ORG,
        class_id: CLASS,
        session_date: DATE,
        status: 'scheduled',
        teacher_id: 'staff-other-org',
      },
      // 別天的不收
      {
        org_id: ORG,
        class_id: CLASS,
        session_date: '2026-10-21',
        status: 'scheduled',
        teacher_id: 'staff-wu',
      },
    ],
    staff: [
      { id: 'staff-lin', org_id: ORG, user_id: 'u-lin', display_name: '林老師', status: 'active' },
      {
        id: 'staff-chen',
        org_id: ORG,
        user_id: 'u-chen',
        display_name: '陳老師',
        status: 'active',
      },
      { id: 'staff-wu', org_id: ORG, user_id: 'u-wu', display_name: '吳老師', status: 'active' },
      {
        id: 'staff-huang',
        org_id: ORG,
        user_id: 'u-huang',
        display_name: '黃老師',
        status: 'active',
      },
      {
        id: 'staff-other-org',
        org_id: 'org-b',
        user_id: 'u-other-org',
        display_name: '別 org 老師',
        status: 'active',
      },
    ],
    user_roles: [
      { user_id: 'u-lin', role: 'teacher' },
      { user_id: 'u-chen', role: 'teacher' },
      { user_id: 'u-wu', role: 'teacher' },
      { user_id: 'u-huang', role: 'teacher' },
      { user_id: 'u-other-org', role: 'teacher' },
    ],
    notifications: [],
    ...over,
  });
}

type Db = ReturnType<typeof seed>;

function call(
  db: Db,
  body: unknown,
  opts: { roles?: string[]; campusScope?: string[] | null } = {},
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-1');
    set('roles', opts.roles ?? ['admin']);
    set('permissions', ['*']);
    set('campusScope', opts.campusScope === undefined ? null : opts.campusScope);
    await next();
  });
  app.route('/', contactBookApp as unknown as Hono);
  return app.request('/remind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/contact-book/remind', () => {
  // 名單照 zh-Hant 排序（同 /missing），乙（1 畫）在甲（5 畫）前
  // fixture 裡同一天別班的黃老師、teacher_id 指到別 org 的老師都不能收到（review3 二讀）
  it('只通知那天實際上課的老師；內文寫班名、日期、還沒寫的人', async () => {
    const db = seed();
    const res = await call(db, { classId: CLASS, date: DATE });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sent: 1,
      alreadyReminded: false,
      teacherNames: ['林老師'],
      missingCount: 2,
    });
    expect(db.rows('notifications')).toEqual([
      expect.objectContaining({
        org_id: ORG,
        user_id: 'u-lin',
        role: 'teacher',
        kind: 'contact_book_reminder',
        dedupe_key: `contact_book_reminder:${CLASS}:${DATE}`,
        payload: {
          title: '請補寫聯絡簿',
          body: '小五英文 10/20 還有 2 位沒寫：乙、甲',
          url: '/teacher/schedule',
        },
        // 只進通知中心、不推播（老師第一版不推播，同 notify()）
        push_status: 'skipped',
        push_error: 'ROLE_PUSH_DISABLED',
      }),
    ]);
  });

  it('通知寫失敗 → 500，不能說成「今天已提醒過」', async () => {
    const db = seed();
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const from = client.from.bind(client);
    client.from = (t: string) => {
      const q = from(t);
      if (t !== 'notifications') return q;
      return {
        upsert: () => ({
          select: () => Promise.resolve({ data: null, error: { code: '23505', message: 'boom' } }),
        }),
      };
    };
    const res = await call(db, { classId: CLASS, date: DATE });
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty('alreadyReminded');
  });

  it('同班同天再按一次：不再發，回 alreadyReminded', async () => {
    const db = seed();
    await call(db, { classId: CLASS, date: DATE });
    const res = await call(db, { classId: CLASS, date: DATE });
    expect(await res.json()).toMatchObject({ sent: 0, alreadyReminded: true });
    expect(db.rows('notifications')).toHaveLength(1);
  });

  it('都寫了 → 409 NOTHING_MISSING，不發', async () => {
    const db = seed({
      contact_book_entries: [S1, S2, S3].map((s) => ({
        org_id: ORG,
        student_id: s,
        entry_date: DATE,
        content: 'x',
      })),
    });
    const res = await call(db, { classId: CLASS, date: DATE });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('NOTHING_MISSING');
    expect(db.rows('notifications')).toEqual([]);
  });

  it('上課老師離職或沒有老師角色 → 409 NO_TEACHER', async () => {
    const inactive = seed({
      staff: [
        {
          id: 'staff-lin',
          org_id: ORG,
          user_id: 'u-lin',
          display_name: '林老師',
          status: 'inactive',
        },
      ],
    });
    expect((await call(inactive, { classId: CLASS, date: DATE })).status).toBe(409);
    const noRole = seed({ user_roles: [{ user_id: 'u-lin', role: 'admin' }] });
    const res = await call(noRole, { classId: CLASS, date: DATE });
    expect(((await res.json()) as { code: string }).code).toBe('NO_TEACHER');
  });

  it('不是 admin 403；別 org 的班 404；分校範圍外 403 —— 都不發', async () => {
    const db = seed();
    expect((await call(db, { classId: CLASS, date: DATE }, { roles: ['teacher'] })).status).toBe(
      403,
    );
    expect((await call(db, { classId: CLASS_OTHER_ORG, date: DATE })).status).toBe(404);
    expect(
      (await call(db, { classId: CLASS_OTHER_CAMPUS, date: DATE }, { campusScope: [CAMPUS] }))
        .status,
    ).toBe(403);
    // 範圍內照發（防過度擋）
    expect((await call(db, { classId: CLASS, date: DATE }, { campusScope: [CAMPUS] })).status).toBe(
      200,
    );
    expect(db.rows('notifications')).toHaveLength(1);
  });

  it('超過 5 位：寫前 5 位＋「等 N 位」', async () => {
    const cls = { name: '小五英文', uses_contact_book: true };
    const many = Array.from({ length: 7 }, (_, i) => ({
      org_id: ORG,
      class_id: CLASS,
      student_id: id(100 + i),
      status: 'active',
      students: { name: `生${i + 1}` },
      classes: cls,
    }));
    const db = seed({ enrollments: many, contact_book_entries: [] });
    await call(db, { classId: CLASS, date: DATE });
    expect((db.rows('notifications')[0] as { payload: { body: string } }).payload.body).toBe(
      '小五英文 10/20 還有 7 位沒寫：生1、生2、生3、生4、生5 等 7 位',
    );
  });
});
