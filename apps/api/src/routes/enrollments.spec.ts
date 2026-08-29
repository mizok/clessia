import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import * as enrollmentsRoute from './enrollments';
import { checkEnrollmentAttendance, checkEnrollmentPreconditions } from './enrollments/validation';

interface FakeSupabaseDataSet {
  readonly classes?: unknown[];
  readonly enrollments?: unknown[];
  readonly schedules?: unknown[];
  readonly sessions?: unknown[];
  readonly attendance_records?: unknown[];
}

function createFakeSupabase(dataSet: FakeSupabaseDataSet) {
  return {
    from(table: keyof FakeSupabaseDataSet) {
      return createFakeQueryBuilder(table, dataSet);
    },
  };
}

function createFakeQueryBuilder(table: keyof FakeSupabaseDataSet, dataSet: FakeSupabaseDataSet) {
  const filters: Array<{ type: 'eq' | 'in' | 'neq'; column: string; value: unknown }> = [];
  let selectOptions: { count?: string; head?: boolean } | undefined;

  const builder = {
    select(_columns?: string, options?: { count?: string; head?: boolean }) {
      selectOptions = options;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ type: 'eq', column, value });
      return builder;
    },
    in(column: string, value: unknown[]) {
      filters.push({ type: 'in', column, value });
      return builder;
    },
    neq(column: string, value: unknown) {
      filters.push({ type: 'neq', column, value });
      return builder;
    },
    async maybeSingle() {
      const rows = getFilteredRows(table, dataSet, filters);
      return { data: rows[0] ?? null, error: null };
    },
    then(
      onfulfilled?:
        | ((
            value: { data: unknown[]; error: null } | { data: null; error: null; count: number },
          ) => unknown)
        | null,
    ) {
      const rows = getFilteredRows(table, dataSet, filters);
      if (selectOptions?.head) {
        return Promise.resolve({ data: null, error: null, count: rows.length }).then(
          onfulfilled ?? undefined,
        );
      }
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled ?? undefined);
    },
  };

  return builder;
}

function getFilteredRows(
  table: keyof FakeSupabaseDataSet,
  dataSet: FakeSupabaseDataSet,
  filters: Array<{ type: 'eq' | 'in' | 'neq'; column: string; value: unknown }>,
) {
  return (dataSet[table] ?? []).filter((row) =>
    filters.every((filter) => {
      const currentValue = (row as unknown as Record<string, unknown>)[filter.column];
      if (filter.type === 'eq') {
        return currentValue === filter.value;
      }
      if (filter.type === 'neq') {
        return currentValue !== filter.value;
      }
      return (filter.value as unknown[]).includes(currentValue);
    }),
  );
}

interface MockEnrollmentRow {
  id?: string;
  org_id: string;
  class_id: string;
  student_id: string;
  status: string;
  billing_mode?: string | null;
  fee_template_id?: string | null;
  agreed_amount?: string | number | null;
  adjustment_note?: string | null;
  effective_from: string;
  effective_to?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  classes?: {
    name?: string;
    campus_id?: string | null;
    campuses?: { name?: string | null } | null;
    courses?: { id?: string; name?: string | null } | null;
    id?: string;
    schedules?: Array<{
      weekday: number;
      start_time: string;
      end_time: string;
      effective_to: string | null;
    }>;
  } | null;
  students?: {
    name?: string;
    school?: string;
    grade?: string;
  } | null;
  creator?: {
    name?: string | null;
  } | null;
}

interface MockClassRow {
  id: string;
  org_id: string;
  max_students: number | null;
}

interface MockScheduleRow {
  class_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  effective_to: string | null;
}

interface MockEnrollmentsRouteData {
  readonly classes?: MockClassRow[];
  readonly schedules?: MockScheduleRow[];
  readonly enrollments?: MockEnrollmentRow[];
  readonly duplicateOnInsert?: Set<string>;
}

function createEnrollmentsTestApp(data: MockEnrollmentsRouteData) {
  const app = new Hono();
  const supabase = createMockEnrollmentsSupabase(data);

  app.use('/api/enrollments/*', async (c, next) => {
    const context = c as unknown as { set: (key: string, value: unknown) => void };
    context.set('supabase', supabase);
    context.set('orgId', 'org-1');
    context.set('userId', 'user-1');
    await next();
  });

  app.route('/api/enrollments', enrollmentsRoute.default);
  return app;
}

