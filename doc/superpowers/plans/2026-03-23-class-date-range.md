# Class Date Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為班級加入 `start_date` / `end_date` 欄位，並在產生課堂 dialog 中限制日曆只能選擇班級有效期間內的日期。

**Architecture:** DB migration 新增兩個可選欄位 → API 的 GET/POST/PATCH 同步支援 → 前端 `Class` interface 加欄位 → ClassFormDialog 加日期選擇器 → GenerateSessionsDialog 以 `minDate`/`maxDate` 限制日曆選擇範圍。

**Tech Stack:** Supabase PostgreSQL migration、Hono + Zod OpenAPI (apps/api)、Angular 21 Signals、PrimeNG DatePicker

---

## File Map

| 動作 | 路徑 |
|------|------|
| Create | `supabase/migrations/20260323000001_add_class_date_range.sql` |
| Modify | `apps/api/src/routes/classes.ts` |
| Modify | `apps/web/src/app/core/classes.service.ts` |
| Modify | `apps/web/src/app/features/admin/pages/courses/class-form-dialog/class-form-dialog.component.ts` |
| Modify | `apps/web/src/app/features/admin/pages/courses/class-form-dialog/class-form-dialog.component.html` |
| Modify | `apps/web/src/app/features/admin/pages/courses/generate-sessions-dialog/generate-sessions-dialog.component.ts` |
| Modify | `apps/web/src/app/features/admin/pages/courses/generate-sessions-dialog/generate-sessions-dialog.component.html` |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260323000001_add_class_date_range.sql`

- [ ] **Step 1: 建立 migration 檔案**

```sql
-- 為班級加入有效期間欄位（皆可為 null，代表無限制）
ALTER TABLE public.classes
  ADD COLUMN start_date date,
  ADD COLUMN end_date date;

COMMENT ON COLUMN public.classes.start_date IS '班級開始日期（null = 無限制）';
COMMENT ON COLUMN public.classes.end_date IS '班級結束日期（null = 無限制）';
```

- [ ] **Step 2: 套用 migration**

```bash
supabase db reset
```

Expected: 無錯誤，classes 表多了 `start_date`、`end_date` 兩欄。

---

## Task 2: API — classes.ts

**Files:**
- Modify: `apps/api/src/routes/classes.ts`

**目前狀況：**
- `ClassSchema` (response) 有 `id, orgId, campusId, name, maxStudents, gradeLevels, isActive, ...`
- `rowToClass()` helper 做資料轉換
- POST (create) 和 PATCH (update) body schema 各自定義

- [ ] **Step 1: 在 `ClassSchema` 加入兩個可選欄位**

在 response schema（搜尋 `updatedByName: z.string().nullable().optional()`）後面加：

```ts
startDate: z.string().nullable().optional(), // 'yyyy-MM-dd' or null
endDate: z.string().nullable().optional(),
```

- [ ] **Step 2: 在 `rowToClass()` 轉換函式加入欄位對應**

```ts
startDate: (row['start_date'] as string | null) ?? null,
endDate: (row['end_date'] as string | null) ?? null,
```

- [ ] **Step 3: 在 POST body schema 加入可選欄位**

搜尋 POST route 的 body schema（含 `name`, `maxStudents`, `gradeLevels`），加入：

```ts
startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
```

- [ ] **Step 4: 在 POST insert 加入欄位**

```ts
start_date: body.startDate ?? null,
end_date: body.endDate ?? null,
```

- [ ] **Step 5: 在 PATCH body schema 加入可選欄位**（同 Step 3 格式）

- [ ] **Step 6: 在 PATCH update 加入欄位**

```ts
...(body.startDate !== undefined && { start_date: body.startDate }),
...(body.endDate !== undefined && { end_date: body.endDate }),
```

- [ ] **Step 7: 確認 API 可正常啟動**

```bash
cd apps/api && npx tsx src/index.ts
```

Expected: 無 TypeScript 錯誤。

---

## Task 3: Frontend — Class interface & ClassesService

**Files:**
- Modify: `apps/web/src/app/core/classes.service.ts`

- [ ] **Step 1: 在 `Class` interface 加入兩個可選欄位**

```ts
startDate?: string | null;  // 'yyyy-MM-dd'
endDate?: string | null;
```

位置：在 `updatedByName` 之後、`schedules` 之前。

- [ ] **Step 2: 確認前端仍可編譯**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error|ERROR" | head -20
```

Expected: 無錯誤。

