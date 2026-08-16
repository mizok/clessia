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
            then(onfulfilled?: ((value: { data: typeof sessions; error: null }) => unknown) | null) {
              return Promise.resolve({ data: sessions, error: null }).then(onfulfilled ?? undefined);
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
          event.org_id === state.orgId &&
          (!state.campusId || event.campus_id === state.campusId)
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
              event_id: string;
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
              };
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
            event_id: event.id,
            session_date: event.event_date,
            start_time: event.start_time,
            end_time: event.end_time,
            status: session.status,
            class_id: session.class_id,
            classes: session.classes,
            events: {
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
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: Array<{ readonly status: 'present' | 'absent' | 'on_leave' }>;
            error: null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const rows =
        state.orgId === 'org-1' ? (data.attendanceRecordsByEventId?.[state.eventId] ?? []) : [];

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
  };

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      if (column === 'class_id') state.classId = String(value);
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
        | ((value: { count: number; data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({
        count: data.enrollmentCountsByClassId?.[state.classId] ?? 0,
        data: null,
        error: null,
      }).then(onfulfilled, onrejected);
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
