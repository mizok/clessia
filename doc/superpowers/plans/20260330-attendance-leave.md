# 出勤紀錄 & 請假管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實作管理端出勤紀錄（`/admin/attendance`）與請假管理（`/admin/leave`），以及系統設定頁的出勤模式切換，包含完整的 DB schema、後端 API、前端介面。

**Architecture:** 新增 `events` 抽象表作為所有可出勤事件的父表，`sessions` 掛載 `event_id`，`attendance_records` 統一參考 `event_id`。請假提交即生效並自動更新出勤狀態。出勤模式（日到班/隨堂點名）為組織層級設定，存於 `organizations.attendance_mode`。

**Tech Stack:** Supabase PostgreSQL migrations、Hono OpenAPIHono（zod-openapi）、Angular 21 Standalone Components、Signals、PrimeNG 21、RxJS HTTP

**Spec:** `doc/superpowers/specs/20260330-attendance-leave-design.md`

---

## File Map

### 新增（後端）
- `apps/api/src/routes/org-settings.ts` — 組織設定 GET/PATCH
- `apps/api/src/routes/attendance.ts` — 出勤紀錄 CRUD
- `apps/api/src/routes/leaves.ts` — 請假管理 CRUD
- `apps/api/src/routes/daily-checkins.ts` — 日到班打卡

### 修改（後端）
- `apps/api/src/index.ts` — 註冊新路由

### 新增（DB）
- `supabase/migrations/20260330000001_create_events.sql`
- `supabase/migrations/20260330000002_sessions_add_event_id.sql`
- `supabase/migrations/20260330000003_create_attendance_records.sql`
- `supabase/migrations/20260330000004_create_leave_requests.sql`
- `supabase/migrations/20260330000005_create_daily_checkins.sql`
- `supabase/migrations/20260330000006_org_attendance_mode.sql`

### 新增（前端 Services）
- `apps/web/src/app/core/org-settings.service.ts`
- `apps/web/src/app/core/attendance.service.ts`
- `apps/web/src/app/core/leave.service.ts`

### 修改（前端）
- `apps/web/src/app/features/admin/pages/settings/settings.page.ts` — 加出勤模式切換
- `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts` — 完整實作
- `apps/web/src/app/features/admin/pages/leave/leave.page.ts` — 完整實作
- `apps/web/src/app/features/admin/pages/leave/leave.page.html` — 完整實作

### 新增（前端）
- `apps/web/src/app/features/admin/pages/attendance/attendance.page.html`
- `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss`
- `apps/web/src/app/features/admin/pages/leave/leave-form-dialog.component.ts`

---

## Task 1: DB Migration — events 表 + enums + org attendance_mode

**Files:**
- Create: `supabase/migrations/20260330000001_create_events.sql`
- Create: `supabase/migrations/20260330000006_org_attendance_mode.sql`

- [ ] **Step 1: 建立 events migration**

建立 `supabase/migrations/20260330000001_create_events.sql`：

```sql
-- ============================================================
-- event_type enum
-- ============================================================
CREATE TYPE public.event_type AS ENUM ('session', 'mock_exam');

-- ============================================================
-- events 表（所有可出勤事件的父表）
-- 業務表不使用 RLS，授權邏輯在 Hono middleware 層
-- ============================================================
CREATE TABLE public.events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type  public.event_type NOT NULL,
  title       text NOT NULL,
  campus_id   uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  event_date  date NOT NULL,
  start_time  time,
  end_time    time,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_org_date_idx ON public.events (org_id, event_date);
CREATE INDEX events_campus_idx ON public.events (campus_id);

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

- [ ] **Step 2: 建立 org attendance_mode migration**

建立 `supabase/migrations/20260330000006_org_attendance_mode.sql`：

```sql
-- ============================================================
-- attendance_mode enum
-- ============================================================
CREATE TYPE public.attendance_mode AS ENUM ('per_session', 'daily_checkin');

-- ============================================================
-- 為 organizations 加入 attendance_mode 欄位
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN attendance_mode public.attendance_mode NOT NULL DEFAULT 'per_session';
```

- [ ] **Step 3: 套用 migration**

```bash
cd /path/to/clessia
supabase db reset
```

確認輸出無錯誤，`events` 表和 `organizations.attendance_mode` 均存在。

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260330000001_create_events.sql
git add supabase/migrations/20260330000006_org_attendance_mode.sql
git commit -m "feat(db): add events table and org attendance_mode"
```

---

## Task 2: DB Migration — sessions 掛載 event_id（含 backfill）

**Files:**
- Create: `supabase/migrations/20260330000002_sessions_add_event_id.sql`

- [ ] **Step 1: 建立 sessions backfill migration**

建立 `supabase/migrations/20260330000002_sessions_add_event_id.sql`：

```sql
-- Step 1: 加欄位（nullable，先讓 backfill 可以執行）
ALTER TABLE public.sessions
  ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

-- Step 2: backfill — 為每筆 session 建立對應的 event 記錄
-- 透過 session → class → campus 取得 campus_id
INSERT INTO public.events (org_id, event_type, title, campus_id, event_date, start_time, end_time, created_at, updated_at)
SELECT
  s.org_id,
  'session'::public.event_type,
  cl.name || ' ' || to_char(s.session_date, 'YYYY-MM-DD'),
  cl.campus_id,
  s.session_date,
  s.start_time,
  s.end_time,
  s.created_at,
  s.updated_at
FROM public.sessions s
JOIN public.classes cl ON cl.id = s.class_id
WHERE s.event_id IS NULL;

-- Step 3: 將 event_id 指回剛建立的 events 記錄
UPDATE public.sessions s
SET event_id = e.id
FROM public.events e
WHERE e.org_id = s.org_id
  AND e.event_type = 'session'
  AND e.event_date = s.session_date
  AND e.start_time = s.start_time
  AND e.end_time = s.end_time
  AND s.event_id IS NULL
  AND e.id IN (
    SELECT ev.id FROM public.events ev
    JOIN public.classes cl ON cl.campus_id = ev.campus_id
    WHERE cl.id = s.class_id
    LIMIT 1
  );

-- Step 4: 加 NOT NULL 約束（backfill 完成後）
ALTER TABLE public.sessions
  ALTER COLUMN event_id SET NOT NULL;

CREATE INDEX sessions_event_id_idx ON public.sessions (event_id);
```

- [ ] **Step 2: 套用並驗證**

```bash
supabase db reset
```

執行後確認：
```sql
SELECT COUNT(*) FROM sessions WHERE event_id IS NULL;
-- 應回傳 0
SELECT COUNT(*) FROM events WHERE event_type = 'session';
-- 應等於 SELECT COUNT(*) FROM sessions
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260330000002_sessions_add_event_id.sql
git commit -m "feat(db): backfill sessions.event_id from events table"
```

---

## Task 3: DB Migration — attendance_records、leave_requests、daily_checkins

**Files:**
- Create: `supabase/migrations/20260330000003_create_attendance_records.sql`
- Create: `supabase/migrations/20260330000004_create_leave_requests.sql`
- Create: `supabase/migrations/20260330000005_create_daily_checkins.sql`

