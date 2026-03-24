# Excel 批次匯入設計文件

**日期**：2026-03-24
**功能**：家長批次匯入、班級批次加學生
**狀態**：已確認，待實作

---

## 一、功能概覽

| 功能 | 入口 | 對象 |
|------|------|------|
| 家長批次匯入 | 家長列表頁工具列「匯入」按鈕 | 全新建立家長帳號 + 學生帳號 |
| 班級批次加學生 | 班級詳情頁學生區塊「Excel 匯入」按鈕 | 比對系統中已存在的學生並加入班級 |

---

## 二、Excel 範本格式

### 2.1 家長匯入範本

每行代表一個「家長—學生」關係。若一個家長有多個孩子，重複填寫家長資訊（同電話或同 Email），系統自動合併。

| 欄位 | 必填 | 說明 |
|------|------|------|
| 家長姓名 | ✅ | 最長 100 字 |
| 家長電話 | 至少一個 | 格式：09xxxxxxxx，最長 20 字 |
| 家長Email | 至少一個 | 標準 Email 格式 |
| 家長備註 | ❌ | 最長 2000 字 |
| 學生姓名 | ✅ | 最長 50 字 |
| 學生年級 | ✅ | 固定值（見下方對照表） |
| 學生就讀學校 | ✅ | 最長 100 字 |
| 學生生日 | ❌ | 格式：YYYY-MM-DD |
| 學生性別 | ❌ | 固定值：男、女、不提供 |

**年級對照表**（範本說明頁列出，前端解析時將中文轉換為系統碼）

| Excel 填寫值 | 系統碼 |
|--------------|--------|
| 小一 | P1 |
| 小二 | P2 |
| 小三 | P3 |
| 小四 | P4 |
| 小五 | P5 |
| 小六 | P6 |
| 國一 | J1 |
| 國二 | J2 |
| 國三 | J3 |
| 高一 | S1 |
| 高二 | S2 |
| 高三 | S3 |

**性別對照表**：男 → `male`、女 → `female`、不提供 → `prefer_not_to_say`

電話格式驗證（`09xxxxxxxx`）僅在前端 preview 執行；後端只驗證最長 20 字，不重複格式驗證。

### 2.2 班級加學生範本

| 欄位 | 必填 | 說明 |
|------|------|------|
| 學生姓名 | ✅ | 用於比對系統中已存在的學生 |
| 就讀學校 | ✅ | 配合姓名提高比對精準度 |

---

## 三、UI 流程

### 3.1 家長批次匯入 Dialog

**步驟 1 — 上傳**
- Dialog 內顯示「下載範本」連結 + 拖曳/點擊上傳區
- 前端使用 `xlsx` 函式庫解析，不傳原始檔至後端
- 解析後進入步驟 2

**步驟 2 — 預覽與驗證**
- 列出所有解析出的行，顯示：家長姓名、聯絡資訊、學生姓名
- 錯誤標記：
  - 🔴 必填欄位缺漏（必須修正才可繼續）
  - 🔴 電話/Email 格式錯誤
  - 🟡 同名家長警示：名字相同但聯絡資訊不同，將建立為兩個獨立帳號，請確認是否正確
  - 🔵 合併提示：同電話/Email 出現多次，將建立 1 個家長帳號並關聯 N 個學生
- 有任何 🔴 錯誤，「確認匯入」按鈕 disabled

**步驟 3 — 批次建立（後端）**
- 呼叫 `POST /api/parents/batch-import`
- 後端逐筆執行：建立家長帳號 → 建立學生帳號 → 建立關聯
- 任一筆失敗不中斷整批，繼續處理下一筆

**步驟 4 — 結果摘要**
- 顯示：建立家長 N 個、建立學生 N 個、失敗 N 筆
- 失敗筆數 > 0 時提供可下載的錯誤報告（CSV）

---

### 3.2 班級批次加學生 Dialog

**步驟 1 — 上傳**
- 同上，下載範本 + 上傳

**步驟 2 — 比對預覽**
- 前端解析後呼叫 `POST /api/enrollments/batch-match` 取得每行比對結果
- 比對狀態：
  - ✅ 唯一匹配（姓名 + 學校找到唯一一筆）→ 可加入
  - ⚠️ 多重匹配（同名同校存在多筆）→ 需手動選擇
  - 🔴 找不到 → 標記「系統中無此學生」
  - 🔴 已在班級中 → 標記「已是班級成員」

**步驟 3 — 衝突處理（僅有 ⚠️ 時出現）**
- 每個衝突行展開候選學生清單
- 顯示：姓名、年級、學校、生日（輔助辨識）
- 管理者點選正確的一筆；也可選擇「略過此行」

**步驟 4 — 確認匯入**
- 呼叫現有 `POST /api/enrollments/batch`（傳入確認的 studentIds）
- 顯示結果：成功加入 N 人、略過 N 人
- 若後端回傳 `over_quota`（班級人數已達上限）：顯示錯誤提示「班級人數已達上限，本次匯入已取消」，不進行部分匯入
- **備註**：現有 `POST /api/enrollments/batch` 在 insert 前先做 quota 檢查（整批取消，無部分寫入問題），無需額外改造
- **前端預防**：比對預覽步驟應顯示「班級剩餘名額 N 人 / 本次將加入 M 人」，若 M > N 則在 preview 警示，讓管理者在送出前就能發現

---

## 四、API 設計

### 4.1 `POST /api/parents/batch-import`（新增）

