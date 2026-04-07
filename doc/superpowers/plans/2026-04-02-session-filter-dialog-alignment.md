# 課堂管理與出勤紀錄 Filter Dialog 對齊實作計劃

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 讓 `課堂管理` 與 `課堂出勤紀錄` 共用一致的進階篩選互動，將高頻條件留在頁面工具列，將課程模糊搜尋與班級等低頻條件收進 dialog，同時補齊 `/api/attendance/sessions` 的分頁結構。

**Architecture:** `課堂管理` 與 `課堂出勤紀錄` 都改成「日期/分校工具列 + 進階篩選 dialog」模式；課程採分校 scope 內模糊搜尋、多選，班級只在已選課程後才出現。API 端將 `attendance/sessions` 對齊成 `{ data, meta }` 分頁回應，並支援 `courseIds` 與 `classIds`；出勤頁固定排除 `cancelled`，不暴露狀態篩選。

**Tech Stack:** Angular 21 Standalone + Signals、PrimeNG 21、Hono + Zod OpenAPI、Supabase JS、Vitest、date-fns

---

## 範圍與假設

- `課堂管理` 保留：
  - 工具列：日期範圍、分校、多校區既有行為
  - 進階 dialog：課程、班級、老師、課堂狀態
- `課堂出勤紀錄` 改成：
  - 工具列：日期範圍、單一分校、進階篩選按鈕
  - 進階 dialog：課程、班級、學生
- `班級` 只有在至少選了一門 `課程` 後才顯示。
- `課程` 搜尋只在當前分校 scope 內查找。
- `課堂出勤紀錄` 若尚未做「記住上次分校」功能，本次先採 `第一個可用分校` 為預設值。

---

## 異動檔案總覽

**Backend**
- Modify: `apps/api/src/routes/attendance.ts`

**Web Core**
- Modify: `apps/web/src/app/core/attendance.service.ts`

**課堂管理**
- Modify: `apps/web/src/app/features/admin/pages/sessions/sessions.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/sessions.page.html`
- Modify: `apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.html`
- Modify: `apps/web/src/app/features/admin/pages/sessions/dialogs/mobile-filter-dialog/mobile-filter-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/dialogs/mobile-filter-dialog/mobile-filter-dialog.component.html`

**出勤紀錄**
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.html`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss`

**新共用元件**
- Create: `apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.ts`
- Create: `apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.html`
- Create: `apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.scss`
- Create: `apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.spec.ts`

**測試**
- Modify: `apps/api/src/routes/attendance.spec.ts`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.spec.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.spec.ts`

---

### Task 1：先用測試鎖住 `/api/attendance/sessions` 新 contract

**Files:**
- Test: `apps/api/src/routes/attendance.spec.ts`
- Modify: `apps/api/src/routes/attendance.ts`

- [ ] **Step 1：新增 failing test，要求 `GET /api/attendance/sessions` 回傳 `{ data, meta }`**

測試要覆蓋：
- `page=1&pageSize=20` 時回傳 `meta.page / meta.pageSize / meta.total / meta.totalPages`
- `data` 為陣列
- 預設不包含 `cancelled` session

- [ ] **Step 2：新增 failing test，要求支援 `courseIds` 與 `classIds`**

測試要覆蓋：
- 傳 `courseIds` 時只回該課程底下 session
- 傳 `classIds` 時只回該班級 session
- 兩者同時存在時取交集

- [ ] **Step 3：最小化修改 route schema**

在 `apps/api/src/routes/attendance.ts`：
- 把 `/sessions` request query 補上：
  - `courseIds?: string`
  - `classIds?: string`
  - `page?: number`
  - `pageSize?: number`
- 把 response schema 從 `z.array(EventSessionSummarySchema)` 改成：

```ts
z.object({
  data: z.array(EventSessionSummarySchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  }),
})
```

- [ ] **Step 4：實作分頁與 filter**

在 `/sessions` handler：
- 解析 `courseIds` / `classIds`
- 預設 `statuses = ['scheduled', 'completed']`
- 對 `eventsQuery` 加上：
  - `sessions.classes.course_id in (...)`
  - `sessions.class_id in (...)`
- 以 `count: 'exact'` 拿總數
- 用 `.range(from, to)` 實作 page/pageSize
- 維持 `event_date asc, start_time asc`

- [ ] **Step 5：跑 route 測試**

Run:
```bash
npx vitest run apps/api/src/routes/attendance.spec.ts
```

Expected:
- PASS

- [ ] **Step 6：Commit**

```bash
git add apps/api/src/routes/attendance.ts apps/api/src/routes/attendance.spec.ts
git commit -m "feat(api): paginate attendance sessions and add course filters"
```

---

### Task 2：更新 AttendanceService 與出勤頁 query model

**Files:**
- Modify: `apps/web/src/app/core/attendance.service.ts`
- Test: `apps/web/src/app/features/admin/pages/attendance/attendance.page.spec.ts`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts`

- [ ] **Step 1：先寫 failing test，要求出勤頁帶上 `courseIds/classIds/page/pageSize`**

