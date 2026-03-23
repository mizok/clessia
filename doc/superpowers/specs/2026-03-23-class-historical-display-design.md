# Class Historical Display — Design Spec

**Date:** 2026-03-23
**Scope:** 課程管理頁（`/admin/courses`）班級 row 顯示日期範圍、歷史班級預設隱藏、切換顯示歷史及日期範圍篩選、歷史班級唯讀限制

---

## 1. 歷史班級定義

```
end_date IS NOT NULL AND end_date < today（台灣本地日期 Asia/Taipei）
```

- 沒有設 `end_date` 的班級永遠不視為歷史班級
- `isActive` 與「歷史」是獨立語意：歷史班級由日期判定，`isActive` 保留原本「是否對家長/老師顯示」的語意
- **時區**：API 端使用 `CURRENT_DATE AT TIME ZONE 'Asia/Taipei'`，前端使用本地時間的零時（`startOfDay(new Date())`），兩者語意一致

---

## 2. API 層變更 (`apps/api/src/routes/classes.ts`)

### 新增 Query Params

| 參數 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `includeHistorical` | `boolean` | `false` | 是否包含歷史班級 |
| `historicalFrom` | `string (yyyy-MM-dd)` | — | 搭配 `includeHistorical=true`，篩選有效期間重疊的歷史班級 |
| `historicalTo` | `string (yyyy-MM-dd)` | — | 同上 |

### 預設行為變更

未帶 `includeHistorical=true` 時，查詢自動加上：
```sql
(end_date IS NULL OR end_date >= CURRENT_DATE AT TIME ZONE 'Asia/Taipei')
```

### 歷史班級日期重疊條件

帶 `includeHistorical=true` 且有日期範圍時，**歷史班級**額外加上：
```sql
(start_date IS NULL OR start_date <= :historicalTo OR :historicalTo IS NULL)
AND (end_date >= :historicalFrom OR :historicalFrom IS NULL)
```
`start_date IS NULL` 的歷史班級視為「從很早開始」，仍可被日期範圍命中。

現役班級（`end_date IS NULL OR end_date >= today`）不受此日期範圍過濾，永遠全部回傳。

帶 `includeHistorical=true` 無日期範圍時，回傳所有班級（含所有歷史）。

### 向下相容性 — 現有呼叫端處理

預設過濾會影響以下呼叫端，需逐一確認行為是否可接受：

| 呼叫端 | 路徑 | 預設過濾是否可接受 |
|--------|------|------------------|
| `CoursesPage.loadClasses()` | `courses.page.ts` | ✅ 可接受，歷史透過 toggle 另外 fetch |
| `ClassPickerDialogComponent` | `students/detail/class-picker-dialog` | ✅ 選班不應選已結束班級 |
| `SessionsPage` class filter | `sessions/sessions.page.ts` | ✅ 行事曆篩選班級應排除已結束班級 |
| 其他呼叫 `classesService.list()` | 待實作時確認 | 預設排除歷史，如有需要加 `includeHistorical: true` |

---

## 3. 前端 Signal 設計 (`courses.page.ts`)

```ts
protected readonly showHistorical = signal(false);
protected readonly historicalDateFrom = signal<Date | null>(null);
protected readonly historicalDateTo = signal<Date | null>(null);
protected readonly historicalClasses = signal<Class[]>([]);
protected readonly loadingHistorical = signal(false);
```

**`isHistorical` helper（pure function，非 signal）：**

```ts
protected isHistorical(cls: Class): boolean {
  if (!cls.endDate) return false;
  const end = new Date(cls.endDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}
```

**合併後的班級清單：**

```ts
protected readonly allClasses = computed(() => [
  ...this.classes(),
  ...(this.showHistorical() ? this.historicalClasses() : []),
]);
```

`courseGroups` computed 改用 `allClasses()` 而非 `this.classes()`。

### `courseGroups` 中的 filter 行為

歷史班級參與所有現有 filter（搜尋、老師、科目），但有一個例外：

- `statusFilter === true`（「啟用中」）時：歷史班級即使 `isActive=true` 也**不顯示**（加 `!isHistorical(cl)` 條件）
- `statusFilter === false`（「已停用」）時：歷史班級正常顯示（不額外排除）
- `statusFilter === null`（全部）：歷史班級正常顯示

