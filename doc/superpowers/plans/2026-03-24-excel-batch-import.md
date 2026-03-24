# Excel 批次匯入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增兩個 Excel 批次匯入功能：(A) 家長列表頁批次建立家長＋學生帳號；(B) 班級詳情頁批次比對現有學生並加入班級。

**Architecture:** 前端使用 xlsx 解析 Excel，API 新增兩個端點（`POST /api/parents/batch-import`、`POST /api/enrollments/batch-match`），各功能以 PrimeNG DynamicDialog 封裝為四步驟 wizard（上傳 → 預覽/比對 → 衝突處理 → 結果）。

**Tech Stack:** Angular 21 Standalone Components + Signals、PrimeNG 21 DynamicDialog、Hono + Zod OpenAPI、Supabase JS、xlsx（已在 stack）

**Spec:** `doc/superpowers/specs/2026-03-24-excel-batch-import-design.md`

---

## 檔案地圖

### 新建
| 路徑 | 說明 |
|------|------|
| `apps/api/src/routes/parents.ts` | 新增 `POST /parents/batch-import` |
| `apps/api/src/routes/enrollments.ts` | 新增 `POST /enrollments/batch-match` |
| `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.ts` | 家長批次匯入 dialog |
| `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.html` | |
| `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.scss` | |
| `apps/web/src/app/features/admin/pages/courses/class-detail/student-excel-import-dialog/student-excel-import-dialog.component.ts` | 班級批次加學生 dialog |
| `apps/web/src/app/features/admin/pages/courses/class-detail/student-excel-import-dialog/student-excel-import-dialog.component.html` | |
| `apps/web/src/app/features/admin/pages/courses/class-detail/student-excel-import-dialog/student-excel-import-dialog.component.scss` | |

### 修改
| 路徑 | 修改內容 |
|------|----------|
| `apps/web/src/app/core/parents.service.ts` | 新增 `BatchImportInput`、`BatchImportResult` 介面與 `batchImport()` 方法 |
| `apps/web/src/app/core/enrollments.service.ts` | 新增 `BatchMatchInput`、`BatchMatchResult` 介面與 `batchMatch()` 方法 |
| `apps/web/src/app/features/admin/pages/parents/parents.page.ts` | 新增「匯入」按鈕 + 開啟 dialog 邏輯 |
| `apps/web/src/app/features/admin/pages/parents/parents.page.html` | 工具列加「匯入」按鈕 |
| `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts` | 新增「Excel 匯入」按鈕 + 開啟 dialog 邏輯 |
| `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html` | 學生區塊加「Excel 匯入」按鈕 |

---

## ═══ Phase A：家長批次匯入 ═══

---

### Task A1：API — `POST /api/parents/batch-import`

> 🤖 **委派 Codex**：給定 sessionId，prompt 包含以下完整規格

**Files:**
- Modify: `apps/api/src/routes/parents.ts`

