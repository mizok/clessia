# 課堂行事曆 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 實作 `/admin/calendar` 週/日視圖行事曆，取代排課管理/課堂搜尋/課務異動三個空 stub 頁面，讓管理員可瀏覽課堂並直接處理停課、代課、調課。

**Architecture:** CSS Grid 週視圖（桌機）/ 日視圖（手機），Sessions 以絕對定位色塊顯示於時間軸。點擊色塊開啟 Popup 查看詳情並執行異動。後端新增 `sessions.ts` 路由 + `schedule_changes` DB 表。

**Tech Stack:** Angular 21.1, PrimeNG 21.1, Hono 4.11 + @hono/zod-openapi 1.2, Supabase JS 2.95, date-fns 4.1, zod 4.3

---

## Phase 0: 環境調查（已完成）

### 版本資訊

| 套件 | 版本 |
|------|------|
| @angular/core | ^21.1.0 |
| primeng | ^21.1.1 |
| typescript | ~5.9.2 |
| date-fns | ^4.1.0 |
| hono | ^4.11.9 |
| @hono/zod-openapi | ^1.2.1 |
| @supabase/supabase-js | ^2.95.3 |
| zod | ^4.3.6 |

### 現有架構確認

- API 路由模式：`apps/api/src/routes/*.ts`，從 `apps/api/src/index.ts` 用 `app.route()` 掛載
- AppEnv 提供：`c.var.supabase`、`c.var.orgId`、`c.var.userId`
- Frontend service 放在：`apps/web/src/app/core/*.service.ts`
- 行事曆頁面已存在（空 stub）：`apps/web/src/app/features/admin/pages/calendar/`
- 設計系統：`apps/web/src/styles.scss`（CSS 變數）、參考 `courses.page.scss`
- API Base URL：`http://localhost:8788`（local）

---

## Phase 1: 功能規格

### Feature: 課堂行事曆

**概述**
統一行事曆介面，瀏覽課堂 + 處理停課/代課/調課。取代原本分散的 `/admin/schedule`、`/admin/sessions`、`/admin/changes` 三頁。

**響應式需求**
- [x] 需支援手機版：是
- [x] 桌機：週視圖（CSS Grid，Mon–Sun 7 欄）
- [x] 手機 < 768px：日視圖（單日，左右箭頭換日）

**共用元件識別**
- [x] 現有可用：`EmptyStateComponent`、`CampusesService`、`CoursesService`、`StaffService`
- [ ] 不需要新建 shared component（行事曆太特定）

**Checklist**

#### Database
- [x] 新增 `schedule_changes` 表（調課/代課/停課異動紀錄）
- [x] 新增 `schedule_change_type` enum
- [ ] 不需要 seed data（行事曆從 sessions 讀取現有資料）

#### API
- [x] `GET /api/sessions?from=&to=&campusId=&courseId=&teacherId=`
- [x] `GET /api/sessions/:id/changes`
- [x] `POST /api/sessions/:id/cancel`
- [x] `POST /api/sessions/:id/substitute`
- [x] `POST /api/sessions/:id/reschedule`

#### Frontend
- [x] `sessions.service.ts`（HTTP client + interfaces）
- [x] `calendar.page.ts/html/scss`（週/日行事曆 + 3 個操作 dialog）
- [x] 設計參考：`courses.page.scss`、`classes.page.scss`

**測試情境**
1. 切換週次 → 課堂資料正確更新
2. 篩選分校/課程/老師 → 只顯示符合條件的課堂
3. 停課 → 課堂變灰色 + 記錄出現在異動紀錄
4. 代課 → 課堂變橘色 + 異動紀錄顯示代課老師
5. 調課 → 課堂變橘色 + 異動紀錄顯示新時間
6. 手機版 → 顯示日視圖，操作正常

**相依性**
- `sessions` 表已存在（由開課班的「產生課堂」功能建立）
- `classes`、`courses`、`campuses`、`staff` 表已存在

---

## Phase 2: Database（委派 Codex）

**【驗證點】** `supabase migration up --local` 無錯誤

### Codex Prompt