### Toggle OFF 時的清理

Toggle 關閉時：
1. `historicalClasses.set([])`
2. `historicalDateFrom.set(null)`、`historicalDateTo.set(null)`
3. 從 `selectedClassIds` 中移除歷史班級的 ID

---

## 4. Filter UI 變更

### Toolbar 新增元素

現有篩選列（科目 / 老師 / 狀態）後方新增 toggle：

```
[ 含歷史班級 ○── ]
```

Toggle ON 後行內展開日期範圍：

```
[ 含歷史班級 ●── ]  [ 開始日期 ]  ～  [ 結束日期 ]
```

使用 `p-datepicker`，`dateFormat="yy-mm-dd"`，`[appendTo]="'body'"`。

### 互動行為

| 動作 | 結果 |
|------|------|
| Toggle ON（無日期範圍） | 載入所有歷史班級 |
| Toggle ON + 填日期範圍 | re-fetch，只取該範圍有效的歷史班級 |
| Toggle OFF | 清空日期範圍、清除 `historicalClasses`、移除已選歷史班級 |
| `hasActiveFilters()` | 包含 `showHistorical() === true` |
| 清除篩選按鈕 | 包含關閉 toggle |

### Loading 狀態

歷史班級 fetch 期間，`loadingHistorical = true`，班級列表區顯示輕量 inline loading indicator，不蓋掉現役班級。

---

## 5. Class Row 顯示變更

### 日期副標題

在 `.class-row__name-group` 內，班級名稱下方新增（只在有 `start_date` 或 `end_date` 時）：

```html
@if (cls.startDate || cls.endDate) {
  <span class="class-row__date-range">
    {{ cls.startDate ? (cls.startDate | slice:0:7) : '' }}
    ～
    {{ cls.endDate ? (cls.endDate | slice:0:7) : '' }}
  </span>
}
```

格式：`yyyy-MM`（只顯示年月）。只有 start：`2026-03 ～` / 只有 end：`～ 2027-01`。

### 歷史班級視覺處理

- 班級 row 加上 `.class-row--historical` class
- 整行 `opacity: 0.65`
- Hover 時 border-left 改用 `--zinc-300`（不使用 accent 色）
- 班級名稱旁加 `已結束` 小 tag（zinc 灰底，與「已停用」tag 風格一致）

---

## 6. 操作限制

| 操作 | 歷史班級行為 |
|------|-------------|
| 點擊進詳情頁 | ✅ 允許（為未來報表查閱保留） |
| 勾選 checkbox | ✅ 允許（為未來報表功能保留） |
| 編輯班級按鈕 | ❌ 隱藏 |
| 產生課堂按鈕 | ❌ 隱藏 |
| 停用 / 啟用按鈕 | ❌ 隱藏 |
| 批次啟用計數 | ❌ `selectedInactiveCount` computed 加 `!isHistorical(cl)` 條件 |
| 批次停用計數 | ❌ `selectedActiveCount` 同上 |
| 批次刪除 | ❌ `batchDelete()` 前端先過濾掉歷史班級 ID，不依賴後端 |

---

## 7. 受影響的檔案

| 動作 | 路徑 |
|------|------|
| Modify | `apps/api/src/routes/classes.ts` |
| Modify | `apps/web/src/app/core/classes.service.ts` |
| Modify | `apps/web/src/app/features/admin/pages/courses/courses.page.ts` |
| Modify | `apps/web/src/app/features/admin/pages/courses/courses.page.html` |
| Modify | `apps/web/src/app/features/admin/pages/courses/courses.page.scss` |
| Confirm | `apps/web/src/app/features/admin/pages/students/detail/class-picker-dialog/class-picker-dialog.component.ts` |
| Confirm | `apps/web/src/app/features/admin/pages/sessions/sessions.page.ts` |
| Confirm | `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts` |

---

## 8. 未來擴充（不在本次範圍）

- 詳情頁加「已結束」視覺提示 banner
- 批次勾選歷史班級後，匯出報表功能
