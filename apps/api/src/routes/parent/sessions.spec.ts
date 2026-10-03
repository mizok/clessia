import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import sessionsRoute from './sessions';

/**
 * #1116 家長端「孩子的課堂」。設計：kb/wiki/architecture/parent-sessions-read.md。
 *
 * 用**真的 `createChildDb` ＋ 會照條件過濾的 multi-org-db** —— 這一支要證明的是範圍條件
 * 真的有下（別的孩子、別的班、在籍區間外），回固定資料的替身證明不了。
 */

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CHILD = id(1);
const SIBLING = id(2); // 同一個家長的另一個孩子：在 scope 裡，但不是這次查的那個
const STRANGER = id(3); // 別人家的孩子

const CLASS_A = id(101);
const CLASS_B = id(102);
const CLASS_SIBLING = id(103);
const CLASS_STRANGER = id(104);

const TEACHER_WANG = { display_name: '王老師' };
const TEACHER_LIN = { display_name: '林老師' };

interface SessionSeed {
  id: string;
  class_id: string;
  session_date: string;
  status?: string;
  event_id?: string | null;
  teacher_id?: string | null;
  schedule_teacher_id?: string | null;
  schedule_changes?: Record<string, unknown>[];
}

function session(seed: SessionSeed) {
  const scheduleTeacherId =
    seed.schedule_teacher_id === undefined ? 't-wang' : seed.schedule_teacher_id;
  const teacherId = seed.teacher_id === undefined ? 't-wang' : seed.teacher_id;
  return {
    id: seed.id,
    class_id: seed.class_id,
    session_date: seed.session_date,
    start_time: '18:00:00',
    end_time: '19:30:00',
    status: seed.status ?? 'scheduled',
    event_id: seed.event_id ?? null,
    teacher_id: teacherId,
    teacher: teacherId === 't-lin' ? TEACHER_LIN : teacherId ? TEACHER_WANG : null,
    schedules: scheduleTeacherId
      ? {
          teacher_id: scheduleTeacherId,
          teacher: scheduleTeacherId === 't-lin' ? TEACHER_LIN : TEACHER_WANG,
        }
      : null,
    classes: {
      name: `班 ${seed.class_id.slice(-3)}`,
      campuses: { name: '信義校' },
      courses: { name: '國中數學' },
    },
    schedule_changes: seed.schedule_changes ?? [],
  };
}

function baseSeed(extra: Record<string, Record<string, unknown>[]> = {}) {
  return {
    enrollments: [
      { student_id: CHILD, class_id: CLASS_A, effective_from: '2026-01-01', effective_to: null },
      {
        student_id: SIBLING,
        class_id: CLASS_SIBLING,
        effective_from: '2026-01-01',
        effective_to: null,
      },
      {
        student_id: STRANGER,
        class_id: CLASS_STRANGER,
        effective_from: '2026-01-01',
        effective_to: null,
      },
    ],
    sessions: [
      session({ id: id(301), class_id: CLASS_A, session_date: '2026-10-05' }),
      session({ id: id(302), class_id: CLASS_SIBLING, session_date: '2026-10-05' }),
      session({ id: id(303), class_id: CLASS_STRANGER, session_date: '2026-10-05' }),
    ],
    academy_exam_classes: [],
    attendance_records: [],
    daily_checkins: [],
    ...extra,
  };
}

function appWith(
  seed: Record<string, readonly Record<string, unknown>[]>,
  opts: { roles?: string[]; scope?: readonly string[] | null } = {},
) {
  const db = createMultiOrgDb(seed);
  const scope = opts.scope === undefined ? [CHILD, SIBLING] : opts.scope;
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', opts.roles ?? ['parent']);
    set('studentScope', scope);
    set('childDb', createChildDb(db.client as never, scope, 'org-1'));
    await next();
  });
  app.route('/', sessionsRoute as unknown as Hono);
  return app;
}

const WINDOW = 'dateFrom=2026-10-01&dateTo=2026-10-31';

async function get(app: Hono, query = `childId=${CHILD}&${WINDOW}`) {
  const res = await app.request(`/?${query}`);
  return { res, body: (await res.json()) as any };
}