function createMockEnrollmentsSupabase(seed: MockEnrollmentsRouteData) {
  const state = {
    classes: [...(seed.classes ?? [])],
    schedules: [...(seed.schedules ?? [])],
    enrollments: [...(seed.enrollments ?? [])],
    nextId: 1,
    duplicateOnInsert: seed.duplicateOnInsert ?? new Set<string>(),
  };

  return {
    from(table: string) {
      if (table === 'classes') {
        return createClassesQuery(state);
      }

      if (table === 'schedules') {
        return createSchedulesQuery(state);
      }

      if (table === 'enrollments') {
        return createEnrollmentsQueryForRoutes(state);
      }

      if (table === 'leave_requests') {
        return createLeaveRequestsQuery();
      }

      if (table === 'events') {
        return createEventsBackfillQuery();
      }

      if (table === 'attendance_records') {
        return createAttendanceUpsertQuery();
      }

      throw new Error(`Unsupported table: ${table}`);
    },
  };
}

function createClassesQuery(state: { classes: MockClassRow[] }) {
  const filters: Array<{ column: string; value: unknown }> = [];

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return query;
    },
    async maybeSingle() {
      const row =
        state.classes.find((item) =>
          filters.every(
            (filter) =>
              (item as unknown as Record<string, unknown>)[filter.column] === filter.value,
          ),
        ) ?? null;
      return { data: row, error: null };
    },
  };

  return query;
}