```
## Context
- 專案：Clessia（補習班管理系統）
- Tech Stack：Supabase PostgreSQL
- 參考檔案：supabase/migrations/20260223000001_create_classes.sql（參考 sessions 表定義）

## 版本資訊
- Supabase CLI（本地開發）

## 任務

建立新的 migration 檔案，路徑：`supabase/migrations/20260224000001_create_schedule_changes.sql`

內容如下：

```sql
CREATE TYPE public.schedule_change_type AS ENUM ('reschedule', 'substitute', 'cancellation');

CREATE TABLE public.schedule_changes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id            uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  change_type           public.schedule_change_type NOT NULL,
  new_session_date      date,
  new_start_time        time,
  new_end_time          time,
  substitute_teacher_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reason                text,
  created_by_name       text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX schedule_changes_org_id_idx ON public.schedule_changes(org_id, created_at DESC);
CREATE INDEX schedule_changes_session_id_idx ON public.schedule_changes(session_id);

COMMENT ON TABLE public.schedule_changes IS '課務異動紀錄（調課/代課/停課）';
```

接著執行驗證：
```bash
supabase migration up --local
```

## 限制條件
- 不要執行 `supabase db reset`（保留現有測試資料）
- 只建立這一個 migration 檔案

## 預期產出
- `supabase/migrations/20260224000001_create_schedule_changes.sql`
- migration 套用成功，無錯誤訊息
```

**Codex 呼叫方式（在 Claude Code 執行）：**
```
mcp__codex-cli__codex({
  prompt: "（上方 prompt 內容）",
  sessionId: "feature-calendar-phase2",
  workingDirectory: "/Users/mizokhuangmbp2023/Desktop/Workspace/clessia",
  sandbox: "workspace-write"
})
```

**【驗證】** 確認輸出包含 `migration applied successfully` 或無錯誤。

---

## Phase 3: API（委派 Codex）

**【驗證點】** `npx tsc --noEmit`（在 api 根目錄）無 TypeScript 錯誤

### Codex Prompt

```
## Context
- 專案：Clessia API
- Tech Stack：Hono 4.11, @hono/zod-openapi 1.2, @supabase/supabase-js 2.95, zod 4.3, TypeScript 5.9
- 參考檔案：
  - apps/api/src/routes/campuses.ts（參考路由寫法、schema 結構、mapXxx helper 模式）
  - apps/api/src/index.ts（查看現有 route 掛載方式）
  - apps/api/src/middleware/auth.ts（確認 c.var.supabase / orgId / userId 用法）

## 版本資訊
- hono: ^4.11.9
- @hono/zod-openapi: ^1.2.1
- @supabase/supabase-js: ^2.95.3
- zod: ^4.3.6

## 任務

**建立 `apps/api/src/routes/sessions.ts`**，實作以下端點：

### GET /（查詢課堂列表）

Query params（用 zod 定義）：
- `from: string`（YYYY-MM-DD，必填）
- `to: string`（YYYY-MM-DD，必填）
- `campusId?: string`
- `courseId?: string`
- `teacherId?: string`

Supabase 查詢（使用 PostgREST join 語法）：
```typescript
supabase
  .from('sessions')
  .select(`
    id, session_date, start_time, end_time, status,
    class_id, teacher_id,
    classes!inner (
      name,
      courses!inner ( id, name ),
      campuses!inner ( id, name )
    ),
    staff!inner ( display_name )
  `)
  .eq('org_id', orgId)
  .gte('session_date', from)
  .lte('session_date', to)
  .order('session_date')
  .order('start_time')
```

若有 campusId，加 `.eq('classes.campus_id', campusId)`；courseId 同理 `.eq('classes.course_id', courseId)`；teacherId 加 `.eq('teacher_id', teacherId)`。

查詢完後，另外查詢哪些 session id 有 schedule_changes 紀錄：
```typescript
const { data: changes } = await supabase
  .from('schedule_changes')
  .select('session_id')
  .in('session_id', sessionIds);