- [ ] **Step 1: 建立 attendance_records migration**

建立 `supabase/migrations/20260330000003_create_attendance_records.sql`：

```sql
-- ============================================================
-- attendance_status enum
-- ============================================================
CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'on_leave');

-- ============================================================
-- attendance_records 表
-- ============================================================
CREATE TABLE public.attendance_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status           public.attendance_status NOT NULL DEFAULT 'present',
  note             text,
  recorded_by      text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  recorded_by_role text CHECK (recorded_by_role IN ('teacher', 'admin', 'system')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_records_student_event_unique UNIQUE (student_id, event_id)
);

CREATE INDEX attendance_records_org_event_idx ON public.attendance_records (org_id, event_id);
CREATE INDEX attendance_records_student_idx ON public.attendance_records (student_id);
CREATE INDEX attendance_records_status_idx ON public.attendance_records (status);

CREATE TRIGGER attendance_records_updated_at
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

- [ ] **Step 2: 建立 leave_requests migration**

建立 `supabase/migrations/20260330000004_create_leave_requests.sql`：

```sql
-- ============================================================
-- leave_submitter_role enum
-- ============================================================
CREATE TYPE public.leave_submitter_role AS ENUM ('parent', 'admin');

-- ============================================================
-- leave_requests 表
-- ============================================================
CREATE TABLE public.leave_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id         uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  reason             text,
  submitted_by       text NOT NULL REFERENCES public.ba_user(id) ON DELETE RESTRICT,
  submitted_by_role  public.leave_submitter_role NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_date_range_check CHECK (end_date >= start_date)
);

CREATE INDEX leave_requests_org_date_idx ON public.leave_requests (org_id, start_date, end_date);
CREATE INDEX leave_requests_student_idx ON public.leave_requests (student_id);
```

- [ ] **Step 3: 建立 daily_checkins migration**

建立 `supabase/migrations/20260330000005_create_daily_checkins.sql`：

```sql
-- ============================================================
-- daily_checkins 表（日到班模式用）
-- ============================================================
CREATE TABLE public.daily_checkins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  campus_id     uuid NOT NULL REFERENCES public.campuses(id) ON DELETE CASCADE,
  checkin_date  date NOT NULL,
  checkin_time  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_checkins_student_campus_date_unique UNIQUE (student_id, campus_id, checkin_date)
);

CREATE INDEX daily_checkins_org_date_idx ON public.daily_checkins (org_id, checkin_date);
CREATE INDEX daily_checkins_student_idx ON public.daily_checkins (student_id);
```

- [ ] **Step 4: 套用並驗證**

```bash
supabase db reset
```

確認四張新表均存在且無錯誤。

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260330000003_create_attendance_records.sql
git add supabase/migrations/20260330000004_create_leave_requests.sql
git add supabase/migrations/20260330000005_create_daily_checkins.sql
git commit -m "feat(db): add attendance_records, leave_requests, daily_checkins tables"
```

---

## Task 4: Backend — org-settings 路由

**Files:**
- Create: `apps/api/src/routes/org-settings.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: 寫測試（org-settings）**

建立 `apps/api/src/routes/org-settings.spec.ts`（參考 `campuses.spec.ts` 的測試模式）：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toOrgSettingsResponse } from './org-settings';

describe('toOrgSettingsResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'org-1',
      name: '測試補習班',
      attendance_mode: 'per_session',
    };
    const result = toOrgSettingsResponse(row);
    expect(result).toEqual({
      id: 'org-1',
      name: '測試補習班',
      attendanceMode: 'per_session',
    });
  });

  it('maps daily_checkin mode correctly', () => {
    const row = { id: 'org-1', name: '測試', attendance_mode: 'daily_checkin' };
    expect(toOrgSettingsResponse(row).attendanceMode).toBe('daily_checkin');
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

```bash
cd apps/api && npx vitest run src/routes/org-settings.spec.ts
```

預期：FAIL — `toOrgSettingsResponse is not defined`

- [ ] **Step 3: 建立 org-settings.ts**

建立 `apps/api/src/routes/org-settings.ts`：

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

// ============================================================
// Schemas
// ============================================================

const AttendanceModeSchema = z
  .enum(['per_session', 'daily_checkin'])
  .openapi('AttendanceMode');

const OrgSettingsSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    attendanceMode: AttendanceModeSchema,
  })
  .openapi('OrgSettings');

const UpdateOrgSettingsSchema = z
  .object({
    attendanceMode: AttendanceModeSchema.optional(),
  })
  .openapi('UpdateOrgSettings');

// ============================================================
// Helpers (exported for unit testing)
// ============================================================

export function toOrgSettingsResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    attendanceMode: row['attendance_mode'] as 'per_session' | 'daily_checkin',
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/org/settings
app.openapi(
  createRoute({
    method: 'get',
    path: '/settings',
    tags: ['Org'],
    summary: '取得組織設定',
    responses: {
      200: {
        description: '組織設定',
        content: { 'application/json': { schema: OrgSettingsSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');

    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, attendance_mode')
      .eq('id', orgId)
      .single();

    if (error || !data) {
      return c.json({ error: '讀取組織設定失敗' }, 500);
    }

    return c.json(toOrgSettingsResponse(data), 200);
  },
);

// PATCH /api/org/settings
app.openapi(
  createRoute({
    method: 'patch',
    path: '/settings',
    tags: ['Org'],
    summary: '更新組織設定',
    request: {
      body: { content: { 'application/json': { schema: UpdateOrgSettingsSchema } } },
    },
    responses: {
      200: {
        description: '更新後的組織設定',
        content: { 'application/json': { schema: OrgSettingsSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const updates: Record<string, unknown> = {};
    if (body.attendanceMode !== undefined) {
      updates['attendance_mode'] = body.attendanceMode;
    }

    const { data, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', orgId)
      .select('id, name, attendance_mode')
      .single();

    if (error || !data) {
      return c.json({ error: '更新組織設定失敗' }, 500);
    }

    return c.json(toOrgSettingsResponse(data), 200);
  },
);

export default app;
```

- [ ] **Step 4: 跑測試確認 pass**

```bash
cd apps/api && npx vitest run src/routes/org-settings.spec.ts
```

預期：PASS

- [ ] **Step 5: 在 index.ts 註冊路由**

修改 `apps/api/src/index.ts`，在現有 import 區塊後加入：

```typescript
import orgSettingsRoute from './routes/org-settings';
```

在受保護路由區塊（`app.use('/api/*', authMiddleware)` 之後）加入：

```typescript
app.route('/api/org', orgSettingsRoute);
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/org-settings.ts apps/api/src/routes/org-settings.spec.ts apps/api/src/index.ts
git commit -m "feat(api): add org settings GET/PATCH endpoint"
```

---

## Task 5: Backend — attendance 路由