---

## Task 4: ClassFormDialog — 加入日期欄位

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/class-form-dialog/class-form-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-form-dialog/class-form-dialog.component.html`

**目前狀況：**
ClassFormDialog 用 `this.config.data?.cls` 取得既有班級資料（edit 模式），有 `form` reactive form 或 signals 管理欄位，最後呼叫 `classesService.createClass()` / `updateClass()`。

先讀 `.component.ts` 確認 form 結構再動手。

- [ ] **Step 1: 在 TS 加入 startDate / endDate signals（或 form controls）**

若使用 signals：
```ts
protected readonly startDate = signal<Date | null>(
  cls?.startDate ? new Date(cls.startDate) : null
);
protected readonly endDate = signal<Date | null>(
  cls?.endDate ? new Date(cls.endDate) : null
);
```

若使用 ReactiveForm，在 FormGroup 加：
```ts
startDate: new FormControl<Date | null>(
  cls?.startDate ? new Date(cls.startDate) : null
),
endDate: new FormControl<Date | null>(
  cls?.endDate ? new Date(cls.endDate) : null
),
```

- [ ] **Step 2: 在送出邏輯加入欄位**

```ts
startDate: this.startDate() ? format(this.startDate()!, 'yyyy-MM-dd') : null,
endDate: this.endDate() ? format(this.endDate()!, 'yyyy-MM-dd') : null,
```

（`format` 來自 `date-fns`，已在 generate-sessions-dialog 使用，確認 import）

- [ ] **Step 3: 在 HTML 加入兩個 DatePicker 欄位**

位置：在現有欄位最後（例如 `gradeLevels` 或 `maxStudents` 之後）：

```html
<div class="form-dialog__row">
  <div class="form-dialog__field">
    <label class="form-dialog__label">開始日期</label>
    <p-datepicker
      [ngModel]="startDate()"
      (ngModelChange)="startDate.set($event)"
      dateFormat="yy-mm-dd"
      [showIcon]="true"
      [showClear]="true"
      placeholder="不限"
      styleClass="w-full"
      [appendTo]="'body'"
    />
  </div>
  <div class="form-dialog__field">
    <label class="form-dialog__label">結束日期</label>
    <p-datepicker
      [ngModel]="endDate()"
      (ngModelChange)="endDate.set($event)"
      dateFormat="yy-mm-dd"
      [showIcon]="true"
      [showClear]="true"
      placeholder="不限"
      styleClass="w-full"
      [appendTo]="'body'"
      [minDate]="startDate() ?? undefined"
    />
  </div>
</div>
```

- [ ] **Step 4: 確認前端可編譯**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error|ERROR" | head -20
```

---

## Task 5: GenerateSessionsDialog — 限制日曆範圍

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/generate-sessions-dialog/generate-sessions-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/courses/generate-sessions-dialog/generate-sessions-dialog.component.html`

**目前狀況：**
- `cls` signal 已有完整 `Class` 資料（由 `this.config.data?.cls` 注入）
- `generateFrom` / `generateTo` 為 `signal<Date | null>`
- HTML 的兩個 `p-datepicker` 目前沒有 `minDate` / `maxDate` 限制

- [ ] **Step 1: 在 TS 加入 computed minDate / maxDate**

```ts
protected readonly classStartDate = computed(() => {
  const d = this.cls()?.startDate;
  return d ? new Date(d) : undefined;
});

protected readonly classEndDate = computed(() => {
  const d = this.cls()?.endDate;
  return d ? new Date(d) : undefined;
});
```

- [ ] **Step 2: 在 HTML 的開始日期 datepicker 加上限制**

```html
<p-datepicker
  [ngModel]="generateFrom()"
  (ngModelChange)="generateFrom.set($event)"
  dateFormat="yy-mm-dd"
  [showIcon]="true"
  placeholder="選擇日期"
  styleClass="w-full"
  [appendTo]="'body'"
  [minDate]="classStartDate()"
  [maxDate]="classEndDate()"
/>
```

- [ ] **Step 3: 在 HTML 的結束日期 datepicker 加上限制**

```html
<p-datepicker
  [ngModel]="generateTo()"
  (ngModelChange)="generateTo.set($event)"
  dateFormat="yy-mm-dd"
  [showIcon]="true"
  placeholder="選擇日期"
  styleClass="w-full"
  [appendTo]="'body'"
  [minDate]="generateFrom() ?? classStartDate()"
  [maxDate]="classEndDate()"
