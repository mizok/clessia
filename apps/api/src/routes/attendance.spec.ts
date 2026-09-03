import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  buildAttendanceSessionListMeta,
  buildAttendanceAuditBatchDetails,
  buildAttendanceAuditResourceName,
  ensureAttendanceSessionEvents,
  normalizeAttendanceFilterIds,
  normalizeAttendanceSessionStatuses,
  toAttendanceResponse,
} from './attendance';
import attendanceApp from './attendance';

describe('toAttendanceResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'ar-1',
      org_id: 'org-1',
      student_id: 'stu-1',
      student_name: '王小明',
      event_id: 'ev-1',
      event_date: '2026-04-01',
      start_time: '14:00',
      end_time: '16:00',
      campus_name: '中正分校',
      class_name: '國一數學A班',
      status: 'present',
      note: null,
      recorded_by: null,
      recorded_by_role: null,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    };
    const result = toAttendanceResponse(row);
    expect(result.id).toBe('ar-1');
    expect(result.studentName).toBe('王小明');
    expect(result.status).toBe('present');
    expect(result.eventDate).toBe('2026-04-01');
  });
});

describe('attendance audit helpers', () => {
  it('formats attendance audit resource name from session context', () => {
    expect(
      buildAttendanceAuditResourceName({
        courseName: '英文八年級重點進階班',
        className: '英文班 B',
        eventDate: '2026-04-02',
        startTime: '14:00',
      }),
    ).toBe('英文八年級重點進階班 / 英文班 B / 2026-04-02 14:00');
  });

  it('summarizes batch attendance updates by status', () => {
    expect(
      buildAttendanceAuditBatchDetails([
        { studentId: 'student-1', status: 'present' },
        { studentId: 'student-2', status: 'present' },
        { studentId: 'student-3', status: 'absent' },
      ]),
    ).toEqual({
      updatedCount: 3,
      presentCount: 2,
      absentCount: 1,
    });
  });
});

describe('attendance session status normalization', () => {
  it('returns null when status filter is omitted', () => {
    expect(normalizeAttendanceSessionStatuses(undefined)).toBeNull();
  });

  it('parses comma separated session statuses', () => {
    expect(normalizeAttendanceSessionStatuses('scheduled,completed,cancelled')).toEqual([
      'scheduled',
      'completed',
      'cancelled',
    ]);
  });
});