const changedIds = new Set(changes?.map(c => c.session_id) ?? []);
```

Response schema（camelCase）：
```typescript
{
  data: Array<{
    id: string
    sessionDate: string        // YYYY-MM-DD
    startTime: string          // HH:mm（slice 前五碼）
    endTime: string            // HH:mm
    status: 'scheduled' | 'completed' | 'cancelled'
    classId: string
    className: string
    courseId: string
    courseName: string
    campusId: string
    campusName: string
    teacherId: string
    teacherName: string
    hasChanges: boolean
  }>
}
```

### GET /:id/changes（查詢單一課堂異動紀錄）

```typescript
supabase
  .from('schedule_changes')
  .select(`
    id, change_type, new_session_date, new_start_time, new_end_time,
    reason, created_by_name, created_at,
    staff!substitute_teacher_id ( id, display_name )
  `)
  .eq('session_id', id)
  .order('created_at', { ascending: false })
```

Response：
```typescript
{
  data: Array<{
    id: string
    changeType: 'reschedule' | 'substitute' | 'cancellation'
    newSessionDate: string | null
    newStartTime: string | null    // HH:mm
    newEndTime: string | null      // HH:mm
    substituteTeacherId: string | null
    substituteTeacherName: string | null
    reason: string | null
    createdByName: string | null
    createdAt: string
  }>
}
```

### POST /:id/cancel（停課）

Request body: `{ reason?: string }`

1. 更新 sessions.status = 'cancelled'（.eq('id', id).eq('org_id', orgId)）
2. 查詢 profiles.display_name（.eq('id', userId).maybeSingle()）
3. 寫入 schedule_changes：`{ org_id, session_id: id, change_type: 'cancellation', reason, created_by_name }`

Response: `{ success: true }`

### POST /:id/substitute（代課）

Request body: `{ substituteTeacherId: string, reason?: string }`

1. 查詢 profiles.display_name
2. 寫入 schedule_changes：`{ org_id, session_id: id, change_type: 'substitute', substitute_teacher_id, reason, created_by_name }`

Response: `{ success: true }`

### POST /:id/reschedule（調課）

Request body: `{ newSessionDate: string, newStartTime: string, newEndTime: string, reason?: string }`

1. 查詢 profiles.display_name
2. 寫入 schedule_changes：`{ org_id, session_id: id, change_type: 'reschedule', new_session_date, new_start_time, new_end_time, reason, created_by_name }`

Response: `{ success: true }`

---

**修改 `apps/api/src/index.ts`**：

1. 加入 import：`import sessionsRoute from './routes/sessions';`
2. 在最後一個 app.route 後加入：`app.route('/api/sessions', sessionsRoute);`

## 限制條件
- 嚴格遵守現有 campuses.ts 的 OpenAPIHono 路由寫法（createRoute + openapi）
- camelCase response，DB snake_case
- 所有 zod schema 加 .openapi() 標記
- 不要修改其他現有檔案

## 預期產出
- `apps/api/src/routes/sessions.ts`（新建）
- `apps/api/src/index.ts`（修改，加 import + route）
```

**Codex 呼叫方式：**
```
mcp__codex-cli__codex({
  prompt: "（上方 prompt 內容）",
  sessionId: "feature-calendar-phase3",
  workingDirectory: "/Users/mizokhuangmbp2023/Desktop/Workspace/clessia",
  sandbox: "workspace-write"
})
```

**【驗證】**
```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia && npx tsc -p apps/api/tsconfig.json --noEmit 2>&1 | head -20
```
預期：無 error 輸出。

---

## Phase 4: Frontend Service（委派 Codex）

**【驗證點】** `npx ng build` 無錯誤

### Codex Prompt