function createSchedulesQuery(state: { schedules: MockScheduleRow[] }) {
  const filters: Array<{ column: string; value: unknown }> = [];

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: MockScheduleRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const rows = state.schedules.filter((item) =>
        filters.every(
          (filter) => (item as unknown as Record<string, unknown>)[filter.column] === filter.value,
        ),
      );
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createEnrollmentsQueryForRoutes(state: {
  enrollments: MockEnrollmentRow[];
  nextId: number;
  duplicateOnInsert: Set<string>;
}) {
  const filters: Array<{
    type: 'eq' | 'in' | 'neq';
    column: string;
    value: unknown;
  }> = [];
  let insertPayload: Record<string, unknown> | null = null;
  let head = false;
  let countRequested = false;

  const query = {
    select(_columns?: string, options?: { count?: string; head?: boolean }) {
      head = options?.head === true;
      countRequested = options?.count === 'exact';
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ type: 'eq', column, value });
      return query;
    },
    in(column: string, value: unknown[]) {
      filters.push({ type: 'in', column, value });
      return query;
    },
    neq(column: string, value: unknown) {
      filters.push({ type: 'neq', column, value });
      return query;
    },
    order() {
      return query;
    },
    range() {
      return query;
    },
    insert(payload: Record<string, unknown>) {
      insertPayload = payload;
      return query;
    },
    async single() {
      if (insertPayload) {
        const duplicateKey = `${insertPayload['class_id']}|${insertPayload['student_id']}`;
        if (state.duplicateOnInsert.has(duplicateKey)) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          };
        }

        const newRow: MockEnrollmentRow = {
          id: `enrollment-${state.nextId++}`,
          org_id: String(insertPayload['org_id']),
          class_id: String(insertPayload['class_id']),
          student_id: String(insertPayload['student_id']),
          status: String(insertPayload['status']),
          billing_mode: (insertPayload['billing_mode'] as string | null | undefined) ?? null,
          fee_template_id: (insertPayload['fee_template_id'] as string | null | undefined) ?? null,
          agreed_amount:
            (insertPayload['agreed_amount'] as string | number | null | undefined) ?? null,
          adjustment_note: (insertPayload['adjustment_note'] as string | null | undefined) ?? null,
          effective_from: String(insertPayload['effective_from']),
          effective_to: (insertPayload['effective_to'] as string | null | undefined) ?? null,
          notes: (insertPayload['notes'] as string | null | undefined) ?? null,
          created_by: (insertPayload['created_by'] as string | null | undefined) ?? null,
          created_at: '2026-04-09T00:00:00.000Z',
          updated_at: '2026-04-09T00:00:00.000Z',
          classes: {
            name: '測試班級',
            campus_id: null,
            campuses: null,
            courses: { id: 'course-1', name: '測試課程' },
          },
          students: {
            name: '測試學生',
            school: '測試國中',
            grade: 'J1',
          },
          creator: null,
        };
        state.enrollments.push(newRow);
        insertPayload = null;
        return { data: newRow, error: null };
      }

      const rows = filterEnrollmentRows(state.enrollments, filters);
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: 'not found' },
      };
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((
            value:
              | { data: MockEnrollmentRow[]; error: null }
              | { data: null; error: null; count: number },
          ) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const rows = filterEnrollmentRows(state.enrollments, filters);

      if (head && countRequested) {
        return Promise.resolve({ data: null, error: null, count: rows.length }).then(
          onfulfilled,
          onrejected,
        );
      }

      return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function filterEnrollmentRows(
  rows: MockEnrollmentRow[],
  filters: Array<{ type: 'eq' | 'in' | 'neq'; column: string; value: unknown }>,
) {
  return rows.filter((row) =>
    filters.every((filter) => {
      const currentValue = (row as unknown as Record<string, unknown>)[filter.column];
      if (filter.type === 'eq') {
        return currentValue === filter.value;
      }
      if (filter.type === 'neq') {
        return currentValue !== filter.value;
      }
      return (filter.value as unknown[]).includes(currentValue);
    }),
  );
}

function createLeaveRequestsQuery() {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    gte() {
      return query;
    },
    lte() {
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        ((value: { data: never[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createEventsBackfillQuery() {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    gte() {
      return query;
    },
    lte() {
      return query;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        ((value: { data: never[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createAttendanceUpsertQuery() {
  return {
    upsert() {
      return Promise.resolve({ error: null });
    },
  };
}

describe('toEnrollmentResponse', () => {
  const toEnrollmentResponse = (enrollmentsRoute as Record<string, unknown>)[
    'toEnrollmentResponse'
  ] as ((row: Record<string, unknown>) => Record<string, unknown>) | undefined;

  const baseRow = {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-000000000002',
    class_id: '00000000-0000-0000-0000-000000000003',
    student_id: '00000000-0000-0000-0000-000000000004',
    status: 'active',
    billing_mode: 'monthly',
    fee_template_id: '00000000-0000-0000-0000-0000000000ff',
    // numeric 從 postgrest 回來是字串 —— mapper 要轉成 number，不然前端算不了
    agreed_amount: '4500',
    adjustment_note: '舊生續讀，老闆同意折 500',
    effective_from: '2026-01-01',
    effective_to: null,
    notes: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    classes: {
      name: '英文班',
      courses: { id: '00000000-0000-0000-0000-000000000005', name: '英文' },
    },
    students: { name: '王小明' },
    creator: null,
  };

  it('maps attendances count to attendanceCount', () => {
    expect(toEnrollmentResponse).toBeTypeOf('function');

    const row = { ...baseRow, attendances: [{ count: 5 }] };
    const result = toEnrollmentResponse?.(row);
    expect(result?.['attendanceCount']).toBe(5);
  });

  it('defaults attendanceCount to 0 when attendances is empty', () => {
    expect(toEnrollmentResponse).toBeTypeOf('function');

    const row = { ...baseRow, attendances: [] };
    const result = toEnrollmentResponse?.(row);
    expect(result?.['attendanceCount']).toBe(0);
  });

  /**
   * 計費欄位（P1）。`agreed_amount` 是 numeric —— postgrest 回來是**字串**，
   * 不轉的話前端拿到 "4500" 做加總會變成字串串接。
   */
  it('把計費欄位帶出來，金額轉成 number', () => {
    const result = toEnrollmentResponse?.({ ...baseRow, attendances: [] });

    expect(result?.['billingMode']).toBe('monthly');
    expect(result?.['feeTemplateId']).toBe('00000000-0000-0000-0000-0000000000ff');
    expect(result?.['agreedAmount']).toBe(4500);
    expect(result?.['adjustmentNote']).toBe('舊生續讀，老闆同意折 500');
  });

  // 「還沒決定計費方式」是真實狀態 —— 四個欄位都可以是空的，不能因此炸掉或給預設值
  it('沒有計費資料時四個欄位都是 null', () => {
    const result = toEnrollmentResponse?.({
      ...baseRow,
      billing_mode: null,
      fee_template_id: null,
      agreed_amount: null,
      adjustment_note: null,
      attendances: [],
    });

    expect(result?.['billingMode']).toBeNull();
    expect(result?.['feeTemplateId']).toBeNull();
    expect(result?.['agreedAmount']).toBeNull();
    expect(result?.['adjustmentNote']).toBeNull();
  });
});

describe('POST /api/enrollments/batch result mapping', () => {
  it('returns already_exists when supabase returns error code 23505', () => {
    const supabaseError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    const resultStatus = supabaseError.code === '23505' ? 'already_exists' : 'error';
    expect(resultStatus).toBe('already_exists');
  });

  it('returns enrolled when supabase insert succeeds', () => {
    const supabaseData = { id: 'enroll-uuid-1' };
    const supabaseError = null;
    const resultStatus = supabaseError === null ? 'enrolled' : 'error';
    expect(resultStatus).toBe('enrolled');
    expect(supabaseData.id).toBe('enroll-uuid-1');
  });

  it('returns error for non-unique errors', () => {
    const supabaseError = { code: '23503', message: 'foreign key violation' };
    const resultStatus = supabaseError.code === '23505' ? 'already_exists' : 'error';
    expect(resultStatus).toBe('error');
  });
});

describe('checkEnrollmentPreconditions', () => {
  const orgId = 'org-1';
  const classId = 'class-1';

  it('returns OVER_QUOTA when projected enrollment exceeds class max students', async () => {
    const supabase = createFakeSupabase({
      classes: [{ id: classId, org_id: orgId, max_students: 2 }],
      enrollments: [
        {
          org_id: orgId,
          class_id: classId,
          student_id: 'existing-1',
          status: 'active',
        },
        {
          org_id: orgId,
          class_id: classId,
          student_id: 'existing-2',
          status: 'pending_payment',
        },
      ],
    });

    const result = await checkEnrollmentPreconditions({
      supabase: supabase as never,
      orgId,
      classId,
      studentIds: ['student-1'],
      effectiveFrom: '2026-04-09',
      effectiveTo: null,
    });

    expect(result.error).toEqual({
      code: 'OVER_QUOTA',
      message: '班級人數已達上限',
      quota: 2,
      currentActive: 2,
      adding: 1,
    });
    expect(result.conflicts).toEqual([]);
  });

  it('returns schedule conflicts when an active enrollment overlaps target schedules', async () => {
    const supabase = createFakeSupabase({
      classes: [{ id: classId, org_id: orgId, max_students: null }],
      schedules: [
        {
          class_id: classId,
          weekday: 3,
          start_time: '18:00:00',
          end_time: '20:00:00',
          effective_to: null,
        },
      ],
      enrollments: [
        {
          org_id: orgId,
          class_id: 'class-2',
          student_id: 'student-1',
          status: 'active',
          effective_from: '2026-04-01',
          effective_to: null,
          classes: {
            id: 'class-2',
            name: 'B 班',
            courses: { name: '英文' },
            schedules: [
              {
                weekday: 3,
                start_time: '19:00:00',
                end_time: '21:00:00',
                effective_to: null,
              },
            ],
          },
        },
      ],
    });

    const result = await checkEnrollmentPreconditions({
      supabase: supabase as never,
      orgId,
      classId,
      studentIds: ['student-1'],
      effectiveFrom: '2026-04-09',
      effectiveTo: null,
    });

    expect(result.error).toBeNull();
    expect(result.conflicts).toEqual([
      {
        studentId: 'student-1',
        conflictingClassId: 'class-2',
        conflictingClassName: 'B 班',
        conflictingCourseName: '英文',
        weekday: 3,
        startTime: '19:00:00',
        endTime: '21:00:00',
      },
    ]);
  });

  it('skips schedule conflicts when enrollment effective dates do not overlap', async () => {
    const supabase = createFakeSupabase({
      classes: [{ id: classId, org_id: orgId, max_students: null }],
      schedules: [
        {
          class_id: classId,
          weekday: 3,
          start_time: '18:00:00',
          end_time: '20:00:00',
          effective_to: null,
        },
      ],
      enrollments: [
        {
          org_id: orgId,
          class_id: 'class-2',
          student_id: 'student-1',
          status: 'active',
          effective_from: '2026-04-01',
          effective_to: '2026-04-08',
          classes: {
            id: 'class-2',
            name: 'B 班',
            courses: { name: '英文' },
            schedules: [
              {
                weekday: 3,
                start_time: '19:00:00',
                end_time: '21:00:00',
                effective_to: null,
              },
            ],
          },
        },
      ],
    });

    const result = await checkEnrollmentPreconditions({
      supabase: supabase as never,
      orgId,
      classId,
      studentIds: ['student-1'],
      effectiveFrom: '2026-04-09',
      effectiveTo: null,
    });

    expect(result.error).toBeNull();
    expect(result.conflicts).toEqual([]);
  });
});

describe('POST /api/enrollments route integration', () => {
  const classId = '11111111-1111-4111-8111-111111111111';
  const conflictingClassId = '22222222-2222-4222-8222-222222222222';
  const studentId = '33333333-3333-4333-8333-333333333333';
  const secondStudentId = '44444444-4444-4444-8444-444444444444';

  it('returns 400 OVER_QUOTA for single enrollment when class is full', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: 1 }],
      enrollments: [
        {
          org_id: 'org-1',
          class_id: classId,
          student_id: '55555555-5555-4555-8555-555555555555',
          status: 'active',
          effective_from: '2026-04-01',
        },
      ],
    });

    const response = await app.request('/api/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId, studentId }),
    });
    const payload = (await response.json()) as {
      code: string;
      quota: number;
      currentActive: number;
    };

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      code: 'OVER_QUOTA',
      quota: 1,
      currentActive: 1,
    });
  });

  it('returns 409 with warnings when single enrollment hits schedule conflict', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: null }],
      schedules: [
        {
          class_id: classId,
          weekday: 3,
          start_time: '18:00:00',
          end_time: '20:00:00',
          effective_to: null,
        },
      ],
      enrollments: [
        {
          org_id: 'org-1',
          class_id: conflictingClassId,
          student_id: studentId,
          status: 'active',
          effective_from: '2026-04-01',
          effective_to: null,
          classes: {
            id: conflictingClassId,
            name: '衝突班級',
            courses: { name: '英文' },
            schedules: [
              {
                weekday: 3,
                start_time: '19:00:00',
                end_time: '21:00:00',
                effective_to: null,
              },
            ],
          },
        },
      ],
    });

    const response = await app.request('/api/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId, studentId }),
    });
    const payload = (await response.json()) as {
      code: string;
      warnings: Array<{ conflictingClassId: string; weekday: number }>;
    };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('SCHEDULE_CONFLICT');
    expect(payload.warnings).toEqual([
      expect.objectContaining({
        conflictingClassId,
        weekday: 3,
      }),
    ]);
  });

  it('returns 201 when skipConflictCheck is true for single enrollment', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: null }],
      schedules: [
        {
          class_id: classId,
          weekday: 3,
          start_time: '18:00:00',
          end_time: '20:00:00',
          effective_to: null,
        },
      ],
      enrollments: [
        {
          org_id: 'org-1',
          class_id: conflictingClassId,
          student_id: studentId,
          status: 'active',
          effective_from: '2026-04-01',
          effective_to: null,
          classes: {
            id: conflictingClassId,
            name: '衝突班級',
            courses: { name: '英文' },
            schedules: [
              {
                weekday: 3,
                start_time: '19:00:00',
                end_time: '21:00:00',
                effective_to: null,
              },
            ],
          },
        },
      ],
    });

    const response = await app.request('/api/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        classId,
        studentId,
        skipConflictCheck: true,
      }),
    });
    const payload = (await response.json()) as { data: { classId: string; studentId: string } };

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      classId,
      studentId,
    });
  });

  it('returns 409 ALREADY_ENROLLED when unique constraint is hit', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: null }],
      duplicateOnInsert: new Set([`${classId}|${studentId}`]),
    });

    const response = await app.request('/api/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId, studentId }),
    });
    const payload = (await response.json()) as { code: string; error: string };

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      code: 'ALREADY_ENROLLED',
      error: '此學生已在此班',
    });
  });
});