describe('attendance session filter helpers', () => {
  it('normalizes comma separated filter ids', () => {
    expect(normalizeAttendanceFilterIds('course-1, course-2,course-1')).toEqual([
      'course-1',
      'course-2',
    ]);
  });

  it('builds paginated meta for session list responses', () => {
    expect(buildAttendanceSessionListMeta(21, 2, 10)).toEqual({
      total: 21,
      page: 2,
      pageSize: 10,
      totalPages: 3,
    });
  });

  it('backfills missing session events for attendance queries', async () => {
    const insertedEvents: Array<Record<string, unknown>> = [];
    const updatedSessions: Array<{ id: string; event_id: string | null }> = [];
    const sessions = [
      {
        id: 'session-1',
        event_id: null,
        session_date: '2026-04-06',
        start_time: '09:00:00',
        end_time: '11:00:00',
        status: 'scheduled',
        class_id: 'class-1',
        classes: {
          name: 'Ｇ',
          course_id: 'course-1',
          campus_id: '11111111-1111-4111-8111-111111111111',
          courses: { name: '社會 高二重點強化班' },
        },
      },
    ];

    const fakeSupabase = {
      from(table: string) {
        if (table === 'sessions') {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            is() {
              return this;
            },
            gte() {
              return this;
            },
            lte() {
              return this;
            },
            in() {
              return this;
            },
            then(
              onfulfilled?: ((value: { data: typeof sessions; error: null }) => unknown) | null,
            ) {
              return Promise.resolve({ data: sessions, error: null }).then(
                onfulfilled ?? undefined,
              );
            },
            update(payload: { event_id: string }) {
              return {
                eq(column: string, value: unknown) {
                  if (column === 'id') {
                    updatedSessions.push({ id: String(value), event_id: payload.event_id });
                  }
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        }

        if (table === 'events') {
          return {
            insert(rows: Array<Record<string, unknown>>) {
              insertedEvents.push(...rows);
              return Promise.resolve({ error: null });
            },
          };
        }

        throw new Error(`Unsupported table in fake supabase: ${table}`);
      },
    };

    const result = await ensureAttendanceSessionEvents({
      supabase: fakeSupabase as never,
      orgId: 'org-1',
      campusId: '11111111-1111-4111-8111-111111111111',
      courseIdList: [],
      classIdList: ['class-1'],
      statusList: ['scheduled', 'completed'],
    });

    expect(result.error).toBeNull();
    expect(result.created).toBe(1);
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]).toEqual(
      expect.objectContaining({
        org_id: 'org-1',
        event_type: 'session',
        title: 'Ｇ',
        campus_id: '11111111-1111-4111-8111-111111111111',
        event_date: '2026-04-06',
        start_time: '09:00:00',
        end_time: '11:00:00',
      }),
    );
    expect(updatedSessions).toHaveLength(1);
    expect(updatedSessions[0]?.id).toBe('session-1');
    expect(updatedSessions[0]?.event_id).toEqual(expect.any(String));
  });
});

describe('GET /api/attendance/sessions', () => {
  it('returns first page when date filters are omitted', async () => {
    const app = createAttendanceTestApp(
      createMockSupabase({
        events: [
          buildEvent({
            id: 'event-1',
            classId: 'class-1',
            className: '數學 A',
            courseId: 'course-1',
            courseName: '數學',
            sessionStatus: 'scheduled',
            eventDate: '2026-04-01',
          }),
          buildEvent({
            id: 'event-2',
            classId: 'class-2',
            className: '英文 B',
            courseId: 'course-2',
            courseName: '英文',
            sessionStatus: 'completed',
            eventDate: '2026-04-02',
          }),
        ],
        enrollmentCountsByClassId: {
          'class-1': 12,
          'class-2': 8,
        },
      }),
    );

    const response = await app.request('/api/attendance/sessions?page=1&pageSize=1');
    const payload = (await response.json()) as {
      data: Array<{ eventId: string }>;
      meta: { total: number; page: number; pageSize: number; totalPages: number };
    };

    expect(response.status).toBe(200);
    expect(payload.data.map((item) => item.eventId)).toEqual(['event-1']);
    expect(payload.meta).toEqual({
      total: 2,
      page: 1,
      pageSize: 1,
      totalPages: 2,
    });
  });

  it('hides cancelled sessions by default and returns them when asked', async () => {
    const events = [
      buildEvent({
        id: 'event-1',
        classId: 'class-1',
        className: '數學 A',
        courseId: 'course-1',
        courseName: '數學',
        sessionStatus: 'scheduled',
        eventDate: '2026-04-01',
      }),
      buildEvent({
        id: 'event-2',
        classId: 'class-2',
        className: '英文 B',
        courseId: 'course-2',
        courseName: '英文',
        sessionStatus: 'cancelled',
        eventDate: '2026-04-02',
        // 停課的課堂刻意不補建出勤事件 —— 所以它沒有 eventId
        hasEvent: false,
      }),
    ];
    const request = async (query: string) => {
      const app = createAttendanceTestApp(createMockSupabase({ events }));
      const response = await app.request(`/api/attendance/sessions?${query}`);
      return (await response.json()) as {
        data: Array<{ classId: string; status: string; eventId: string | null }>;
      };
    };

    const byDefault = await request('page=1&pageSize=20');
    expect(byDefault.data.map((item) => item.classId)).toEqual(['class-1']);

    const withCancelled = await request('page=1&pageSize=20&statuses=scheduled,cancelled');
    expect(withCancelled.data).toEqual([
      expect.objectContaining({ classId: 'class-1', status: 'scheduled', eventId: 'event-1' }),
      // 沒有 eventId 就點不了名，前端要據此關掉入口 —— 不能給空字串蒙混
      expect.objectContaining({ classId: 'class-2', status: 'cancelled', eventId: null }),
    ]);
  });

  it('marks how many exams each class has that day', async () => {
    const app = createAttendanceTestApp(
      createMockSupabase({
        events: [
          buildEvent({
            id: 'event-1',
            classId: 'class-1',
            className: '數學 A',
            courseId: 'course-1',
            courseName: '數學',
            sessionStatus: 'scheduled',
            eventDate: '2026-04-01',
          }),
          buildEvent({
            id: 'event-2',
            classId: 'class-2',
            className: '英文 B',
            courseId: 'course-2',
            courseName: '英文',
            sessionStatus: 'scheduled',
            eventDate: '2026-04-02',
          }),
        ],
        examsByClassId: {
          // 同一天兩場（不同科）要數成 2；同一班在區間內**別天**的那場不能算進來
          'class-1': ['2026-04-01', '2026-04-01', '2026-04-02'],
          // 區間外的考試不該漏到這一頁的任何一格上
          'class-2': ['2026-04-09'],
        },
      }),
    );

    const response = await app.request('/api/attendance/sessions?page=1&pageSize=20');
    const payload = (await response.json()) as {
      data: Array<{ classId: string; examCount: number }>;
    };

    expect(payload.data).toEqual([
      expect.objectContaining({ classId: 'class-1', examCount: 2 }),
      expect.objectContaining({ classId: 'class-2', examCount: 0 }),
    ]);
  });

  it('flags substitute teachers and returns who actually teaches', async () => {
    const app = createAttendanceTestApp(
      createMockSupabase({
        events: [
          buildEvent({
            id: 'event-1',
            classId: 'class-1',
            className: '數學 A',
            courseId: 'course-1',
            courseName: '數學',
            sessionStatus: 'scheduled',
            eventDate: '2026-04-01',
            teacherId: 'teacher-sub',
            teacherName: '代課老師',
            scheduleTeacherId: 'teacher-main',
          }),
          buildEvent({
            id: 'event-2',
            classId: 'class-2',
            className: '英文 B',
            courseId: 'course-2',
            courseName: '英文',
            sessionStatus: 'scheduled',
            eventDate: '2026-04-02',
            teacherId: 'teacher-main',
            teacherName: '正課老師',
            scheduleTeacherId: 'teacher-main',
          }),
        ],
      }),
    );

    const response = await app.request('/api/attendance/sessions?page=1&pageSize=20');
    const payload = (await response.json()) as {
      data: Array<{ classId: string; isSubstitute: boolean; teacherName: string | null }>;
    };

    expect(payload.data).toEqual([
      expect.objectContaining({
        classId: 'class-1',
        isSubstitute: true,
        teacherName: '代課老師',
      }),
      expect.objectContaining({
        classId: 'class-2',
        isSubstitute: false,
        teacherName: '正課老師',
      }),
    ]);
  });

  it('returns paginated data/meta and excludes cancelled sessions by default', async () => {
    const app = createAttendanceTestApp(
      createMockSupabase({
        events: [
          buildEvent({
            id: 'event-1',
            classId: 'class-1',
            className: '數學 A',
            courseId: 'course-1',
            courseName: '數學',
            sessionStatus: 'scheduled',
          }),
          buildEvent({
            id: 'event-2',
            classId: 'class-2',
            className: '英文 B',
            courseId: 'course-1',
            courseName: '英文',
            sessionStatus: 'completed',
          }),
          buildEvent({
            id: 'event-3',
            classId: 'class-3',
            className: '自然 C',
            courseId: 'course-2',
            courseName: '自然',
            sessionStatus: 'cancelled',
          }),
        ],
        attendanceRecordsByEventId: {
          'event-2': [{ status: 'present' }, { status: 'absent' }],
        },
        enrollmentCountsByClassId: {
          'class-1': 12,
          'class-2': 8,
          'class-3': 5,
        },
      }),
    );

    const response = await app.request(
      '/api/attendance/sessions?dateFrom=2026-04-01&dateTo=2026-04-03&page=1&pageSize=1',
    );
    const payload = (await response.json()) as {
      data: Array<{ eventId: string }>;
      meta: { total: number; page: number; pageSize: number; totalPages: number };
    };

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.eventId).toBe('event-1');
    expect(payload.meta).toEqual({
      total: 2,
      page: 1,
      pageSize: 1,
      totalPages: 2,
    });
  });

  it('supports courseIds and classIds filters and intersects them when both are present', async () => {
    const app = createAttendanceTestApp(
      createMockSupabase({
        events: [
          buildEvent({
            id: 'event-1',
            classId: 'class-1',
            className: '數學 A',
            courseId: 'course-1',
            courseName: '數學',
            sessionStatus: 'scheduled',
          }),
          buildEvent({
            id: 'event-2',
            classId: 'class-2',
            className: '英文 B',
            courseId: 'course-1',
            courseName: '英文',
            sessionStatus: 'completed',
          }),
          buildEvent({
            id: 'event-3',
            classId: 'class-3',
            className: '自然 C',
            courseId: 'course-2',
            courseName: '自然',
            sessionStatus: 'scheduled',
          }),
        ],
        enrollmentCountsByClassId: {
          'class-1': 10,
          'class-2': 9,
          'class-3': 7,
        },
      }),
    );

    const byCourseResponse = await app.request(
      '/api/attendance/sessions?dateFrom=2026-04-01&dateTo=2026-04-03&courseIds=course-1',
    );
    const byCoursePayload = (await byCourseResponse.json()) as { data: Array<{ eventId: string }> };

    const byClassResponse = await app.request(
      '/api/attendance/sessions?dateFrom=2026-04-01&dateTo=2026-04-03&classIds=class-3',
    );
    const byClassPayload = (await byClassResponse.json()) as { data: Array<{ eventId: string }> };

    const intersectionResponse = await app.request(
      '/api/attendance/sessions?dateFrom=2026-04-01&dateTo=2026-04-03&courseIds=course-1&classIds=class-3',
    );
    const intersectionPayload = (await intersectionResponse.json()) as {
      data: Array<{ eventId: string }>;
    };

    expect(byCoursePayload.data.map((item) => item.eventId)).toEqual(['event-1', 'event-2']);
    expect(byClassPayload.data.map((item) => item.eventId)).toEqual(['event-3']);
    expect(intersectionPayload.data).toEqual([]);
  });

  it('filters by class campus even when event campus is missing', async () => {
    const campusId = '11111111-1111-4111-8111-111111111111';

    const app = createAttendanceTestApp(
      createMockSupabase({
        events: [
          {
            ...buildEvent({
              id: 'event-1',
              classId: 'class-1',
              className: '高二重點強化班 G班',
              courseId: 'course-1',
              courseName: '社會',
              sessionStatus: 'completed',
            }),
            campus_id: null,
            campuses: null,
            sessions: [
              {
                class_id: 'class-1',
                status: 'completed',
                classes: {
                  name: '高二重點強化班 G班',
                  course_id: 'course-1',
                  campus_id: campusId,
                  campuses: { name: '示範分校01' },
                  courses: { name: '社會' },
                },
              },
            ],
          },
        ],
        enrollmentCountsByClassId: {
          'class-1': 18,
        },
      }),
    );

    const response = await app.request(
      `/api/attendance/sessions?campusId=${campusId}&classIds=class-1&page=1&pageSize=20`,
    );
    const payload = (await response.json()) as {
      data: Array<{ eventId: string; campusId: string | null; campusName: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        campusId,
        campusName: '示範分校01',
      }),
    ]);
  });

  it('counts leave and attendance records even when attendance_taken_at is null', async () => {
    const app = createAttendanceTestApp(
      createMockSupabase({
        events: [
          {
            ...buildEvent({
              id: 'event-1',
              classId: 'class-1',
              className: '數學 A',
              courseId: 'course-1',
              courseName: '數學',
              sessionStatus: 'scheduled',
            }),
            attendance_taken_at: null,
          },
        ],
        attendanceRecordsByEventId: {
          'event-1': [{ status: 'on_leave' }, { status: 'present' }, { status: 'absent' }],
        },
        enrollmentCountsByClassId: {
          'class-1': 12,
        },
      }),
    );

    const response = await app.request(
      '/api/attendance/sessions?dateFrom=2026-04-01&dateTo=2026-04-03&page=1&pageSize=20',
    );
    const payload = (await response.json()) as {
      data: Array<{
        eventId: string;
        takenAt: string | null;
        presentCount: number;
        onLeaveCount: number;
        absentCount: number;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        takenAt: null,
        presentCount: 1,
        onLeaveCount: 1,
        absentCount: 1,
      }),
    ]);
  });
});