**Request Body**
```ts
{
  rows: Array<{
    parentName: string;
    parentPhone?: string;
    parentEmail?: string;
    parentNotes?: string;
    studentName: string;
    studentGrade: GradeLevel;        // 'P1'|'P2'|'P3'|'P4'|'P5'|'P6'|'J1'|'J2'|'J3'|'S1'|'S2'|'S3'
    studentSchool: string;
    studentBirthday?: string;        // 'YYYY-MM-DD'
    studentGender?: StudentGender;   // 'male' | 'female' | 'prefer_not_to_say'
  }>
}
```

**Response**
```ts
{
  parentsCreated: number;
  studentsCreated: number;
  results: Array<{
    rowIndex: number;
    status: 'success' | 'failed';
    parentId?: string;
    studentId?: string;
    error?: string;   // 'DUPLICATE_EMAIL' | 'DUPLICATE_PHONE' | 'CREATE_FAILED' | ...
  }>
}
```

**後端邏輯**
1. 先將同一批次的行按電話/Email 分組，確定哪些行要共用同一個家長帳號
2. 依序建立家長（若同批次已建立則取 id）→ 建立學生 → 建立 parent_student_relations
3. 任一步失敗，該行記錄 `failed`，繼續下一行

**冪等行為（家長電話/Email 已存在於系統）**

若 batch-import 中的家長電話/Email 在資料庫中已存在（即該家長之前已建立過帳號）：
- **不重複建立帳號**，直接取得現有家長的 id
- 繼續建立學生並關聯至現有家長
- response 中該行 `status: 'success'`，`parentId` 指向現有帳號

此行為使批次匯入可安全重試，不會因為部分家長已存在而失敗。`DUPLICATE_EMAIL` / `DUPLICATE_PHONE` 錯誤碼保留給「同一批次內」重複（前端 preview 應已攔截，後端為保險兜底）。

**學生建立行為（永遠新建）**

批次匯入中的每個學生均視為全新建立，不嘗試比對系統中已存在的學生：
- 即使系統中已有同名同校的學生，仍建立新帳號
- 這是刻意設計：批次匯入是一次性上線資料匯入場景，不是增量更新
- `org_id` 由後端從認證 session 取得，不由前端傳入

---

### 4.2 `POST /api/enrollments/batch-match`（新增，唯讀）

**Request Body**
```ts
{
  classId: string;
  items: Array<{ name: string; school: string }>
}
```

**Response**
```ts
{
  results: Array<{
    index: number;
    status: 'matched' | 'ambiguous' | 'not_found' | 'already_enrolled';
    studentId?: string;        // status === 'matched'
    candidates?: Array<{       // status === 'ambiguous'
      id: string;
      name: string;
      grade: string;
      school: string;
      birthday?: string | null;
    }>;
  }>
}
```

**比對邏輯**（兩段式）

```sql
-- 第一段：精確全字比對
SELECT * FROM students
WHERE org_id = $orgId
  AND name = $name
  AND school = $school
  AND is_active = true;

-- 若第一段無結果，執行第二段：模糊比對
SELECT * FROM students
WHERE org_id = $orgId
  AND name ILIKE $name
  AND school ILIKE $school
  AND is_active = true;
```

執行順序：
1. 依上述兩段查詢取得候選清單
2. 從候選中排除已在 classId 的 enrollments 中的學生（`already_enrolled` 檢查為後處理步驟）
3. 排除後：
   - 唯一剩餘 → `matched`
   - 多筆剩餘 → `ambiguous`（回傳所有候選）
   - 剩餘為空但排除前有結果 → `already_enrolled`
   - 兩段皆無結果 → `not_found`

`org_id` 由後端從認證 session 取得，不由前端傳入。

---

### 4.3 現有端點沿用

班級加學生的寫入沿用：`POST /api/enrollments/batch`（傳 `{ classId, studentIds[] }`）

---

## 五、前端元件結構

```
apps/web/src/app/
├── features/admin/pages/parents/
│   └── parent-import-dialog/
│       ├── parent-import-dialog.component.ts
│       ├── parent-import-dialog.component.html
│       └── parent-import-dialog.component.scss
│
└── features/admin/pages/courses/class-detail/
    └── student-excel-import-dialog/
        ├── student-excel-import-dialog.component.ts
        ├── student-excel-import-dialog.component.html
        └── student-excel-import-dialog.component.scss
```

兩個 dialog 各自獨立，不共用元件，但遵循相同的 wizard 視覺模式（步驟指示器 + 內容區 + footer）。

---

## 六、錯誤處理原則

| 層級 | 處理方式 |
|------|----------|
| 解析錯誤（非 xlsx 格式） | 前端立即提示，不進入預覽 |
| 欄位驗證錯誤 | 預覽步驟標紅，確認按鈕 disabled |
| 同名家長警示 | 預覽步驟標黃，仍可確認匯入 |
| 後端個別行失敗 | 不中斷整批，結果摘要顯示失敗行 |
| 網路錯誤 | 提示重試，不重複建立（後端需冪等） |

---

## 七、範圍外（Out of Scope）

- 匯入結果的 audit log（現有 audit log 機制不在本次範圍）
- 更新現有家長/學生資料（本次僅建立新資料）
- 家長帳號初始密碼顯示（批次匯入不逐一彈窗顯示。結果頁提示：「各帳號已建立，請透過家長管理頁的『重設密碼』功能取得初始密碼後再通知家長」）
