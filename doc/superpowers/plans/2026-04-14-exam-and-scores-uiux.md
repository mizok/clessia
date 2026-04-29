# Exam And Scores UI/UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成考務與成績板塊的 UI/UX 改版，優先解決手機操作不友善、成績登錄表格化過重、家長端成績頁缺席等問題。

**Architecture:** 採漸進式改版，不改動既有 API 與核心資料流，先重構管理端 `score-entry` 相關輸入介面，再整理 `overview` 與 `exams` 的資訊層次，最後補齊 `parent/grades`。桌機保留高密度資訊呈現，小螢幕改用卡片、堆疊區塊與條件式重排，避免依賴水平卷軸完成核心任務。

**Tech Stack:** Angular 21 Standalone Components、Signals、PrimeNG 21、SCSS、Vitest

---

## 實作前提

1. 專案文件實際慣例使用 `doc/superpowers/plans`，本計畫沿用該目錄，不使用 skill 內文的 `docs/plans` 字樣。
2. 本次為前端 UI/UX 改版，不預期修改 API contract。
3. 所有樣式遵守既有 tokens、BEM 命名與 mobile-first 原則。
4. 若 component 需要額外子元件，優先在 feature 內新增，避免過早抽 shared。

## Task 1: 建立成績登錄頁共用版型與行動裝置骨架

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.scss`
- Test: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.spec.ts`

**Step 1: 寫出行動裝置版型需求測試**

- 在 spec 補一個針對頁面結構的測試，確認存在：
  - header card
  - editor 區塊
  - action bar
  - closed hint

**Step 2: 執行單元測試確認現況**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.spec.ts"`

Expected: 現有測試通過，新增結構測試若先寫更細可能失敗。

**Step 3: 重構頁首與底部操作列**

- 讓 header 支援小螢幕換行
- 讓 stats / term summary 在窄寬下直向堆疊
- 讓 action bar 在小螢幕改為直向排列，儲存按鈕可滿寬
- 增加 `dirty` 狀態的視覺容器位置，供後續 editor 串接

**Step 4: 執行測試**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.spec.ts"`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.html \
  apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.scss \
  apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.spec.ts
git commit -m "feat: improve score entry shell layout"
```

## Task 2: 補習班考試成績登錄加入 mobile 卡片模式

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.scss`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.ts`
- Test: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.spec.ts`

**Step 1: 寫出 mobile card 結構測試**

- 驗證每位學生除了 table row 外，存在可在窄螢幕使用的卡片結構 class
- 驗證卡片中含姓名、年級、分數、狀態、備註

**Step 2: 執行測試確認失敗**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.spec.ts"`

Expected: FAIL，因為目前只有 table。

**Step 3: 實作最小版 mobile card UI**

- 保留桌機 table
- 新增 mobile card list 結構
- 使用 CSS 在小螢幕隱藏 table、顯示 card
- 卡片中沿用既有輸入邏輯，不新增平行 state
- 若 `status = absent`，分數輸入 disabled

**Step 4: 補強視覺狀態**

- dirty row / card 加上輕量邊框提示
- 分數欄位、狀態欄位在卡片中有清楚 label

**Step 5: 執行測試**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.spec.ts"`

Expected: PASS

**Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.{ts,html,scss,spec.ts}
git commit -m "feat: add mobile academy score cards"
```

## Task 3: 段考成績登錄加入 mobile 科目卡模式

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.scss`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.ts`
- Test: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.spec.ts`

**Step 1: 寫出窄螢幕卡片化測試**

- 驗證展開學生後，存在科目卡容器 class
- 驗證每張卡有科目、分數、狀態、備註欄位

**Step 2: 執行測試確認失敗**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.spec.ts"`

Expected: FAIL，因為目前只有展開後 table。

**Step 3: 實作 mobile card UI**

- 桌機保留 table
- 小螢幕改成科目卡列表
- 放大 recent chips 與搜尋結果按鈕觸控面積
- 學生 header 在小螢幕下改成可換行、避免資訊擠壓

**Step 4: 執行測試**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.spec.ts"`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.{ts,html,scss,spec.ts}
git commit -m "feat: add mobile term score cards"
```

## Task 4: 重構成績總覽外框與視角切換層次

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/overview.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/overview.component.scss`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/overview.component.ts`
- Test: `apps/web/src/app/features/admin/pages/grades/overview/overview.component.spec.ts`

**Step 1: 寫出視角切換卡結構測試**

- 驗證頁面具有模式說明區
- 驗證切換學生視角 / 班級視角時文案同步更新

**Step 2: 執行測試確認失敗**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/overview/overview.component.spec.ts"`

Expected: FAIL，因為目前只有單純 toggle。

**Step 3: 實作視角切換卡**

- 在 toolbar 上方加入模式說明
- 視覺上區分 overview header、mode switch、content
- 小螢幕下讓切換器滿寬