describe('PATCH /api/attendance/batch', () => {
  it('rejects attendance updates for future events', async () => {
    const futureEvent: MockAttendanceEvent = {
      ...buildEvent({
        id: 'event-future',
        classId: 'class-1',
        className: '數學 A',
        courseId: 'course-1',
        courseName: '數學',
        sessionStatus: 'scheduled',
      }),
      event_date: '2099-01-01',
    };

    const app = createAttendanceTestApp(
      createMockSupabase({
        events: [futureEvent],
        enrollmentCountsByClassId: {
          'class-1': 12,
        },
      }),
    );

    const response = await app.request('/api/attendance/batch', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: 'event-future',
        updates: [{ studentId: 'student-1', status: 'present' }],
      }),
    });
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('未來課堂尚未開放點名');
  });
});

interface MockAttendanceEvent {
  readonly id: string;
  readonly org_id: string;
  readonly event_date: string;
  readonly start_time: string | null;
  readonly end_time: string | null;
  readonly attendance_taken_at: string | null;
  readonly campus_id: string | null;
  readonly campuses: { readonly name: string } | null;
  readonly sessions: Array<{
    readonly class_id: string;
    readonly status: 'scheduled' | 'completed' | 'cancelled';
    /** 實際上這堂課的老師；null 代表沒指定 */
    readonly teacher_id?: string | null;
    readonly teacher?: { readonly display_name: string } | null;
    /** 課表排定的老師；與 teacher_id 不一致就是代課 */
    readonly schedules?: { readonly teacher_id: string | null } | null;
    /** false 代表這堂課還沒補建出勤事件（停課的課堂就不補） */
    readonly hasEvent?: boolean;
    readonly classes: {
      readonly name: string;
      readonly course_id: string;
      readonly campus_id?: string | null;
      readonly campuses?: { readonly name: string } | null;
      readonly courses: { readonly name: string } | null;
    } | null;
  }>;
}

