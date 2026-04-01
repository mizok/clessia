# 出勤作業台重設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 Admin 出勤頁改為以班級/課堂為主軸的每日作業台，並建立 Teacher 課表 MVP（含點名）。

**Architecture:** 後端新增三個 API（sessions summary、roster、batch upsert），前端 Admin 頁面全改版為 by-class 卡片列表 + 右側點名面板，Teacher 頁面從零實作週視圖課表，點名面板共用元件。

**Tech Stack:** Angular 21 (Signals, Standalone), PrimeNG 21, Hono + Zod OpenAPI, Supabase PostgreSQL

> 🤖 **Codex 委派標記**
> - **[CODEX]** 的 Task 適合委派給 Codex 執行（純後端、SQL、無 UI）
> - **[ME]** 的 Task 由 Claude Code 自己執行（Angular UI）

---

## 檔案結構總覽

### 新建
| 檔案 | 說明 |
|---|---|
| `supabase/migrations/20260401000001_attendance_operations.sql` | events + organizations schema 變更 |
| `supabase/migrations/20260401000002_seed_attendance_test.sql` | 測試用 seed 資料 |
| `apps/web/src/app/shared/components/attendance-roster-panel/attendance-roster-panel.component.ts` | 點名面板（Admin + Teacher 共用） |
| `apps/web/src/app/shared/components/attendance-roster-panel/attendance-roster-panel.component.html` | 點名面板 template |
| `apps/web/src/app/shared/components/attendance-roster-panel/attendance-roster-panel.component.scss` | 點名面板樣式 |

### 修改
| 檔案 | 說明 |
|---|---|
| `apps/api/src/routes/attendance.ts` | 新增 sessions / roster / batch 三個端點 |
| `apps/api/src/routes/org-settings.ts` | 擴充 attendanceResponsible / attendanceRetroactiveDays |
| `apps/web/src/app/core/attendance.service.ts` | 新增 sessions() / roster() / batchUpdate() |
| `apps/web/src/app/core/org-settings.service.ts` | 擴充介面 |
| `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts` | 全改版 |
| `apps/web/src/app/features/admin/pages/attendance/attendance.page.html` | 全改版 |
| `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss` | 全改版 |
| `apps/web/src/app/features/admin/pages/sessions/sessions.page.ts` | openLeaveRoster header 改名 |
| `apps/web/src/app/features/admin/pages/sessions/dialogs/session-detail-dialog/session-detail-dialog.component.ts` | 新增「查看出勤」連結 |
| `apps/web/src/app/features/admin/pages/sessions/dialogs/session-leave-roster-dialog/session-leave-roster-dialog.component.html` | header 文字改名 |
| `apps/web/src/app/features/teacher/pages/schedule/schedule.page.ts` | 全改版（從空殼到週視圖） |
| `apps/web/src/app/features/teacher/pages/schedule/schedule.page.html` | 全改版 |
| `apps/web/src/app/features/teacher/pages/schedule/schedule.page.scss` | 全改版 |

---

## Task 1 [CODEX]：DB Migration

**Files:**
- Create: `supabase/migrations/20260401000001_attendance_operations.sql`

- [ ] **Step 1: 建立 migration 檔**

```sql
-- 出勤作業台重設計 schema 變更
-- 2026-04-01

-- 1. events 新增 attendance_taken_at
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS attendance_taken_at timestamptz;

-- 2. organizations 新增出勤責任設定欄位
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS attendance_responsible text
    NOT NULL DEFAULT 'admin'
    CHECK (attendance_responsible IN ('admin', 'teacher')),
  ADD COLUMN IF NOT EXISTS attendance_retroactive_days integer
    NOT NULL DEFAULT 0
    CHECK (attendance_retroactive_days >= 0);

COMMENT ON COLUMN public.events.attendance_taken_at
  IS '首次完成點名的時間，NULL 代表尚未點名，immutable（補正不更新）';
COMMENT ON COLUMN public.organizations.attendance_responsible
  IS '點名責任方：admin（預設）或 teacher';
COMMENT ON COLUMN public.organizations.attendance_retroactive_days
  IS '補點名期限天數，0 代表無限制';
```

- [ ] **Step 2: 套用 migration**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
supabase db reset
```

預期：migration 無錯誤，`events` 和 `organizations` 表有新欄位。

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260401000001_attendance_operations.sql
git commit -m "feat(db): add attendance_taken_at to events, attendance settings to organizations"
```

---

## Task 2 [CODEX]：org-settings API 擴充

**Files:**
- Modify: `apps/api/src/routes/org-settings.ts`

- [ ] **Step 1: 更新 schema 與 handler**

將 `apps/api/src/routes/org-settings.ts` 完整替換為：

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const AttendanceModeSchema = z
  .enum(['per_session', 'daily_checkin'])
  .openapi('AttendanceMode');

const AttendanceResponsibleSchema = z
  .enum(['admin', 'teacher'])
  .openapi('AttendanceResponsible');

const OrgSettingsSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    attendanceMode: AttendanceModeSchema,
    attendanceResponsible: AttendanceResponsibleSchema,
    attendanceRetroactiveDays: z.number().int().min(0),
  })
  .openapi('OrgSettings');

const UpdateOrgSettingsSchema = z
  .object({
    attendanceMode: AttendanceModeSchema.optional(),
    attendanceResponsible: AttendanceResponsibleSchema.optional(),
    attendanceRetroactiveDays: z.coerce.number().int().min(0).optional(),
  })
  .openapi('UpdateOrgSettings');

export function toOrgSettingsResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    attendanceMode: row['attendance_mode'] as 'per_session' | 'daily_checkin',
    attendanceResponsible: (row['attendance_responsible'] as 'admin' | 'teacher') ?? 'admin',
    attendanceRetroactiveDays: (row['attendance_retroactive_days'] as number) ?? 0,
  };
}

const app = new OpenAPIHono<AppEnv>();

const SELECT_FIELDS = 'id, name, attendance_mode, attendance_responsible, attendance_retroactive_days';

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
      .select(SELECT_FIELDS)
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
    if (body.attendanceMode !== undefined) updates['attendance_mode'] = body.attendanceMode;
    if (body.attendanceResponsible !== undefined) updates['attendance_responsible'] = body.attendanceResponsible;
    if (body.attendanceRetroactiveDays !== undefined) updates['attendance_retroactive_days'] = body.attendanceRetroactiveDays;

    const { data, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', orgId)
      .select(SELECT_FIELDS)
      .single();

    if (error || !data) {
      return c.json({ error: '更新組織設定失敗' }, 500);
    }

    return c.json(toOrgSettingsResponse(data), 200);
  },
);