**Files:**
- Create: `apps/api/src/routes/attendance.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: 寫測試（helpers）**

建立 `apps/api/src/routes/attendance.spec.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { toAttendanceResponse } from './attendance';

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
```

- [ ] **Step 2: 跑測試確認 fail**

```bash
cd apps/api && npx vitest run src/routes/attendance.spec.ts
```

預期：FAIL

- [ ] **Step 3: 建立 attendance.ts**

建立 `apps/api/src/routes/attendance.ts`：

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

// ============================================================
// Schemas
// ============================================================

const AttendanceStatusSchema = z
  .enum(['present', 'absent', 'on_leave'])
  .openapi('AttendanceStatus');

const AttendanceRecordSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string(),
    eventId: z.uuid(),
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    campusName: z.string().nullable(),
    className: z.string().nullable(),
    status: AttendanceStatusSchema,
    note: z.string().nullable(),
    recordedBy: z.string().nullable(),
    recordedByRole: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AttendanceRecord');

const AttendanceListResponseSchema = z
  .object({
    data: z.array(AttendanceRecordSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('AttendanceListResponse');

const UpdateAttendanceSchema = z
  .object({
    status: AttendanceStatusSchema.optional(),
    note: z.string().nullable().optional(),
  })
  .openapi('UpdateAttendance');

const CreateAttendanceSchema = z
  .object({
    studentId: z.uuid(),
    eventId: z.uuid(),
    status: AttendanceStatusSchema,
    note: z.string().nullable().optional(),
  })
  .openapi('CreateAttendance');

// ============================================================
// Helpers (exported for unit testing)
// ============================================================

export function toAttendanceResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    studentId: row['student_id'] as string,
    studentName: row['student_name'] as string,
    eventId: row['event_id'] as string,
    eventDate: row['event_date'] as string,
    startTime: (row['start_time'] as string | null) ?? null,
    endTime: (row['end_time'] as string | null) ?? null,
    campusName: (row['campus_name'] as string | null) ?? null,
    className: (row['class_name'] as string | null) ?? null,
    status: row['status'] as 'present' | 'absent' | 'on_leave',
    note: (row['note'] as string | null) ?? null,
    recordedBy: (row['recorded_by'] as string | null) ?? null,
    recordedByRole: (row['recorded_by_role'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/attendance
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Attendance'],
    summary: '查詢出勤紀錄',
    request: {
      query: z.object({
        campusId: z.uuid().optional(),
        classId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        status: AttendanceStatusSchema.optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '出勤紀錄列表',
        content: { 'application/json': { schema: AttendanceListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { campusId, classId, studentId, dateFrom, dateTo, status, page = 1, pageSize = 20 } =
      c.req.valid('query');

    // 透過 events JOIN sessions JOIN classes 取得豐富資料
    let query = supabase
      .from('attendance_records')
      .select(
        `
        id, org_id, student_id, event_id, status, note, recorded_by, recorded_by_role, created_at, updated_at,
        students!inner(name),
        events!inner(event_date, start_time, end_time, campus_id, campuses(name)),
        events!inner(sessions(class_id, classes(name)))
        `,
        { count: 'exact' },
      )
      .eq('org_id', orgId);

    if (studentId) query = query.eq('student_id', studentId);
    if (status) query = query.eq('status', status);
    if (dateFrom) query = query.gte('events.event_date', dateFrom);
    if (dateTo) query = query.lte('events.event_date', dateTo);
    if (campusId) query = query.eq('events.campus_id', campusId);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1).order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取出勤紀錄失敗', message: error.message }, 500);
    }

    const rows = (data ?? []).map((r: any) => ({
      id: r.id,
      org_id: r.org_id,
      student_id: r.student_id,
      student_name: r.students?.name ?? '',
      event_id: r.event_id,
      event_date: r.events?.event_date ?? '',
      start_time: r.events?.start_time ?? null,
      end_time: r.events?.end_time ?? null,
      campus_name: r.events?.campuses?.name ?? null,
      class_name: r.events?.sessions?.[0]?.classes?.name ?? null,
      status: r.status,
      note: r.note,
      recorded_by: r.recorded_by,
      recorded_by_role: r.recorded_by_role,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    const total = count ?? 0;
    return c.json(
      {
        data: rows.map(toAttendanceResponse),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      },
      200,
    );
  },
);

// POST /api/attendance
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Attendance'],
    summary: '新增出勤紀錄',
    request: {
      body: { content: { 'application/json': { schema: CreateAttendanceSchema } } },
    },
    responses: {
      201: {
        description: '建立的出勤紀錄',
        content: { 'application/json': { schema: AttendanceRecordSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('attendance_records')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        event_id: body.eventId,
        status: body.status,
        note: body.note ?? null,
        recorded_by: userId,
        recorded_by_role: 'admin',
      })
      .select('*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name))')
      .single();

    if (error || !data) {
      return c.json({ error: '新增出勤紀錄失敗', message: error?.message }, 500);
    }

    const row = {
      ...data,
      student_name: (data as any).students?.name ?? '',
      event_date: (data as any).events?.event_date ?? '',
      start_time: (data as any).events?.start_time ?? null,
      end_time: (data as any).events?.end_time ?? null,
      campus_name: (data as any).events?.campuses?.name ?? null,
      class_name: null,
    };

    return c.json(toAttendanceResponse(row), 201);
  },
);

// PATCH /api/attendance/:id
app.openapi(
  createRoute({
    method: 'patch',
    path: '/:id',
    tags: ['Attendance'],
    summary: '修改出勤狀態',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateAttendanceSchema } } },
    },
    responses: {
      200: {
        description: '更新後的出勤紀錄',
        content: { 'application/json': { schema: AttendanceRecordSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const updates: Record<string, unknown> = { recorded_by: userId, recorded_by_role: 'admin' };
    if (body.status !== undefined) updates['status'] = body.status;
    if (body.note !== undefined) updates['note'] = body.note;

    const { data, error } = await supabase
      .from('attendance_records')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name))')
      .single();

    if (error || !data) {
      return c.json({ error: '更新出勤紀錄失敗', message: error?.message }, 500);
    }

    const row = {
      ...data,
      student_name: (data as any).students?.name ?? '',
      event_date: (data as any).events?.event_date ?? '',
      start_time: (data as any).events?.start_time ?? null,
      end_time: (data as any).events?.end_time ?? null,
      campus_name: (data as any).events?.campuses?.name ?? null,
      class_name: null,
    };

    return c.json(toAttendanceResponse(row), 200);
  },
);

export default app;
```

- [ ] **Step 4: 跑測試確認 pass**

```bash
cd apps/api && npx vitest run src/routes/attendance.spec.ts
```

預期：PASS

- [ ] **Step 5: 在 index.ts 註冊路由**

修改 `apps/api/src/index.ts`：

```typescript
import attendanceRoute from './routes/attendance';
// 在受保護路由區塊加入：
app.route('/api/attendance', attendanceRoute);
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/attendance.ts apps/api/src/routes/attendance.spec.ts apps/api/src/index.ts
git commit -m "feat(api): add attendance records CRUD endpoints"
```

---

## Task 6: Backend — leaves 路由 + daily-checkins 路由

**Files:**
- Create: `apps/api/src/routes/leaves.ts`
- Create: `apps/api/src/routes/daily-checkins.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: 寫 leaves 測試**

建立 `apps/api/src/routes/leaves.spec.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { toLeaveResponse } from './leaves';