**Codex prompt 骨架：**
```
在 apps/api/src/routes/parents.ts 新增一個 POST /batch-import 端點。

專案環境：Hono + @hono/zod-openapi，Supabase JS client，Better Auth admin API（`createAuth(env).api.admin.createUser()`），TypeScript strict。

Request body schema（Zod）：
{
  rows: z.array(z.object({
    parentName: z.string().min(1).max(100),
    parentPhone: z.string().max(20).optional(),
    parentEmail: z.email().optional(),
    parentNotes: z.string().max(2000).optional(),
    studentName: z.string().min(1).max(50),
    studentGrade: GradeLevelSchema,   // 從既有 students route import
    studentSchool: z.string().min(1).max(100),
    studentBirthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    studentGender: StudentGenderSchema.optional(),  // 從 students route import
  })).min(1).max(500),
}

Response schema：
{
  parentsCreated: z.number(),
  studentsCreated: z.number(),
  results: z.array(z.object({
    rowIndex: z.number(),
    status: z.enum(['success', 'failed']),
    parentId: z.string().optional(),
    studentId: z.string().optional(),
    error: z.string().optional(),
  })),
}

後端邏輯：
1. 從 c.get('orgId') 取得 orgId，從 c.get('supabase') 取得 supabase client
2. 將 rows 按 parentPhone / parentEmail 分組，決定哪些 rows 共用同一個家長帳號
   - 分組 key：normalize(phone) 或 normalize(email)（去除空白、轉小寫）
   - 同一批次內同 key → 共用；不同 key → 各自建立
3. 依序處理每個家長群組：
   a. 先查 supabase 的 parents 表：`SELECT id FROM parents WHERE org_id = orgId AND (phone = ? OR email = ?)`
   b. 若已存在 → 取既有 parentId（冪等）
   c. 若不存在 → 呼叫 auth.api.admin.createUser() 建立 Better Auth 帳號，再 INSERT parents
4. 對每個 row 建立學生：INSERT students（永遠新建，不去重）
5. INSERT parent_student_relations（relation: null, is_primary: true）
6. 每個 row 的結果記入 results 陣列，任一步失敗 → status: 'failed' + error，繼續下一個
7. 回傳 { parentsCreated, studentsCreated, results }

參考同檔案既有的 create parent 端點的 Better Auth 呼叫方式。
```

- [ ] **A1-1**：委派 Codex 實作上述端點
- [ ] **A1-2**：本機啟動 API，用 curl/Postman 測試：

```bash
curl -X POST http://localhost:3000/api/parents/batch-import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "rows": [{
      "parentName": "測試家長",
      "parentPhone": "0912345678",
      "studentName": "測試學生",
      "studentGrade": "J1",
      "studentSchool": "台北市立中正國中"
    }]
  }'
```

  期望：`{ parentsCreated: 1, studentsCreated: 1, results: [{ rowIndex: 0, status: "success" }] }`

- [ ] **A1-3**：測試重複電話（冪等）：再送同一筆，期望：同一個 parentId，新增另一個學生
- [ ] **A1-4** Commit：
```bash
git add apps/api/src/routes/parents.ts
git commit -m "feat(api): add POST /parents/batch-import endpoint"
```

---

### Task A2：Service — `ParentsService.batchImport()`

> 🤖 **委派 Codex**

**Files:**
- Modify: `apps/web/src/app/core/parents.service.ts`

**Codex prompt：**
```
在 apps/web/src/app/core/parents.service.ts 新增以下介面與方法。

Angular 版本：21，使用 inject(HttpClient)，回傳 Observable。

新增介面（放在檔案現有介面區塊）：

export interface BatchImportRow {
  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
  parentNotes?: string;
  studentName: string;
  studentGrade: string;   // 'P1'|'P2'|...|'S3'
  studentSchool: string;
  studentBirthday?: string;
  studentGender?: string;
}

export interface BatchImportResultItem {
  rowIndex: number;
  status: 'success' | 'failed';
  parentId?: string;
  studentId?: string;
  error?: string;
}

export interface BatchImportResponse {
  parentsCreated: number;
  studentsCreated: number;
  results: BatchImportResultItem[];
}

在 ParentsService class 新增方法：
  batchImport(rows: BatchImportRow[]): Observable<BatchImportResponse> {
    return this.http.post<BatchImportResponse>(`${this.endpoint}/batch-import`, { rows });
  }
```

- [ ] **A2-1**：委派 Codex 實作
- [ ] **A2-2**：確認 TypeScript 編譯無誤：`npx ng build --configuration development 2>&1 | head -20`
- [ ] **A2-3** Commit：
```bash
git add apps/web/src/app/core/parents.service.ts
git commit -m "feat(parents-service): add batchImport method and interfaces"
```

---

### Task A3：產生 `parent-import-dialog` 元件骨架

**Files:**
- Create: `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.{ts,html,scss}`

