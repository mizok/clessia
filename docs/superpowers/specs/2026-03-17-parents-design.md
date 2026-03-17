# 家長管理功能設計文件

**日期**: 2026-03-17
**路徑**: `/admin/parents`
**角色**: Admin
**依賴**: 學生管理（已完成）

---

## 一、核心決策

| 決策 | 結論 | 理由 |
|------|------|------|
| `parents.user_id` nullable? | NOT NULL | 兩種建立路徑（公開報名繳費後、管理員直接建立）均同步建立 BA 帳號，不存在無帳號的家長資料 |
| 帳號狀態設計 | 三態 enum：`active / inactive / archived` | 與 Staff 一致；補習班有學年週期，家長會「畢業」，封存比刪除合理 |
| `is_active` 欄位 | 移除，改用 `status` enum | 布林無法表達封存語意 |

---

## 二、Database Schema 變更

### Migration

```sql
-- 新增 status enum
create type public.parent_status as enum ('active', 'inactive', 'archived');

-- 為 parents 表新增欄位
alter table public.parents
  add column user_id text not null references ba_user(id),
  add column status public.parent_status not null default 'active';

-- 移除舊欄位
alter table public.parents drop column is_active;

-- Indexes
create index parents_user_id_idx on public.parents (user_id);
create index parents_status_idx on public.parents (status);

-- Audit log 支援 parent resource type
alter table public.audit_logs
  drop constraint audit_logs_resource_type_check;
alter table public.audit_logs
  add constraint audit_logs_resource_type_check
  check (resource_type in ('class','course','campus','staff','session','student','parent'));
```

### Seed 更新

`supabase/seed.sql` 中現有的 `INSERT INTO parents` 需改為：
1. 先呼叫 Better Auth `createUser()` 建立 BA 帳號
2. 再 INSERT parents 並帶入 `user_id`

---

## 三、API Endpoints

### 路由總覽

| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/api/parents` | 列表（搜尋、狀態篩選、分頁） |
| `POST` | `/api/parents` | 新增家長（同步建立 BA user） |
| `GET` | `/api/parents/:id` | 詳情（含關聯學生） |
| `PUT` | `/api/parents/:id` | 更新基本資料 + 關聯學生 |
| `POST` | `/api/parents/:id/reset-password` | 重設密碼，回傳新密碼 |
| `PUT` | `/api/parents/:id/status` | 更新狀態（active / inactive / archived） |

### 主要 Schemas

```typescript
// Query params (GET /api/parents)
{
  search?: string        // 姓名 / 手機 / Email
  status?: 'active' | 'inactive' | 'archived'
  page?: number
  pageSize?: number      // default 20, max 100
}

// POST /api/parents (CreateParentInput)
{
  name: string           // 必填
  email?: string         // email 或 phone 至少一個
  phone?: string
  studentIds?: string[]  // 關聯學生 IDs
  notes?: string
}

// Response: Parent
{
  id: string
  userId: string
  orgId: string
  name: string
  phone: string | null
  email: string | null
  loginAccount: string   // email 優先，否則 phone
  status: 'active' | 'inactive' | 'archived'
  studentCount: number
  notes: string | null
  createdAt: string
  updatedAt: string
}

// POST /api/parents/:id/reset-password response
{ password: string }

// POST /api/parents (create) response
{ data: Parent; initialPassword: string }
```

### POST /api/parents 建立流程

對齊 `staff.ts` rollback 模式：

1. 呼叫 `auth.api.createUser()`（email 有填用 email；否則 phone 作為 username）
2. 更新 `ba_user.orgId`
3. `INSERT INTO parents`（帶 user_id、status='active'）
4. `INSERT INTO parent_student_relations`（若有 studentIds）
5. 任一步驟失敗 → `auth.api.removeUser()` rollback
6. 回傳 `{ data: Parent, initialPassword: string }`

### PUT /api/parents/:id/status 狀態轉換

| 轉換 | BA user 操作 |
|------|-------------|
| → `active` | `ba_user.banned = false` |
| → `inactive` | `ba_user.banned = true` |
| → `archived` | `ba_user.banned = true` |

所有狀態變更記錄至 audit log（resource_type: `'parent'`）。

---

## 四、Frontend Service

**檔案**：`apps/web/src/app/core/parents.service.ts`

對齊 `students.service.ts` 風格。

```typescript
export type ParentStatus = 'active' | 'inactive' | 'archived';