describe('toLeaveResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'lr-1',
      org_id: 'org-1',
      student_id: 'stu-1',
      student_name: '王小明',
      start_date: '2026-04-01',
      end_date: '2026-04-01',
      reason: '身體不適',
      submitted_by: 'user-1',
      submitted_by_role: 'admin',
      submitted_by_name: '張老師',
      created_at: '2026-04-01T00:00:00Z',
    };
    const result = toLeaveResponse(row);
    expect(result.id).toBe('lr-1');
    expect(result.studentName).toBe('王小明');
    expect(result.submittedByRole).toBe('admin');
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

```bash
cd apps/api && npx vitest run src/routes/leaves.spec.ts
```

- [ ] **Step 3: 建立 leaves.ts**

建立 `apps/api/src/routes/leaves.ts`：

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

// ============================================================
// Schemas
// ============================================================

const LeaveRequestSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    reason: z.string().nullable(),
    submittedBy: z.string(),
    submittedByRole: z.enum(['parent', 'admin']),
    submittedByName: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('LeaveRequest');

const LeaveListResponseSchema = z
  .object({
    data: z.array(LeaveRequestSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('LeaveListResponse');

const CreateLeaveSchema = z
  .object({
    studentId: z.uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().nullable().optional(),
  })
  .openapi('CreateLeave');

// ============================================================
// Helpers (exported for unit testing)
// ============================================================

export function toLeaveResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    studentId: row['student_id'] as string,
    studentName: row['student_name'] as string,
    startDate: row['start_date'] as string,
    endDate: row['end_date'] as string,
    reason: (row['reason'] as string | null) ?? null,
    submittedBy: row['submitted_by'] as string,
    submittedByRole: row['submitted_by_role'] as 'parent' | 'admin',
    submittedByName: (row['submitted_by_name'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/leaves
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Leaves'],
    summary: '查詢請假紀錄',
    request: {
      query: z.object({
        campusId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '請假紀錄列表',
        content: { 'application/json': { schema: LeaveListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { studentId, dateFrom, dateTo, page = 1, pageSize = 20 } = c.req.valid('query');

    let query = supabase
      .from('leave_requests')
      .select(
        `*, students!inner(name), ba_user!submitted_by(name)`,
        { count: 'exact' },
      )
      .eq('org_id', orgId);

    if (studentId) query = query.eq('student_id', studentId);
    if (dateFrom) query = query.gte('start_date', dateFrom);
    if (dateTo) query = query.lte('end_date', dateTo);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1).order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取請假紀錄失敗', message: error.message }, 500);
    }

    const rows = (data ?? []).map((r: any) => ({
      ...r,
      student_name: r.students?.name ?? '',
      submitted_by_name: r.ba_user?.name ?? null,
    }));

    const total = count ?? 0;
    return c.json(
      {
        data: rows.map(toLeaveResponse),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      },
      200,
    );
  },
);

// POST /api/leaves
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Leaves'],
    summary: '新增請假（即生效，自動更新出勤狀態）',
    request: {
      body: { content: { 'application/json': { schema: CreateLeaveSchema } } },
    },
    responses: {
      201: {
        description: '建立的請假紀錄',
        content: { 'application/json': { schema: LeaveRequestSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // 1. 建立請假紀錄
    const { data: leave, error: leaveError } = await supabase
      .from('leave_requests')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        start_date: body.startDate,
        end_date: body.endDate,
        reason: body.reason ?? null,
        submitted_by: userId,
        submitted_by_role: 'admin',
      })
      .select('*, students(name), ba_user!submitted_by(name)')
      .single();

    if (leaveError || !leave) {
      return c.json({ error: '新增請假失敗', message: leaveError?.message }, 500);
    }

    // 2. 自動更新對應日期範圍內的 attendance_records → on_leave
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('org_id', orgId)
      .gte('event_date', body.startDate)
      .lte('event_date', body.endDate);

    if (events && events.length > 0) {
      const eventIds = events.map((e: any) => e.id);
      await supabase
        .from('attendance_records')
        .upsert(
          eventIds.map((eventId: string) => ({
            org_id: orgId,
            student_id: body.studentId,
            event_id: eventId,
            status: 'on_leave',
            recorded_by: userId,
            recorded_by_role: 'system',
          })),
          { onConflict: 'student_id,event_id' },
        );
    }

    const row = {
      ...leave,
      student_name: (leave as any).students?.name ?? '',
      submitted_by_name: (leave as any).ba_user?.name ?? null,
    };

    return c.json(toLeaveResponse(row), 201);
  },
);

// DELETE /api/leaves/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Leaves'],
    summary: '刪除請假（attendance 恢復為 absent）',
    request: {
      params: z.object({ id: z.uuid() }),
    },
    responses: {
      204: { description: '已刪除' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    // 1. 找到這筆請假的 studentId 和日期範圍
    const { data: leave } = await supabase
      .from('leave_requests')
      .select('student_id, start_date, end_date')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!leave) {
      return c.json({ error: '找不到請假紀錄' }, 404);
    }

    // 2. 刪除請假
    await supabase.from('leave_requests').delete().eq('id', id).eq('org_id', orgId);

    // 3. 將對應 attendance_records 的 on_leave 改回 absent
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('org_id', orgId)
      .gte('event_date', (leave as any).start_date)
      .lte('event_date', (leave as any).end_date);

    if (events && events.length > 0) {
      const eventIds = events.map((e: any) => e.id);
      await supabase
        .from('attendance_records')
        .update({ status: 'absent' })
        .eq('student_id', (leave as any).student_id)
        .eq('status', 'on_leave')
        .in('event_id', eventIds);
    }

    return c.body(null, 204);
  },
);

export default app;
```

- [ ] **Step 4: 跑 leaves 測試確認 pass**

```bash
cd apps/api && npx vitest run src/routes/leaves.spec.ts
```

預期：PASS

- [ ] **Step 5: 建立 daily-checkins.ts（基礎版）**

建立 `apps/api/src/routes/daily-checkins.ts`：

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const DailyCheckinSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    studentId: z.uuid(),
    campusId: z.uuid(),
    checkinDate: z.string(),
    checkinTime: z.string(),
    createdAt: z.string(),
  })
  .openapi('DailyCheckin');

const CreateDailyCheckinSchema = z
  .object({
    studentId: z.uuid(),
    campusId: z.uuid(),
    checkinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .openapi('CreateDailyCheckin');

const app = new OpenAPIHono<AppEnv>();

// POST /api/daily-checkins
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['DailyCheckins'],
    summary: '日到班打卡（批次建立當日出勤紀錄）',
    request: {
      body: { content: { 'application/json': { schema: CreateDailyCheckinSchema } } },
    },
    responses: {
      201: {
        description: '打卡紀錄',
        content: { 'application/json': { schema: DailyCheckinSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    // 1. 建立打卡紀錄（UPSERT 防重複）
    const { data: checkin, error } = await supabase
      .from('daily_checkins')
      .upsert(
        {
          org_id: orgId,
          student_id: body.studentId,
          campus_id: body.campusId,
          checkin_date: body.checkinDate,
          checkin_time: new Date().toISOString(),
        },
        { onConflict: 'student_id,campus_id,checkin_date' },
      )
      .select()
      .single();

    if (error || !checkin) {
      return c.json({ error: '打卡失敗', message: error?.message }, 500);
    }

    // 2. 找出該學生當天在此分校的所有 events → 批次建立 attendance_records（present）
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('org_id', orgId)
      .eq('campus_id', body.campusId)
      .eq('event_date', body.checkinDate);

    if (events && events.length > 0) {
      const eventIds = events.map((e: any) => e.id);
      await supabase
        .from('attendance_records')
        .upsert(
          eventIds.map((eventId: string) => ({
            org_id: orgId,
            student_id: body.studentId,
            event_id: eventId,
            status: 'present',
            recorded_by_role: 'system',
          })),
          { onConflict: 'student_id,event_id', ignoreDuplicates: false },
        );
    }

    return c.json(
      {
        id: (checkin as any).id,
        orgId: (checkin as any).org_id,
        studentId: (checkin as any).student_id,
        campusId: (checkin as any).campus_id,
        checkinDate: (checkin as any).checkin_date,
        checkinTime: (checkin as any).checkin_time,
        createdAt: (checkin as any).created_at,
      },
      201,
    );
  },
);

export default app;
```

- [ ] **Step 6: 在 index.ts 註冊所有新路由**

修改 `apps/api/src/index.ts`：

```typescript
import leavesRoute from './routes/leaves';
import dailyCheckinsRoute from './routes/daily-checkins';

// 在受保護路由區塊加入：
app.route('/api/leaves', leavesRoute);
app.route('/api/daily-checkins', dailyCheckinsRoute);
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/leaves.ts apps/api/src/routes/leaves.spec.ts
git add apps/api/src/routes/daily-checkins.ts
git add apps/api/src/index.ts
git commit -m "feat(api): add leaves and daily-checkins endpoints"
```

---

## Task 7: Frontend — OrgSettingsService + SettingsPage 出勤模式切換

**Files:**
- Create: `apps/web/src/app/core/org-settings.service.ts`
- Modify: `apps/web/src/app/features/admin/pages/settings/settings.page.ts`

- [ ] **Step 1: 建立 OrgSettingsService**

建立 `apps/web/src/app/core/org-settings.service.ts`：

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type AttendanceMode = 'per_session' | 'daily_checkin';

export interface OrgSettings {
  id: string;
  name: string;
  attendanceMode: AttendanceMode;
}

export interface UpdateOrgSettingsInput {
  attendanceMode?: AttendanceMode;
}

@Injectable({ providedIn: 'root' })
export class OrgSettingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/org`;

  getSettings(): Observable<OrgSettings> {
    return this.http.get<OrgSettings>(`${this.baseUrl}/settings`);
  }

  updateSettings(input: UpdateOrgSettingsInput): Observable<OrgSettings> {
    return this.http.patch<OrgSettings>(`${this.baseUrl}/settings`, input);
  }
}
```

- [ ] **Step 2: 改寫 SettingsPage**

修改 `apps/web/src/app/features/admin/pages/settings/settings.page.ts`：

```typescript
import { Component, OnInit, inject, signal, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { CardModule } from 'primeng/card';
import { ToastModule } from 'primeng/toast';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageService } from 'primeng/api';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  OrgSettingsService,
  type AttendanceMode,
  type OrgSettings,
} from '@core/org-settings.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, SelectButtonModule, CardModule, ToastModule, SkeletonModule],
  providers: [MessageService],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly messageService = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly settings = signal<OrgSettings | null>(null);
  protected readonly attendanceModeValue = signal<AttendanceMode>('per_session');

  protected readonly attendanceModeOptions = [
    { label: '隨堂點名', value: 'per_session' },
    { label: '日到班', value: 'daily_checkin' },
  ];

  ngOnInit(): void {
    this.orgSettingsService.getSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.attendanceModeValue.set(s.attendanceMode);
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '無法載入系統設定' });
        this.loading.set(false);
      },
    });
  }

  protected saveAttendanceMode(): void {
    this.saving.set(true);
    this.orgSettingsService.updateSettings({ attendanceMode: this.attendanceModeValue() }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.saving.set(false);
        this.messageService.add({ severity: 'success', summary: '已儲存', detail: '出勤模式已更新' });
      },
      error: () => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '儲存失敗，請稍後再試' });
      },
    });
  }
}
```

- [ ] **Step 3: 建立 settings.page.html**

建立 `apps/web/src/app/features/admin/pages/settings/settings.page.html`：

```html
<p-toast />

<div class="settings-page">
  <div class="settings-page__header">
    <h2 class="settings-page__title">{{ page().label }}</h2>
  </div>

  @if (loading()) {
    <div class="settings-page__section">
      <p-skeleton height="2rem" styleClass="mb-2" />
      <p-skeleton height="3rem" />
    </div>
  } @else {
    <div class="settings-page__section">
      <h3 class="settings-page__section-title">出勤紀錄模式</h3>
      <p class="settings-page__section-desc">
        <strong>隨堂點名</strong>：老師在每堂課結束後逐一標記學生出席狀態。<br />
        <strong>日到班</strong>：學生抵達分校打卡後，系統自動勾選當天所有課堂為出席。
      </p>
      <div class="settings-page__control">
        <p-selectbutton
          [options]="attendanceModeOptions"
          [(ngModel)]="attendanceModeValue"
          optionLabel="label"
          optionValue="value"
        />
        <p-button
          label="儲存"
          icon="pi pi-check"
          [loading]="saving()"
          (onClick)="saveAttendanceMode()"
          styleClass="ml-3"
        />
      </div>
    </div>
  }
</div>
```

- [ ] **Step 4: 建立 settings.page.scss**

建立 `apps/web/src/app/features/admin/pages/settings/settings.page.scss`：

```scss
.settings-page {
  padding: var(--space-6);

  &__header {
    margin-bottom: var(--space-6);
  }

  &__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--zinc-900);
    margin: 0;
  }

  &__section {
    background: var(--surface-card);
    border: 1px solid var(--surface-border);
    border-radius: var(--border-radius);
    padding: var(--space-6);
    margin-bottom: var(--space-4);
    max-width: 640px;
  }

  &__section-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--zinc-800);
    margin: 0 0 var(--space-2);
  }

  &__section-desc {
    font-size: 0.875rem;
    color: var(--zinc-500);
    margin: 0 0 var(--space-4);
    line-height: 1.6;
  }

  &__control {
    display: flex;
    align-items: center;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/org-settings.service.ts
git add apps/web/src/app/features/admin/pages/settings/
git commit -m "feat(admin): add attendance mode setting to system settings page"
```

---

## Task 8: Frontend — AttendanceService + AttendancePage

**Files:**
- Create: `apps/web/src/app/core/attendance.service.ts`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts`
- Create: `apps/web/src/app/features/admin/pages/attendance/attendance.page.html`
- Create: `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss`

- [ ] **Step 1: 建立 AttendanceService**

建立 `apps/web/src/app/core/attendance.service.ts`：

```typescript
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type AttendanceStatus = 'present' | 'absent' | 'on_leave';

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '到課',
  absent: '缺席',
  on_leave: '請假',
};

export const ATTENDANCE_STATUS_SEVERITIES: Record<AttendanceStatus, string> = {
  present: 'success',
  absent: 'danger',
  on_leave: 'warn',
};

export interface AttendanceRecord {
  id: string;
  orgId: string;
  studentId: string;
  studentName: string;
  eventId: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  campusName: string | null;
  className: string | null;
  status: AttendanceStatus;
  note: string | null;
  recordedBy: string | null;
  recordedByRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceListResponse {
  data: AttendanceRecord[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface AttendanceQueryParams {
  campusId?: string;
  classId?: string;
  studentId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: AttendanceStatus;
  page?: number;
  pageSize?: number;
}

export interface UpdateAttendanceInput {
  status?: AttendanceStatus;
  note?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/attendance`;

  list(params: AttendanceQueryParams): Observable<AttendanceListResponse> {
    let httpParams = new HttpParams();
    if (params.campusId) httpParams = httpParams.set('campusId', params.campusId);
    if (params.classId) httpParams = httpParams.set('classId', params.classId);
    if (params.studentId) httpParams = httpParams.set('studentId', params.studentId);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.page) httpParams = httpParams.set('page', params.page);
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize);
    return this.http.get<AttendanceListResponse>(this.baseUrl, { params: httpParams });
  }

  update(id: string, input: UpdateAttendanceInput): Observable<AttendanceRecord> {
    return this.http.patch<AttendanceRecord>(`${this.baseUrl}/${id}`, input);
  }
}
```

- [ ] **Step 2: 改寫 AttendancePage**

修改 `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts`：

```typescript
import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { SkeletonModule } from 'primeng/skeleton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { MessageService } from 'primeng/api';
import { format } from 'date-fns';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  AttendanceService,
  type AttendanceRecord,
  type AttendanceStatus,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_SEVERITIES,
} from '@core/attendance.service';
import { CampusesService } from '@core/campuses.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TagModule,
    ToastModule,
    SkeletonModule,
    IconFieldModule,
    InputIconModule,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
  ],
  providers: [MessageService],
  templateUrl: './attendance.page.html',
  styleUrl: './attendance.page.scss',
})
export class AttendancePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);

  protected readonly loading = signal(false);
  protected readonly records = signal<AttendanceRecord[]>([]);
  protected readonly totalRecords = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(20);

  // Filters
  protected readonly filterCampusId = signal<string | null>(null);
  protected readonly filterDateRange = signal<Date[] | null>(null);
  protected readonly filterStatus = signal<AttendanceStatus | null>(null);

  protected readonly campuses = signal<{ label: string; value: string }[]>([]);

  protected readonly statusOptions = [
    { label: '全部狀態', value: null },
    { label: '到課', value: 'present' },
    { label: '缺席', value: 'absent' },
    { label: '請假', value: 'on_leave' },
  ];

  protected readonly paginationConfig = computed<ResponsiveTablePaginationConfig>(() => ({
    totalRecords: this.totalRecords(),
    rows: this.pageSize(),
    page: this.currentPage() - 1,
  }));

  protected readonly ATTENDANCE_STATUS_LABELS = ATTENDANCE_STATUS_LABELS;
  protected readonly ATTENDANCE_STATUS_SEVERITIES = ATTENDANCE_STATUS_SEVERITIES;

  protected readonly statusEditOptions = [
    { label: '到課', value: 'present' },
    { label: '缺席', value: 'absent' },
    { label: '請假', value: 'on_leave' },
  ];

  ngOnInit(): void {
    this.loadCampuses();
    this.loadRecords();
  }

  private loadCampuses(): void {
    this.campusesService.list({ isActive: true }).subscribe({
      next: (res) => {
        this.campuses.set([
          { label: '全部分校', value: '' },
          ...res.data.map((c) => ({ label: c.name, value: c.id })),
        ]);
      },
    });
  }

  protected loadRecords(): void {
    this.loading.set(true);
    const range = this.filterDateRange();
    this.attendanceService
      .list({
        campusId: this.filterCampusId() ?? undefined,
        status: this.filterStatus() ?? undefined,
        dateFrom: range?.[0] ? format(range[0], 'yyyy-MM-dd') : undefined,
        dateTo: range?.[1] ? format(range[1], 'yyyy-MM-dd') : undefined,
        page: this.currentPage(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (res) => {
          this.records.set(res.data);
          this.totalRecords.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: '錯誤', detail: '無法載入出勤紀錄' });
          this.loading.set(false);
        },
      });
  }

  protected onPageChange(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
    this.pageSize.set(event.rows);
    this.loadRecords();
  }

  protected onFilterChange(): void {
    this.currentPage.set(1);
    this.loadRecords();
  }

  protected updateStatus(record: AttendanceRecord, newStatus: AttendanceStatus): void {
    this.attendanceService.update(record.id, { status: newStatus }).subscribe({
      next: (updated) => {
        this.records.update((list) =>
          list.map((r) => (r.id === updated.id ? updated : r)),
        );
        this.messageService.add({ severity: 'success', summary: '已更新', detail: '出勤狀態已修改' });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '更新失敗，請稍後再試' });
      },
    });
  }
}
```

- [ ] **Step 3: 建立 attendance.page.html**

建立 `apps/web/src/app/features/admin/pages/attendance/attendance.page.html`：

```html
<p-toast />

<div class="attendance-page">
  <div class="attendance-page__header">
    <h2 class="attendance-page__title">{{ page().label }}</h2>
  </div>

  <!-- 篩選區 -->
  <div class="attendance-page__filters">
    <p-select
      [options]="campuses()"
      [(ngModel)]="filterCampusId"
      optionLabel="label"
      optionValue="value"
      placeholder="全部分校"
      (onChange)="onFilterChange()"
      styleClass="attendance-page__filter-item"
    />
    <p-datepicker
      [(ngModel)]="filterDateRange"
      selectionMode="range"
      placeholder="日期範圍"
      dateFormat="yy-mm-dd"
      (onClose)="onFilterChange()"
      styleClass="attendance-page__filter-item"
    />
    <p-select
      [options]="statusOptions"
      [(ngModel)]="filterStatus"
      optionLabel="label"
      optionValue="value"
      placeholder="全部狀態"
      (onChange)="onFilterChange()"
      styleClass="attendance-page__filter-item"
    />
    <p-button
      icon="pi pi-refresh"
      severity="secondary"
      (onClick)="onFilterChange()"
      pTooltip="重新整理"
    />
  </div>

  <!-- 資料表 -->
  <app-responsive-table
    [value]="records()"
    [loading]="loading()"
    [pagination]="paginationConfig()"
    (pageChange)="onPageChange($event)"
    emptyMessage="沒有出勤紀錄"
  >
    <ng-template appRtColDef field="studentName" header="學生姓名" />
    <ng-template appRtColDef field="campusName" header="分校" />
    <ng-template appRtColDef field="className" header="班級" />
    <ng-template appRtColDef field="eventDate" header="日期" />
    <ng-template appRtColDef field="time" header="時間" />
    <ng-template appRtColDef field="status" header="狀態" />

    <ng-template appRtColCell field="time" let-row>
      @if (row.startTime && row.endTime) {
        {{ row.startTime }} – {{ row.endTime }}
      } @else {
        —
      }
    </ng-template>

    <ng-template appRtColCell field="status" let-row>
      <p-select
        [options]="statusEditOptions"
        [ngModel]="row.status"
        optionLabel="label"
        optionValue="value"
        (onChange)="updateStatus(row, $event.value)"
        styleClass="attendance-page__status-select"
      >
        <ng-template #selectedItem let-selected>
          <p-tag
            [value]="ATTENDANCE_STATUS_LABELS[row.status]"
            [severity]="ATTENDANCE_STATUS_SEVERITIES[row.status]"
          />
        </ng-template>
      </p-select>
    </ng-template>
  </app-responsive-table>
</div>
```

- [ ] **Step 4: 建立 attendance.page.scss**

建立 `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss`：

```scss
.attendance-page {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--zinc-900);
    margin: 0;
  }

  &__filters {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    align-items: center;
  }

  &__filter-item {
    min-width: 160px;
  }

  &__status-select {
    border: none;
    background: transparent;
    padding: 0;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/attendance.service.ts
git add apps/web/src/app/features/admin/pages/attendance/
git commit -m "feat(admin): implement attendance records page with filters and inline status edit"
```

---

## Task 9: Frontend — LeaveService + LeavePage + LeaveFormDialog

**Files:**
- Create: `apps/web/src/app/core/leave.service.ts`
- Modify: `apps/web/src/app/features/admin/pages/leave/leave.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/leave/leave.page.html`
- Modify: `apps/web/src/app/features/admin/pages/leave/leave.page.scss`
- Create: `apps/web/src/app/features/admin/pages/leave/leave-form-dialog.component.ts`

- [ ] **Step 1: 建立 LeaveService**

建立 `apps/web/src/app/core/leave.service.ts`：

```typescript
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface LeaveRequest {
  id: string;
  orgId: string;
  studentId: string;
  studentName: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  submittedBy: string;
  submittedByRole: 'parent' | 'admin';
  submittedByName: string | null;
  createdAt: string;
}

export interface LeaveListResponse {
  data: LeaveRequest[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface LeaveQueryParams {
  campusId?: string;
  studentId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateLeaveInput {
  studentId: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
}

@Injectable({ providedIn: 'root' })
export class LeaveService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/leaves`;

  list(params: LeaveQueryParams): Observable<LeaveListResponse> {
    let httpParams = new HttpParams();
    if (params.campusId) httpParams = httpParams.set('campusId', params.campusId);
    if (params.studentId) httpParams = httpParams.set('studentId', params.studentId);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    if (params.page) httpParams = httpParams.set('page', params.page);
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize);
    return this.http.get<LeaveListResponse>(this.baseUrl, { params: httpParams });
  }

  create(input: CreateLeaveInput): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(this.baseUrl, input);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
```

- [ ] **Step 2: 建立 LeaveFormDialogComponent**

建立 `apps/web/src/app/features/admin/pages/leave/leave-form-dialog.component.ts`：

```typescript
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { format } from 'date-fns';
import { StudentsService, type Student } from '@core/students.service';
import { LeaveService, type CreateLeaveInput } from '@core/leave.service';

@Component({
  selector: 'app-leave-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    AutoCompleteModule,
    DatePickerModule,
    TextareaModule,
  ],
  template: `
    <div class="leave-form">
      <div class="leave-form__field">
        <label class="leave-form__label">學生 <span class="leave-form__required">*</span></label>
        <p-autocomplete
          [(ngModel)]="selectedStudent"
          [suggestions]="studentSuggestions()"
          (completeMethod)="searchStudents($event)"
          optionLabel="name"
          placeholder="輸入學生姓名搜尋"
          styleClass="w-full"
        />
      </div>

      <div class="leave-form__field">
        <label class="leave-form__label">請假日期 <span class="leave-form__required">*</span></label>
        <p-datepicker
          [(ngModel)]="dateRange"
          selectionMode="range"
          placeholder="選擇日期區間"
          dateFormat="yy-mm-dd"
          styleClass="w-full"
        />
      </div>

      <div class="leave-form__field">
        <label class="leave-form__label">原因（選填）</label>
        <textarea
          pTextarea
          [(ngModel)]="reason"
          placeholder="請假原因"
          rows="3"
          style="width:100%"
        ></textarea>
      </div>

      <div class="leave-form__actions">
        <p-button
          label="取消"
          severity="secondary"
          (onClick)="cancel()"
          [disabled]="saving()"
        />
        <p-button
          label="送出請假"
          icon="pi pi-check"
          [loading]="saving()"
          (onClick)="submit()"
          [disabled]="!canSubmit()"
        />
      </div>
    </div>
  `,
  styles: [`
    .leave-form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      padding: 0.5rem 0;

      &__field { display: flex; flex-direction: column; gap: 0.375rem; }
      &__label { font-size: 0.875rem; font-weight: 500; color: var(--zinc-700); }
      &__required { color: var(--red-500); }
      &__actions { display: flex; justify-content: flex-end; gap: 0.75rem; padding-top: 0.5rem; }
    }
  `],
})
export class LeaveFormDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly studentsService = inject(StudentsService);
  private readonly leaveService = inject(LeaveService);

  protected selectedStudent: Student | null = null;
  protected dateRange: Date[] | null = null;
  protected reason = '';

  protected readonly saving = signal(false);
  protected readonly studentSuggestions = signal<Student[]>([]);

  protected canSubmit(): boolean {
    return !!this.selectedStudent && !!this.dateRange?.[0] && !!this.dateRange?.[1];
  }

  protected searchStudents(event: { query: string }): void {
    this.studentsService.list({ search: event.query, pageSize: 20 }).subscribe({
      next: (res) => this.studentSuggestions.set(res.data),
    });
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);

    const input: CreateLeaveInput = {
      studentId: this.selectedStudent!.id,
      startDate: format(this.dateRange![0], 'yyyy-MM-dd'),
      endDate: format(this.dateRange![1], 'yyyy-MM-dd'),
      reason: this.reason || null,
    };

    this.leaveService.create(input).subscribe({
      next: (leave) => {
        this.saving.set(false);
        this.dialogRef.close(leave);
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }
}
```

- [ ] **Step 3: 改寫 LeavePage**

修改 `apps/web/src/app/features/admin/pages/leave/leave.page.ts`：

```typescript
import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageService, ConfirmationService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { format } from 'date-fns';
import { differenceInDays } from 'date-fns';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  LeaveService,
  type LeaveRequest,
} from '@core/leave.service';
import { CampusesService } from '@core/campuses.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { LeaveFormDialogComponent } from './leave-form-dialog.component';

@Component({
  selector: 'app-leave',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TagModule,
    ToastModule,
    SkeletonModule,
    ConfirmDialogModule,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
  ],
  providers: [MessageService, ConfirmationService, DialogService],
  templateUrl: './leave.page.html',
  styleUrl: './leave.page.scss',
})
export class LeavePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly leaveService = inject(LeaveService);
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);

  protected readonly loading = signal(false);
  protected readonly leaves = signal<LeaveRequest[]>([]);
  protected readonly totalRecords = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(20);

  protected readonly filterCampusId = signal<string | null>(null);
  protected readonly filterDateRange = signal<Date[] | null>(null);
  protected readonly campuses = signal<{ label: string; value: string }[]>([]);

  protected readonly paginationConfig = computed<ResponsiveTablePaginationConfig>(() => ({
    totalRecords: this.totalRecords(),
    rows: this.pageSize(),
    page: this.currentPage() - 1,
  }));

  ngOnInit(): void {
    this.loadCampuses();
    this.loadLeaves();
  }

  private loadCampuses(): void {
    this.campusesService.list({ isActive: true }).subscribe({
      next: (res) => {
        this.campuses.set([
          { label: '全部分校', value: '' },
          ...res.data.map((c) => ({ label: c.name, value: c.id })),
        ]);
      },
    });
  }

  protected loadLeaves(): void {
    this.loading.set(true);
    const range = this.filterDateRange();
    this.leaveService
      .list({
        campusId: this.filterCampusId() ?? undefined,
        dateFrom: range?.[0] ? format(range[0], 'yyyy-MM-dd') : undefined,
        dateTo: range?.[1] ? format(range[1], 'yyyy-MM-dd') : undefined,
        page: this.currentPage(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (res) => {
          this.leaves.set(res.data);
          this.totalRecords.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: '錯誤', detail: '無法載入請假紀錄' });
          this.loading.set(false);
        },
      });
  }

  protected onPageChange(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
    this.pageSize.set(event.rows);
    this.loadLeaves();
  }

  protected onFilterChange(): void {
    this.currentPage.set(1);
    this.loadLeaves();
  }

  protected openCreateDialog(): void {
    const ref = this.dialogService.open(LeaveFormDialogComponent, {
      header: '新增請假',
      width: '480px',
      modal: true,
    });
    ref.onClose.subscribe((result: LeaveRequest | null) => {
      if (result) {
        this.messageService.add({ severity: 'success', summary: '成功', detail: `已為 ${result.studentName} 新增請假` });
        this.loadLeaves();
      }
    });
  }

  protected confirmDelete(leave: LeaveRequest): void {
    this.confirmationService.confirm({
      message: `確定要刪除 ${leave.studentName} 的請假紀錄（${leave.startDate} ~ ${leave.endDate}）？刪除後對應出勤狀態將恢復為缺席。`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      accept: () => this.deleteLeave(leave.id, leave.studentName),
    });
  }

  private deleteLeave(id: string, studentName: string): void {
    this.leaveService.delete(id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: '已刪除', detail: `${studentName} 的請假已刪除` });
        this.loadLeaves();
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '刪除失敗，請稍後再試' });
      },
    });
  }

  protected getDays(startDate: string, endDate: string): number {
    return differenceInDays(new Date(endDate), new Date(startDate)) + 1;
  }

  protected getRoleLabel(role: 'parent' | 'admin'): string {
    return role === 'admin' ? '管理員代建' : '家長申請';
  }
}
```

- [ ] **Step 4: 建立 leave.page.html**

修改 `apps/web/src/app/features/admin/pages/leave/leave.page.html`：

```html
<p-toast />
<p-confirmdialog />