interface MockSupabaseData {
  readonly events: MockAttendanceEvent[];
  readonly attendanceRecordsByEventId?: Record<
    string,
    Array<{ readonly status: 'present' | 'absent' | 'on_leave' }>
  >;
  readonly enrollmentCountsByClassId?: Record<string, number>;
  /** `academy_exam_classes` join `academy_exams` 回來的樣子 */
  readonly examsByClassId?: Record<string, string[]>;
}

function createAttendanceTestApp(supabase: ReturnType<typeof createMockSupabase>) {
  const app = new Hono();

  app.use('/api/attendance/*', async (c, next) => {
    const context = c as unknown as { set: (key: string, value: unknown) => void };
    context.set('supabase', supabase);
    context.set('orgId', 'org-1');
    context.set('userId', 'user-1');
    context.set('roles', ['admin']);
    await next();
  });

  app.route('/api/attendance', attendanceApp);

  return app;
}

function createMockSupabase(data: MockSupabaseData) {
  return {
    from(table: string) {
      if (table === 'sessions') {
        return createSessionsQuery(data);
      }

      if (table === 'events') {
        return createEventsQuery(data);
      }

      if (table === 'attendance_records') {
        return createAttendanceRecordsQuery(data);
      }

      if (table === 'enrollments') {
        return createEnrollmentsQuery(data);
      }

      if (table === 'academy_exam_classes') {
        return createExamClassesQuery(data);
      }

      throw new Error(`Unsupported table: ${table}`);
    },
  };
}