- [ ] **A3-1**：產生元件：
```bash
cd apps/web
npx ng generate component features/admin/pages/parents/parent-import-dialog \
  --type component --standalone --skip-tests
```

- [ ] **A3-2**：確認三個檔案已建立
- [ ] **A3-3** Commit：
```bash
git add apps/web/src/app/features/admin/pages/parents/parent-import-dialog/
git commit -m "feat(parent-import-dialog): scaffold component"
```

---

### Task A4：實作 `parent-import-dialog` 邏輯

> 🤖 **委派 Codex**（最機械的部分）

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.html`
- Modify: `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.scss`

**四步驟 Wizard 規格：**

```
Step 1 — 上傳
Step 2 — 預覽（前端驗證 + 標記）
Step 3 — 送出 API（loading state）
Step 4 — 結果摘要
```

**Codex prompt（詳細）：**
```
實作 Angular 21 Standalone Component：ParentImportDialogComponent
位置：apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.ts

使用 PrimeNG DynamicDialog（inject DynamicDialogRef），不使用 constructor injection。
使用 Angular Signals（signal, computed），不使用 Subject/BehaviorSubject。

依賴：
- inject(ParentsService) — batchImport()
- inject(DynamicDialogRef) — 關閉 dialog
- xlsx（import * as XLSX from 'xlsx'）— 解析 Excel

年級對照表（中文 → 系統碼）：
const GRADE_MAP: Record<string, string> = {
  '小一':'P1','小二':'P2','小三':'P3','小四':'P4','小五':'P5','小六':'P6',
  '國一':'J1','國二':'J2','國三':'J3',
  '高一':'S1','高二':'S2','高三':'S3',
};

性別對照表：
const GENDER_MAP: Record<string, string> = {
  '男':'male','女':'female','不提供':'prefer_not_to_say',
};

State signals：
- step: signal<1|2|3|4>(1)
- file: signal<File | null>(null)
- rows: signal<ParsedRow[]>([])  // ParsedRow = raw + validation status
- submitting: signal<boolean>(false)
- submitResult: signal<BatchImportResponse | null>(null)

ParsedRow 介面：
interface ParsedRow {
  index: number;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  parentNotes: string;
  studentName: string;
  studentGrade: string;   // 系統碼，無法對應則留原值
  studentSchool: string;
  studentBirthday: string;
  studentGender: string;
  // 驗證
  errors: string[];       // 必填缺漏、格式錯誤 → 🔴
  warnings: string[];     // 同名家長不同聯絡資訊 → 🟡
  mergeNote: string | null; // 與另一行合併說明 → 🔵
}

驗證邏輯（computed from rows()）：
- 必填：parentName、studentName、studentGrade（需在 GRADE_MAP）、studentSchool
- 聯絡資訊：parentPhone 或 parentEmail 至少一個
- 電話格式：/^09\d{8}$/（若有填）
- Email 格式：RFC5322（若有填）
- 同名家長警示：相同 parentName 但 phone/email 均不同 → 加 warning
- 合併提示：相同 phone 或 email 出現多次 → 加 mergeNote

computed：
- hasErrors = computed(() => rows().some(r => r.errors.length > 0))
- parentsCount = computed(() => 去重後家長數)

Step 1 HTML：
- <p-fileupload> 或自訂 input[type=file] accept=".xlsx,.xls"
- 「下載範本」連結（href="/assets/templates/parent-import-template.xlsx"）
- 上傳後自動讀取 → 解析 → 進入 step 2

Step 2 HTML：
- 表格顯示所有 rows，每行標記 errors（紅色）、warnings（黃色）、mergeNote（藍色）
- 底部：「確認匯入」button（[disabled]="hasErrors()"）

Step 3：呼叫 parentsService.batchImport()，顯示 loading spinner

Step 4：
- 顯示：建立家長 N 個、建立學生 N 個、失敗 N 筆
- 提示：「各帳號已建立，請透過家長管理頁的重設密碼功能取得初始密碼後再通知家長」
- 「完成」按鈕 → ref.close('imported')

