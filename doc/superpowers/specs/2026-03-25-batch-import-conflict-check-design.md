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
| 對比 DB：同電話/Email + 不同名 | 報錯，該筆匯入失敗 |
| 對比 DB：同名但聯絡資訊不同 | 預覽時顯示「需確認」警告，允許匯入 ← **新增** |
| 對比 DB：同電話/Email + 同名 | 視為同一家長合併，無警告 |

---

## 設計

### 1. 新 API Endpoint

**`POST /api/parents/batch-check`**

受 auth middleware 保護（需登入且有 orgId）。

**Request body：**
```json
{
  "rows": [
    { "parentName": "王小美", "parentPhone": "0999999999", "parentEmail": "" }
  ]
}
```

**後端邏輯：**
1. 收集所有不重複的家長姓名
2. 一次查詢 `parents WHERE name IN (...) AND org_id = orgId`，取得 `id, name, user_id`
3. 對找到的每個同名家長，查 `ba_user` 取得 `phone, email`（並過濾 placeholder email）
4. 對每個匯入行，逐一比對：若 DB 有同名家長，且其電話與 Email 均與匯入行不符（無法合併）→ 回傳警告
5. 若匯入行的電話/Email 能對應到同名 DB 家長（即會被合併）→ 不視為衝突，不回傳警告

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

只做讀取，不寫入任何資料。

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
  rowIndex: number;
  type: 'same_name_exists';
  message: string;
}

export interface BatchCheckResponse {
  warnings: BatchCheckWarning[];
}

batchCheck(rows: BatchCheckRow[]): Observable<BatchCheckResponse>
```

**`parent-import-dialog.component.ts`**

`processFile()` 流程改為：

```
上傳檔案
  → parseRows()          // 現有邏輯（檔案內衝突檢查）
  → batchCheck() API     // 新增：DB 衝突檢查
  → 合併 DB warnings 進 ParsedRow.warnings[]
  → step.set(2)          // 進入預覽
```

- batch-check API 失敗時**靜默降級**：直接進入預覽，不阻擋流程
- 整個流程在同一 loading 狀態內完成（不需要新增 spinner）

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
| `apps/web/.../parent-import-dialog.component.ts` | `processFile()` 串接 batch-check |

---

## 不在範圍內

- 單筆新增家長的同名檢查（另議）
- 批次匯入結果頁的同名提示（警告已在預覽時顯示，結果頁不重複）
- 修改現有的 `batch-import` endpoint 邏輯