```
## Context
- 專案：Clessia Frontend
- Tech Stack：Angular 21.1, TypeScript 5.9, RxJS
- 參考檔案：apps/web/src/app/core/classes.service.ts（參考 Observable + inject 寫法）

## 版本資訊
- @angular/core: ^21.1.0
- typescript: ~5.9.2

## 任務

建立 `apps/web/src/app/core/sessions.service.ts`：

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Session {
  id: string;
  sessionDate: string;     // YYYY-MM-DD
  startTime: string;       // HH:mm
  endTime: string;         // HH:mm
  status: 'scheduled' | 'completed' | 'cancelled';
  classId: string;
  className: string;
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  teacherId: string;
  teacherName: string;
  hasChanges: boolean;
}

export interface ScheduleChange {
  id: string;
  changeType: 'reschedule' | 'substitute' | 'cancellation';
  newSessionDate: string | null;
  newStartTime: string | null;
  newEndTime: string | null;
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface SessionQueryParams {
  from: string;
  to: string;
  campusId?: string;
  courseId?: string;
  teacherId?: string;
}

@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/sessions`;

  list(params: SessionQueryParams): Observable<{ data: Session[] }> {
    const query: Record<string, string> = { from: params.from, to: params.to };
    if (params.campusId) query['campusId'] = params.campusId;
    if (params.courseId) query['courseId'] = params.courseId;
    if (params.teacherId) query['teacherId'] = params.teacherId;
    return this.http.get<{ data: Session[] }>(this.endpoint, { params: query });
  }

  getChanges(sessionId: string): Observable<{ data: ScheduleChange[] }> {
    return this.http.get<{ data: ScheduleChange[] }>(`${this.endpoint}/${sessionId}/changes`);
  }

  cancel(sessionId: string, reason?: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.endpoint}/${sessionId}/cancel`, { reason });
  }

  substitute(sessionId: string, substituteTeacherId: string, reason?: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.endpoint}/${sessionId}/substitute`, {
      substituteTeacherId,
      reason,
    });
  }

  reschedule(
    sessionId: string,
    newSessionDate: string,
    newStartTime: string,
    newEndTime: string,
    reason?: string,
  ): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.endpoint}/${sessionId}/reschedule`, {
      newSessionDate, newStartTime, newEndTime, reason,
    });
  }
}
```

## 限制條件
- `providedIn: 'root'`
- 使用 `inject()` 不用 constructor injection
- `private readonly` 修飾所有 DI 屬性
- `import type` for type-only imports

## 預期產出
- `apps/web/src/app/core/sessions.service.ts`（新建）
```

**Codex 呼叫方式：**
```
mcp__codex-cli__codex({
  prompt: "（上方 prompt 內容）",
  sessionId: "feature-calendar-phase4",
  workingDirectory: "/Users/mizokhuangmbp2023/Desktop/Workspace/clessia",
  sandbox: "workspace-write"
})
```

**【驗證】**
```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia && npx ng build 2>&1 | grep -E "error|ERROR|✓" | head -20
```
預期：無 ERROR，有 `✓ Building...`。

---

## Phase 5: Frontend UI（Claude 執行）

> 此 Phase 由 Claude 自行實作，不委派 Codex。需設計判斷。

**【驗證點】** `npx ng build` 無錯誤 + 瀏覽器視覺檢查

### 5a: Routes Catalog + Router 更新

**修改 `apps/web/src/app/core/smart-enums/routes-catalog.ts`：**

1. 將 `ADMIN_CALENDAR` 從 ungrouped 移入「教務管理」群組，標籤改為「課堂行事曆」：
   ```typescript
   public static readonly ADMIN_CALENDAR = this.register(
     'calendar', '/admin/calendar', '課堂行事曆',
     UserType.ADMIN, 'pi-calendar',
     true, '教務管理',
   );
   ```

2. 將以下三個改為 `showInMenu: false`（第六個參數）：
   - `ADMIN_SCHEDULE`
   - `ADMIN_SESSIONS`
   - `ADMIN_CHANGES`

3. `ADMIN_CALENDAR` 的位置在 routes-catalog 中移到 `ADMIN_CLASSES` 後面。

**確認 `apps/web/src/app/app.routes.ts`** 已有 calendar 路由（若無則加入）。

Commit：
```bash
git add apps/web/src/app/core/smart-enums/routes-catalog.ts apps/web/src/app/app.routes.ts
git commit -m "feat(nav): move calendar to 教務管理, hide schedule/sessions/changes stubs"
```

### 5b: 行事曆頁面（calendar.page.ts）

**修改 `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`**

完整 TypeScript 實作（含所有 signals、grid 計算、操作邏輯）：

**常數：**
```typescript
const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 22;
const SLOT_HEIGHT_PX = 36; // px per 30-min slot
```

**Computed signals：**
- `weekStart` / `weekEnd` / `weekDays`（7 天陣列）：用 `startOfWeek(currentDate(), { weekStartsOn: 1 })` + `addDays`
- `weekLabel`：`format(weekStart, 'yyyy/MM/dd') – format(weekEnd, 'MM/dd')`
- `dayLabel`：`format(currentDate, 'yyyy/MM/dd (EEE)', { locale: zhTW })`
- `timeSlots`：從 08:00 到 21:30，每 30 分鐘一格，共 28 個（`['08:00','08:30',...,'21:30']`）
- `gridHeight`：`(CALENDAR_END_HOUR - CALENDAR_START_HOUR) * 2 * SLOT_HEIGHT_PX`（= 1008px）
- `isWeekView`：`signal(window.innerWidth >= 768)`

**Grid helpers（protected methods）：**
```typescript
getSessionTop(startTime: string): number {
  const [h, m] = startTime.split(':').map(Number);
  return ((h - CALENDAR_START_HOUR) * 2 + m / 30) * SLOT_HEIGHT_PX;
}