SCSS 使用 BEM：.pid（parent-import-dialog 縮寫）
```

- [ ] **A4-1**：委派 Codex 實作三個檔案（.ts / .html / .scss）
- [ ] **A4-2**：`npx ng build --configuration development 2>&1 | grep -i error`，確認無編譯錯誤
- [ ] **A4-3** Commit：
```bash
git add apps/web/src/app/features/admin/pages/parents/parent-import-dialog/
git commit -m "feat(parent-import-dialog): implement 4-step Excel import wizard"
```

---

### Task A5：產生 Excel 範本檔案

**Files:**
- Create: `apps/web/public/assets/templates/parent-import-template.xlsx`

- [ ] **A5-1**：確認 Angular 的 assets / public 路徑：
```bash
ls apps/web/public/
grep -n "assets\|public" apps/web/angular.json | head -20
```
  期望：`public/` 為 Angular 的 serve 根目錄，`/assets/...` 對應 `apps/web/public/assets/...`

- [ ] **A5-2**：用 Node.js 腳本產生範本（在 repo root 執行）：
```js
// scripts/gen-parent-template.mjs
import * as XLSX from 'xlsx';
import { mkdir } from 'fs/promises';

await mkdir('apps/web/public/assets/templates', { recursive: true });

const wb = XLSX.utils.book_new();

// 資料頁
const ws = XLSX.utils.aoa_to_sheet([
  ['家長姓名*','家長電話','家長Email','家長備註','學生姓名*','學生年級*','學生就讀學校*','學生生日','學生性別'],
  ['王美華','0912345678','','','王小明','國一','台北市立中正國中','2012-03-15','男'],
]);
XLSX.utils.book_append_sheet(wb, ws, '資料');

// 說明頁
const wsInfo = XLSX.utils.aoa_to_sheet([
  ['年級填寫值','','性別填寫值'],
  ['小一','','男'],['小二','','女'],['小三','','不提供'],
  ['小四'],['小五'],['小六'],
  ['國一'],['國二'],['國三'],
  ['高一'],['高二'],['高三'],
]);
XLSX.utils.book_append_sheet(wb, wsInfo, '說明');

XLSX.writeFile(wb, 'apps/web/public/assets/templates/parent-import-template.xlsx');
console.log('✅ 範本已產生');
```

```bash
node scripts/gen-parent-template.mjs
```

- [ ] **A5-3** Commit：
```bash
git add apps/web/public/assets/templates/parent-import-template.xlsx scripts/gen-parent-template.mjs
git commit -m "feat: add parent Excel import template and generator script"
```

---

### Task A6：整合到 `parents.page`

> 🤖 **委派 Codex**

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/parents/parents.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/parents/parents.page.html`

**Codex prompt：**
```
在 apps/web/src/app/features/admin/pages/parents/parents.page.ts 新增「匯入」按鈕功能。

1. import ParentImportDialogComponent from './parent-import-dialog/parent-import-dialog.component'
2. 在 imports 陣列加入 ParentImportDialogComponent
3. 新增 protected 方法：
   openImportDialog(): void {
     const ref = this.dialogService.open(ParentImportDialogComponent, {
       header: '批次匯入家長',
       width: '720px',
       modal: true,
       appendTo: this.overlayContainer || 'body',
     });
     ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
       if (result === 'imported') this.loadParents();
     });
   }

在 apps/web/src/app/features/admin/pages/parents/parents.page.html 的工具列（搜尋框旁）加入按鈕：
<p-button
  label="匯入"
  icon="pi pi-upload"
  severity="secondary"
  (onClick)="openImportDialog()"
/>
```

- [ ] **A6-1**：確認 `parents.page.ts` 中 reload 方法名稱（已知為 `loadParents`，但確認一下）：
```bash
grep -n "loadParents\|loadData" apps/web/src/app/features/admin/pages/parents/parents.page.ts
```