export interface Parent {
  id: string;
  userId: string;
  orgId: string;
  name: string;
  phone: string | null;
  email: string | null;
  loginAccount: string;    // email 優先，否則 phone
  status: ParentStatus;
  studentCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParentDetailStudent {
  id: string;
  name: string;
  grade: string;
  relation: string | null;
  isPrimary: boolean;
}

export interface ParentDetail extends Parent {
  students: ParentDetailStudent[];
}

export interface CreateParentInput {
  name: string;
  email?: string;
  phone?: string;
  studentIds?: string[];
  notes?: string;
}

export interface UpdateParentInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  studentIds?: string[];
  notes?: string | null;
}

// Methods
list(params?: ParentQueryParams): Observable<ParentListResponse>
get(id: string): Observable<{ data: ParentDetail }>
create(input: CreateParentInput): Observable<{ data: Parent; initialPassword: string }>
update(id: string, input: UpdateParentInput): Observable<{ data: Parent }>
resetPassword(id: string): Observable<{ password: string }>
updateStatus(id: string, status: ParentStatus): Observable<{ data: Parent }>
```

---

## 五、Frontend UI

### 列表頁（`/admin/parents`）

對齊 `students.page.ts` 架構。

**篩選列**：
- 搜尋框（姓名 / 手機 / Email）
- 狀態篩選 dropdown（預設：active + inactive；可切換顯示封存）

**Table 欄位**：

| 欄位 | 說明 |
|------|------|
| 姓名 | 可點擊開啟編輯 |
| 登入帳號 | Email 優先，否則顯示手機號碼 |
| 關聯學生 | 學生數 badge |
| 帳號狀態 | `active` / `inactive` / `archived` badge |
| 操作 | 編輯、重設密碼、狀態操作（停用/啟用/封存） |

### 新增/編輯 Dialog（DynamicDialog）

對齊 `StudentFormDialogComponent` 模式，`appendTo` overlay container。

**新增模式欄位**：姓名、Email、手機、關聯學生（多選搜尋）、備註
**編輯模式**：同上欄位，不含密碼
**帳號狀態**：不在此 dialog，由列表操作按鈕管理

### 初始密碼提示 Dialog

新增或重設密碼後觸發，獨立 Dialog component：

- 顯示帳號 + 密碼（可複製）
- 「產生帳號資訊卡」按鈕 → 觸發 pdfmake 產生 PDF
- 提示文字：「請記下密碼或立刻產生帳號資訊卡，關閉後將無法再次查看」

### 帳號資訊卡（pdfmake）

| 欄位 | 內容 |
|------|------|
| 補習班名稱 | 從 org 資料取得 |
| 家長姓名 | |
| 登入帳號 | Email 或手機 |
| 密碼 | 顯示明文（首次建立或重設後才有） |
| 說明文字 | 「請妥善保管，如需重設請洽管理員」 |

---

## 六、共用元件識別

| 元件 | 狀態 | 說明 |
|------|------|------|
| `EmptyStateComponent` | ✅ 已有 | 直接複用 |
| `ConfirmDialogComponent` | ✅ 已有 | 停用/封存確認 |
| `PasswordRevealDialogComponent` | ❌ 新建 | 顯示一次性密碼 + 帳號資訊卡按鈕；新增家長和重設密碼共用 |

---

## 七、測試情境

1. **Happy path**：新增家長（有 Email）→ 顯示初始密碼 → 產生帳號資訊卡
2. **Happy path**：新增家長（無 Email，只有手機）→ 以手機作為 username 登入
3. **Email 重複**：建立時 Email 已被使用 → 顯示「此 Email 已被使用」
4. **手機重複**：建立時手機已被使用 → 顯示「此手機已被使用」
5. **重設密碼**：管理員重設 → 顯示新密碼 → 可產生帳號資訊卡
6. **停用/啟用**：`active` → `inactive` → `active`，`ba_user.banned` 同步
7. **封存**：`active` → `archived` → 從預設列表消失，可切換篩選顯示
8. **關聯學生**：新增時選學生 → `parent_student_relations` 正確建立
9. **BA rollback**：DB 插入失敗 → BA user 自動刪除，無殘留帳號

---

## 八、響應式需求

本功能為管理後台（`/admin`），以桌面版為主，**不需支援手機版**。

---

## 九、AGENT_GUIDE.md 對應

| Phase | 執行者 | 產出 |
|-------|--------|------|
| Phase 2: DB | Codex | migration SQL、seed.sql 更新 |
| Phase 3: API | Codex | `apps/api/src/routes/parents.ts`、掛載至 `index.ts` |
| Phase 4: Frontend Service | Codex | `apps/web/src/app/core/parents.service.ts` |
| Phase 5: Frontend UI | Claude | list page、form dialog、password reveal dialog |
| Phase 6: E2E | Codex | Playwright 測試腳本 |
