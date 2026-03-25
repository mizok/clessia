# 批次匯入預覽強化：合併提示 + 重複學生禁止

**日期：** 2026-03-25
**功能：** batch-check v2 — 既有家長合併 info 提示、同家長同名學生禁止匯入

---

## 背景

前一版 `POST /api/parents/batch-check` 僅偵測「同名但聯絡資訊不同」的衝突（`same_name_exists` warning）。

本次擴充兩個偵測情境：

1. **既有家長合併提示**：匯入行的電話/Email 已對應到 DB 既有家長（名稱亦相同）→ 會靜默合併，但管理者不知道。應顯示藍色 info 提示。
2. **重複學生禁止**：若該家長已存在於 DB，且其名下已有同名學生 → 禁止建立，顯示紅色錯誤。

---

## 衝突處理規則（完整版）

| 情境 | 類型 | 層級 | 行為 |
|------|------|------|------|
| 檔案內：同名同電話/Email | 現有 mergeNote | info | 藍色「將合併」，允許匯入 |
| 檔案內：同名但聯絡資訊不同 | 現有 warning | warning | ⚠️ 黃色警告，允許匯入 |
| DB：同電話/Email + 不同名 | 現有錯誤（batch-import 處理） | error | 匯入時報錯，非 batch-check 範圍 |
| DB：同名同電話/Email（會合併） | `merging_with_existing` ← **新增** | info | 藍色「將合併至現有帳號」，允許匯入 |
| DB：同名但聯絡資訊不同 | `same_name_exists`（既有） | warning | ⚠️ 黃色警告，允許匯入 |
| DB：既有家長下已有同名學生 | `student_already_exists` ← **新增** | error | 🔴 紅色錯誤，禁止該筆匯入 |

---

## 設計

### 1. Request body 變更

`BatchCheckRow` 新增 `studentName` 欄位（**optional**）：

```typescript
const BatchCheckRowSchema = z.object({
  parentName: z.string().min(1).max(100),
  parentPhone: z.string().optional(),
  parentEmail: z.string().optional(),
  studentName: z.string().max(50).optional(),  // ← 新增；空值或未提供時跳過學生重複查詢
});
```

`studentName` 設為 optional 的理由：若前端 `ParsedRow.studentName` 為空字串（使用者未填），應只跳過學生重複查詢，不能因 400 錯誤導致整個 batch-check（含家長名稱比對）被靜默略過。

前端 map 時：

```typescript
const checkRows: BatchCheckRow[] = parsedRows.map((row) => ({
  parentName: row.parentName,
  parentPhone: row.parentPhone || undefined,
  parentEmail: row.parentEmail || undefined,
  studentName: row.studentName || undefined,  // 空字串轉為 undefined
}));
```

### 2. Response schema 變更

新增 `merges` 和 `errors` 陣列，與現有 `warnings` 並列：

```json
{
  "warnings": [
    { "rowIndex": 0, "type": "same_name_exists", "message": "系統已有同名家長「王小美」，請確認是否為不同人" }
  ],
  "merges": [
    { "rowIndex": 1, "type": "merging_with_existing", "message": "此家長已存在於系統，匯入將合併至現有帳號" }
  ],
  "errors": [
    { "rowIndex": 2, "type": "student_already_exists", "message": "學生「王小明」已存在於此家長帳號下，無需重複建立" }
  ]
}
```

對應 Zod schema：

```typescript
const BatchCheckMergeSchema = z.object({
  rowIndex: z.number().int().min(0),
  type: z.literal('merging_with_existing'),
  message: z.string(),
}).openapi('BatchCheckMerge');

const BatchCheckErrorSchema = z.object({
  rowIndex: z.number().int().min(0),
  type: z.literal('student_already_exists'),
  message: z.string(),
}).openapi('BatchCheckError');

const BatchCheckResponseSchema = z.object({
  warnings: z.array(BatchCheckWarningSchema),
  merges: z.array(BatchCheckMergeSchema),
  errors: z.array(BatchCheckErrorSchema),
}).openapi('BatchCheckResponse');
```

### 3. 後端邏輯擴充

在現有 batch-check route handler 的 Step 4 中，當找到同名 DB 家長時，按以下優先順序處理：

**每個 `rowIndex` 只屬於一個分類（互斥）：**

1. `canMerge = false` → 進 `warnings[]`（`same_name_exists`），不做學生查詢
2. `canMerge = true` + 有重複學生 → 進 `errors[]`（`student_already_exists`），**不同時進 `merges[]`**
3. `canMerge = true` + 無重複學生（或 `studentName` 未提供）→ 進 `merges[]`（`merging_with_existing`）

**可合併時（`canMerge = true`）的完整處理邏輯：**