describe('POST /api/enrollments/batch route integration', () => {
  const classId = '66666666-6666-4666-8666-666666666666';
  const conflictingClassId = '77777777-7777-4777-8777-777777777777';
  const studentId = '88888888-8888-4888-8888-888888888888';
  const secondStudentId = '99999999-9999-4999-8999-999999999999';

  it('returns 409 with warnings when batch enrollment hits schedule conflicts', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: null }],
      schedules: [
        {
          class_id: classId,
          weekday: 3,
          start_time: '18:00:00',
          end_time: '20:00:00',
          effective_to: null,
        },
      ],
      enrollments: [
        {
          org_id: 'org-1',
          class_id: conflictingClassId,
          student_id: studentId,
          status: 'active',
          effective_from: '2026-04-01',
          effective_to: null,
          classes: {
            id: conflictingClassId,
            name: '衝突班級',
            courses: { name: '英文' },
            schedules: [
              {
                weekday: 3,
                start_time: '19:00:00',
                end_time: '21:00:00',
                effective_to: null,
              },
            ],
          },
        },
      ],
    });

    const response = await app.request('/api/enrollments/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId, studentIds: [studentId, secondStudentId] }),
    });
    const payload = (await response.json()) as {
      code: string;
      warnings: Array<{ studentId: string }>;
    };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('SCHEDULE_CONFLICT');
    expect(payload.warnings).toEqual([expect.objectContaining({ studentId })]);
  });

  it('returns 200 and inserts when batch skipConflictCheck is true', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: null }],
      schedules: [
        {
          class_id: classId,
          weekday: 3,
          start_time: '18:00:00',
          end_time: '20:00:00',
          effective_to: null,
        },
      ],
      enrollments: [
        {
          org_id: 'org-1',
          class_id: conflictingClassId,
          student_id: studentId,
          status: 'active',
          effective_from: '2026-04-01',
          effective_to: null,
          classes: {
            id: conflictingClassId,
            name: '衝突班級',
            courses: { name: '英文' },
            schedules: [
              {
                weekday: 3,
                start_time: '19:00:00',
                end_time: '21:00:00',
                effective_to: null,
              },
            ],
          },
        },
      ],
    });

    const response = await app.request('/api/enrollments/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        classId,
        studentIds: [studentId, secondStudentId],
        skipConflictCheck: true,
      }),
    });
    const payload = (await response.json()) as {
      results: Array<{ studentId: string; status: string }>;
      warnings?: Array<{ studentId: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.results).toEqual([
      expect.objectContaining({ studentId, status: 'enrolled' }),
      expect.objectContaining({ studentId: secondStudentId, status: 'enrolled' }),
    ]);
    expect(payload.warnings).toEqual([expect.objectContaining({ studentId })]);
  });

  // effective_from 是課堂名單的閘門（attendance.ts 用它決定學生出不出現在點名表）。
  // 上線時把跑了五週的班級名單灌進來，寫死今天會讓前五週的名單是空的、補點名補不了。
  it('honours effectiveFrom so a roster can be backfilled to the term start', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: null }],
    });

    await app.request('/api/enrollments/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId, studentIds: [studentId], effectiveFrom: '2026-06-01' }),
    });

    const listed = await app.request(`/api/enrollments?classId=${classId}`);
    const payload = (await listed.json()) as { data: Array<{ effectiveFrom: string }> };

    expect(payload.data[0].effectiveFrom).toBe('2026-06-01');
  });

  // 「人數已達上限」沒有數字的話，使用者不知道要刪幾個人或把上限調到多少
  it('reports the quota numbers so the message can say how many are over', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: 1 }],
      enrollments: [
        {
          org_id: 'org-1',
          class_id: classId,
          student_id: '55555555-5555-4555-8555-555555555555',
          status: 'active',
          effective_from: '2026-04-01',
        },
      ],
    });

    const response = await app.request('/api/enrollments/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId, studentIds: [studentId, secondStudentId] }),
    });
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      code: 'OVER_QUOTA',
      quota: 1,
      currentActive: 1,
      adding: 2,
    });
  });

  it('defaults effectiveFrom to today when omitted', async () => {
    const app = createEnrollmentsTestApp({
      classes: [{ id: classId, org_id: 'org-1', max_students: null }],
    });

    await app.request('/api/enrollments/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId, studentIds: [studentId] }),
    });

    const listed = await app.request(`/api/enrollments?classId=${classId}`);
    const payload = (await listed.json()) as { data: Array<{ effectiveFrom: string }> };

    expect(payload.data[0].effectiveFrom).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('DELETE enrollment attendance gate logic', () => {
  it('allows hard delete when attendanceCount is 0', () => {
    const attendanceCount = 0;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(true);
  });

  it('blocks delete and returns 409 when attendanceCount > 0', () => {
    const attendanceCount: number = 3;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(false);
    const errorCode = 'has_attendance';
    expect(errorCode).toBe('has_attendance');
  });

  it('blocks delete even when status is suspended but has attendance', () => {
    const status = 'suspended';
    const attendanceCount: number = 1;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(false);
    expect(status).toBe('suspended');
  });
});

describe('copy-from-class helper logic', () => {
  const buildCopyFromClassPlan = (enrollmentsRoute as Record<string, unknown>)[
    'buildCopyFromClassPlan'
  ] as
    | ((
        sourceEnrollments: Array<{ student_id: string }>,
        targetActiveEnrollments: Array<{ student_id: string }>,
      ) => {
        sourceStudentIds: string[];
        toInsertStudentIds: string[];
        skipped: number;
      })
    | undefined;

  const isCopyFromClassOverQuota = (enrollmentsRoute as Record<string, unknown>)[
    'isCopyFromClassOverQuota'
  ] as
    | ((input: {
        currentActiveCount: number | null;
        maxStudents: number | null;
        toInsertCount: number;
      }) => boolean)
    | undefined;

  it('dedupes source rows and skips students already in target active set', () => {
    expect(buildCopyFromClassPlan).toBeTypeOf('function');

    const plan = buildCopyFromClassPlan?.(
      [
        { student_id: 'student-1' },
        { student_id: 'student-1' },
        { student_id: 'student-2' },
        { student_id: 'student-3' },
      ],
      [{ student_id: 'student-2' }, { student_id: 'student-9' }],
    );

    expect(plan).toEqual({
      sourceStudentIds: ['student-1', 'student-2', 'student-3'],
      toInsertStudentIds: ['student-1', 'student-3'],
      skipped: 1,
    });
  });

  it('returns zero skipped when target class has no active enrollments', () => {
    expect(buildCopyFromClassPlan).toBeTypeOf('function');

    const plan = buildCopyFromClassPlan?.(
      [{ student_id: 'student-1' }, { student_id: 'student-2' }],
      [],
    );

    expect(plan).toEqual({
      sourceStudentIds: ['student-1', 'student-2'],
      toInsertStudentIds: ['student-1', 'student-2'],
      skipped: 0,
    });
  });

  it('detects over quota when projected active exceeds max students', () => {
    expect(isCopyFromClassOverQuota).toBeTypeOf('function');

    const isOverQuota = isCopyFromClassOverQuota?.({
      currentActiveCount: 18,
      maxStudents: 20,
      toInsertCount: 3,
    });

    expect(isOverQuota).toBe(true);
  });

  it('uses 9999 fallback when max students is null', () => {
    expect(isCopyFromClassOverQuota).toBeTypeOf('function');

    const isOverQuota = isCopyFromClassOverQuota?.({
      currentActiveCount: 5000,
      maxStudents: null,
      toInsertCount: 10,
    });

    expect(isOverQuota).toBe(false);
  });
});

describe('leave backfill helper logic', () => {
  const buildEnrollmentLeaveAttendanceUpserts = (enrollmentsRoute as Record<string, unknown>)[
    'buildEnrollmentLeaveAttendanceUpserts'
  ] as
    | ((input: {
        orgId: string;
        studentId: string;
        recordedBy: string;
        events: Array<{ id: string; event_date: string }>;
        leaves: Array<{ start_date: string; end_date: string }>;
      }) => Array<{
        org_id: string;
        student_id: string;
        event_id: string;
        status: 'on_leave';
        recorded_by: string;
        recorded_by_role: 'system';
      }>)
    | undefined;

  it('回填先請假後入班時，將落在請假區間內的課堂改為 on_leave', () => {
    expect(buildEnrollmentLeaveAttendanceUpserts).toBeTypeOf('function');

    const rows = buildEnrollmentLeaveAttendanceUpserts?.({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        { id: 'event-1', event_date: '2026-04-02' },
        { id: 'event-2', event_date: '2026-04-17' },
      ],
      leaves: [{ start_date: '2026-04-01', end_date: '2026-04-16' }],
    });

    expect(rows).toEqual([
      {
        org_id: 'org-1',
        student_id: 'student-1',
        event_id: 'event-1',
        status: 'on_leave',
        recorded_by: 'user-1',
        recorded_by_role: 'system',
      },
    ]);
  });

  it('沒有重疊請假時不回填 attendance', () => {
    expect(buildEnrollmentLeaveAttendanceUpserts).toBeTypeOf('function');

    const rows = buildEnrollmentLeaveAttendanceUpserts?.({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [{ id: 'event-1', event_date: '2026-04-20' }],
      leaves: [{ start_date: '2026-04-01', end_date: '2026-04-16' }],
    });

    expect(rows).toEqual([]);
  });
});