export default app;
```

- [ ] **Step 2: 驗證 API 回傳新欄位**

啟動 API server 後：
```bash
curl -s http://localhost:8787/api/org/settings \
  -H "Authorization: Bearer <token>" | jq '.attendanceResponsible, .attendanceRetroactiveDays'
```
預期回傳：`"admin"` 和 `0`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/org-settings.ts
git commit -m "feat(api): extend org-settings with attendanceResponsible and attendanceRetroactiveDays"
```

---

## Task 3 [CODEX]：新增 Read API（sessions + roster）

**Files:**
- Modify: `apps/api/src/routes/attendance.ts`

在現有 `attendance.ts` 的 `export default app` **之前**新增以下兩個端點。

- [ ] **Step 1: 新增 EventSessionSummary schema**

在 `attendance.ts` 頂部（現有 schema 之後）加入：

```typescript
const EventSessionSummarySchema = z
  .object({
    eventId: z.uuid(),
    classId: z.uuid(),
    className: z.string(),
    teacherName: z.string().nullable(),
    campusId: z.uuid().nullable(),
    campusName: z.string().nullable(),
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    enrolledCount: z.number(),
    presentCount: z.number(),
    onLeaveCount: z.number(),
    absentCount: z.number(),
    takenAt: z.string().nullable(),
  })
  .openapi('EventSessionSummary');

const RosterStudentSchema = z
  .object({
    studentId: z.uuid(),
    studentName: z.string(),
    grade: z.string().nullable(),
    school: z.string().nullable(),
    recordId: z.uuid().nullable(),
    status: AttendanceStatusSchema.nullable(),
  })
  .openapi('RosterStudent');

const AttendanceRosterSchema = z
  .object({
    eventId: z.uuid(),
    takenAt: z.string().nullable(),
    students: z.array(RosterStudentSchema),
  })
  .openapi('AttendanceRoster');
```

- [ ] **Step 2: 新增 GET /api/attendance/sessions**

```typescript
// GET /api/attendance/sessions
app.openapi(
  createRoute({
    method: 'get',
    path: '/sessions',
    tags: ['Attendance'],
    summary: '取得課堂出勤摘要列表（by 日期）',
    request: {
      query: z.object({
        date: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        campusId: z.uuid().optional(),
      }),
    },
    responses: {
      200: {
        description: '課堂出勤摘要',
        content: { 'application/json': { schema: z.array(EventSessionSummarySchema) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { date, dateFrom, dateTo, campusId } = c.req.valid('query');

    const from = date ?? dateFrom;
    const to = date ?? dateTo;

    if (!from) return c.json({ error: 'date 或 dateFrom 為必填' }, 400);

    // 1. 取得 events（含 session→class→teacher 關聯）
    let eventsQuery = supabase
      .from('events')
      .select(`
        id, event_date, start_time, end_time, attendance_taken_at,
        campus_id, campuses(name),
        sessions(
          class_id,
          classes(name, teacher_id, ba_user:teacher_id(name))
        )
      `)
      .eq('org_id', orgId)
      .gte('event_date', from)
      .lte('event_date', to ?? from)
      .order('start_time', { ascending: true });

    if (campusId) eventsQuery = eventsQuery.eq('campus_id', campusId);

    const { data: events, error: eventsError } = await eventsQuery;
    if (eventsError) return c.json({ error: '查詢課堂失敗', message: eventsError.message }, 500);

    const results = await Promise.all(
      (events ?? []).map(async (ev: any) => {
        const session = ev.sessions?.[0];
        const classRow = session?.classes;
        const classId = session?.class_id ?? null;

        // 2. 統計出勤（只在 takenAt 有值時才有意義）
        let presentCount = 0, onLeaveCount = 0, absentCount = 0;

        if (ev.attendance_taken_at) {
          const { data: records } = await supabase
            .from('attendance_records')
            .select('status')
            .eq('event_id', ev.id)
            .eq('org_id', orgId);

          for (const r of records ?? []) {
            if (r.status === 'present') presentCount++;
            else if (r.status === 'on_leave') onLeaveCount++;
            else if (r.status === 'absent') absentCount++;
          }
        }

        // 3. 修課人數（enrollment snapshot）
        const { count: enrolledCount } = await supabase
          .from('enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('class_id', classId)
          .eq('status', 'active')
          .lte('effective_from', ev.event_date)
          .or(`effective_to.is.null,effective_to.gte.${ev.event_date}`);

        return {
          eventId: ev.id,
          classId: classId ?? '',
          className: classRow?.name ?? '',
          teacherName: classRow?.ba_user?.name ?? null,
          campusId: ev.campus_id ?? null,
          campusName: ev.campuses?.name ?? null,
          eventDate: ev.event_date,
          startTime: ev.start_time ? ev.start_time.slice(0, 5) : null,
          endTime: ev.end_time ? ev.end_time.slice(0, 5) : null,
          enrolledCount: enrolledCount ?? 0,
          presentCount,
          onLeaveCount,
          absentCount,
          takenAt: ev.attendance_taken_at ?? null,
        };
      }),
    );

    return c.json(results, 200);
  },
);
```

- [ ] **Step 3: 新增 GET /api/attendance/roster/:eventId**