在 `attendance.page.spec.ts` 補測試：
- 開頁後若已有預設分校，會呼叫 `attendanceService.sessions`
- 參數包含：
  - `campusId`
  - `dateFrom/dateTo`
  - `page`
  - `pageSize`
- 套用進階篩選後會帶上 `courseIds` 與 `classIds`

- [ ] **Step 2：更新 service response/interface**

在 `apps/web/src/app/core/attendance.service.ts`：
- 新增：

```ts
export interface AttendanceSessionListResponse {
  data: EventSessionSummary[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}
```

- `sessions()` 改為回傳 `Observable<AttendanceSessionListResponse>`
- query params 補：
  - `courseIds?: string[]`
  - `classIds?: string[]`
  - `page?: number`
  - `pageSize?: number`

- [ ] **Step 3：收斂 AttendancePage state**

在 `attendance.page.ts`：
- 保留：
  - `selectedDateRange`
  - `selectedCampusId`
  - `selectedCourseIds`
  - `selectedClassIds`
  - `selectedStudentIds`
  - `currentPage`
  - `pageSize`
  - `totalSessions`
- 刪除：
  - `selectedStatuses`
  - `statusOptions`
- `loadSessions()` 改讀 `response.data` / `response.meta`

- [ ] **Step 4：預設分校策略**

在載入分校成功後：
- 若 `selectedCampusId()` 尚未設定，直接設成第一個 active campus
- 再觸發 `loadSessions()`
- 不再提供 `全部分校`

- [ ] **Step 5：跑出勤頁測試**

Run:
```bash
npx nx test web --include=apps/web/src/app/features/admin/pages/attendance/attendance.page.spec.ts --skipNxCache
```

Expected:
- PASS

- [ ] **Step 6：Commit**

```bash
git add apps/web/src/app/core/attendance.service.ts apps/web/src/app/features/admin/pages/attendance/attendance.page.ts apps/web/src/app/features/admin/pages/attendance/attendance.page.spec.ts
git commit -m "refactor(web): align attendance page with paginated session filters"
```

---

### Task 3：抽共用 Session Advanced Filters Dialog

**Files:**
- Create: `apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.ts`
- Create: `apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.html`
- Create: `apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.scss`
- Test: `apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.spec.ts`

- [ ] **Step 1：先寫 failing spec，鎖住共用互動**

測試要覆蓋：
- 課程多選器可依輸入做模糊搜尋
- 未選課程時不顯示班級 filter
- 已選課程後才顯示班級 filter
- `attendance` mode 顯示學生、不顯示老師與狀態
- `sessions` mode 顯示老師與狀態、不顯示學生

- [ ] **Step 2：建立 dialog 輸入/輸出 contract**

建議介面：

```ts
export interface SessionAdvancedFiltersDialogData {
  readonly mode: 'sessions' | 'attendance';
  readonly campuses: Campus[];
  readonly courses: Course[];
  readonly classes: Array<{ id: string; name: string; courseId: string; campusId: string }>;
  readonly students?: Student[];
  readonly teachers?: Staff[];
  readonly selectedCampusIds?: string[];
  readonly selectedCampusId?: string | null;
  readonly selectedCourseIds: string[];
  readonly selectedClassIds: string[];
  readonly selectedStudentIds?: string[];
  readonly selectedTeacherIds?: string[];
  readonly selectedStatuses?: string[];
}
```

- [ ] **Step 3：實作 dialog**

規則：
- 使用 `ImeFilterInputComponent` 做課程、班級、學生、老師的 IME filter
- 課程 options 先依 `mode + campus scope` 縮限，再做前端 fuzzy filter
- 班級 options 只從 `已選課程 + campus scope` 推導
- `套用` 時才回傳結果
- `清除全部` 只清進階條件，不改日期與分校

- [ ] **Step 4：跑 dialog 測試**

Run:
```bash
npx nx test web --include=apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.spec.ts --skipNxCache
```

Expected:
- PASS

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/app/shared/components/session-advanced-filters-dialog
git commit -m "feat(web): add shared session advanced filters dialog"
```

---

### Task 4：接上課堂管理的 dialog 化 filter

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.html`
- Modify: `apps/web/src/app/features/admin/pages/sessions/dialogs/mobile-filter-dialog/mobile-filter-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/dialogs/mobile-filter-dialog/mobile-filter-dialog.component.html`
- Modify: `apps/web/src/app/features/admin/pages/sessions/sessions.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/sessions.page.html`
- Test: `apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts`
- Test: `apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.spec.ts`

- [ ] **Step 1：先補 failing test，要求桌面版只留輕量工具列**

測試要覆蓋：
- 工具列只保留日期、分校、篩選按鈕、清除按鈕
- 不再直接 render 課程/班級/老師/狀態 multiselect
- active filter count 仍會顯示在篩選按鈕上

- [ ] **Step 2：重寫 `SessionFiltersComponent` 為輕量工具列**