function createEventsQuery(data: MockSupabaseData) {
  const state = {
    orgId: '',
    campusId: null as string | null,
    dateFrom: null as string | null,
    dateTo: null as string | null,
    courseIds: [] as string[],
    classIds: [] as string[],
    statuses: [] as string[],
    rangeFrom: 0,
    rangeTo: Number.MAX_SAFE_INTEGER,
  };

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      if (column === 'org_id') state.orgId = String(value);
      if (column === 'campus_id' || column === 'sessions.classes.campus_id') {
        state.campusId = String(value);
      }
      return query;
    },
    gte(column: string, value: string) {
      if (column === 'event_date') state.dateFrom = value;
      return query;
    },
    lte(column: string, value: string) {
      if (column === 'event_date') state.dateTo = value;
      return query;
    },
    in(column: string, values: string[]) {
      if (column === 'sessions.classes.course_id') state.courseIds = values;
      if (column === 'sessions.class_id') state.classIds = values;
      if (column === 'sessions.status') state.statuses = values;
      return query;
    },
    order() {
      return query;
    },
    range(from: number, to: number) {
      state.rangeFrom = from;
      state.rangeTo = to;
      return query;
    },
    single() {
      const filtered = data.events.filter((event) => {
        return (
          event.org_id === state.orgId && (!state.campusId || event.campus_id === state.campusId)
        );
      });

      return Promise.resolve({
        data: filtered[0] ?? null,
        error: filtered[0] ? null : { message: 'not found' },
      });
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: MockAttendanceEvent[];
            error: null;
            count: number;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const filtered = data.events.filter((event) => {
        const session = event.sessions[0];
        const courseId = session?.classes?.course_id;
        const classCampusId = session?.classes?.campus_id;
        const classId = session?.class_id;
        const status = session?.status;

        return (
          event.org_id === state.orgId &&
          (!state.campusId || event.campus_id === state.campusId) &&
          (!state.dateFrom || event.event_date >= state.dateFrom) &&
          (!state.dateTo || event.event_date <= state.dateTo) &&
          (state.courseIds.length === 0 || (!!courseId && state.courseIds.includes(courseId))) &&
          (state.classIds.length === 0 || (!!classId && state.classIds.includes(classId))) &&
          (state.statuses.length === 0 || (!!status && state.statuses.includes(status)))
        );
      });

      const paginated = filtered.slice(state.rangeFrom, state.rangeTo + 1);

      return Promise.resolve({
        data: paginated,
        error: null,
        count: filtered.length,
      }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createSessionsQuery(data: MockSupabaseData) {
  const state = {
    orgId: '',
    campusId: null as string | null,
    dateFrom: null as string | null,
    dateTo: null as string | null,
    eventIdIsNull: false,
    courseIds: [] as string[],
    classIds: [] as string[],
    statuses: [] as string[],
    rangeFrom: 0,
    rangeTo: Number.MAX_SAFE_INTEGER,
  };

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      if (column === 'org_id') state.orgId = String(value);
      if (column === 'classes.campus_id') state.campusId = String(value);
      return query;
    },
    gte(column: string, value: string) {
      if (column === 'session_date') state.dateFrom = value;
      return query;
    },
    lte(column: string, value: string) {
      if (column === 'session_date') state.dateTo = value;
      return query;
    },
    is(column: string, value: unknown) {
      if (column === 'event_id' && value === null) {
        state.eventIdIsNull = true;
      }
      return query;
    },
    in(column: string, values: string[]) {
      if (column === 'classes.course_id') state.courseIds = values;
      if (column === 'class_id') state.classIds = values;
      if (column === 'status') state.statuses = values;
      return query;
    },
    order() {
      return query;
    },
    range(from: number, to: number) {
      state.rangeFrom = from;
      state.rangeTo = to;
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: Array<{
              id: string;
              event_id: string | null;
              teacher_id: string | null;
              teacher: { readonly display_name: string } | null;
              schedules: { readonly teacher_id: string | null } | null;
              session_date: string;
              start_time: string | null;
              end_time: string | null;
              status: 'scheduled' | 'completed' | 'cancelled';
              class_id: string;
              classes: MockAttendanceEvent['sessions'][number]['classes'];
              events: {
                id: string;
                event_date: string;
                start_time: string | null;
                end_time: string | null;
                attendance_taken_at: string | null;
                campus_id: string | null;
                campuses: { readonly name: string } | null;
              } | null;
            }>;
            error: null;
            count: number;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const filtered = data.events
        .flatMap((event) =>
          event.sessions.map((session, index) => ({
            id: `${event.id}-session-${index}`,
            event_id: session.hasEvent === false ? null : event.id,
            teacher_id: session.teacher_id ?? null,
            teacher: session.teacher ?? null,
            schedules: session.schedules ?? null,
            session_date: event.event_date,
            start_time: event.start_time,
            end_time: event.end_time,
            status: session.status,
            class_id: session.class_id,
            classes: session.classes,
            events:
              session.hasEvent === false
                ? null
                : {
                    id: event.id,
                    event_date: event.event_date,
                    start_time: event.start_time,
                    end_time: event.end_time,
                    attendance_taken_at: event.attendance_taken_at,
                    campus_id: event.campus_id,
                    campuses: event.campuses,
                  },
            org_id: event.org_id,
          })),
        )
        .filter((session) => {
          const courseId = session.classes?.course_id;
          const classCampusId = session.classes?.campus_id ?? null;

          return (
            session.org_id === state.orgId &&
            (!state.campusId || classCampusId === state.campusId) &&
            (!state.eventIdIsNull || session.event_id === null) &&
            (!state.dateFrom || session.session_date >= state.dateFrom) &&
            (!state.dateTo || session.session_date <= state.dateTo) &&
            (state.courseIds.length === 0 || (!!courseId && state.courseIds.includes(courseId))) &&
            (state.classIds.length === 0 || state.classIds.includes(session.class_id)) &&
            (state.statuses.length === 0 || state.statuses.includes(session.status))
          );
        });

      const paginated = filtered.slice(state.rangeFrom, state.rangeTo + 1);

      return Promise.resolve({
        data: paginated,
        error: null,
        count: filtered.length,
      }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createAttendanceRecordsQuery(data: MockSupabaseData) {
  const state = {
    eventId: '',
    orgId: '',
    // 課堂列表改成批次查詢之後走這條：一次撈多個 event 的出勤，回傳帶 event_id 的列
    eventIds: null as string[] | null,
  };

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      if (column === 'event_id') state.eventId = String(value);
      if (column === 'org_id') state.orgId = String(value);
      return query;
    },
    in(column: string, values: readonly string[]) {
      if (column === 'event_id') state.eventIds = [...values];
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: Array<{ readonly status: 'present' | 'absent' | 'on_leave' }>;
            error: null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const byEvent = data.attendanceRecordsByEventId ?? {};
      const rows =
        state.orgId !== 'org-1'
          ? []
          : state.eventIds !== null
            ? state.eventIds.flatMap((eventId) =>
                (byEvent[eventId] ?? []).map((row) => ({ ...row, event_id: eventId })),
              )
            : (byEvent[state.eventId] ?? []);

      return Promise.resolve({
        data: rows,
        error: null,
      }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createEnrollmentsQuery(data: MockSupabaseData) {
  const state = {
    classId: '',
    classIds: null as string[] | null,
  };

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      if (column === 'class_id') state.classId = String(value);
      return query;
    },
    in(column: string, values: readonly string[]) {
      if (column === 'class_id') state.classIds = [...values];
      return query;
    },
    lte() {
      return query;
    },
    or() {
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            count: number | null;
            data: Array<Record<string, unknown>> | null;
            error: null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const counts = data.enrollmentCountsByClassId ?? {};

      // 批次版：課堂列表現在撈的是**生效區間的列**再在記憶體裡數，不是每班一次 count。
      // fixture 仍然只給「某班有幾人」，所以這裡把它展開成 n 筆不設區間的列 ——
      // 區間本身的邏輯由 lib/session-roster.spec.ts 守
      if (state.classIds !== null) {
        const rows = state.classIds.flatMap((classId) =>
          Array.from({ length: counts[classId] ?? 0 }, () => ({
            class_id: classId,
            effective_from: '1970-01-01',
            effective_to: null,
          })),
        );
        return Promise.resolve({ count: rows.length, data: rows, error: null }).then(
          onfulfilled,
          onrejected,
        );
      }

      return Promise.resolve({
        count: counts[state.classId] ?? 0,
        data: null,
        error: null,
      }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

/**
 * `academy_exam_classes` 的假查詢。日期區間的過濾在真實世界由 PostgREST 做，
 * 這裡照做一次 —— 不做的話「用這一頁的日期區間去撈」這件事就沒被驗到。
 */
function createExamClassesQuery(data: MockSupabaseData) {
  const state = {
    classIds: [] as string[],
    dateFrom: null as string | null,
    dateTo: null as string | null,
  };

  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    in(column: string, values: string[]) {
      if (column === 'class_id') state.classIds = values;
      return query;
    },
    gte(_column: string, value: string) {
      state.dateFrom = value;
      return query;
    },
    lte(_column: string, value: string) {
      state.dateTo = value;
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: Array<{ class_id: string; academy_exams: { exam_date: string } }>;
            error: null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const rows = Object.entries(data.examsByClassId ?? {})
        .filter(([classId]) => state.classIds.includes(classId))
        .flatMap(([classId, dates]) =>
          dates
            .filter(
              (date) =>
                (!state.dateFrom || date >= state.dateFrom) &&
                (!state.dateTo || date <= state.dateTo),
            )
            .map((date) => ({ class_id: classId, academy_exams: { exam_date: date } })),
        );

      return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function buildEvent(input: {
  id: string;
  classId: string;
  className: string;
  courseId: string;
  courseName: string;
  sessionStatus: 'scheduled' | 'completed' | 'cancelled';
  /** 呼叫端本來就在傳這個欄位，但先前的簽章沒有它，於是被靜默忽略、日期永遠是同一天。 */
  eventDate?: string;
  teacherId?: string | null;
  teacherName?: string | null;
  scheduleTeacherId?: string | null;
  hasEvent?: boolean;
}): MockAttendanceEvent {
  const eventDate = input.eventDate ?? '2026-04-02';
  return {
    id: input.id,
    org_id: 'org-1',
    event_date: eventDate,
    start_time: '09:00:00',
    end_time: '11:00:00',
    attendance_taken_at: input.sessionStatus === 'completed' ? `${eventDate}T09:00:00Z` : null,
    campus_id: '11111111-1111-4111-8111-111111111111',
    campuses: { name: '示範分校' },
    sessions: [
      {
        class_id: input.classId,
        status: input.sessionStatus,
        teacher_id: input.teacherId ?? null,
        teacher: input.teacherName ? { display_name: input.teacherName } : null,
        schedules:
          input.scheduleTeacherId === undefined ? null : { teacher_id: input.scheduleTeacherId },
        hasEvent: input.hasEvent,
        classes: {
          name: input.className,
          course_id: input.courseId,
          campus_id: '11111111-1111-4111-8111-111111111111',
          campuses: { name: '示範分校' },
          courses: { name: input.courseName },
        },
      },
    ],
  };
}

/**
 * `recorded_by_role` 原本三處人工寫入點一律寫死 `'admin'`，即使按下按鈕的是老師。
 *
 * **這條只能在路由層守。** `resolveRecordedByRole` 的單元測試證明它會回 `'teacher'`，
 * 但證不出「路由真的把 roles 傳給它」—— 寫死 `'admin'` 的那個版本一樣通過所有
 * 純函式測試。錯在接線那一層，測試就得跨到那一層。
 */
describe('PATCH /api/attendance/batch —— recorded_by_role', () => {
  function createBatchApp(roles: string[], teachesThisClass = true) {
    const upserted: Array<Record<string, unknown>> = [];
    // 補登窗是按台北日期算的，所以測試也要用台北的今天
    // （`getCurrentTaipeiDateString` 在 attendance.ts 裡是私有的，這裡照抄一次）
    const eventDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(
      new Date(),
    );

    const supabase = {
      from(table: string) {
        const query: Record<string, unknown> = {
          select: () => query,
          eq: () => query,
          in: () => query,
          lte: () => query,
          gte: () => query,
          is: () => query,
          order: () => query,
          or: () => query,
          not: () => query,
          limit: () => query,
          update: () => query,
          maybeSingle: () =>
            Promise.resolve({
              // `staff` 是範圍檢查用的（assertTeacherCanWriteAttendance 要拿呼叫者的
              // staff.id）；其餘是組織的點名設定：老師負責點名、當天可改，
              // 讓流程走得到 upsert
              data:
                table === 'staff'
                  ? { id: 'staff-1' }
                  : { attendance_responsible: 'teacher', attendance_retroactive_days: 0 },
              error: null,
            }),
          single: () =>
            Promise.resolve({
              data: {
                id: 'event-1',
                attendance_taken_at: null,
                event_date: eventDate,
                start_time: '09:00',
                sessions: [{ class_id: 'class-1', classes: { name: 'Ｇ', courses: null } }],
              },
              error: null,
            }),
          upsert: (rows: Array<Record<string, unknown>>) => {
            if (table === 'attendance_records') upserted.push(...rows);
            return Promise.resolve({ error: null });
          },
          insert: () => Promise.resolve({ error: null }),
          then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) =>
            Promise.resolve({
              data:
                table === 'enrollments'
                  ? [{ student_id: 'stu-1' }]
                  : table === 'sessions'
                    ? // 這堂課的授課老師。`teachesThisClass` false 時換成別人，
                      // 用來驗「不是自己的課就不能寫」
                      [
                        {
                          teacher_id: teachesThisClass ? 'staff-1' : 'someone-else',
                          schedules: { teacher_id: teachesThisClass ? 'staff-1' : 'someone-else' },
                        },
                      ]
                    : [],
            }).then(onfulfilled ?? undefined),
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
      context.set('roles', roles);
      await next();
    });
    app.route('/api/attendance', attendanceApp);

    return { app, upserted };
  }

  async function save(roles: string[], teachesThisClass = true) {
    const { app, upserted } = createBatchApp(roles, teachesThisClass);
    const response = await app.request(
      '/api/attendance/batch',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: '00000000-0000-4000-8000-000000000001',
          updates: [{ studentId: 'stu-1', status: 'present' }],
        }),
      },
      undefined,
      // 這支端點的稽核紀錄用 c.executionCtx.waitUntil，沒有它會丟例外。
      // Workers 上一定有；測試要自己給一個
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );
    return { status: response.status, upserted };
  }

  it('老師點的名記成 teacher，不是 admin', async () => {
    const { status, upserted } = await save(['teacher']);

    expect(status).toBe(200);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]?.['recorded_by_role']).toBe('teacher');
  });

  /**
   * 範圍限制原本只擋讀不擋寫：清單會縮到自己的課，但這支寫入端點只檢查時窗。
   * 老師在畫面上看不到別班，可是清單本來就回傳 `eventId`，換一個值就改得動。
   * 見 kb/wiki/architecture/authorization-scope.md 洞 4。
   */
  it('老師不能點別班的名，即使拿得到 eventId', async () => {
    const { status, upserted } = await save(['teacher'], false);

    expect(status).toBe(403);
    expect(upserted).toHaveLength(0);
  });

  it('管理員不受這個範圍限制', async () => {
    expect((await save(['admin'], false)).status).toBe(200);
  });

  it('管理員點的名記成 admin', async () => {
    const { upserted } = await save(['admin']);

    expect(upserted[0]?.['recorded_by_role']).toBe('admin');
  });
});

/**
 * roster 的請假推導。
 *
 * **這條只能在路由層守**：`leaveCoversSession` 的單元測試證明日期/時間的重疊算對了，
 * 但證不出「roster 真的去查了 leave_requests」—— 完全不查的版本一樣通過那些測試。
 * 而這張單要修的洞正是「沒有人去查」（請假連動只寫得到當下已存在的 event，
 * 而出勤事件是懶生成的）。
 */
describe('GET /api/attendance/roster/{eventId} —— 請假推導', () => {
  function createRosterApp(leaveRows: Array<Record<string, unknown>>) {
    const queriedTables: string[] = [];

    const supabase = {
      from(table: string) {
        queriedTables.push(table);
        const query: Record<string, unknown> = {
          select: () => query,
          eq: () => query,
          in: () => query,
          lte: () => query,
          gte: () => query,
          or: () => query,
          single: () =>
            Promise.resolve({
              data: {
                id: 'event-1',
                event_date: '2026-04-06',
                start_time: '09:00',
                end_time: '11:00',
                attendance_taken_at: null,
                sessions: [{ class_id: 'class-1' }],
              },
              error: null,
            }),
          then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
            const data =
              table === 'enrollments'
                ? [{ student_id: 'stu-1', students: { name: '王小明', grade: 'J1' } }]
                : table === 'leave_requests'
                  ? leaveRows
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
      await next();
    });
    app.route('/api/attendance', attendanceApp);

    return { app, queriedTables };
  }

  async function roster(leaveRows: Array<Record<string, unknown>>) {
    const { app, queriedTables } = createRosterApp(leaveRows);
    const response = await app.request('/api/attendance/roster/event-1');
    const payload = (await response.json()) as {
      students: Array<{
        studentId: string;
        status: string | null;
        hasLeaveRequest: boolean;
        leaveEndDate: string | null;
      }>;
    };
    return { payload, queriedTables };
  }

  it('沒有點名紀錄、但當天有假 —— 仍然標得出來', async () => {
    // 這就是原本的洞：請假在課堂 event 生成之前建立，連動一筆都沒寫到
    const { payload, queriedTables } = await roster([
      {
        student_id: 'stu-1',
        start_date: '2026-04-06',
        end_date: '2026-04-06',
        start_time: null,
        end_time: null,
      },
    ]);

    expect(queriedTables).toContain('leave_requests');
    expect(payload.students[0]).toMatchObject({
      studentId: 'stu-1',
      // 紀錄上什麼都沒有 —— 這正是「未點名」
      status: null,
      hasLeaveRequest: true,
    });
  });

  it('回請假的結束日 —— 讓前端能在按下銷假之前警告會取消到哪一天', async () => {
    const { payload } = await roster([
      {
        student_id: 'stu-1',
        start_date: '2026-04-04',
        end_date: '2026-04-08',
        start_time: null,
        end_time: null,
      },
    ]);

    expect(payload.students[0]).toMatchObject({
      hasLeaveRequest: true,
      leaveEndDate: '2026-04-08',
    });
  });

  it('同一天被兩張假蓋到時，回最晚的那個結束日', async () => {
    // 銷假會把兩張都動到 —— 警告要說出「最遠會取消到哪」，不是隨便挑一張
    const { payload } = await roster([
      {
        student_id: 'stu-1',
        start_date: '2026-04-06',
        end_date: '2026-04-06',
        start_time: null,
        end_time: null,
      },
      {
        student_id: 'stu-1',
        start_date: '2026-04-05',
        end_date: '2026-04-10',
        start_time: null,
        end_time: null,
      },
    ]);

    expect(payload.students[0]?.leaveEndDate).toBe('2026-04-10');
  });

  it('沒有假時 leaveEndDate 是 null', async () => {
    const { payload } = await roster([]);

    expect(payload.students[0]).toMatchObject({ hasLeaveRequest: false, leaveEndDate: null });
  });

  it('假沒蓋到這堂課的時段就不標', async () => {
    const { payload } = await roster([
      {
        student_id: 'stu-1',
        start_date: '2026-04-06',
        end_date: '2026-04-06',
        start_time: '13:00',
        end_time: '17:00',
      },
    ]);

    expect(payload.students[0]?.hasLeaveRequest).toBe(false);
  });

  it('沒有假就是 false，不是 undefined', async () => {
    const { payload } = await roster([]);

    expect(payload.students[0]?.hasLeaveRequest).toBe(false);
  });
});

/**
 * 銷假端點的接線。
 *
 * 純函式（`cancel-leave-for-date.spec.ts`）守的是「哪一天要怎麼縮」，
 * 這裡守的是**它有沒有被正確地接上**：授權、只銷當天、以及
 * **on_leave 紀錄是被刪掉而不是改成 absent**（後者是「系統替老師寫一個相反的謊」，
 * 而純函式完全看不到這件事）。
 */
describe('POST /api/attendance/roster/{eventId}/cancel-leave', () => {
  function createCancelApp(options: {
    roles: string[];
    eventDate: string;
    leaves: Array<Record<string, unknown>>;
    ownStaffId?: string | null;
  }) {
    const calls: Array<{ table: string; op: string; payload?: unknown }> = [];

    const supabase = {
      from(table: string) {
        const query: Record<string, unknown> = {
          select: () => query,
          eq: () => query,
          in: () => query,
          lte: () => query,
          gte: () => query,
          maybeSingle: () =>
            Promise.resolve({ data: options.ownStaffId ? { id: options.ownStaffId } : null }),
          single: () =>
            Promise.resolve({
              data: { id: 'event-1', event_date: options.eventDate },
              error: null,
            }),
          update: (payload: unknown) => {
            calls.push({ table, op: 'update', payload });
            return query;
          },
          delete: () => {
            calls.push({ table, op: 'delete' });
            return query;
          },
          insert: () => Promise.resolve({ error: null }),
          then: (onfulfilled?: ((value: { data: unknown[]; error: null }) => unknown) | null) => {
            const data =
              table === 'leave_requests'
                ? options.leaves
                : table === 'events'
                  ? [{ id: 'event-1' }]
                  : table === 'sessions'
                    ? [{ teacher_id: options.ownStaffId ?? null, schedules: null }]
                    : table === 'attendance_records'
                      ? [{ id: 'rec-1' }]
                      : [];
            return Promise.resolve({ data, error: null }).then(onfulfilled ?? undefined);
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
      context.set('roles', options.roles);
      await next();
    });
    app.route('/api/attendance', attendanceApp);

    return { app, calls };
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

  async function cancel(options: Parameters<typeof createCancelApp>[0]) {
    const { app, calls } = createCancelApp(options);
    const response = await app.request(
      '/api/attendance/roster/event-1/cancel-leave',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: 'stu-1' }),
      },
      undefined,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );
    return { status: response.status, body: await response.json().catch(() => null), calls };
  }

  it('單日的假整張刪掉，並把 on_leave 紀錄刪除（不是改成 absent）', async () => {
    const { status, body, calls } = await cancel({
      roles: ['admin'],
      eventDate: today,
      leaves: [{ id: 'leave-1', start_date: today, end_date: today }],
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      leavesDeleted: 1,
      leavesTruncated: 0,
      attendanceRecordsRemoved: 1,
      droppedAfter: null,
    });

    // 紀錄要被**刪掉**：寫 absent 等於系統替老師寫一個相反的謊
    expect(calls).toContainEqual({ table: 'attendance_records', op: 'delete' });
    expect(
      calls.filter((call) => call.table === 'attendance_records' && call.op === 'update'),
    ).toHaveLength(0);
  });

  it('今天卡在跨日假的中間 —— 截到昨天並回報被連坐的後段', async () => {
    const { body, calls } = await cancel({
      roles: ['admin'],
      eventDate: '2026-04-06',
      leaves: [{ id: 'leave-1', start_date: '2026-04-04', end_date: '2026-04-08' }],
    });

    expect(body).toMatchObject({
      leavesDeleted: 0,
      leavesTruncated: 1,
      droppedAfter: '2026-04-08',
    });
    expect(calls).toContainEqual({
      table: 'leave_requests',
      op: 'update',
      payload: { start_date: '2026-04-04', end_date: '2026-04-05' },
    });
  });

  it('沒有假可以銷 → 404，不會去動任何紀錄', async () => {
    const { status, calls } = await cancel({
      roles: ['admin'],
      eventDate: today,
      leaves: [],
    });

    expect(status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('老師不能銷別班的假', async () => {
    const { status } = await cancel({
      roles: ['teacher'],
      eventDate: today,
      leaves: [{ id: 'leave-1', start_date: today, end_date: today }],
      // 這堂課的老師是別人（sessions 回的 teacher_id 是 null）
      ownStaffId: null,
    });

    expect(status).toBe(403);
  });

  it('老師不能銷別天的假 —— 依據是「他人就在我面前」', async () => {
    const { status } = await cancel({
      roles: ['teacher'],
      eventDate: '2026-04-06',
      leaves: [{ id: 'leave-1', start_date: '2026-04-06', end_date: '2026-04-06' }],
      ownStaffId: 'staff-1',
    });

    expect(status).toBe(403);
  });
});
