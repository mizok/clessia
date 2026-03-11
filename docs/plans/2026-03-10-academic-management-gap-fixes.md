# Academic Management Gap Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修正目前 `main` 分支教務管理板塊中會誤導使用者或讓回歸失效的缺漏，並補上對應測試。

**Architecture:** 採最小可驗證修正，不重做教務資訊架構。前端以現有 `/admin/classes` 與 `/admin/sessions` 為主路徑，修正 URL 狀態同步、刪除文案判斷與隱藏舊入口；測試層同步更新為現在的元件 API，補回關鍵 regression coverage。

**Tech Stack:** Angular 21 Standalone Components、Signals、PrimeNG、Vitest、Nx

---

### Task 1: 修正課堂管理的日期篩選狀態同步

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/sessions/sessions.page.ts`
- Test: `apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts`

**Step 1: 寫失敗測試，覆蓋 query params 帶入日期區間時的篩選狀態**

在 `sessions.page.spec.ts` 新增案例：

- 建立 `ActivatedRoute.snapshot.queryParams` 含 `from` / `to`
- 驗證元件初始化後：
  - `listDateRange()` 反映 query params
  - `activeFilterCount()` 把日期算進去
  - `hasActiveFilters()` 為 `true`

**Step 2: 跑單測確認目前會失敗**

Run: `npx nx test web --include=apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts`

Expected:

- 目前先因教務測試檔 API 過期而編譯失敗，後續 Task 4 會一併修正
- 修正後，這個新案例應先紅燈再轉綠

**Step 3: 寫最小實作**

在 `sessions.page.ts`：

- `applyQueryParams()` 讀到 `from` 時，同步把 `listDateRangeModified` 設為 `true`
- 若未帶日期 query，維持既有預設日期範圍與 `false` 狀態

**Step 4: 跑測試確認通過**

Run: `npx nx test web --include=apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts`

Expected:

- 新增日期 query regression case 通過

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/sessions/sessions.page.ts apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts
git commit -m "fix: sync sessions date filter state from query params"
```

### Task 2: 修正班級刪除確認文案的判斷條件

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.ts`
- Test: `apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts`

**Step 1: 寫失敗測試，覆蓋刪除確認框應依 `hasPastSessions` 判斷**

在 `classes.page.spec.ts` 新增案例：

- `hasPastSessions = false`、`scheduleCount > 0` 時，不應顯示「歷史課堂、出席紀錄與報名資料將一併刪除」
- `hasPastSessions = true` 時，若仍能直接呼叫方法，確認顯示文案與實際規則一致，或至少不再用 `scheduleCount` 當歷史判斷

**Step 2: 跑單測確認目前會失敗**

Run: `npx nx test web --include=apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts`

Expected:

- 在 Task 4 修正測試編譯問題後，這組新測試先失敗

**Step 3: 寫最小實作**

在 `classes.page.ts`：

- 把 `confirmDeleteClass()` 的 `hasHistory` 判斷由 `scheduleCount` 改為 `hasPastSessions`
- 依目前產品規則調整確認訊息：
  - 無歷史課堂：刪除班級，並刪除其未來課堂 / 時段 / 報名等關聯資料
  - 有歷史課堂：理論上不應走到刪除流程；保留防呆訊息或直接提前返回

**Step 4: 跑測試確認通過**

Run: `npx nx test web --include=apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts`

Expected:

- 刪除確認文案不再因 `scheduleCount` 誤判

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/classes/classes.page.ts apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts
git commit -m "fix: align class delete messaging with past-session rule"
```

### Task 3: 收斂隱藏課程入口到現行教務主路徑

**Files:**

- Modify: `apps/web/src/app/app.routes.ts`
- Reference: `apps/web/src/app/core/smart-enums/routes-catalog.ts`
- Test: `apps/web/src/app/app.routes.ts` 對應 smoke 驗證以現有 routing build 為主

**Step 1: 先確認收斂策略**

採最小修正：

- 保留 `/admin/classes` 作為現在的課程/班級管理主頁
- 將隱藏但仍可直達的 `/admin/courses` 直接 redirect 到 `/admin/classes`
- 不改動 `/admin/classes` 內現有課程 CRUD 入口，避免擴大重構

**Step 2: 寫最小實作**

在 `app.routes.ts`：

- 將 `ADMIN_COURSES` 由 `loadComponent(CoursesPage)` 改成 `redirectTo: RoutesCatalog.ADMIN_CLASSES.relativePath`

**Step 3: 跑建置或路由相關測試**

Run: `npx nx test web --include=apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts`

Expected:

- 不再需要維護一條隱藏但仍是獨立入口的課程主檔頁

**Step 4: Commit**

```bash
git add apps/web/src/app/app.routes.ts
git commit -m "fix: redirect hidden courses route to classes"
```

### Task 4: 修復教務管理回歸測試，讓 targeted test 可重新運行

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.spec.ts`
- Modify: `apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts`
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts`
- Optional: `apps/web/src/app/features/admin/pages/courses/courses.page.spec.ts`

**Step 1: 先修正已過期的 `SessionFiltersComponent` spec**

調整測試內容對齊現在 API：

- `selectedCourseId` 改為 `selectedCourseIds`
- `courseChange` 改為 `courseIdsChange`
- 需要時補齊明確型別，移除 `implicit any`

**Step 2: 修正 `ClassesPage` 既有測試與現況不一致的斷言**

目前 `navigateToSessionsList()` 測試仍期待舊 query shape。應改成對齊現況：

- `SessionsService.list()` 傳 `campusIds` / `courseIds`
- `router.navigate()` query 不含不存在的 `view`

**Step 3: 視需要補 `SessionsPage` query-param regression 測試**

補齊 Task 1 的日期範圍初始化案例，確保後續不再回歸。

**Step 4: 跑完整 targeted tests**

Run:

- `npx nx test web --include=apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts`
- `npx nx test web --include=apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts`
- `npx nx test web --include=apps/web/src/app/features/admin/pages/courses/courses.page.spec.ts`

Expected:

- 三個教務頁面 targeted test 可正常編譯並通過

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.spec.ts apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts apps/web/src/app/features/admin/pages/courses/courses.page.spec.ts
git commit -m "test: restore academic management regression coverage"
```

### Task 5: 最終驗證與整理

**Files:**

- Modify: 依前四項實作結果為準

**Step 1: 跑最終驗證**

Run:

- `npx nx test web --include=apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts`
- `npx nx test web --include=apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts`
- `npx nx test web --include=apps/web/src/app/features/admin/pages/courses/courses.page.spec.ts`

**Step 2: 進行人工檢查**

確認：

- 從班級頁點「在列表中查看」帶日期進 `/admin/sessions` 時，篩選 badge / 清除按鈕狀態正確
- 無歷史課堂但有時段/未來課堂的班級，不再顯示錯誤的歷史資料刪除警告
- `/admin/courses` 會導回 `/admin/classes`

**Step 3: 最終 Commit**

```bash
git add apps/web/src/app/app.routes.ts apps/web/src/app/features/admin/pages/sessions/sessions.page.ts apps/web/src/app/features/admin/pages/classes/classes.page.ts apps/web/src/app/features/admin/pages/sessions/components/session-filters/session-filters.component.spec.ts apps/web/src/app/features/admin/pages/sessions/sessions.page.spec.ts apps/web/src/app/features/admin/pages/classes/classes.page.spec.ts docs/plans/2026-03-10-academic-management-gap-fixes.md
git commit -m "fix: close academic management gaps on main"
```