- [ ] **A6-2**：委派 Codex 實作
- [ ] **A6-2**：瀏覽器確認 `/admin/parents` 頁面出現「匯入」按鈕，點擊可開啟 dialog
- [ ] **A6-3** Commit：
```bash
git add apps/web/src/app/features/admin/pages/parents/parents.page.ts \
        apps/web/src/app/features/admin/pages/parents/parents.page.html
git commit -m "feat(parents): add Excel batch import button"
```

---

## ═══ Phase B：班級批次加學生 ═══

---

### Task B1：API — `POST /api/enrollments/batch-match`

> 🤖 **委派 Codex**

**Files:**
- Modify: `apps/api/src/routes/enrollments.ts`

**Codex prompt：**
```
在 apps/api/src/routes/enrollments.ts 新增一個 POST /batch-match 端點（唯讀，不寫入資料）。

Request body：
{
  classId: z.uuid(),
  items: z.array(z.object({ name: z.string().min(1), school: z.string().min(1) })).min(1).max(200),
}

Response：
{
  results: z.array(z.object({
    index: z.number(),
    status: z.enum(['matched', 'ambiguous', 'not_found', 'already_enrolled']),
    studentId: z.string().optional(),
    candidates: z.array(z.object({
      id: z.string(),
      name: z.string(),
      grade: z.string(),
      school: z.string(),
      birthday: z.string().nullable().optional(),
    })).optional(),
  })),
}

後端邏輯（per item）：
1. 從 c.get('orgId')、c.get('supabase') 取得依賴
2. 先精確比對：
   const { data: exact } = await supabase.from('students')
     .select('id, name, grade, school, birthday')
     .eq('org_id', orgId).eq('name', item.name).eq('school', item.school).eq('is_active', true)
3. 若 exact 無結果，執行模糊比對：
   .ilike('name', item.name).ilike('school', item.school)
   // 注意：ILIKE 不加 % 萬用字元，是大小寫不敏感的精確全字比對，不是部分匹配
   // 不要自行改成 `%${item.name}%`
4. 取 candidates（exact 優先，否則用模糊結果）
5. 從 candidates 排除已在 classId 的 enrollments（status IN ['active','pending_payment']）：
   const { data: enrolled } = await supabase.from('enrollments')
     .select('student_id').eq('class_id', classId).in('status', ['active','pending_payment'])
   const enrolledIds = new Set(enrolled?.map(e => e.student_id))
6. 判斷最終狀態：
   - candidates 全被排除（排除前有結果）→ already_enrolled
   - 剩餘 1 筆 → matched
   - 剩餘 > 1 筆 → ambiguous（回傳 candidates）
   - 無結果 → not_found
```

- [ ] **B1-1**：委派 Codex 實作
- [ ] **B1-2**：測試比對：
```bash
curl -X POST http://localhost:3000/api/enrollments/batch-match \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "classId": "<existing-class-id>", "items": [{"name":"陳小明","school":"建國中學"}] }'
```
  期望：`{ results: [{ index: 0, status: "not_found" | "matched" | ... }] }`

- [ ] **B1-3** Commit：
```bash
git add apps/api/src/routes/enrollments.ts
git commit -m "feat(api): add POST /enrollments/batch-match endpoint"
```

---

### Task B2：Service — `EnrollmentsService.batchMatch()`

> 🤖 **委派 Codex**

**Files:**
- Modify: `apps/web/src/app/core/enrollments.service.ts`

