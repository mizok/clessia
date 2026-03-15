# Handoff Report — `fix/academic-bugfixes` Branch

**日期**：2026-03-14
**接手者**：Codex
**Worktree 路徑**：`.worktrees/bugfix-wave1`
**分支**：`fix/academic-bugfixes`

---

## 一、已完成的工作（已 commit）

以下 8 個 Bug / UX 項目已全部 commit 至分支：

| Commit | 說明 |
|--------|------|
| `c8fcf16` | **Bug 4** — `assertSessionOperable` 錯誤優先順序修正（cancelled > completed > unassigned）|
| `ddb5d4f` | **Bug 1** — 課程停用使用台灣時區（Intl API，非 UTC）|
| `39429bd` | **Bug 7** — 調課驗證「無變更」情況，回傳 400 / NO_CHANGE |
| `e8b16a4` | **Bug 2** — 課程停用加入 rollback 保護（INSERT schedule_changes 失敗時 rollback sessions UPDATE）|
| `fe19106` | **Bug 8** — 恢復停課前驗證老師是否仍為有效狀態，無效則 unassigned |
| `7e1b5f0` | **Bug 5** — 新增 `time_change` audit log type（需 DB migration，詳見下方）|
| `22d55fd` | **Bug 6** — 刪除死碼 `batch-assign-planner.ts` |
| `9591c47` | **UX 1** — sessions badge 改為顯示篩選範圍的 `filteredUnassignedCount` |

> Bug 3（courses.ts 靜默忽略 DB 錯誤）需確認是否已納入上述 commits，請執行 `git diff HEAD apps/api/src/routes/courses.ts` 確認。

---

## 二、未 commit 的暫存修改（需接手）

以下修改**已完成但尚未 commit**，Worktree 目前的狀態：

### 2-1. `apps/api/src/auth.ts` — `trustedOrigins` 開放 localhost

**變更目的**：開發環境 Better Auth 接受任何 localhost port（4200~4205）。

```typescript
trustedOrigins: [
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4202',
  'http://localhost:4203',
  'http://localhost:4204',
  'http://localhost:4205',
  'https://clessia.pages.dev',
],
```

> **注意**：這是 dev-only 設定，**不應合併到 main**，僅供 worktree 開發用。考慮改用環境變數控制。

---

### 2-2. `apps/api/src/index.ts` — CORS 開放所有 localhost port

**變更目的**：解決開發時前端連不到 API 的 CORS 問題。

```typescript
origin: (origin) =>
  origin?.startsWith('http://localhost') ? origin : 'https://clessia.pages.dev',
```

> 同上，dev-only，不應直接合併。

---

### 2-3. `package.json` — dev scripts 改為直接呼叫底層工具

```json
"dev:web": "cd apps/web && npx ng serve --configuration=development",
"dev:api": "cd apps/api && npx wrangler dev",
```

> 目的：支援在 worktree 目錄下直接 `npm run dev:web/api` 啟動，且支援 `--` passthrough 額外參數。

---

### 2-4. `apps/web/` — IME 搜尋修復（核心功能，應 commit）

這是最重要的未 commit 修改，解決 PrimeNG MultiSelect filter 無法用中文輸入搜尋的 bug。

#### 新增檔案：`apps/web/src/app/shared/components/ime-filter-input/`

這是一個新的 Shared Component，三個檔案：

**`ime-filter-input.component.ts`**
```typescript
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-ime-filter-input',
  imports: [IconFieldModule, InputTextModule, InputIconModule],
  templateUrl: './ime-filter-input.component.html',
  styleUrl: './ime-filter-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImeFilterInputComponent {
  readonly placeholder = input('搜尋...');
  readonly filterChange = output<string>();

  protected onInput(e: Event): void {
    if ((e as InputEvent).isComposing) return;
    this.filterChange.emit((e.target as HTMLInputElement).value);
  }

  protected onCompositionEnd(e: CompositionEvent): void {
    this.filterChange.emit((e.target as HTMLInputElement).value);
  }
}
```

**`ime-filter-input.component.html`**
```html
<p-iconfield class="ime-filter-input">
  <input
    pInputText
    type="text"
    class="ime-filter-input__input"
    [placeholder]="placeholder()"
    (input)="onInput($event)"
    (compositionend)="onCompositionEnd($event)"
  />
  <p-inputicon>
    <i class="pi pi-search"></i>
  </p-inputicon>
</p-iconfield>
```

**`ime-filter-input.component.scss`**
```scss
.ime-filter-input {
  display: block;
  width: 100%;

  &__input {
    width: 100%;
  }
}
```

#### 修改檔案：`session-filters.component.ts`

- 新增 `signal` import、`ImeFilterInputComponent` import
- `TeacherSelectOption` 介面新增 `campusIds?: string[]` 和 `campusNames?: string[]`
- 新增 4 個 filter query signals：`campusFilterQuery`、`courseFilterQuery`、`teacherFilterQuery`、`classFilterQuery`
- 新增 3 個 computed filtered options：`filteredCampusOptions`、`filteredCourseOptions`、`filteredClassOptions`
- `teacherOptionGroups` computed 改為套用 `teacherFilterQuery` 過濾，且在 option 中加入 `campusNames`
- 新增 `getTeacherCampusLabel()` 方法
- 新增 module-level `matchesAll<T>()` helper function（大小寫不敏感，支援多欄位搜尋）

#### 修改檔案：`session-filters.component.html`

- 4 個 multiselect 全部改為 `[filter]="false"`（關閉 PrimeNG 內建 filter）
- `[options]` 改為對應的 filtered computed signal
- 4 個 `<ng-template #header>` 全部改為 `<ng-template #filter>` ← **重要！**
  - `#header` slot 在 `.p-multiselect-header` div 外面渲染，導致 Select All checkbox 殘留
  - `#filter` slot 在 header div 內部渲染，完全替換 builtInFilterElement（含 Select All checkbox）
