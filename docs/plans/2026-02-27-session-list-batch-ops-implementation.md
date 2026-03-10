# Session List Batch Ops Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 將批次操作收斂到課堂列表，提供傻瓜式批次改時間/批次停課流程，保留衝突安全機制與跨頁全選能力。

**Architecture:** 以前端課堂列表為單一入口，所有批次操作皆採 `dryRun -> apply` 二段式；使用者僅能「套用可更新項目」，衝突自動略過。日期調整維持單堂操作。

**Tech Stack:** Angular 21 + Signals、PrimeNG、Hono + Supabase、Vitest / API integration tests

---

### Task 1: 調整批次操作資料契約

**Files:**
- Modify: `apps/web/src/app/core/classes.service.ts`
- Modify: `apps/api/src/routes/classes.ts`
- Add tests: API route tests (若專案已有測試框架，沿用現有位置)

**Steps:**
1. 定義批次改時間、批次停課的 request/response schema。
2. response 固定包含：
- `updated`
- `skipped`
- `conflicts`
- `dryRun`
- `processableIds`（或可對應 apply 的 token）
3. 寫 schema 驗證測試。

### Task 2: 後端實作 `batch-update-time`

**Files:**
- Modify: `apps/api/src/routes/classes.ts`
- Reuse/Modify: `apps/api/src/domain/session-assignment/*`（視現有規劃器可重用度）

**Steps:**
1. 建立目標課堂集合（勾選 or 跨頁篩選）。
2. 檢查衝突：
- 老師撞堂
- 同班時段重疊
- 狀態不可修改
- 時間不合法
3. `dryRun=true` 回傳預覽結果。
4. apply 時僅更新 processable 項目。
5. 寫入 audit log 與異動紀錄。

### Task 3: 後端實作 `batch-cancel`

**Files:**
- Modify: `apps/api/src/routes/classes.ts`

**Steps:**
1. 建立目標課堂集合。
2. 僅允許可停課狀態（例如 scheduled）。
3. dryRun 回傳可停課與略過明細。
4. apply 僅取消可停課項目。
5. 寫入 audit log 與異動紀錄。

### Task 4: 前端課堂列表批次工具列

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/session-list-dialog/session-list-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/classes/session-list-dialog/session-list-dialog.component.html`
- Modify: `apps/web/src/app/features/admin/pages/classes/session-list-dialog/session-list-dialog.component.scss`

**Steps:**
1. 新增批次工具列 UI：
- 批次改時間
- 批次停課
2. 新增跨頁全選狀態與摘要顯示。
3. 新增預覽結果面板與主按鈕：
- `套用可更新項目`
- `取消`
4. 移除/隱藏進階模式選項，不暴露 strict/force。

### Task 5: 衝突處理提示與清單

**Files:**
- Modify: `session-list-dialog.component.html/.scss`

**Steps:**
1. 實作固定提示區塊：
- `偵測到衝突，已自動略過`
- 三步流程提示
2. 實作「只看衝突」切換。
3. 每筆衝突顯示原因 + 建議動作（單堂修正入口）。

### Task 6: 保留單堂改日期

**Files:**
- Modify: 現有單堂操作所在元件（依目前課堂操作入口）

**Steps:**
1. 保留單堂改日期行為。
2. 確保與批次改時間流程不互斥。
3. 單堂修正後可回到批次預覽重跑。

### Task 7: 驗證與回歸

**Checks:**
1. `npx tsc -p apps/web/tsconfig.app.json --noEmit`
2. `npx tsc -p apps/api/tsconfig.json --noEmit`
3. 相關單元/整合測試（批次改時間、批次停課、衝突略過）
4. 手機版實測（375 寬）：
- 批次面板不破版
- 分頁不超長
- 衝突清單可閱讀

### Task 8: 舊精靈退場（可選）

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/session-list-dialog/session-list-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.ts`（若仍有入口）

**Steps:**
1. 停用舊「批次指派精靈」入口（先 feature flag 或隱藏）。
2. 確認新流程覆蓋主要使用情境後，再移除舊程式碼。

---

## 交付驗收標準

1. 管理員可在課堂列表直接完成批次改時間與批次停課。
2. 有衝突時不阻斷可成功項目，且有清楚流程提示。
3. 不需要理解技術模式（strict/force/skip），仍可完成操作。
4. 日期批次修改不存在，單堂改日期可正常使用。
5. 手機版操作可用且分頁不破版。