**Codex prompt：**
```
在 apps/web/src/app/core/enrollments.service.ts 新增介面與方法：

export interface BatchMatchItem {
  name: string;
  school: string;
}

export interface BatchMatchCandidate {
  id: string;
  name: string;
  grade: string;
  school: string;
  birthday?: string | null;
}

export interface BatchMatchResultItem {
  index: number;
  status: 'matched' | 'ambiguous' | 'not_found' | 'already_enrolled';
  studentId?: string;
  candidates?: BatchMatchCandidate[];
}

export interface BatchMatchResponse {
  results: BatchMatchResultItem[];
}

在 EnrollmentsService class 新增：
  batchMatch(classId: string, items: BatchMatchItem[]): Observable<BatchMatchResponse> {
    return this.http.post<BatchMatchResponse>(`${this.base}/batch-match`, { classId, items });
  }
```

- [ ] **B2-1**：委派 Codex 實作
- [ ] **B2-2**：`npx ng build --configuration development 2>&1 | grep -i error`
- [ ] **B2-3** Commit：
```bash
git add apps/web/src/app/core/enrollments.service.ts
git commit -m "feat(enrollments-service): add batchMatch method and interfaces"
```

---

### Task B3：產生 `student-excel-import-dialog` 元件骨架

**Files:**
- Create: `apps/web/src/app/features/admin/pages/courses/class-detail/student-excel-import-dialog/student-excel-import-dialog.component.{ts,html,scss}`

- [ ] **B3-1**：
```bash
cd apps/web
npx ng generate component \
  features/admin/pages/courses/class-detail/student-excel-import-dialog \
  --type component --standalone --skip-tests
```

- [ ] **B3-2** Commit：
```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/student-excel-import-dialog/
git commit -m "feat(student-excel-import-dialog): scaffold component"
```

---

### Task B4：實作 `student-excel-import-dialog` 邏輯

> 🤖 **委派 Codex**

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/student-excel-import-dialog/` (三個檔案)

**Codex prompt：**
```
實作 Angular 21 Standalone Component：StudentExcelImportDialogComponent
位置：apps/web/src/app/features/admin/pages/courses/class-detail/student-excel-import-dialog/student-excel-import-dialog.component.ts

使用 PrimeNG DynamicDialog：
- inject(DynamicDialogRef) — 關閉
- inject(DynamicDialogConfig) — 讀取 config.data: { classId: string; remainingSlots: number }

依賴：
- inject(EnrollmentsService) — batchMatch()（新增）、batchCreate()（既有，勿重複宣告；簽名：`batchCreate(input: BatchCreateInput): Observable<{ results: BatchCreateResultItem[] }>`）
- xlsx — 解析 Excel

State signals：
- step: signal<1|2|3|4>(1)
- rawItems: signal<{name:string,school:string}[]>([])
- matchResults: signal<BatchMatchResultItem[]>([])
- resolvedIds: signal<Map<number, string>>(new Map())  // index → studentId（衝突解決後）
- loading: signal<boolean>(false)
- submitResult: signal<{success:number,skipped:number} | null>(null)

Step 1：上傳
- 接受 .xlsx/.xls，解析取第一個 sheet 的 A（姓名）、B（學校）欄，跳過 header row
- 「下載範本」連結：href="/assets/templates/student-class-import-template.xlsx"
- 解析後呼叫 enrollmentsService.batchMatch(classId, items)，loading=true → step 2

Step 2：比對預覽
- 列出所有 matchResults：
  - ✅ matched → 顯示學生姓名、年級、學校
  - ⚠️ ambiguous → 顯示下拉選擇（candidates），管理者選一個
  - 🔴 not_found → 標記，無法選擇
  - 🔴 already_enrolled → 標記「已在班級」
- 顯示剩餘名額 vs 本次可加入數（matched + resolved ambiguous），若超過 remainingSlots 顯示 warning
- 「確認加入」button

Step 3：loading（呼叫 batchCreate）

Step 4：結果
- 「成功加入 N 人、略過 N 人」
- 若 over_quota → 顯示「班級人數已達上限，本次匯入已取消」
- 「完成」按鈕 → ref.close('imported')

computed：
- resolvedCount = matched + ambiguous that have been resolved
- canSubmit = resolvedCount > 0 && resolvedCount <= remainingSlots