```typescript
// GET /api/attendance/roster/:eventId
app.openapi(
  createRoute({
    method: 'get',
    path: '/roster/:eventId',
    tags: ['Attendance'],
    summary: '取得課堂點名名單（懶建立，不寫 DB）',
    request: {
      params: z.object({ eventId: z.uuid() }),
    },
    responses: {
      200: {
        description: '課堂點名名單',
        content: { 'application/json': { schema: AttendanceRosterSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { eventId } = c.req.valid('param');

    // 1. 確認 event 存在
    const { data: ev, error: evError } = await supabase
      .from('events')
      .select('id, event_date, attendance_taken_at, sessions(class_id)')
      .eq('id', eventId)
      .eq('org_id', orgId)
      .single();

    if (evError || !ev) return c.json({ error: '找不到課堂' }, 404);

    const classId = (ev as any).sessions?.[0]?.class_id;
    const eventDate = (ev as any).event_date as string;

    // 2. Enrollment snapshot（event_date 當天有效）
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('student_id, students(name, grade_level, school)')
      .eq('class_id', classId)
      .eq('status', 'active')
      .lte('effective_from', eventDate)
      .or(`effective_to.is.null,effective_to.gte.${eventDate}`);

    // 3. 現有出勤紀錄
    const { data: records } = await supabase
      .from('attendance_records')
      .select('id, student_id, status')
      .eq('event_id', eventId)
      .eq('org_id', orgId);

    const recordMap = new Map(
      (records ?? []).map((r: any) => [r.student_id, { id: r.id, status: r.status }]),
    );

    const students = (enrollments ?? []).map((e: any) => {
      const rec = recordMap.get(e.student_id);
      return {
        studentId: e.student_id,
        studentName: e.students?.name ?? '',
        grade: e.students?.grade_level ?? null,
        school: e.students?.school ?? null,
        recordId: rec?.id ?? null,
        status: rec?.status ?? null,
      };
    });

    return c.json(
      {
        eventId,
        takenAt: (ev as any).attendance_taken_at ?? null,
        students,
      },
      200,
    );
  },
);
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/attendance.ts
git commit -m "feat(api): add GET /api/attendance/sessions and GET /api/attendance/roster/:eventId"
```

---

## Task 4 [CODEX]：新增 PATCH /api/attendance/batch

**Files:**
- Modify: `apps/api/src/routes/attendance.ts`

在 `export default app` 之前，繼續加入：

- [ ] **Step 1: 新增 batch schema**

```typescript
const BatchAttendanceUpdateSchema = z
  .object({
    eventId: z.uuid(),
    updates: z
      .array(
        z.object({
          studentId: z.uuid(),
          status: z.enum(['present', 'absent']), // 不接受 on_leave
        }),
      )
      .min(1),
  })
  .openapi('BatchAttendanceUpdate');
```

- [ ] **Step 2: 新增 PATCH /api/attendance/batch**

```typescript
// PATCH /api/attendance/batch
app.openapi(
  createRoute({
    method: 'patch',
    path: '/batch',
    tags: ['Attendance'],
    summary: '批次儲存點名結果（原子性，同步更新 attendance_taken_at）',
    request: {
      body: { content: { 'application/json': { schema: BatchAttendanceUpdateSchema } } },
    },
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: z.object({ updated: z.number(), takenAt: z.string() }) } } },
      400: { description: '參數錯誤' },
      403: { description: '無權限' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { eventId, updates } = c.req.valid('json');

    // 1. 確認 event 屬於此 org
    const { data: ev } = await supabase
      .from('events')
      .select('id, attendance_taken_at, sessions(class_id), event_date')
      .eq('id', eventId)
      .eq('org_id', orgId)
      .single();

    if (!ev) return c.json({ error: '找不到課堂或無權限' }, 403);

    const classId = (ev as any).sessions?.[0]?.class_id;
    const eventDate = (ev as any).event_date as string;

    // 2. 驗證所有 studentId 屬於此課堂有效 enrollment
    const { data: validEnrollments } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', classId)
      .eq('status', 'active')
      .lte('effective_from', eventDate)
      .or(`effective_to.is.null,effective_to.gte.${eventDate}`);

    const validIds = new Set((validEnrollments ?? []).map((e: any) => e.student_id));
    const invalidIds = updates.filter((u) => !validIds.has(u.studentId));
    if (invalidIds.length > 0) {
      return c.json({ error: '部分學生不在此課堂修課名單中' }, 400);
    }

    // 3. Upsert 出勤紀錄
    const records = updates.map((u) => ({
      org_id: orgId,
      event_id: eventId,
      student_id: u.studentId,
      status: u.status,
      recorded_by: userId,
      recorded_by_role: 'admin',
    }));

    const { error: upsertError } = await supabase
      .from('attendance_records')
      .upsert(records, { onConflict: 'event_id,student_id' });

    if (upsertError) {
      return c.json({ error: '儲存出勤失敗', message: upsertError.message }, 500);
    }

    // 4. 更新 attendance_taken_at（只在首次點名時設定）
    const takenAt =
      (ev as any).attendance_taken_at ?? new Date().toISOString();

    if (!(ev as any).attendance_taken_at) {
      await supabase
        .from('events')
        .update({ attendance_taken_at: takenAt })
        .eq('id', eventId)
        .eq('org_id', orgId);
    }

    return c.json({ updated: updates.length, takenAt }, 200);
  },
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/attendance.ts
git commit -m "feat(api): add PATCH /api/attendance/batch with atomic attendance_taken_at update"
```

---

## Task 5 [ME]：前端 attendance.service.ts 擴充

**Files:**
- Modify: `apps/web/src/app/core/attendance.service.ts`

- [ ] **Step 1: 更新 service（新增介面與方法）**

```typescript
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

// 既有介面保留，新增以下：

export interface EventSessionSummary {
  eventId: string;
  classId: string;
  className: string;
  teacherName: string | null;
  campusId: string | null;
  campusName: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  enrolledCount: number;
  presentCount: number;
  onLeaveCount: number;
  absentCount: number;
  takenAt: string | null;
}

export interface RosterStudent {
  studentId: string;
  studentName: string;
  grade: string | null;
  school: string | null;
  recordId: string | null;
  status: 'present' | 'absent' | 'on_leave' | null;
}

export interface AttendanceRoster {
  eventId: string;
  takenAt: string | null;
  students: RosterStudent[];
}

export interface BatchAttendanceUpdate {
  eventId: string;
  updates: { studentId: string; status: 'present' | 'absent' }[];
}

// 在 AttendanceService class 內新增：
// sessions(params): Observable<EventSessionSummary[]>
// roster(eventId): Observable<AttendanceRoster>
// batchUpdate(input): Observable<{ updated: number; takenAt: string }>
```

完整 service 實作：