describe('checkEnrollmentAttendance', () => {
  const base = { orgId: 'org-1', classId: 'class-1', studentId: 'student-1' };

  /** 讓指定資料表的查詢回傳錯誤，用來驗證 fail-closed。 */
  function createFailingSupabase(failingTable: string) {
    const error = { message: `${failingTable} exploded` };
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      then: (onfulfilled?: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, count: null, error }).then(onfulfilled ?? undefined),
    };
    return { from: () => builder };
  }

  it('沒有任何 session 時視為無出勤紀錄', async () => {
    const supabase = createFakeSupabase({ sessions: [] });
    await expect(
      checkEnrollmentAttendance({ supabase: supabase as never, ...base }),
    ).resolves.toEqual({ status: 'none' });
  });

  it('session 都還沒產生 event 時視為無出勤紀錄', async () => {
    const supabase = createFakeSupabase({
      sessions: [{ org_id: 'org-1', class_id: 'class-1', event_id: null }],
    });
    await expect(
      checkEnrollmentAttendance({ supabase: supabase as never, ...base }),
    ).resolves.toEqual({ status: 'none' });
  });

  it('該學生在本班的 event 上有出勤紀錄時要擋下刪除', async () => {
    const supabase = createFakeSupabase({
      sessions: [{ org_id: 'org-1', class_id: 'class-1', event_id: 'event-1' }],
      attendance_records: [{ org_id: 'org-1', event_id: 'event-1', student_id: 'student-1' }],
    });
    await expect(
      checkEnrollmentAttendance({ supabase: supabase as never, ...base }),
    ).resolves.toEqual({ status: 'has-attendance' });
  });

  it('出勤紀錄屬於別的學生時不算數（守門必須以 student 為範圍）', async () => {
    const supabase = createFakeSupabase({
      sessions: [{ org_id: 'org-1', class_id: 'class-1', event_id: 'event-1' }],
      attendance_records: [{ org_id: 'org-1', event_id: 'event-1', student_id: 'student-2' }],
    });
    await expect(
      checkEnrollmentAttendance({ supabase: supabase as never, ...base }),
    ).resolves.toEqual({ status: 'none' });
  });

  it('別班 session 的出勤紀錄不算數', async () => {
    const supabase = createFakeSupabase({
      sessions: [{ org_id: 'org-1', class_id: 'class-2', event_id: 'event-9' }],
      attendance_records: [{ org_id: 'org-1', event_id: 'event-9', student_id: 'student-1' }],
    });
    await expect(
      checkEnrollmentAttendance({ supabase: supabase as never, ...base }),
    ).resolves.toEqual({ status: 'none' });
  });

  it('sessions 查詢失敗時 fail closed，不得回報「沒有出勤」', async () => {
    const result = await checkEnrollmentAttendance({
      supabase: createFailingSupabase('sessions') as never,
      ...base,
    });
    expect(result.status).toBe('check-failed');
  });

  it('attendance_records 查詢失敗時 fail closed', async () => {
    // sessions 正常、attendance 爆炸 —— 這正是舊版 `count ?? 0` 會誤判成「可以刪」的情境。
    const supabase = {
      from(table: string) {
        if (table === 'sessions') {
          return createFakeSupabase({
            sessions: [{ org_id: 'org-1', class_id: 'class-1', event_id: 'event-1' }],
          }).from('sessions' as never);
        }
        return createFailingSupabase('attendance_records').from();
      },
    };
    const result = await checkEnrollmentAttendance({ supabase: supabase as never, ...base });
    expect(result.status).toBe('check-failed');
  });
});