SCSS BEM prefix: .seid（student-excel-import-dialog）
```

- [ ] **B4-1**：委派 Codex 實作
- [ ] **B4-2**：編譯確認：`npx ng build --configuration development 2>&1 | grep -i error`
- [ ] **B4-3** Commit：
```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/student-excel-import-dialog/
git commit -m "feat(student-excel-import-dialog): implement 4-step Excel import wizard"
```

---

### Task B5：產生班級加學生 Excel 範本

**Files:**
- Create: `apps/web/public/assets/templates/student-class-import-template.xlsx`
- Create: `scripts/gen-student-class-template.mjs`

- [ ] **B5-1**：
```js
// scripts/gen-student-class-template.mjs
import * as XLSX from 'xlsx';

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['學生姓名*', '就讀學校*'],
  ['陳志遠', '建國中學'],
  ['林佳慧', '北一女中'],
]);
XLSX.utils.book_append_sheet(wb, ws, '資料');
XLSX.writeFile(wb, 'apps/web/public/assets/templates/student-class-import-template.xlsx');
console.log('✅ 範本已產生');
```

```bash
node scripts/gen-student-class-template.mjs
```

- [ ] **B5-2** Commit：
```bash
git add apps/web/public/assets/templates/student-class-import-template.xlsx \
        scripts/gen-student-class-template.mjs
git commit -m "feat: add class student Excel import template"
```

---

### Task B6：整合到 `class-detail.page`

> 🤖 **委派 Codex**

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html`

**Codex prompt：**
```
在 apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts 新增 Excel 匯入功能。

1. import StudentExcelImportDialogComponent from './student-excel-import-dialog/student-excel-import-dialog.component'
2. 在 imports 陣列加入 StudentExcelImportDialogComponent
3. 新增方法：
   protected openExcelImport(): void {
     const cls = this.cls();
     if (!cls) return;

     const activeCount = this.enrollments().filter(e =>
       ['active', 'pending_payment'].includes(e.status)
     ).length;
     const remainingSlots = (cls.maxStudents ?? 9999) - activeCount;

     const ref = this.dialogService.open(StudentExcelImportDialogComponent, {
       header: 'Excel 批次加入學生',
       width: '640px',
       modal: true,
       appendTo: this.overlayContainer || 'body',
       data: { classId: cls.id, remainingSlots },
     });
     ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
       if (result === 'imported') this.loadEnrollments();
     });
   }

在 class-detail.page.html 的學生列表區塊，在現有「加入學生」按鈕旁加入：
<p-button
  label="Excel 匯入"
  icon="pi pi-file-excel"
  severity="secondary"
  (onClick)="openExcelImport()"
/>
請確認 loadEnrollments() 方法名稱與現有程式碼一致（可能叫 loadEnrollments 或 loadClassData）。
```

- [ ] **B6-1**：先確認 class-detail.page.ts 中重新載入 enrollments 的方法名稱：
```bash
grep -n "loadEnrollment\|loadClass\|loadData" apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts
```

- [ ] **B6-2**：委派 Codex 實作（帶入正確的 reload 方法名）
- [ ] **B6-3**：瀏覽器確認班級詳情頁出現「Excel 匯入」按鈕，點擊可開啟 dialog
- [ ] **B6-4** Commit：
```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts \
        apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html
git commit -m "feat(class-detail): add Excel batch student import button"
```

---

## Final：驗收 & Push

- [ ] **F1**：完整 build 確認無錯誤：
```bash
npx ng build --configuration development 2>&1 | tail -5
```

- [ ] **F2**：手動端對端測試：
  - 家長匯入：上傳有效 Excel → 預覽正確 → 確認 → 家長列表出現新資料
  - 班級加學生：上傳 Excel → 比對結果正確 → 解決衝突 → 確認 → 班級學生列表更新

- [ ] **F3** Push：
```bash
git push origin feat/enrollment
```
