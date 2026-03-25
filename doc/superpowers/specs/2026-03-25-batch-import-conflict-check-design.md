# 批次匯入家長：預覽前 DB 同名衝突檢查

**日期：** 2026-03-25
**功能：** 家長批次匯入（Excel）衝突偵測強化

---

## 背景

批次匯入家長時，前端已能偵測同一 Excel **檔案內**的重複（同名同聯絡方式顯示「將合併」、同名不同聯絡顯示「需確認」）。但目前無法在預覽步驟比對 **DB 既有資料**，導致以下問題：

- 匯入的家長姓名若已存在於 DB（但聯絡方式不同），系統會靜默建立第二個同名帳號，管理者無從察覺。

---

## 衝突處理規則（完整）

| 情境 | 行為 |
|------|------|
| 檔案內：同名同電話/Email | 顯示「將合併」提示，允許匯入 |
| 檔案內：同名但聯絡資訊不同 | 顯示「需確認」警告，允許匯入 |
| 對比 DB：同電話/Email + 不同名 | 報錯，該筆匯入失敗（由 batch-import 處理，不在 batch-check 範圍） |
| 對比 DB：同名但聯絡資訊不同 | 預覽時顯示「需確認」警告，允許匯入 ← **新增** |
| 對比 DB：同電話/Email + 同名 | 視為同一家長合併，無警告 |

> **注意：** `batch-check` 只負責偵測「同名但聯絡資訊不同」的情境。「同電話/Email 但不同名」的衝突由現有 `batch-import` endpoint 在實際匯入時處理，`batch-check` 不重複偵測。

---

## 設計

### 1. 新 API Endpoint

**`POST /api/parents/batch-check`**

受 auth middleware 保護（需登入且有 orgId）。

**Request body Zod schema：**

```typescript
const BatchCheckRowSchema = z.object({
  parentName: z.string().min(1).max(100),
  parentPhone: z.string().optional(),   // 空字串或 undefined 均視為無電話
  parentEmail: z.string().optional(),   // 空字串或 undefined 均視為無 Email
});

const BatchCheckBodySchema = z.object({
  rows: z.array(BatchCheckRowSchema).min(1).max(500),
});
```

欄位定義與現有 `BatchImportRowSchema` 的 `parentPhone`/`parentEmail` 對齊（均為 optional string）。

**Request body 範例：**

```json
{
  "rows": [
    { "parentName": "王小美", "parentPhone": "0999999999", "parentEmail": "" }
  ]
}
```

**後端邏輯：**

所有字串比對在 **JS 層**執行（不使用 SQL 函數），資料庫僅負責查詢。

1. 從 `rows` 收集所有不重複的家長姓名，以 JS `name.trim().toLowerCase()` 正規化後去重
2. 以 Supabase `ilike`（case-insensitive）查詢 `parents WHERE name ILIKE ANY(names) AND org_id = orgId`，取得 `id, name, user_id`（此步驟為範圍縮小查詢，JS 端仍做精確比對）
3. 對找到的每個同名家長，查 `ba_user` 取得 `phone, email`；以 `isPlaceholderEmail(email, c.env.PLACEHOLDER_EMAIL_DOMAIN)` 過濾 placeholder email（過濾後該家長視為無 email）
4. 對每個匯入行，在 JS 端以 `trim().toLowerCase()` 對 DB 家長名稱進行精確比對，若找到同名家長，再進行聯絡資訊比對：
   - DB `phone` 格式為原始寫入值（無 `+886` 前綴，與匯入行 `parentPhone.trim()` 直接比對）
   - **「可合併」判定（任一滿足即視為可合併，不回傳警告）：**
     - 匯入行 `parentPhone.trim()` 非空 **且** 等於 DB 家長的 `phone`，**或**
     - 匯入行 `parentEmail.trim()` 非空 **且** 等於 DB 家長的 `email`（需先排除 placeholder）
   - 若兩者均不符 → 回傳 `same_name_exists` 警告
5. 每個匯入行最多回傳一個警告（取第一個無法合併的同名 DB 家長）

**Response：**
```json
{
  "warnings": [
    {
      "rowIndex": 0,
      "type": "same_name_exists",
      "message": "系統已有同名家長「王小美」，請確認是否為不同人"
    }
  ]
}
```

- `rowIndex` 為 **0-based**，對應 request body `rows[rowIndex]`，也等同前端 `parsedRows` 陣列的索引（非 `ParsedRow.index` 的 1-based 顯示值）
- 只做讀取，不寫入任何資料。

---

### 2. 前端整合

**`apps/web/src/app/core/parents.service.ts`**

新增：
```typescript
export interface BatchCheckRow {
  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
}

export interface BatchCheckWarning {
  rowIndex: number;  // 0-based，對應 parsedRows 陣列索引
  type: 'same_name_exists';
  message: string;
}

export interface BatchCheckResponse {
  warnings: BatchCheckWarning[];
}

batchCheck(rows: BatchCheckRow[]): Observable<BatchCheckResponse>
```

**`parent-import-dialog.component.ts`**

`processFile()` 改為 async 方法（現有 `.then()` 鏈重構為 async/await），流程：

```
上傳檔案
  → parseRows()          // 現有邏輯（檔案內衝突檢查）
  → batchCheck() API     // 新增：DB 衝突檢查
  → 合併 DB warnings 進 ParsedRow.warnings[]
  → step.set(2)          // 進入預覽
```

**前端傳送 batch-check 時，包含所有行（含有 errors 的行），不過濾。**

`parsedRows` 的 index（0-based 陣列位置）與 `rowIndex` 直接對應。

**靜默降級實作：**
```typescript
const checkRows = parsedRows.map(row => ({
  parentName: row.parentName,
  parentPhone: row.parentPhone || undefined,
  parentEmail: row.parentEmail || undefined,
}));

const dbResult = await firstValueFrom(
  this.parentsService.batchCheck(checkRows)
).catch(() => ({ warnings: [] as BatchCheckWarning[] }));

for (const w of dbResult.warnings) {
  parsedRows[w.rowIndex].warnings.push(w.message);
}
```

整個流程在同一 loading 狀態內完成（不需要新增 spinner）。

---

### 3. 警告顯示

不需修改 HTML 或 SCSS。

DB 同名警告走現有的 `row.warnings[]`，預覽表格「狀態」欄自動顯示：

```
⚠️ 需確認
系統已有同名家長「王小美」，請確認是否為不同人
```

警告**不阻擋匯入**（不進 `errors[]`），管理者可自行判斷是否繼續。

---

## 改動範圍

| 檔案 | 改動 |
|------|------|
| `apps/api/src/routes/parents.ts` | 新增 `POST /batch-check` route |
| `apps/web/src/app/core/parents.service.ts` | 新增 `batchCheck()` method 與相關型別 |
| `apps/web/.../parent-import-dialog.component.ts` | `processFile()` 改為 async 並串接 batch-check |

---

## 不在範圍內

- 單筆新增家長的同名檢查（另議）
- 批次匯入結果頁的同名提示（警告已在預覽時顯示，結果頁不重複）
- 修改現有的 `batch-import` endpoint 邏輯
- 偵測「同電話/Email + 不同名」衝突（由 `batch-import` 處理）