<div class="leave-page">
  <div class="leave-page__header">
    <h2 class="leave-page__title">{{ page().label }}</h2>
    <p-button
      label="新增請假"
      icon="pi pi-plus"
      (onClick)="openCreateDialog()"
    />
  </div>

  <!-- 篩選區 -->
  <div class="leave-page__filters">
    <p-select
      [options]="campuses()"
      [(ngModel)]="filterCampusId"
      optionLabel="label"
      optionValue="value"
      placeholder="全部分校"
      (onChange)="onFilterChange()"
      styleClass="leave-page__filter-item"
    />
    <p-datepicker
      [(ngModel)]="filterDateRange"
      selectionMode="range"
      placeholder="日期範圍"
      dateFormat="yy-mm-dd"
      (onClose)="onFilterChange()"
      styleClass="leave-page__filter-item"
    />
    <p-button
      icon="pi pi-refresh"
      severity="secondary"
      (onClick)="onFilterChange()"
      pTooltip="重新整理"
    />
  </div>

  <!-- 資料表 -->
  <app-responsive-table
    [value]="leaves()"
    [loading]="loading()"
    [pagination]="paginationConfig()"
    (pageChange)="onPageChange($event)"
    emptyMessage="沒有請假紀錄"
  >
    <ng-template appRtColDef field="studentName" header="學生姓名" />
    <ng-template appRtColDef field="startDate" header="請假開始" />
    <ng-template appRtColDef field="endDate" header="請假結束" />
    <ng-template appRtColDef field="days" header="天數" />
    <ng-template appRtColDef field="reason" header="原因" />
    <ng-template appRtColDef field="submittedByRole" header="提交者" />
    <ng-template appRtColDef field="actions" header="" />

    <ng-template appRtColCell field="days" let-row>
      {{ getDays(row.startDate, row.endDate) }} 天
    </ng-template>

    <ng-template appRtColCell field="reason" let-row>
      {{ row.reason ?? '—' }}
    </ng-template>

    <ng-template appRtColCell field="submittedByRole" let-row>
      <p-tag
        [value]="getRoleLabel(row.submittedByRole)"
        [severity]="row.submittedByRole === 'admin' ? 'info' : 'secondary'"
      />
    </ng-template>

    <ng-template appRtColCell field="actions" let-row>
      <p-button
        icon="pi pi-trash"
        severity="danger"
        size="small"
        [text]="true"
        (onClick)="confirmDelete(row)"
        pTooltip="刪除請假"
      />
    </ng-template>
  </app-responsive-table>
</div>
```

- [ ] **Step 5: 建立 leave.page.scss**

修改 `apps/web/src/app/features/admin/pages/leave/leave.page.scss`：

```scss
.leave-page {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--zinc-900);
    margin: 0;
  }

  &__filters {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    align-items: center;
  }

  &__filter-item {
    min-width: 160px;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/core/leave.service.ts
git add apps/web/src/app/features/admin/pages/leave/
git commit -m "feat(admin): implement leave management page with create and delete"
```

---

## 完成後驗證清單

- [ ] `supabase db reset` 成功，無 migration 錯誤
- [ ] `http://localhost:8787/docs` 可看到 `/api/org/settings`、`/api/attendance`、`/api/leaves`、`/api/daily-checkins` 的 OpenAPI 文件
- [ ] `/admin/settings` 顯示出勤模式切換，可儲存
- [ ] `/admin/attendance` 可篩選、分頁顯示出勤紀錄，可 inline 修改狀態
- [ ] `/admin/leave` 可查看請假列表，「新增請假」dialog 可正常送出，刪除有確認提示
- [ ] 新增請假後，對應的 attendance_records 狀態更新為 `on_leave`
- [ ] 刪除請假後，對應的 attendance_records 狀態恢復為 `absent`