- Teacher option template 新增服務分校小字顯示

#### 修改檔案：`session-filters.component.scss`

- 新增 `&__teacher-option-campuses` 樣式（小字、zinc-400 色）

---

### 2-5. `apps/web/` — 其他 UI 修改（應 commit）

#### `session-reschedule-dialog.component.ts`

**調課 dialog 加入預填值**：開啟 modal 時自動填入現有課堂的日期和時間，讓 Bug 7 的 NO_CHANGE 驗證可被觸發。

```typescript
import { format, parse } from 'date-fns';
// 在 ngOnInit 新增：
const s = this.config.data.session as Session;
this.session.set(s);
const sessionDate = parse(s.sessionDate, 'yyyy-MM-dd', new Date());
const startTime = parse(s.startTime.substring(0, 5), 'HH:mm', new Date());
const endTime = parse(s.endTime.substring(0, 5), 'HH:mm', new Date());
this.form.patchValue({ newSessionDate: sessionDate, newStartTime: startTime, newEndTime: endTime });
```

#### `staff.page.html`

**封存按鈕 icon 修正**：從 `pi-trash`（垃圾桶）改為 `pi-box`，tooltip 和按鈕文字也從「刪除」改為「封存」（桌面版和 mobile card 兩處都改了）。

---

## 三、需要手動操作的事項

### 3-1. Bug 5 需要 DB Migration

Bug 5（`time_change` audit log type）對應的 migration 檔案需要確認是否已建立：

```bash
ls supabase/migrations/ | grep time_change
```

如果不存在，需建立：

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
supabase migration new add_time_change_to_schedule_change_type
```

內容：
```sql
ALTER TYPE public.schedule_change_type ADD VALUE IF NOT EXISTS 'time_change';
```

參照格式：`supabase/migrations/20260310113232_add_uncancel_to_schedule_change_type.sql`

---

### 3-2. Commit 未 commit 的修改

建議 commit 順序（auth.ts / index.ts / package.json 為 dev-only，考慮是否納入）：

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/.worktrees/bugfix-wave1

# 1. UI 修改（必須 commit）
git add apps/web/src/app/shared/components/ime-filter-input/
git add apps/web/src/app/features/admin/pages/sessions/components/session-filters/
git add apps/web/src/app/features/admin/pages/sessions/dialogs/session-reschedule-dialog/
git add apps/web/src/app/features/admin/pages/staff/staff.page.html
git commit -m "feat: add IME-aware filter input component and fix session filter UX"

# 2. Dev 環境設定（視情況決定是否 commit）
git add apps/api/src/auth.ts apps/api/src/index.ts package.json
git commit -m "chore: allow all localhost origins for local development"
```

---

### 3-3. 啟動開發環境

```bash
# 終端 1 — API（在 worktree 目錄下）
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/.worktrees/bugfix-wave1
npm run dev:api

# 終端 2 — Frontend
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/.worktrees/bugfix-wave1
npm run dev:web

# 確認 .dev.vars 存在（API 需要）
ls apps/api/.dev.vars
```

> **重要**：如果 `.dev.vars` 不存在，請從主目錄複製：
> ```bash
> cp /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/.dev.vars \
>    /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/.worktrees/bugfix-wave1/apps/api/.dev.vars
> ```

---

## 四、驗證清單

所有 Bug 已於開發環境手動驗證（API 跑在 worktree 分支）：

| # | 項目 | 狀態 |
|---|------|------|
| Bug 1 | UTC 日期問題 | ✅ 已驗證（台灣時區正確） |
| Bug 2 | 課程停用 rollback | ✅ 已 commit |
| Bug 3 | courses.ts 錯誤靜默 | ⚠️ 請確認 commit 內容 |
| Bug 4 | 錯誤優先順序 | ✅ 已驗證（stopped課堂只能取消停課） |
| Bug 5 | time_change audit log | ✅ 已 commit；Migration 需確認 |
| Bug 6 | 死碼刪除 | ✅ 已 commit |
| Bug 7 | 調課無變更擋下 | ✅ 已驗證（彈出「無需調整」訊息） |
| Bug 8 | 恢復停課驗證老師狀態 | ✅ 已驗證（封存老師 → 恢復時 unassigned） |
| UX 1 | filteredUnassignedCount | ✅ 已驗證（篩選分校後 badge 正確縮小） |
| IME fix | 中文搜尋 filter | ✅ 已實作，需瀏覽器驗證 |

---

## 五、下一步建議

1. **Commit 剩餘未提交的修改**（見 3-2）
2. **確認 Bug 5 migration 存在**（見 3-1）
3. **Merge `fix/academic-bugfixes` → `main`**（或開 PR）
4. **在瀏覽器測試 IME 中文搜尋**：開啟老師/課程 multiselect，用中文注音/倉頡輸入搜尋，確認組字期間不觸發過濾

---

## 六、關鍵檔案速查

| 檔案 | 說明 |
|------|------|
| `apps/api/src/routes/courses.ts` | Bug 1, 2, 3 |
| `apps/api/src/routes/sessions.ts` | Bug 5, 7, 8, UX 1 |
| `apps/api/src/domain/session-assignment/session-operation-guard.ts` | Bug 4 |
| `apps/web/src/app/shared/components/ime-filter-input/` | IME 搜尋元件（新建）|
| `apps/web/.../session-filters/session-filters.component.*` | IME filter 整合 |
| `apps/web/.../session-reschedule-dialog.component.ts` | 調課預填值 |
| `apps/web/.../staff.page.html` | 封存 icon 修正 |
| `supabase/migrations/` | Bug 5 migration 需確認 |
