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
| `user_id` unique 約束 | `unique(user_id, org_id)` | 對齊 staff 表設計；允許同一 user 在不同 org 擔任家長（多組織情境） |
| 帳號狀態設計 | 三態 enum：`active / inactive / archived` | 與 Staff 一致；補習班有學年週期，家長會「畢業」，封存比刪除合理 |
| `is_active` 欄位 | 移除，改用 `status` enum | 布林無法表達封存語意 |
| `archived → active` 轉換 | 允許（管理員可手動恢復） | 規格說「需管理員手動改回」，API 不應拒絕此操作 |
| 狀態路由設計 | 單一 `PUT /api/parents/:id/status` | 父母狀態語意較單純，不像 staff 需分三個語意端點；單一端點減少前端複雜度 |
| 密碼長度 | 10 碼英數混合 | 對齊 `staff.ts` 的 `generateRandomPassword()`，統一規格 |
| seed.sql 更新策略 | 直接 INSERT `ba_user`（方案 A） | seed.sql 是 PL/pgSQL，無法呼叫 BA JS API；對齊 staff seed 的做法，直接插入固定 UUID 測試帳號 |

---

## 二、Database Schema 變更

### Migration（時間戳格式：`20260317XXXXXX_add_parent_user_status.sql`）

```sql
-- 新增 status enum
create type public.parent_status as enum ('active', 'inactive', 'archived');

-- 為 parents 表新增欄位
alter table public.parents
  add column user_id text not null references ba_user(id),
  add column status public.parent_status not null default 'active';

-- 移除舊欄位
alter table public.parents drop column is_active;

-- Indexes & constraints
create unique index parents_user_id_org_id_udx on public.parents (user_id, org_id);
create index parents_status_idx on public.parents (status);

-- 注意：parents_updated_at trigger 已由 20260316110000 建立，無需重建

-- Audit log 支援 parent resource type
alter table public.audit_logs
  drop constraint audit_logs_resource_type_check;
alter table public.audit_logs
  add constraint audit_logs_resource_type_check
  check (resource_type in ('class','course','campus','staff','session','student','parent'));
```

### Seed 更新（方案 A：直接插入 `ba_user`）

`supabase/seed.sql` 的 `Students & Parents` DO 區塊需完整改寫：

1. 清理順序：先 `DELETE FROM parent_student_relations`，再 `DELETE FROM parents`，再刪對應的 `ba_user`（加 WHERE orgId = demo_org_id 條件）
2. 插入每位 seed 家長前，先 `INSERT INTO public.ba_user`：
   - 固定 UUID 前綴（如 `50000000-0000-0000-0000-XXXXXXXXXXXX`）
   - `email` 或 `username`（依是否有 email）
   - `banned = false`、`"orgId" = demo_org_id`
   - 同時插入對應的 `ba_account`（provider = 'credential'，含 password hash）
3. 再 `INSERT INTO parents` 帶入 `user_id`、`status = 'active'`，移除 `is_active` 欄位

對齊 seed.sql 中 staff 帳號的建立方式（直接寫入 `ba_user` / `ba_account`，不透過 BA API）。

---

## 三、API Endpoints

### 路由總覽

| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/api/parents` | 列表（搜尋、狀態篩選、分頁） |
| `POST` | `/api/parents` | 新增家長（同步建立 BA user） |
| `GET` | `/api/parents/:id` | 詳情（含關聯學生） |
| `PUT` | `/api/parents/:id` | 更新基本資料 + 關聯學生（含 email/phone 同步 ba_user） |
| `POST` | `/api/parents/:id/reset-password` | 重設密碼，回傳新密碼 |
| `PATCH` | `/api/parents/:id/activate` | 停用 → 啟用（對齊 staff） |
| `PATCH` | `/api/parents/:id/deactivate` | 啟用 → 停用（對齊 staff） |
| `PATCH` | `/api/parents/:id/archive` | 封存（單向，無法透過 API 解除） |

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
  id: string             // uuid（parents.id）
  userId: string         // text（ba_user.id，非 uuid 格式）
  orgId: string          // uuid
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

// GET /api/parents response
{
  data: Parent[]
  summary: {
    total: number
    activeCount: number
    inactiveCount: number
    archivedCount: number
  }
  meta: { total: number; page: number; pageSize: number; totalPages: number }
}

// POST /api/parents (create) response
{ data: Parent; initialPassword: string }

// POST /api/parents/:id/reset-password response
{ password: string }
```

### POST /api/parents 建立流程

對齊 `staff.ts` rollback 模式：

1. 呼叫 `auth.api.createUser()`（email 有填用 email 作為 email；否則 phone 作為 username）
   - email 重複 → `409 { error: 'Email 已被使用', code: 'DUPLICATE_EMAIL' }`
   - username（phone）重複 → `409 { error: '此手機已被使用', code: 'DUPLICATE_PHONE' }`
2. 更新 `ba_user.orgId`
3. `INSERT INTO parents`（帶 user_id、status = 'active'）
4. `INSERT INTO parent_student_relations`（若有 studentIds）
5. 任一步驟失敗 → `auth.api.removeUser()` rollback
6. 回傳 `{ data: Parent, initialPassword: string }`

非法狀態轉換（`PUT /:id/status`）回傳 `400 { error: '不允許的狀態轉換', code: 'INVALID_STATUS_TRANSITION' }`。

### PUT /api/parents/:id 更新流程