getSessionHeight(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 30 * SLOT_HEIGHT_PX;
}

getSessionsForDay(day: Date): Session[] {
  return this.sessions().filter(s => s.sessionDate === format(day, 'yyyy-MM-dd'));
}
```

**Navigation：**
- `prevPeriod()` / `nextPeriod()`：週視圖用 `addWeeks(±1)`，日視圖用 `addDays(±1)`
- `goToday()`：`currentDate.set(new Date())`
- 每次導航後呼叫 `loadSessions()`

**Filter loading（`loadFilters()` in `ngOnInit`）：**
- `campusesService.list({ isActive: true, pageSize: 100 })`
- `coursesService.list({ isActive: true, pageSize: 200 })`
- `staffService.list({ isActive: true, pageSize: 200 })`

**Operation helpers：**
```typescript
protected sessionStatusLabel(s: Session): string {
  if (s.status === 'cancelled') return '停課';
  if (s.hasChanges) return '有異動';
  return '正常';
}

protected sessionStatusSeverity(s: Session): 'info' | 'secondary' | 'warn' {
  if (s.status === 'cancelled') return 'secondary';
  if (s.hasChanges) return 'warn';
  return 'info';
}

protected canOperate(session: Session | null): boolean {
  return !!session && session.status !== 'cancelled';
}
```

**Imports 清單：**
```typescript
import { startOfWeek, endOfWeek, addWeeks, addDays, format, isToday } from 'date-fns';
import { zhTW } from 'date-fns/locale';
```

PrimeNG imports：`ButtonModule, SelectModule, DatePickerModule, DialogModule, ToastModule, TagModule, SkeletonModule, TooltipModule`

### 5c: HTML 模板（calendar.page.html）

結構如下：

```
<p-toast />
<div class="cal">
  <!-- Header：標題 + 導航（上週/今天/下週箭頭 + DatePicker） -->
  <!-- Filters：分校/課程/老師三個 p-select -->
  <!-- Calendar Card：
       @if loading → <p-skeleton>
       @else if isWeekView() →
         <div class="cal__week">（CSS Grid 7 欄）
           - 頂部：時間 gutter + 7 個 day header
           - 主體：時間軸 + 7 個 day column（絕對定位 session blocks）
         </div>
       @else →
         <div class="cal__day-view">（2 欄 grid）
           - 時間軸 + 單日 day column
         </div>
  -->
</div>

<!-- Detail Popup（p-dialog, breakpoints 768px→100vw）-->
<!-- Cancel Dialog -->
<!-- Substitute Dialog -->
<!-- Reschedule Dialog -->
```

Session 色塊在 `cal__day-col` 內用 `position: absolute`：
```html
<div
  class="cal__session"
  [class.cal__session--scheduled]="s.status === 'scheduled' && !s.hasChanges"
  [class.cal__session--cancelled]="s.status === 'cancelled'"
  [class.cal__session--changed]="s.status === 'scheduled' && s.hasChanges"
  [style.top.px]="getSessionTop(s.startTime)"
  [style.height.px]="getSessionHeight(s.startTime, s.endTime)"
  (click)="openDetail(s)"