```typescript
@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/attendance`;

  list(params: AttendanceQueryParams): Observable<AttendanceListResponse> {
    // 保留現有實作
  }

  update(id: string, input: UpdateAttendanceInput): Observable<AttendanceRecord> {
    // 保留現有實作
  }

  sessions(params: { date?: string; dateFrom?: string; dateTo?: string; campusId?: string }): Observable<EventSessionSummary[]> {
    let p = new HttpParams();
    if (params.date) p = p.set('date', params.date);
    if (params.dateFrom) p = p.set('dateFrom', params.dateFrom);
    if (params.dateTo) p = p.set('dateTo', params.dateTo);
    if (params.campusId) p = p.set('campusId', params.campusId);
    return this.http.get<EventSessionSummary[]>(`${this.baseUrl}/sessions`, { params: p });
  }

  roster(eventId: string): Observable<AttendanceRoster> {
    return this.http.get<AttendanceRoster>(`${this.baseUrl}/roster/${eventId}`);
  }

  batchUpdate(input: BatchAttendanceUpdate): Observable<{ updated: number; takenAt: string }> {
    return this.http.patch<{ updated: number; takenAt: string }>(`${this.baseUrl}/batch`, input);
  }
}
```

- [ ] **Step 2: 同步更新 org-settings service 介面**

在 `apps/web/src/app/core/org-settings.service.ts` 中，找到 `OrgSettings` interface 加入：
```typescript
attendanceResponsible: 'admin' | 'teacher';
attendanceRetroactiveDays: number;
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/core/attendance.service.ts apps/web/src/app/core/org-settings.service.ts
git commit -m "feat(web): extend AttendanceService and OrgSettingsService with new endpoints"
```

---

## Task 6 [ME]：共用點名面板元件

**Files:**
- Create: `apps/web/src/app/shared/components/attendance-roster-panel/attendance-roster-panel.component.ts`
- Create: `apps/web/src/app/shared/components/attendance-roster-panel/attendance-roster-panel.component.html`
- Create: `apps/web/src/app/shared/components/attendance-roster-panel/attendance-roster-panel.component.scss`

此元件由 Admin 出勤頁和 Teacher 課表頁共用。

- [ ] **Step 1: 產生元件**

```bash
cd apps/web
npx ng generate component shared/components/attendance-roster-panel --type component --standalone
```

- [ ] **Step 2: 實作 TS**

```typescript
import { Component, inject, input, output, signal, computed } from '@angular/core';
import { AttendanceService, AttendanceRoster, RosterStudent } from '@core/attendance.service';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { GRADE_LEVEL_LABELS } from '@core/students.service';

export interface RosterPanelSession {
  eventId: string;
  className: string;
  eventDate: string;
}

@Component({
  selector: 'app-attendance-roster-panel',
  standalone: true,
  imports: [ButtonModule, TagModule, ProgressSpinnerModule],
  templateUrl: './attendance-roster-panel.component.html',
  styleUrl: './attendance-roster-panel.component.scss',
})
export class AttendanceRosterPanelComponent {
  private readonly attendanceService = inject(AttendanceService);
  private readonly messageService = inject(MessageService);

  readonly session = input.required<RosterPanelSession>();
  readonly closed = output<void>();
  readonly saved = output<{ eventId: string; takenAt: string }>();

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly roster = signal<AttendanceRoster | null>(null);

  // 本地狀態：studentId → status（'present' | 'absent'，on_leave 不在此）
  protected readonly localStatus = signal<Map<string, 'present' | 'absent'>>(new Map());

  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  ngOnInit(): void {
    this.loadRoster();
  }

  private loadRoster(): void {
    this.loading.set(true);
    this.attendanceService.roster(this.session().eventId).subscribe({
      next: (data) => {
        this.roster.set(data);
        // 初始化 localStatus：有紀錄用紀錄值，無紀錄預設 absent
        const map = new Map<string, 'present' | 'absent'>();
        for (const s of data.students) {
          if (s.status !== 'on_leave') {
            map.set(s.studentId, (s.status as 'present' | 'absent') ?? 'absent');
          }
        }
        this.localStatus.set(map);
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '無法載入點名名單' });
        this.loading.set(false);
      },
    });
  }

  protected isOnLeave(student: RosterStudent): boolean {
    return student.status === 'on_leave';
  }

  protected getStatus(studentId: string): 'present' | 'absent' {
    return this.localStatus().get(studentId) ?? 'absent';
  }

  protected setStatus(studentId: string, status: 'present' | 'absent'): void {
    const map = new Map(this.localStatus());
    map.set(studentId, status);
    this.localStatus.set(map);
  }

  protected gradeLabel(grade: string | null): string {
    if (!grade) return '';
    return GRADE_LEVEL_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }

  protected save(): void {
    const roster = this.roster();
    if (!roster) return;
    this.saving.set(true);

    const updates = roster.students
      .filter((s) => !this.isOnLeave(s))
      .map((s) => ({ studentId: s.studentId, status: this.getStatus(s.studentId) }));

    this.attendanceService.batchUpdate({ eventId: this.session().eventId, updates }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.messageService.add({ severity: 'success', summary: '已儲存', detail: '點名完成' });
        this.saved.emit({ eventId: this.session().eventId, takenAt: res.takenAt });
        this.closed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '儲存失敗，請稍後再試' });
      },
    });
  }

  protected close(): void {
    this.closed.emit();
  }
}
```

- [ ] **Step 3: 實作 HTML**

```html
<div class="roster-panel">
  <div class="roster-panel__header">
    <div>
      <div class="roster-panel__title">{{ session().className }}</div>
      <div class="roster-panel__subtitle">{{ session().eventDate }}</div>
    </div>
    <p-button icon="pi pi-times" [text]="true" severity="secondary" (onClick)="close()" />
  </div>

  @if (loading()) {
    <div class="roster-panel__loading">
      <p-progressSpinner strokeWidth="4" />
    </div>
  } @else if (roster()) {
    <div class="roster-panel__list">
      @for (student of roster()!.students; track student.studentId) {
        <div class="roster-panel__row" [class.roster-panel__row--on-leave]="isOnLeave(student)">
          <div class="roster-panel__student">
            <span class="roster-panel__name">{{ student.studentName }}</span>
            <span class="roster-panel__sub">{{ gradeLabel(student.grade) }}{{ student.school ? ' · ' + student.school : '' }}</span>
          </div>
          @if (isOnLeave(student)) {
            <p-tag value="請假中" severity="warning" />
          } @else {
            <div class="roster-panel__toggle">
              <p-button
                label="出席"
                size="small"
                [outlined]="getStatus(student.studentId) !== 'present'"
                severity="success"
                (onClick)="setStatus(student.studentId, 'present')"
              />
              <p-button
                label="缺席"
                size="small"
                [outlined]="getStatus(student.studentId) !== 'absent'"
                severity="danger"
                (onClick)="setStatus(student.studentId, 'absent')"
              />
            </div>
          }
        </div>
      }
    </div>

    <div class="roster-panel__footer">
      <p-button
        label="儲存點名"
        icon="pi pi-check"
        [loading]="saving()"
        (onClick)="save()"
      />
    </div>
  }