更新基本資料時，若 email 或 phone 有變更，需同步更新 `ba_user`：

- email 有變更 → 呼叫 BA API 更新 `ba_user.email`
- phone 有變更且目前用 phone 作為 username → 更新 `ba_user.username`
- `studentIds` 採**全量替換**：先 DELETE 所有現有關聯，再 INSERT 新的；傳入 `[]` 表示解除所有關聯

### 狀態轉換（對齊 staff.ts）

| Endpoint | 來源 | 目標 | BA user 操作 |
|----------|------|------|-------------|
| `PATCH /activate` | `inactive` | `active` | `ba_user.banned = false` |
| `PATCH /deactivate` | `active` | `inactive` | `ba_user.banned = true` |
| `PATCH /archive` | `active` / `inactive` | `archived` | `ba_user.banned = true` |

封存為單向操作，無「解除封存」API。前端封存前需顯示確認警告：「封存後無法自動復原，確定要封存嗎？」

所有狀態變更記錄至 audit log（resource_type: `'parent'`）。

### 忘記密碼邏輯（MVP Out of Scope）

`parents.md` 中提到「有 Email 的家長可發送重設連結」屬 MVP 範疇外，後續版本再考慮。MVP 只實作管理員後台重設密碼。

---

## 四、Frontend Service

**檔案**：`apps/web/src/app/core/parents.service.ts`

對齊 `students.service.ts` 風格。

```typescript
export type ParentStatus = 'active' | 'inactive' | 'archived';

export interface Parent {
  id: string;
  userId: string;         // ba_user.id（text，非 uuid 格式）
  orgId: string;
  name: string;
  phone: string | null;
  email: string | null;
  loginAccount: string;   // email 優先，否則 phone
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
  relation: string | null;  // 自由文字；未來可考慮改為 enum
  isPrimary: boolean;
}

export interface ParentDetail extends Parent {
  students: ParentDetailStudent[];
}

export interface ParentListResponse {
  data: Parent[];
  summary: {
    total: number;
    activeCount: number;
    inactiveCount: number;
    archivedCount: number;
  };
  meta: { total: number; page: number; pageSize: number; totalPages: number };
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
  studentIds?: string[];  // 全量替換；[] 表示解除所有關聯
  notes?: string | null;
}

// Methods
list(params?: ParentQueryParams): Observable<ParentListResponse>
get(id: string): Observable<{ data: ParentDetail }>
create(input: CreateParentInput): Observable<{ data: Parent; initialPassword: string }>
update(id: string, input: UpdateParentInput): Observable<{ data: Parent }>
resetPassword(id: string): Observable<{ password: string }>
activate(id: string): Observable<{ success: boolean }>
deactivate(id: string): Observable<{ success: boolean }>
archive(id: string): Observable<{ success: boolean }>
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

### PasswordRevealDialogComponent（新建）

新增或重設密碼後觸發，獨立 Dialog component，與 DynamicDialog 分開（使用本地 `visible` signal）。

**介面**：
```typescript
// Input
{ account: string; password: string; parentName: string; orgName: string }
// 關閉時 password signal 歸零，確保一次性語意
```

**內容**：
- 顯示帳號 + 密碼（可複製按鈕）
- 「產生帳號資訊卡」按鈕 → 直接在 dialog 內呼叫 pdfmake 產生 PDF
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
| `PasswordRevealDialogComponent` | ❌ 新建 | 新增家長和重設密碼共用；PDF 生成在 dialog 內部處理 |

---

## 七、測試情境

1. **Happy path**：新增家長（有 Email）→ 顯示初始密碼 → 產生帳號資訊卡
2. **Happy path**：新增家長（無 Email，只有手機）→ 以手機作為 username 登入
3. **Email 重複**：建立時 Email 已被使用 → 顯示「此 Email 已被使用」
4. **手機重複**：建立時手機已被使用 → 顯示「此手機已被使用」
5. **重設密碼**：管理員重設 → 顯示新密碼 → 可產生帳號資訊卡
6. **停用/啟用**：`active` → `inactive` → `active`，`ba_user.banned` 同步
7. **封存**：`active` → `archived` → 從預設列表消失，可切換篩選顯示
8. **封存恢復**：`archived` → `active`，`ba_user.banned = false`，重新出現在列表
9. **關聯學生**：新增時選學生 → `parent_student_relations` 正確建立
10. **更新關聯學生**：編輯時 studentIds = [] → 所有關聯解除
11. **更新 email**：PUT 時 email 變更 → `ba_user.email` 同步更新
12. **BA rollback**：DB 插入失敗 → BA user 自動刪除，無殘留帳號

---

## 八、響應式需求

本功能為管理後台（`/admin`），以桌面版為主，**不需支援手機版**。

---

## 九、AGENT_GUIDE.md 對應

| Phase | 執行者 | 產出 |
|-------|--------|------|
| Phase 2: DB | Codex | `20260317XXXXXX_add_parent_user_status.sql`、seed.sql 更新（直接插入 ba_user） |
| Phase 3: API | Codex | `apps/api/src/routes/parents.ts`、掛載至 `index.ts` |
| Phase 4: Frontend Service | Codex | `apps/web/src/app/core/parents.service.ts` |
| Phase 5: Frontend UI | Claude | list page、form dialog、PasswordRevealDialogComponent |
| Phase 6: E2E | Codex | Playwright 測試腳本 |