輸出事件改成：
- `listDateRangeChange`
- `campusIdsChange`
- `openAdvancedFilters`
- `clearFilters`

保留 active filter count 顯示，但不再自己持有課程/班級/老師 IME query。

- [ ] **Step 3：讓 `SessionsPage` 打開共用 dialog**

在 `sessions.page.ts`：
- 新增 `openAdvancedFiltersDialog()`
- 將現有 state 傳入 `SessionAdvancedFiltersDialogComponent`
- `onClose` 後回寫：
  - `selectedCourseIds`
  - `selectedClassIds`
  - `selectedTeacherIds`
  - `selectedStatuses`
- 成功回寫後 `currentPage.set(1)` 再 `loadSessions()`

- [ ] **Step 4：保留 mobile filter dialog，僅作 mobile 專用 fallback**

若不打算本輪一併移除 mobile dialog：
- 先讓 mobile 與 desktop contract 對齊
- 至少補上課程模糊搜尋與「先課程後班級」規則

- [ ] **Step 5：跑 sessions page / filters 測試**

Run:
```bash
npx nx test web --include=apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts,apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.spec.ts --skipNxCache
```

Expected:
- PASS

- [ ] **Step 6：Commit**

```bash
git add apps/web/src/app/features/admin/pages/sessions
git commit -m "refactor(web): move session page advanced filters into dialog"
```

---

### Task 5：接上出勤紀錄的 dialog 化 filter

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.html`
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss`
- Test: `apps/web/src/app/features/admin/pages/attendance/attendance.page.spec.ts`

- [ ] **Step 1：先補 failing test，要求出勤頁只留日期/分校/篩選**

測試要覆蓋：
- 工具列不再直接 render 班級 multiselect / 狀態 multiselect / 學生 multiselect
- 點 `篩選` 後打開共用 dialog
- dialog 套用結果會更新 page state 並重新查詢

- [ ] **Step 2：重寫出勤頁工具列**

在 `attendance.page.html`：
- 保留 `日期範圍`
- 保留 `單一分校 select`
- 新增 `篩選` 按鈕與 badge
- 有進階條件時顯示 `清除篩選`

- [ ] **Step 3：接上 dialog**

在 `attendance.page.ts`：
- 新增 `openAdvancedFiltersDialog()`
- 傳入：
  - `mode: 'attendance'`
  - 當前分校 scope 下的 course/class options
  - student options
- `onClose` 後更新：
  - `selectedCourseIds`
  - `selectedClassIds`
  - `selectedStudentIds`
- 重新查詢 sessions

- [ ] **Step 4：保留學生過濾邏輯，但收進 dialog 後再套用**

若目前仍用 enrollment 去推導 `studentEnrolledClassIds`：
- 套用 dialog 後才批次查 enrollment
- 不要在使用者每次選學生時即時查 API

- [ ] **Step 5：跑出勤頁測試**

Run:
```bash
npx nx test web --include=apps/web/src/app/features/admin/pages/attendance/attendance.page.spec.ts --skipNxCache
```

Expected:
- PASS

- [ ] **Step 6：Commit**

```bash
git add apps/web/src/app/features/admin/pages/attendance
git commit -m "refactor(web): move attendance page advanced filters into dialog"
```

---

### Task 6：整體驗證與回歸

**Files:**
- Verify only

- [ ] **Step 1：跑 API 相關測試**

```bash
npx vitest run apps/api/src/routes/attendance.spec.ts
```

- [ ] **Step 2：跑 web 關鍵頁面測試**

```bash
npx nx test web --include=apps/web/src/app/shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component.spec.ts,apps/web/src/app/features/admin/pages/attendance/attendance.page.spec.ts,apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts,apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.spec.ts --skipNxCache
```

- [ ] **Step 3：跑 web build**

```bash
CI=true npm exec ng build web --configuration=development --verbose
```

Expected:
- Build success
- 若仍有既有 budget warnings，可記錄但不視為本次阻塞

- [ ] **Step 4：跑 api build**

```bash
npx nx build api --skipNxCache
```

Expected:
- Build success
- 若有既有 `wrangler` log file warning，需註記為 sandbox/環境噪音，不視為本次失敗

- [ ] **Step 5：手動 smoke checklist**

- `課堂管理`
  - 日期/分校正常查詢
  - 開啟進階篩選 dialog 後可搜課程
  - 選課程後才顯示班級
  - 清除進階篩選不影響日期/分校
- `課堂出勤紀錄`
  - 進頁自動選到第一個可用分校
  - 切換分校後課程 options scope 正確
  - 選學生後 session 名單正確縮限
  - 列表翻頁時 meta 正常

- [ ] **Step 6：最終 commit**

```bash
git status
git add apps/api/src/routes/attendance.ts apps/api/src/routes/attendance.spec.ts apps/web/src/app/core/attendance.service.ts apps/web/src/app/features/admin/pages/attendance apps/web/src/app/features/admin/pages/sessions apps/web/src/app/shared/components/session-advanced-filters-dialog
git commit -m "feat: align session and attendance advanced filters"
```