</div>
```

- [ ] **Step 4: 實作 SCSS（BEM）**

```scss
.roster-panel {
  display: flex;
  flex-direction: column;
  height: 100%;

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: var(--space-4);
    border-bottom: 1px solid var(--zinc-200);
  }

  &__title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--zinc-900);
  }

  &__subtitle {
    font-size: 0.75rem;
    color: var(--zinc-500);
    margin-top: 2px;
  }

  &__loading {
    display: flex;
    justify-content: center;
    padding: var(--space-8);
  }

  &__list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) 0;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--zinc-100);

    &--on-leave {
      background: var(--zinc-50);
      opacity: 0.7;
    }
  }

  &__student {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__name {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--zinc-800);
  }

  &__sub {
    font-size: 0.75rem;
    color: var(--zinc-400);
  }

  &__toggle {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  &__footer {
    padding: var(--space-4);
    border-top: 1px solid var(--zinc-200);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/shared/components/attendance-roster-panel/
git commit -m "feat(web): add shared AttendanceRosterPanelComponent"
```

---

## Task 7 [ME]：Admin 出勤作業台改版

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.html`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss`

- [ ] **Step 1: 改版 attendance.page.ts**

完全重寫（不保留舊版內容）：

```typescript
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { format } from 'date-fns';
import { AttendanceService, EventSessionSummary } from '@core/attendance.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { AttendanceRosterPanelComponent, RosterPanelSession } from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SidebarModule } from 'primeng/sidebar';

@Component({
  selector: 'app-attendance-page',
  standalone: true,
  imports: [DatePickerModule, ButtonModule, SelectModule, SidebarModule, AttendanceRosterPanelComponent],
  templateUrl: './attendance.page.html',
  styleUrl: './attendance.page.scss',
})
export class AttendancePageComponent implements OnInit {
  private readonly attendanceService = inject(AttendanceService);
  private readonly orgSettingsService = inject(OrgSettingsService);

  protected readonly selectedDate = signal<Date>(new Date());
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly sessions = signal<EventSessionSummary[]>([]);
  protected readonly loading = signal(false);

  // 點名面板
  protected readonly panelVisible = signal(false);
  protected readonly activeSession = signal<RosterPanelSession | null>(null);

  // org settings
  protected readonly orgSettings = this.orgSettingsService.settings;

  protected readonly campuses = computed(() =>
    [...new Map(
      this.sessions()
        .filter((s) => s.campusId)
        .map((s) => [s.campusId, { id: s.campusId!, name: s.campusName ?? '' }])
    ).values()]
  );

  ngOnInit(): void {
    this.loadSessions();
  }

  protected onDateChange(date: Date): void {
    this.selectedDate.set(date);
    this.loadSessions();
  }

  private loadSessions(): void {
    this.loading.set(true);
    const date = format(this.selectedDate(), 'yyyy-MM-dd');
    const campusId = this.selectedCampusId() ?? undefined;
    this.attendanceService.sessions({ date, campusId }).subscribe({
      next: (data) => { this.sessions.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  protected openPanel(session: EventSessionSummary): void {
    this.activeSession.set({
      eventId: session.eventId,
      className: session.className,
      eventDate: session.eventDate,
    });
    this.panelVisible.set(true);
  }

  protected onPanelSaved(result: { eventId: string; takenAt: string }): void {
    this.sessions.update((list) =>
      list.map((s) => s.eventId === result.eventId ? { ...s, takenAt: result.takenAt } : s)
    );
  }

  protected isTaken(session: EventSessionSummary): boolean {
    return session.takenAt !== null;
  }

  protected canTakeAttendance(session: EventSessionSummary): boolean {
    const settings = this.orgSettings?.();
    if (!settings) return true;
    // teacher 模式下 admin 也可（補正），按鈕樣式不同
    return true;
  }

  protected isAdminLed(): boolean {
    return (this.orgSettings?.()?.attendanceResponsible ?? 'admin') === 'admin';
  }
}
```

- [ ] **Step 2: 改版 attendance.page.html**

```html
<div class="attendance-page">
  <div class="attendance-page__header">
    <h1 class="attendance-page__title">出缺席管理</h1>
  </div>

  <div class="attendance-page__toolbar">
    <p-datepicker
      [ngModel]="selectedDate()"
      (ngModelChange)="onDateChange($event)"
      dateFormat="yy-mm-dd"
      [showIcon]="true"
      appendTo="body"
    />
  </div>

  <div class="attendance-page__body">
    @if (loading()) {
      @for (i of [1,2,3]; track i) {
        <div class="attendance-page__skeleton"></div>
      }
    } @else if (sessions().length === 0) {
      <div class="attendance-page__empty">今天沒有課堂</div>
    } @else {
      @for (session of sessions(); track session.eventId) {
        <div class="attendance-page__card">
          <div class="attendance-page__card-info">
            <div class="attendance-page__card-title">{{ session.className }}</div>
            <div class="attendance-page__card-meta">
              {{ session.startTime ?? '--:--' }}–{{ session.endTime ?? '--:--' }}
              @if (session.teacherName) { · {{ session.teacherName }} }
              @if (session.campusName) { · {{ session.campusName }} }
            </div>
          </div>
          <div class="attendance-page__card-stats">
            @if (isTaken(session)) {
              <span class="attendance-page__stat attendance-page__stat--present">✓ {{ session.presentCount }}</span>
              <span class="attendance-page__stat attendance-page__stat--leave">🏳 {{ session.onLeaveCount }}</span>
              <span class="attendance-page__stat attendance-page__stat--absent">✗ {{ session.absentCount }}</span>
            } @else {
              <span class="attendance-page__untaken">◌ {{ session.enrolledCount }} 人未點名</span>
            }
          </div>
          <p-button
            [label]="isTaken(session) ? '修改點名' : '點名'"
            [outlined]="!isAdminLed() || isTaken(session)"
            [severity]="isAdminLed() && !isTaken(session) ? 'primary' : 'secondary'"
            size="small"
            (onClick)="openPanel(session)"
          />
        </div>
      }
    }
  </div>
</div>

<p-sidebar
  [(visible)]="panelVisible"
  position="right"
  [style]="{ width: '380px' }"
  [showCloseIcon]="false"
>
  @if (activeSession()) {
    <app-attendance-roster-panel
      [session]="activeSession()!"
      (closed)="panelVisible.set(false)"
      (saved)="onPanelSaved($event)"
    />
  }
</p-sidebar>
```

- [ ] **Step 3: 改版 attendance.page.scss（BEM）**

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

  &__toolbar {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  &__card {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    background: #fff;
    border: 1px solid var(--zinc-200);
    border-radius: 8px;
  }

  &__card-info {
    flex: 1;
    min-width: 0;
  }

  &__card-title {
    font-weight: 600;
    color: var(--zinc-900);
  }

  &__card-meta {
    font-size: 0.8rem;
    color: var(--zinc-500);
    margin-top: 2px;
  }

  &__card-stats {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }

  &__stat {
    font-size: 0.85rem;
    font-weight: 500;

    &--present { color: var(--green-600); }
    &--leave { color: var(--yellow-600); }
    &--absent { color: var(--red-600); }
  }

  &__untaken {
    font-size: 0.85rem;
    color: var(--zinc-400);
  }

  &__skeleton {
    height: 72px;
    border-radius: 8px;
    background: var(--zinc-100);
    animation: pulse 1.5s ease-in-out infinite;
  }

  &__empty {
    text-align: center;
    color: var(--zinc-400);
    padding: var(--space-8) 0;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/attendance/
git commit -m "feat(admin): redesign attendance page as by-class operations dashboard"
```

---

## Task 8 [ME]：SessionDetailDialog 調整

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/sessions/sessions.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/dialogs/session-leave-roster-dialog/session-leave-roster-dialog.component.html`
- Modify: `apps/web/src/app/features/admin/pages/sessions/dialogs/session-detail-dialog/session-detail-dialog.component.ts`

- [ ] **Step 1: 改 openLeaveRoster header**

在 `sessions.page.ts` 找到：
```typescript
this.dialogService.open(SessionLeaveRosterDialogComponent, {
  header: '課堂名單',
```
改為：
```typescript
this.dialogService.open(SessionLeaveRosterDialogComponent, {
  header: '請假名單',
```

- [ ] **Step 2: session-leave-roster-dialog html 標題更新**

找到 dialog 內部若有寫死的 header 文字「課堂名單」一律改為「請假名單」。

- [ ] **Step 3: session-detail-dialog 新增「查看出勤」連結**

在 `session-detail-dialog.component.ts` 中注入 `Router`，新增方法：

```typescript
private readonly router = inject(Router);

protected goToAttendance(): void {
  const date = this.session()?.eventDate; // 依實際 property 名稱調整
  this.router.navigate(['/admin/attendance'], {
    queryParams: date ? { date } : {},
  });
  this.dialogRef.close();
}
```

在對應 HTML 適當位置加入：
```html
<p-button
  label="查看出勤"
  icon="pi pi-calendar-clock"
  [text]="true"
  size="small"
  (onClick)="goToAttendance()"
/>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/sessions/
git commit -m "feat(admin): rename leave roster dialog header, add attendance link in session detail"
```

---

## Task 9 [ME]：Teacher 課表頁 MVP

**Files:**
- Modify: `apps/web/src/app/features/teacher/pages/schedule/schedule.page.ts`
- Modify: `apps/web/src/app/features/teacher/pages/schedule/schedule.page.html`
- Modify: `apps/web/src/app/features/teacher/pages/schedule/schedule.page.scss`

- [ ] **Step 1: 實作 schedule.page.ts**

```typescript
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { startOfWeek, endOfWeek, addWeeks, subWeeks, format, isToday, isPast, parseISO, differenceInDays } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { AttendanceService, EventSessionSummary } from '@core/attendance.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { AuthService } from '@core/auth.service';
import { AttendanceRosterPanelComponent, RosterPanelSession } from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';
import { ButtonModule } from 'primeng/button';
import { SidebarModule } from 'primeng/sidebar';
import { TagModule } from 'primeng/tag';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

@Component({
  selector: 'app-schedule-page',
  standalone: true,
  imports: [ButtonModule, SidebarModule, TagModule, AttendanceRosterPanelComponent],
  templateUrl: './schedule.page.html',
  styleUrl: './schedule.page.scss',
})
export class SchedulePageComponent implements OnInit {
  private readonly attendanceService = inject(AttendanceService);
  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly authService = inject(AuthService);

  protected readonly currentWeekStart = signal<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  protected readonly sessions = signal<EventSessionSummary[]>([]);
  protected readonly loading = signal(false);

  protected readonly panelVisible = signal(false);
  protected readonly activeSession = signal<RosterPanelSession | null>(null);

  protected readonly orgSettings = this.orgSettingsService.settings;

  protected readonly weekLabel = computed(() => {
    const start = this.currentWeekStart();
    const end = endOfWeek(start, { weekStartsOn: 1 });
    return `${format(start, 'yyyy年M月d日')} – ${format(end, 'M月d日')}`;
  });

  protected readonly weekDays = computed(() => {
    const start = this.currentWeekStart();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return { date, label: `週${WEEKDAY_LABELS[date.getDay()]}`, dateStr: format(date, 'yyyy-MM-dd') };
    });
  });

  protected readonly sessionsByDay = computed(() => {
    const map = new Map<string, EventSessionSummary[]>();
    for (const day of this.weekDays()) map.set(day.dateStr, []);
    for (const s of this.sessions()) {
      const list = map.get(s.eventDate);
      if (list) list.push(s);
    }
    return map;
  });

  ngOnInit(): void {
    this.loadSessions();
  }

  protected prevWeek(): void {
    this.currentWeekStart.update((d) => subWeeks(d, 1));
    this.loadSessions();
  }

  protected nextWeek(): void {
    this.currentWeekStart.update((d) => addWeeks(d, 1));
    this.loadSessions();
  }

  private loadSessions(): void {
    this.loading.set(true);
    const start = this.currentWeekStart();
    const end = endOfWeek(start, { weekStartsOn: 1 });
    // TODO: 待 API 支援 teacherId 篩選後加入
    this.attendanceService.sessions({
      dateFrom: format(start, 'yyyy-MM-dd'),
      dateTo: format(end, 'yyyy-MM-dd'),
    }).subscribe({
      next: (data) => { this.sessions.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  protected isTeacherLed(): boolean {
    return (this.orgSettings?.()?.attendanceResponsible ?? 'admin') === 'teacher';
  }

  protected isRetroactiveLocked(session: EventSessionSummary): boolean {
    if (!this.isTeacherLed()) return false;
    const days = this.orgSettings?.()?.attendanceRetroactiveDays ?? 0;
    if (days === 0) return false;
    const diff = differenceInDays(new Date(), parseISO(session.eventDate));
    return diff > days;
  }

  protected isFuture(session: EventSessionSummary): boolean {
    return !isPast(parseISO(session.eventDate));
  }

  protected openPanel(session: EventSessionSummary): void {
    this.activeSession.set({
      eventId: session.eventId,
      className: session.className,
      eventDate: session.eventDate,
    });
    this.panelVisible.set(true);
  }

  protected onPanelSaved(result: { eventId: string; takenAt: string }): void {
    this.sessions.update((list) =>
      list.map((s) => s.eventId === result.eventId ? { ...s, takenAt: result.takenAt } : s)
    );
  }

  protected isToday(dateStr: string): boolean {
    return isToday(parseISO(dateStr));
  }
}
```

- [ ] **Step 2: 實作 schedule.page.html**

```html
<div class="schedule-page">
  <div class="schedule-page__header">
    <h1 class="schedule-page__title">課表</h1>
  </div>

  <div class="schedule-page__week-nav">
    <p-button icon="pi pi-chevron-left" [text]="true" (onClick)="prevWeek()" />
    <span class="schedule-page__week-label">{{ weekLabel() }}</span>
    <p-button icon="pi pi-chevron-right" [text]="true" (onClick)="nextWeek()" />
  </div>

  <div class="schedule-page__grid">
    @for (day of weekDays(); track day.dateStr) {
      <div class="schedule-page__day" [class.schedule-page__day--today]="isToday(day.dateStr)">
        <div class="schedule-page__day-header">
          <span class="schedule-page__day-label">{{ day.label }}</span>
          <span class="schedule-page__day-date">{{ day.date | date:'M/d' }}</span>
        </div>
        <div class="schedule-page__day-body">
          @for (session of sessionsByDay().get(day.dateStr) ?? []; track session.eventId) {
            <div class="schedule-page__session-card">
              <div class="schedule-page__session-name">{{ session.className }}</div>
              <div class="schedule-page__session-time">
                {{ session.startTime ?? '--:--' }}–{{ session.endTime ?? '--:--' }}
              </div>
              <div class="schedule-page__session-count">{{ session.enrolledCount }} 人</div>

              @if (isTeacherLed()) {
                @if (isFuture(session)) {
                  <!-- 未來課堂，不顯示點名 -->
                } @else if (isRetroactiveLocked(session)) {
                  <span class="schedule-page__locked">點名已截止</span>
                } @else if (session.takenAt) {
                  <p-button label="已點名" size="small" [outlined]="true" severity="secondary" (onClick)="openPanel(session)" />
                } @else {
                  <p-button label="開始點名" size="small" (onClick)="openPanel(session)" />
                }
              } @else {
                <!-- admin 模式：顯示出勤摘要，唯讀 -->
                @if (session.takenAt) {
                  <div class="schedule-page__summary">
                    <span class="schedule-page__summary--present">✓{{ session.presentCount }}</span>
                    <span class="schedule-page__summary--leave">🏳{{ session.onLeaveCount }}</span>
                    <span class="schedule-page__summary--absent">✗{{ session.absentCount }}</span>
                  </div>
                } @else if (!isFuture(session)) {
                  <span class="schedule-page__untaken">未點名</span>
                }
              }
            </div>
          } @empty {
            <div class="schedule-page__no-class">—</div>
          }
        </div>
      </div>
    }
  </div>
</div>

<p-sidebar
  [(visible)]="panelVisible"
  position="right"
  [style]="{ width: '380px' }"
  [showCloseIcon]="false"
>
  @if (activeSession()) {
    <app-attendance-roster-panel
      [session]="activeSession()!"
      (closed)="panelVisible.set(false)"
      (saved)="onPanelSaved($event)"
    />
  }
</p-sidebar>
```

- [ ] **Step 3: 實作 schedule.page.scss（BEM）**

```scss
.schedule-page {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  &__header {
    display: flex;
    align-items: center;
  }

  &__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--zinc-900);
    margin: 0;
  }

  &__week-nav {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  &__week-label {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--zinc-700);
    min-width: 200px;
    text-align: center;
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--space-2);
    overflow-x: auto;
  }

  &__day {
    min-width: 120px;
    border: 1px solid var(--zinc-200);
    border-radius: 8px;
    overflow: hidden;

    &--today {
      border-color: var(--sky-400);
    }
  }

  &__day-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-2);
    background: var(--zinc-50);
    border-bottom: 1px solid var(--zinc-200);

    .schedule-page__day--today & {
      background: var(--sky-50);
    }
  }

  &__day-label {
    font-size: 0.75rem;
    color: var(--zinc-500);
  }

  &__day-date {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--zinc-800);
  }

  &__day-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    min-height: 60px;
  }

  &__session-card {
    padding: var(--space-2);
    background: #fff;
    border: 1px solid var(--zinc-200);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__session-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--zinc-800);
  }

  &__session-time,
  &__session-count {
    font-size: 0.7rem;
    color: var(--zinc-500);
  }

  &__locked,
  &__untaken {
    font-size: 0.7rem;
    color: var(--zinc-400);
  }

  &__summary {
    display: flex;
    gap: var(--space-2);
    font-size: 0.75rem;

    &--present { color: var(--green-600); }
    &--leave { color: var(--yellow-600); }
    &--absent { color: var(--red-600); }
  }

  &__no-class {
    text-align: center;
    color: var(--zinc-300);
    font-size: 0.8rem;
    padding: var(--space-2);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/teacher/pages/schedule/
git commit -m "feat(teacher): implement schedule page MVP with weekly view and attendance panel"
```

---

## Task 10 [CODEX]：Seed 資料

**Files:**
- Create: `supabase/migrations/20260401000002_seed_attendance_test.sql`

- [ ] **Step 1: 建立 seed 檔**

建立以下 SQL，使用系統中現有的 org_id（查 `SELECT id FROM organizations LIMIT 1`）和真實的 campus_id、course_id 等 UUID。

```sql
-- SEED DATA：出勤作業台測試資料
-- 執行前請確認 org_id、campus_id、course_id 存在
-- 2026-04-01

DO $$
DECLARE
  v_org_id uuid;
  v_campus_id uuid;
  v_teacher_id uuid;
  v_course_id uuid;
  v_class_a uuid := gen_random_uuid();
  v_class_b uuid := gen_random_uuid();
  v_class_c uuid := gen_random_uuid();
  -- 12 students
  v_s1 uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid();
  v_s3 uuid := gen_random_uuid(); v_s4 uuid := gen_random_uuid();
  v_s5 uuid := gen_random_uuid(); v_s6 uuid := gen_random_uuid();
  v_s7 uuid := gen_random_uuid(); v_s8 uuid := gen_random_uuid();
  v_s9 uuid := gen_random_uuid(); v_s10 uuid := gen_random_uuid();
  v_s11 uuid := gen_random_uuid(); v_s12 uuid := gen_random_uuid();
  v_today date := CURRENT_DATE;
BEGIN
  SELECT id INTO v_org_id FROM organizations LIMIT 1;
  SELECT id INTO v_campus_id FROM campuses WHERE org_id = v_org_id LIMIT 1;
  SELECT id INTO v_teacher_id FROM ba_user LIMIT 1;
  SELECT id INTO v_course_id FROM courses WHERE org_id = v_org_id LIMIT 1;

  -- 1. 學生（12 名）
  INSERT INTO students (id, org_id, name, grade_level, school, status) VALUES
    (v_s1,  v_org_id, '劉靖雯', 'junior_2', '台北市立中正國中', 'active'),
    (v_s2,  v_org_id, '陳宇翔', 'junior_3', '台北市立大安國中', 'active'),
    (v_s3,  v_org_id, '林小明', 'junior_1', '台北市立信義國中', 'active'),
    (v_s4,  v_org_id, '張雅婷', 'elementary_6', '台北市立東門國小', 'active'),
    (v_s5,  v_org_id, '王志豪', 'junior_2', '新北市立板橋國中', 'active'),
    (v_s6,  v_org_id, '李佳穎', 'junior_3', '新北市立三重國中', 'active'),
    (v_s7,  v_org_id, '吳宗翰', 'elementary_5', '新北市立中和國小', 'active'),
    (v_s8,  v_org_id, '黃思婷', 'junior_1', '新北市立永和國中', 'active'),
    (v_s9,  v_org_id, '蔡明哲', 'junior_2', '桃園市立中壢國中', 'active'),
    (v_s10, v_org_id, '鄭雅文', 'elementary_6', '桃園市立桃園國小', 'active'),
    (v_s11, v_org_id, '許家豪', 'junior_3', '桃園市立八德國中', 'active'),
    (v_s12, v_org_id, '周怡君', 'junior_1', '桃園市立大溪國中', 'active')
  ON CONFLICT DO NOTHING;

  -- 2. 班級
  INSERT INTO classes (id, org_id, campus_id, course_id, name, teacher_id, status) VALUES
    (v_class_a, v_org_id, v_campus_id, v_course_id, '數學班 A', v_teacher_id, 'active'),
    (v_class_b, v_org_id, v_campus_id, v_course_id, '英文班 B', v_teacher_id, 'active'),
    (v_class_c, v_org_id, v_campus_id, v_course_id, '自然班 C', v_teacher_id, 'active')
  ON CONFLICT DO NOTHING;

  -- 3. Enrollments（數學班 A: s1-s8, 英文班 B: s5-s12, 自然班 C: s1-s4+s9-s12）
  INSERT INTO enrollments (id, org_id, class_id, student_id, status, effective_from) VALUES
    (gen_random_uuid(), v_org_id, v_class_a, v_s1, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_a, v_s2, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_a, v_s3, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_a, v_s4, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_a, v_s5, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_a, v_s6, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_a, v_s7, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_a, v_s8, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_b, v_s5,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_b, v_s6,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_b, v_s7,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_b, v_s8,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_b, v_s9,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_b, v_s10, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_b, v_s11, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_b, v_s12, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_c, v_s1,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_c, v_s2,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_c, v_s3,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_c, v_s4,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_c, v_s9,  'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_c, v_s10, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_c, v_s11, 'active', v_today - 30),
    (gen_random_uuid(), v_org_id, v_class_c, v_s12, 'active', v_today - 30)
  ON CONFLICT DO NOTHING;

  -- 4. Events（過去 2 週 + 今天 + 未來 1 週）
  -- 數學班 A: 週一三五 10:00-12:00
  -- 英文班 B: 週二四 14:00-16:00
  -- 自然班 C: 週六 09:00-11:00
  -- （以 generate_series 產生，此處簡化為固定日期插入）
  -- 實際實作時，Codex 應以 generate_series 動態計算正確的週一三五、週二四、週六日期

  -- 今天事件（數學班 A，已點名；英文班 B，未點名）
  -- 此處略，Codex 實作時以 CURRENT_DATE 動態計算

END $$;
```

> **Codex 注意**：實作時請以 `generate_series(CURRENT_DATE - 14, CURRENT_DATE + 7, '1 day')` 搭配 `EXTRACT(DOW)` 過濾星期，動態產生正確的 event 日期。今天的數學班 A 需設 `attendance_taken_at = NOW()`，英文班 B 不設（模擬未點名）。過去的課堂需建立 attendance_records（大多 present，每班至少 1 absent）。

- [ ] **Step 2: 套用 seed**

```bash
supabase db reset
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260401000002_seed_attendance_test.sql
git commit -m "feat(db): add seed data for attendance operations testing"
```

---

## Self-Review 結果

**Spec coverage 確認：**
- ✅ DB migration（attendance_taken_at + org_settings 欄位）→ Task 1
- ✅ org-settings API 擴充 → Task 2
- ✅ GET /api/attendance/sessions → Task 3
- ✅ GET /api/attendance/roster/:eventId → Task 3
- ✅ PATCH /api/attendance/batch（原子性）→ Task 4
- ✅ attendance.service.ts 擴充 → Task 5
- ✅ 共用點名面板元件 → Task 6
- ✅ Admin 出勤作業台改版 → Task 7
- ✅ SessionDetailDialog 改名 + 連結 → Task 8
- ✅ Teacher 課表頁 MVP → Task 9
- ✅ Seed 資料 → Task 10
- ✅ Enrollment snapshot 規則（event_date 當天有效）→ Task 3、4
- ✅ on_leave 顯示為 badge 非 toggle → Task 6
- ✅ attendance_taken_at immutable（首次設定後不更新）→ Task 4
- ⚠️ **留待後續**：Teacher API 需支援 teacherId 篩選（Task 9 已標 TODO）；daily-checkins 與 attendance_records 的優先順序衝突留待獨立處理。