describe('GET /api/me/sessions', () => {
  describe('範圍', () => {
    it('不是家長身分：403 NOT_PARENT', async () => {
      const { res, body } = await get(appWith(baseSeed(), { roles: ['teacher'] }));
      expect(res.status).toBe(403);
      expect(body.code).toBe('NOT_PARENT');
    });

    it('childId 不在 scope：403（指名越權回 403，不回空）', async () => {
      const { res, body } = await get(appWith(baseSeed()), `childId=${STRANGER}&${WINDOW}`);
      expect(res.status).toBe(403);
      expect(body.code).toBe('CHILD_OUT_OF_SCOPE');
    });

    it('dateFrom／dateTo 缺一或區間超過 42 天：400', async () => {
      const app = appWith(baseSeed());
      expect((await get(app, `childId=${CHILD}&dateFrom=2026-10-01`)).res.status).toBe(400);
      expect((await get(app, `childId=${CHILD}&dateTo=2026-10-31`)).res.status).toBe(400);
      const tooLong = await get(app, `childId=${CHILD}&dateFrom=2026-10-01&dateTo=2026-11-13`);
      expect(tooLong.res.status).toBe(400);
      expect(tooLong.body.code).toBe('INVALID_DATE_RANGE');
      const reversed = await get(app, `childId=${CHILD}&dateFrom=2026-10-31&dateTo=2026-10-01`);
      expect(reversed.res.status).toBe(400);
      // 剛好 42 天放行（月曆一頁 6 週）
      expect(
        (await get(app, `childId=${CHILD}&dateFrom=2026-10-01&dateTo=2026-11-12`)).res.status,
      ).toBe(200);
    });

    it('只回這個孩子報名過的班的堂；兄弟姊妹、別人家孩子的班不出現，窗外的堂不出現', async () => {
      const seed = baseSeed();
      seed.sessions.push(session({ id: id(304), class_id: CLASS_A, session_date: '2026-11-05' }));
      const { res, body } = await get(appWith(seed));
      expect(res.status).toBe(200);
      expect(body.data.map((s: { sessionId: string }) => s.sessionId)).toEqual([id(301)]);
    });

    it('轉班：A 班在 effective_to 之後、B 班在 effective_from 之前的堂不出現（countEnrolledOn）', async () => {
      const seed = baseSeed({
        enrollments: [
          {
            student_id: CHILD,
            class_id: CLASS_A,
            effective_from: '2026-01-01',
            effective_to: '2026-10-14',
          },
          {
            student_id: CHILD,
            class_id: CLASS_B,
            effective_from: '2026-10-15',
            effective_to: null,
          },
        ],
        sessions: [
          session({ id: id(311), class_id: CLASS_A, session_date: '2026-10-07' }), // 在籍
          session({ id: id(312), class_id: CLASS_A, session_date: '2026-10-21' }), // 已轉出
          session({ id: id(313), class_id: CLASS_B, session_date: '2026-10-08' }), // 還沒加入
          session({ id: id(314), class_id: CLASS_B, session_date: '2026-10-22' }), // 在籍
        ],
      });
      const { body } = await get(appWith(seed));
      expect(body.data.map((s: { sessionId: string }) => s.sessionId)).toEqual([id(311), id(314)]);
    });

    it('孩子沒有任何報名：回空陣列', async () => {
      const { res, body } = await get(appWith(baseSeed({ enrollments: [] })));
      expect(res.status).toBe(200);
      expect(body.data).toEqual([]);
    });
  });

  describe('內容', () => {
    it('帶課程名、班名、分校名、上課老師；不是代課時 isSubstitute = false、原任課老師 null', async () => {
      const { body } = await get(appWith(baseSeed()));
      expect(body.data[0]).toEqual({
        sessionId: id(301),
        date: '2026-10-05',
        startTime: '18:00',
        endTime: '19:30',
        status: 'scheduled',
        classId: CLASS_A,
        className: '班 101',
        courseName: '國中數學',
        campusName: '信義校',
        teacherName: '王老師',
        isSubstitute: false,
        originalTeacherName: null,
        examCount: 0,
        changes: [],
        attendance: null,
      });
    });

    it('代課：露實際上課的老師，isSubstitute = true 並帶原任課老師', async () => {
      const seed = baseSeed({
        sessions: [
          session({
            id: id(301),
            class_id: CLASS_A,
            session_date: '2026-10-05',
            teacher_id: 't-lin',
          }),
        ],
      });
      const { body } = await get(appWith(seed));
      expect(body.data[0]).toMatchObject({
        teacherName: '林老師',
        isSubstitute: true,
        originalTeacherName: '王老師',
      });
    });

    it('同班同日有校內考：examCount 為場數；別天、別班的不算', async () => {
      const seed = baseSeed({
        academy_exam_classes: [
          { class_id: CLASS_A, academy_exams: { exam_date: '2026-10-05' } },
          { class_id: CLASS_A, academy_exams: { exam_date: '2026-10-05' } },
          { class_id: CLASS_A, academy_exams: { exam_date: '2026-10-06' } },
          { class_id: CLASS_SIBLING, academy_exams: { exam_date: '2026-10-05' } },
        ],
      });
      const { body } = await get(appWith(seed));
      expect(body.data[0].examCount).toBe(2);
    });

    it('有課務異動：changes[] 帶改期的新舊時間，不帶原因與經手人', async () => {
      const seed = baseSeed({
        sessions: [
          session({
            id: id(301),
            class_id: CLASS_A,
            session_date: '2026-10-05',
            schedule_changes: [
              {
                change_type: 'reschedule',
                original_session_date: '2026-10-04',
                original_start_time: '10:00:00',
                original_end_time: '11:30:00',
                new_session_date: '2026-10-05',
                new_start_time: '18:00:00',
                new_end_time: '19:30:00',
                reason: '老師家裡有事',
                created_by_name: '行政小美',
                created_at: '2026-10-01T00:00:00Z',
              },
            ],
          }),
        ],
      });
      const { body } = await get(appWith(seed));
      expect(body.data[0].changes).toEqual([
        {
          changeType: 'reschedule',
          originalDate: '2026-10-04',
          originalStartTime: '10:00',
          originalEndTime: '11:30',
          newDate: '2026-10-05',
          newStartTime: '18:00',
          newEndTime: '19:30',
        },
      ]);
    });

    it('停課的堂照樣回，status = cancelled', async () => {
      const seed = baseSeed({
        sessions: [
          session({
            id: id(301),
            class_id: CLASS_A,
            session_date: '2026-10-05',
            status: 'cancelled',
          }),
        ],
      });
      const { body } = await get(appWith(seed));
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe('cancelled');
    });

    it('attendance 只是這個孩子的那一筆（含到班時間）；沒點名的堂 attendance = null', async () => {
      const seed = baseSeed({
        sessions: [
          session({ id: id(301), class_id: CLASS_A, session_date: '2026-10-05', event_id: 'ev-1' }),
          session({ id: id(305), class_id: CLASS_A, session_date: '2026-10-12', event_id: 'ev-2' }),
        ],
        attendance_records: [
          { student_id: SIBLING, event_id: 'ev-1', status: 'absent' },
          { student_id: CHILD, event_id: 'ev-1', status: 'present' },
          { student_id: SIBLING, event_id: 'ev-2', status: 'present' },
        ],
        daily_checkins: [
          {
            student_id: SIBLING,
            checkin_date: '2026-10-05',
            checked_in_at: '2026-10-05T09:00:00Z',
          },
          { student_id: CHILD, checkin_date: '2026-10-05', checked_in_at: '2026-10-05T09:50:00Z' },
        ],
      });
      const { body } = await get(appWith(seed));
      expect(body.data[0].attendance).toEqual({
        status: 'present',
        checkedInAt: '2026-10-05T09:50:00Z',
      });
      expect(body.data[1].attendance).toBeNull();
    });

    it('依日期、開始時間排序', async () => {
      const seed = baseSeed({
        sessions: [
          session({ id: id(321), class_id: CLASS_A, session_date: '2026-10-12' }),
          session({ id: id(322), class_id: CLASS_A, session_date: '2026-10-05' }),
        ],
      });
      const { body } = await get(appWith(seed));
      expect(body.data.map((s: { sessionId: string }) => s.sessionId)).toEqual([id(322), id(321)]);
    });

    it('回應不含全班人數、老師 id、其他學生的任何資料', async () => {
      const { body } = await get(appWith(baseSeed()));
      const keys = Object.keys(body.data[0]);
      for (const leaked of ['enrolledCount', 'attendanceTally', 'teacherId', 'eventId', 'note']) {
        expect(keys).not.toContain(leaked);
      }
    });
  });
});