/>
```

- [ ] **Step 4: 若班級有 startDate/endDate，在 hint 文字顯示範圍提示**

在 `<p class="generate-hint">` 下方加：

```html
@if (classStartDate() || classEndDate()) {
  <p class="generate-range-hint">
    <i class="pi pi-info-circle"></i>
    班級有效期間：
    {{ classStartDate() ? (classStartDate()! | date:'yyyy-MM-dd') : '不限' }}
    ～
    {{ classEndDate() ? (classEndDate()! | date:'yyyy-MM-dd') : '不限' }}
  </p>
}
```

需在 imports 加 `DatePipe`（或用 `date-fns format`）。

- [ ] **Step 5: 確認前端可編譯**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error|ERROR" | head -20
```

---

## Task 6: 驗收

- [ ] **手動測試：新增班級**
  - 開啟新增班級 dialog，設定開始/結束日期
  - 儲存後重新整理，確認日期正確顯示（class row 或詳情頁）

- [ ] **手動測試：產生課堂日曆限制**
  - 對有 startDate/endDate 的班級點「產生課堂」
  - 確認日曆無法選到有效期間外的日期
  - 確認 hint 文字正確顯示範圍

- [ ] **手動測試：無日期班級不受影響**
  - 對沒有設定 startDate/endDate 的班級點「產生課堂」
  - 確認日曆可自由選擇，無任何限制

- [ ] **Commit**

```bash
git add supabase/migrations/20260323000001_add_class_date_range.sql \
  apps/api/src/routes/classes.ts \
  apps/web/src/app/core/classes.service.ts \
  apps/web/src/app/features/admin/pages/courses/class-form-dialog/ \
  apps/web/src/app/features/admin/pages/courses/generate-sessions-dialog/
git commit -m "feat(classes): add start_date/end_date and constrain session generation calendar"
```

---

## Task 7: 人員／學生／家長列表 — 改用 Container Query 取代 Viewport Media Query

**Problem:** `staff.page.scss`、`students.page.scss`、`parents.page.scss` 目前全部用 viewport-based `respond-to('tablet-portrait')` / `respond-to(480px)`。在 sidebar 展開、內容區變窄時，列表 row 不會自動調整，導致 overflow。

**Fix 原則（同 courses.page 作法）：**
1. 在各頁面的主卡片容器加 `container-type: inline-size; container-name: <x>-card`
2. 把所有 row 相關的 `@include bp.respond-to(...)` 改成 `@include bp.respond-to-container('<x>-card', ...)`
3. Row 內的名稱欄位加 `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
4. 次要欄位（科目、分校標籤、電話等）在窄容器下隱藏或折行到第二行（右對齊）

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/staff/staff.page.scss`
- Modify: `apps/web/src/app/features/admin/pages/students/students.page.scss`
- Modify: `apps/web/src/app/features/admin/pages/parents/parents.page.scss`

**注意：** 讀每個檔案後，先確認：
- 主卡片 wrapper 的 BEM class 名稱（加 container 屬性用）
- `respond-to` 裡面有哪些是 row 相關（需改為 container query）vs page 整體 layout（可保留 viewport media query）

- [ ] **Step 1: staff.page.scss**
  - 讀 `staff.page.scss` 確認主卡片 class 名稱
  - 在主卡片加 `container-type: inline-size; container-name: staff-card`
  - 把 `@include bp.respond-to('tablet-portrait')` 和 `@include bp.respond-to(480px)` 中 row 相關部分改為 `@include bp.respond-to-container('staff-card', 'tablet-portrait')` / `respond-to-container('staff-card', 480px)`
  - 確認 `__name` 有 `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`

- [ ] **Step 2: students.page.scss**（同 Step 1 模式）
  - container-name: `students-card`

- [ ] **Step 3: parents.page.scss**（同 Step 1 模式）
  - container-name: `parents-card`

- [ ] **Step 4: 視覺驗收**
  - 在 DevTools 把 content 區拖窄到 ~480px（模擬 sidebar 展開 + 小視窗）
  - 確認三個頁面的 row 都能正常折行或隱藏次要資訊，無 horizontal overflow

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/staff/staff.page.scss \
  apps/web/src/app/features/admin/pages/students/students.page.scss \
  apps/web/src/app/features/admin/pages/parents/parents.page.scss
git commit -m "fix(ui): replace viewport media queries with container queries for staff/students/parents list rows"
```