```typescript
// canMerge = true，取第一個命中的 DB 家長
const mergeTarget = matchingDbParents.find((p) => {
  const contact = userContactMap.get(p.user_id);
  if (!contact) return false;
  const phoneMatch = importPhone && contact.phone && importPhone === contact.phone;
  const emailMatch = importEmail && contact.email && importEmail === contact.email.toLowerCase();
  return phoneMatch || emailMatch;
});

if (!mergeTarget) {
  // canMerge = false
  warnings.push({ rowIndex, type: 'same_name_exists', message: `系統已有同名家長「${matchingDbParents[0].name}」，請確認是否為不同人` });
  continue;
}

// mergeTarget.id = 第一個命中 canMerge 的 DB 家長 id（parents 表 primary key）
const existingParentId = mergeTarget.id;

// 學生重複查詢（JS 端過濾，避免 Supabase foreign table filter 語法風險）
const importStudentName = (row.studentName ?? '').trim().toLowerCase();

if (importStudentName) {
  const { data: relations } = await supabase
    .from('parent_student_relations')
    .select('students!inner(id, name)')
    .eq('parent_id', existingParentId);

  const isDuplicateStudent = (relations ?? []).some(
    (r: any) => (r.students as { name: string }).name.trim().toLowerCase() === importStudentName
  );

  if (isDuplicateStudent) {
    errors.push({
      rowIndex,
      type: 'student_already_exists',
      message: `學生「${row.studentName!.trim()}」已存在於此家長帳號下，無需重複建立`,
    });
    continue;
  }
}

// 無重複學生 → 進 merges
merges.push({
  rowIndex,
  type: 'merging_with_existing',
  message: '此家長已存在於系統，匯入將合併至現有帳號',
});
```

> **注意：** 學生名稱比對使用 `trim().toLowerCase()`，統一大小寫處理，中文名稱 toLowerCase 無副作用。

### 4. 前端整合變更

**`parents.service.ts`** — 更新型別：

```typescript
export interface BatchCheckRow {
  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
  studentName?: string;  // ← 新增（optional）
}

export interface BatchCheckMerge {
  rowIndex: number;
  type: 'merging_with_existing';
  message: string;
}

export interface BatchCheckError {
  rowIndex: number;
  type: 'student_already_exists';
  message: string;
}

export interface BatchCheckResponse {
  warnings: BatchCheckWarning[];
  merges: BatchCheckMerge[];    // ← 新增
  errors: BatchCheckError[];    // ← 新增
}
```

**`parent-import-dialog.component.ts`** — 更新 `processFile()`：

```typescript
// 1. 靜默降級回傳需包含所有三個陣列
const dbResult: BatchCheckResponse = await firstValueFrom(
  this.parentsService.batchCheck(checkRows)
).catch((): BatchCheckResponse => ({ warnings: [], merges: [], errors: [] }));

// 2. 合併結果
for (const w of dbResult.warnings) {
  parsedRows[w.rowIndex]?.warnings.push(w.message);
}
for (const m of dbResult.merges) {
  if (parsedRows[m.rowIndex]) {
    parsedRows[m.rowIndex].mergeNote = m.message;  // 覆蓋檔案內合併（DB 資訊更精確）
  }
}
for (const e of dbResult.errors) {
  parsedRows[e.rowIndex]?.errors.push(e.message);
}
```

### 5. onSubmit() 無需修改

`onSubmit()` 現有過濾條件 `.filter(row => row.errors.length === 0)` 已足夠。DB 錯誤訊息 push 進 `parsedRow.errors[]` 後，該列在匯入時自動被排除，不需要修改 `onSubmit()`。

### 6. 警告/錯誤顯示

不需修改 HTML 或 SCSS。

- `mergeNote` 走現有藍色 info 欄位
- `warnings[]` 走現有黃色 ⚠️ 警告
- `errors[]` 走現有紅色 🔴 錯誤，`onSubmit()` 自動排除該列

---

## 改動範圍

| 檔案 | 改動 |
|------|------|
| `apps/api/src/routes/parents.ts` | 更新 `BatchCheckRowSchema`（加 `studentName?: optional`）、`BatchCheckResponseSchema`（加 `merges`、`errors` 陣列及對應 item schemas）、擴充 route handler 邏輯（canMerge 判斷 + 學生重複查詢） |
| `apps/web/src/app/core/parents.service.ts` | 更新 `BatchCheckRow`（加 `studentName?`）、`BatchCheckResponse`（加 `merges`、`errors`）、新增 `BatchCheckMerge`、`BatchCheckError` 介面 |
| `apps/web/.../parent-import-dialog.component.ts` | 更新 `checkRows` map（加 `studentName`）、更新靜默降級回傳（加 `merges: [], errors: []`）、合併 `merges` 和 `errors` 結果進 `parsedRows` |

---

## 不在範圍內

- 修改 `batch-import` 的學生重複處理邏輯（batch-check 已標記錯誤的列，`onSubmit()` 過濾後不會送進 batch-import）
- 檔案內重複學生偵測（同一 Excel 內同家長同學生名）
- 學生存在於 DB 但不在此家長名下的跨家長偵測