**Step 4: 執行測試**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/overview/overview.component.spec.ts"`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/overview/overview.component.{ts,html,scss,spec.ts}
git commit -m "feat: improve grades overview switching layout"
```

## Task 5: 重構班級視角為摘要卡 + mobile 排名卡

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.scss`
- Test: `apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.spec.ts`

**Step 1: 寫出摘要與卡片列表測試**

- 驗證 stats 卡仍存在
- 驗證小螢幕專用排名卡容器存在
- 驗證備註有完整展示區塊，不只 table cell

**Step 2: 執行測試確認失敗**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.spec.ts"`

Expected: FAIL

**Step 3: 實作版面**

- 保留桌機 table
- 新增 mobile ranking cards
- 低分與缺考在卡片內以顏色與 tag 呈現
- 摘要卡統一視覺節奏，避免過度模板感

**Step 4: 執行測試**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.spec.ts"`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.{html,scss,spec.ts}
git commit -m "feat: improve class score overview mobile layout"
```

## Task 6: 重構學生視角為摘要卡 + 成績紀錄卡

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.scss`
- Test: `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.spec.ts`

**Step 1: 寫出卡片化紀錄測試**

- 驗證學生資訊卡存在
- 驗證科目摘要卡存在
- 驗證小螢幕成績紀錄卡存在

**Step 2: 執行測試確認失敗**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.spec.ts"`

Expected: FAIL

**Step 3: 實作版面**

- 保留桌機 table
- 小螢幕新增 record cards
- 調整搜尋列與清除按鈕在窄螢幕下的堆疊
- 讓科目摘要卡在小螢幕具備 2 欄或橫滑策略

**Step 4: 執行測試**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.spec.ts"`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.{html,scss,spec.ts}
git commit -m "feat: improve student score overview mobile layout"
```

## Task 7: 重構考試管理頁的篩選層次與 mobile 卡片列表

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.scss`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.ts`
- Test: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.spec.ts`

**Step 1: 寫出篩選區層次測試**

- 驗證 header action、todo 區、toolbar、result bar 仍存在
- 驗證 mobile exam card 結構存在

**Step 2: 執行測試確認失敗**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/exams/exams.component.spec.ts"`

Expected: FAIL

**Step 3: 實作版面**

- 重新整理 toolbar 層次
- 小螢幕下將 header 堆疊、按鈕滿寬
- 新增 mobile card list，桌機保留 responsive-table
- 保留既有篩選邏輯，不重寫資料流

**Step 4: 執行測試**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/exams/exams.component.spec.ts"`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/exams.component.{ts,html,scss,spec.ts}
git commit -m "feat: improve exams management mobile layout"
```

## Task 8: 實作家長端成績頁 mobile-first 版本

**Files:**
- Modify: `apps/web/src/app/features/parent/pages/grades/grades.component.ts`
- Create: `apps/web/src/app/features/parent/pages/grades/grades.component.html`
- Create: `apps/web/src/app/features/parent/pages/grades/grades.component.scss`
- Test: `apps/web/src/app/features/parent/pages/grades/grades.component.spec.ts`
- Reference: `apps/web/src/app/core/scores.service.ts`

**Step 1: 寫出最小可用頁面測試**

- 驗證頁面不再顯示 placeholder 文案
- 驗證存在孩子切換器、摘要區、近期成績區、歷次紀錄區

**Step 2: 執行測試確認失敗**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/parent/pages/grades/grades.component.spec.ts"`

Expected: FAIL

**Step 3: 先做靜態版型與假資料介面**

- 建立 mobile-first 結構
- 先讓 UI 可渲染，必要時以本地 mock state 佔位
- 不在此 task 擴張 API，先對接現有可用資料來源或 TODO 註記

**Step 4: 補最小資料接線**

- 若 `ScoresService` 已能支援，接上近期紀錄與列表
- 若尚不能，先以明確 TODO 和可測試的空狀態收斂，不硬擴 API

**Step 5: 執行測試**

Run: `npx ng test --watch=false --include="apps/web/src/app/features/parent/pages/grades/grades.component.spec.ts"`

Expected: PASS

**Step 6: Commit**

```bash
git add apps/web/src/app/features/parent/pages/grades/grades.component.{ts,html,scss,spec.ts}
git commit -m "feat: add parent grades mobile-first page"
```

## Task 9: 整體回歸驗證

**Files:**
- Verify only

**Step 1: 跑考務與成績相關測試**

Run:

```bash
npx ng test --watch=false --include="apps/web/src/app/features/admin/pages/grades/**/*.spec.ts" --include="apps/web/src/app/features/parent/pages/grades/grades.component.spec.ts"
```

Expected: PASS

**Step 2: 跑 web build**

Run: `npx ng build web`

Expected: BUILD SUCCESS

**Step 3: 人工驗證**

Run: `npx ng serve`

Check:
- `/admin/grades/exams`
- `/admin/grades/overview`
- `/admin/grades/exams/:type/:id/scores`
- `/parent/grades`

確認 390px 寬度與桌機寬度都能正常操作。

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: refresh exam and scores uiux"
```