>
  <span class="cal__session-class">{{ s.className }}</span>
  <span class="cal__session-teacher">{{ s.teacherName }}</span>
</div>
```

### 5d: SCSS（calendar.page.scss）

**色彩語意（依 sessions 狀態）：**

| 狀態 | BEM class | 顏色 |
|------|-----------|------|
| 正常 | `--scheduled` | `accent-100` 背景，`accent-500` 左邊框 |
| 停課 | `--cancelled` | `zinc-100` 背景，`zinc-400` 左邊框，line-through |
| 有異動 | `--changed` | `warning-100` 背景，`warning-600` 左邊框 |

**Grid 結構：**
```scss
.cal__week {
  display: grid;
  grid-template-columns: 56px repeat(7, minmax(0, 1fr));
  grid-template-rows: 48px auto;
  min-width: 600px;  // 強制水平 scroll 於小螢幕
}

.cal__day-col {
  position: relative;
  border-left: 1px solid var(--zinc-100);
}

.cal__hour-line {
  position: absolute;
  left: 0; right: 0;
  height: 1px;
  background: var(--zinc-100);
  &--major { background: var(--zinc-200); }
}

.cal__session {
  position: absolute;
  left: 4px; right: 4px;
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  font-size: var(--text-xs);
  overflow: hidden;
  transition: opacity var(--transition-fast);
  &:hover { opacity: 0.85; }
}
```

Mobile（`@include bp.respond-to('mobile')`）：
- `.cal { padding: var(--space-3); }`
- `.cal__header { flex-direction: column; }`
- `.cal__day-view { display: grid; grid-template-columns: 56px 1fr; }`

Commit：
```bash
git add apps/web/src/app/features/admin/pages/calendar/
git commit -m "feat(web): implement 課堂行事曆 - week/day view with session operations"
```

### 5e: 清理 spec 檔

```bash
rm doc/specs/admin/academic/schedule.md
rm doc/specs/admin/academic/sessions.md
rm doc/specs/admin/academic/changes.md
```

建立 `doc/specs/admin/academic/calendar.md`（直接引用 design doc 摘要即可）。

Commit：
```bash
git add doc/specs/admin/academic/
git commit -m "docs: replace schedule/sessions/changes specs with unified calendar spec"
```

**【驗證 Phase 5】**

```bash
# Build 驗證
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia && npx ng build 2>&1 | grep -E "error|ERROR|✓" | head -20
```

瀏覽器驗證清單：
- [ ] Sidebar「教務管理」出現「課堂行事曆」，排課管理/課堂搜尋/課務異動消失
- [ ] 週視圖顯示正確（7 欄 + 時間軸）
- [ ] 導航（上/下週、今天、日期選擇器）正常
- [ ] 課堂色塊出現在正確時間位置
- [ ] 點擊色塊開啟 Detail Popup
- [ ] 停課操作：確認後課堂變灰色
- [ ] 手機寬度 < 768px 切換成日視圖

---

## Phase 6: E2E 驗證（委派 Codex）

### Codex Prompt

```
## Context
- 專案：Clessia Frontend
- Tech Stack：Playwright
- 前提：dev server 在 http://localhost:4200 運行，已登入 admin 帳號

## 任務

寫一個簡單的 Playwright 腳本，手動執行驗證（不需要寫成正式測試檔案，輸出操作截圖即可）：

1. 導航到 http://localhost:4200/admin/calendar
2. 截圖：確認週視圖顯示
3. 點擊「下週」按鈕，截圖
4. 點擊「今天」按鈕，截圖
5. 若頁面有課堂色塊，點擊第一個，截圖：確認 Detail Popup 顯示

把截圖儲存到 /tmp/calendar-screenshots/

## 預期產出
- /tmp/calendar-screenshots/ 中的截圖檔案
```

**Codex 呼叫方式：**
```
mcp__codex-cli__codex({
  prompt: "（上方 prompt 內容）",
  sessionId: "feature-calendar-phase6",
  workingDirectory: "/Users/mizokhuangmbp2023/Desktop/Workspace/clessia",
  sandbox: "workspace-write"
})
```
