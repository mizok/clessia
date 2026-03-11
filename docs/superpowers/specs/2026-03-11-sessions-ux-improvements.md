# Sessions UX Improvements — Design Spec

**Date:** 2026-03-11
**Scope:** 課堂管理板塊三項 UX 改善
**Status:** Approved

---

## 背景

課堂管理板塊審查後，識別出三項不依賴未完成功能（如點名）的獨立 UX 缺口，可立即實作。

---

## 項目一：批次操作結果加入略過原因說明

### 問題

批次操作完成後，toast 只顯示「已停課 3 堂，略過 2 堂」，使用者不知道為何有課堂被略過。

### 設計

**不修改 API。** 略過的原因在各模式下是規則性的，可在前端靜態對應。

在 `sessions.page.ts` 的 `openBatchSheet` onClose 回呼中，當 `skipped > 0` 時，根據 `mode` 附加一句說明文字：

| mode | 略過原因說明 |
|------|------------|
| `cancel` | 已停課的課堂無法重複操作 |
| `uncancel` | 僅停課中的課堂可取消停課 |
| `assign` | 已指派老師的課堂已略過 |
| `time` | 已停課的課堂無法調整時間 |

**Toast 格式：**
- skipped = 0：`已停課 3 堂`
- skipped > 0：`已停課 3 堂，略過 2 堂（已停課的課堂無法重複操作）`

### 影響範圍

- `sessions.page.ts`：修改 `openBatchSheet` 的 onClose message 組合邏輯

---

## 項目二：未指派課堂快速篩選入口

### 問題

未指派課堂是最常見的待辦狀態，目前需要手動展開篩選器才能找到。

### 設計

**SessionsHeaderComponent** 新增：
- `unassignedCount = input<number>(0)`：未指派課堂數，由 parent 傳入
- `filterUnassigned = output<void>()`：使用者點擊 badge 時觸發

**Badge 呈現規則：**
- 只在 `unassignedCount() > 0` 時顯示
- 樣式：橘色小圓角標籤，文字 `N 堂未指派`
- Hover 時有 cursor pointer + 輕微加深效果

**sessions.page.ts** 新增：
- `unassignedCount = computed(() => sessions().filter(s => s.assignmentStatus === 'unassigned' && s.status !== 'cancelled').length)`
  - 此數字反映**目前已載入資料範圍內**的未指派數，非全局數字（API 不支援全局計數）
- 監聽 `filterUnassigned` output → 呼叫 `selectedTeacherIds.set(['__unassigned__'])`
  - 專案已有 `__unassigned__` 慣例：`filteredSessions` computed 會把這個特殊值對應到 `assignmentStatus === 'unassigned'` 的 client-side filter，`applyQueryParams`/`buildQueryParams` 也已支援序列化

### 影響範圍

- `sessions-header.component.ts`：新增 input/output
- `sessions-header.component.html`：新增 badge
- `sessions-header.component.scss`：badge 樣式
- `sessions.page.ts`：computed + output handler
- `sessions.page.html`：傳入 input、監聽 output
- `sessions.page.spec.ts`：補充 unassignedCount computed 和 filterUnassigned handler 的測試

---

## 項目三：Icon 語意修正

### 問題

Context menu 的「調課」使用 `pi-calendar-clock`，與其他操作項目的 icon 風格不一致，且語意偏向「日曆上的時鐘」而非「移動時間」。

### 設計

| 位置 | 目前 | 修改後 | 說明 |
|------|------|--------|------|
| `sessions.page.ts` context menu「調課」 | `pi pi-calendar-clock` | `pi pi-arrows-h` | 左右箭頭語意對應「調整/移動時間」 |

`p-datepicker` 的預設 `pi-calendar` icon 為 PrimeNG 內建行為，語意正確，不修改。

### 影響範圍

- `sessions.page.ts`：一行 icon 字串修改

---

## 非範圍（刻意排除）

- Summary Bar（今日統計）：依賴點名功能，延後
- 停課後補課引導：需設計補課工作流程，延後
- 批次 skippedIds：需 API 變更，延後

---

## 實作順序建議

1. Icon 修正（1 行，獨立）
2. 批次摘要（純 TS 邏輯）
3. 未指派快篩（需確認 assignmentStatus 篩選機制）
