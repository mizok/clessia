# Enrollment 入班管理 — 技術設計

**日期**: 2026-03-19
**分支**: feat/enrollment
**功能**: 開課班入班管理（enrollments 資料表 + 開課班詳情頁 + 學生詳情頁更新 + 報名管理頁）

---

## 1. 範圍

### PR1（本次）
- `enrollments` 資料表 + migration
- Enrollment API（CRUD + 狀態變更）
- 開課班詳情頁（獨立路由，含學生名單 tab）
- 學生詳情頁「在籍班級」區塊（取代 placeholder）

### PR2（後續）
- 報名管理頁 `/admin/enrollment`（跨班總覽 + 狀態管理）
- 繳費單整合（`invoices` 表，待 fee_templates 完成）

---

## 2. 資料層

### 2.1 `enrollments` 表

```sql
CREATE TYPE public.enrollment_status AS ENUM (
  'pending_payment',
  'active',
  'suspended',
  'withdrawal',
  'void'
);

CREATE TYPE public.payment_cycle AS ENUM (
  'monthly',
  'semester'
);

CREATE TABLE public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  status public.enrollment_status NOT NULL DEFAULT 'active',
  payment_cycle public.payment_cycle,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  notes text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
);
```

**索引**：
- `(org_id)`
- `(class_id)`
- `(student_id)`
- `(status)`

**唯一性約束**（partial index，允許退班後重新加入）：
```sql
CREATE UNIQUE INDEX enrollments_active_class_student_unique
  ON public.enrollments (class_id, student_id)
  WHERE status NOT IN ('withdrawal', 'void');
```

**業務規則**：
- 同一學生在同一班只能有一筆 enrollment（UNIQUE constraint）
- 變更為 `suspended` / `withdrawal` / `void` 時 `notes` 必填（API 層強制）
- `pending_payment` 狀態的學生在寬限期內仍出現在課堂名單，標記「待繳費」

### 2.2 狀態機

```
pending_payment ──收款確認──► active
pending_payment ──逾期/作廢──► void
active ──管理員操作──► suspended
active ──退班──► withdrawal
active ──管理員操作──► void
suspended ──恢復──► active
suspended ──退班──► withdrawal
```

終態：`withdrawal`、`void`（不可再轉換）

**不允許的轉換**：`pending_payment → suspended`（直接 void 即可）

---

## 3. API

### 3.1 路由設計

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/enrollments` | 列表（篩選：class_id、student_id、status、org_id） |
| POST | `/api/enrollments` | 建立報名 |
| GET | `/api/enrollments/:id` | 單筆詳情 |
| PATCH | `/api/enrollments/:id` | 更新（effective_from/to、payment_cycle） |
| PATCH | `/api/enrollments/:id/status` | 狀態變更（附 notes） |
| DELETE | `/api/enrollments/:id` | 刪除（限 pending_payment 或 void） |

### 3.2 建立報名 Schema

```typescript
CreateEnrollmentSchema = z.object({
  classId: z.uuid(),
  studentId: z.uuid(),
  status: z.enum(['pending_payment', 'active']).default('active'),
  paymentCycle: z.enum(['monthly', 'semester']).optional(),
  effectiveFrom: z.string().date().optional(), // 預設今天
  effectiveTo: z.string().date().nullable().optional(),
  notes: z.string().optional(),
})
```

### 3.3 狀態變更 Schema

```typescript
UpdateEnrollmentStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'withdrawal', 'void', 'pending_payment']),
  notes: z.string().optional(),
})
// API handler 層：status 為 suspended/withdrawal/void 時，若 notes 為空則回傳 400
// { error: 'NOTES_REQUIRED' }
```

### 3.4 EnrollmentResponse

```typescript
{
  id, orgId, classId, className, studentId, studentName,
  status, paymentCycle,
  effectiveFrom, effectiveTo,
  notes,
  createdBy: string | null,       // ba_user.id
  createdByName: string | null,   // JOIN profiles.display_name
  createdAt, updatedAt
}
```

### 3.5 `effective_to` 終態行為

當狀態轉為 `withdrawal` 或 `void` 時，若 `effective_to` 為 NULL，API 自動填入 `CURRENT_DATE`。

### 3.6 `DELETE` 限制

只允許刪除 `pending_payment` 狀態的 enrollment（例如管理員登記錯誤）。`void` 與其他終態保留歷史紀錄，不提供刪除。

### 3.7 `audit_logs` 更新

migration 需將 `enrollment` 加入 `audit_logs.resource_type` check constraint。

---

## 4. 前端

### 4.1 開課班詳情頁

**路由**：`/admin/courses/:courseId/classes/:classId`
**檔案**：`apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts`

**頁面結構**：
```
← 返回課程列表
[班級名稱] [狀態 tag: 開班中/已停班]

Tab: [學生名單] [課表]

── 學生名單 tab ──
[加入學生] button (右上)
搜尋框 (姓名過濾)
表格：姓名 | 年級 | 狀態 | 生效日期 | 操作 menu
  操作：啟用 / 停權 / 退班 / 設為失效

── 課表 tab ──
（現有 class-detail-dialog 內容搬過來）
```

**學生選擇 Dialog**：
- 搜尋：姓名
- 篩選：年級、就讀學校、性別、狀態（在籍/停用）、是否已有報名班級
- 自動排除已在本班（status 非 withdrawal/void）的學生
- 分頁列表（每頁 20 筆），單選確認加入
- 若班級 `max_students` 已滿，仍允許加入但顯示警告 toast（不阻擋）
- `RoutesCatalog` 需新增 `ADMIN_CLASS_DETAIL` 條目

### 4.2 學生詳情頁更新

取代現有「報名課程（開發中）」placeholder：

```
── 在籍班級 ──
[班名]  [課程名]  [狀態 tag]  [生效日期]
...
空狀態：尚未加入任何班級
```

只顯示 `active` 和 `pending_payment` 的 enrollment，`withdrawal`/`void` 不顯示。
PR1 為 read-only 顯示（無「加入班級」入口，待 PR2 補齊）。

### 4.3 報名管理頁（PR2）

**路由**：`/admin/enrollment`（現有空白 component）
延後至 PR2 實作，本次 PR1 不動此頁面。

---

## 5. Service 層（前端）

新建 `apps/web/src/app/core/enrollments.service.ts`（與 `StudentsService`、`ParentsService` 同層，保持一致）：

`payment_cycle` 在 PR1 中僅作為記錄用，不影響系統行為；PR2 `invoices` 整合後才有計算邏輯。

```typescript
interface Enrollment {
  id: string;
  orgId: string;
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  status: EnrollmentStatus;
  paymentCycle: PaymentCycle | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Methods:
list(params): Observable<{ data: Enrollment[]; meta: PaginationMeta }>
create(input): Observable<{ data: Enrollment }>
updateStatus(id, status, notes?): Observable<{ data: Enrollment }>
update(id, input): Observable<{ data: Enrollment }>
delete(id): Observable<void>
```

---

## 6. 路由更新

`RoutesCatalog` 新增：
```typescript
ADMIN_CLASS_DETAIL = register(
  'courses/:courseId/classes/:classId',
  '/admin/courses/:courseId/classes/:classId',
  ...
)
```

`app.routes.ts` 在 admin children 的 flat level 新增：
```typescript
{
  path: 'courses/:courseId/classes/:classId',
  loadComponent: () => import('./features/admin/pages/courses/class-detail/class-detail.page')
    .then(m => m.ClassDetailPage),
  data: { page: RoutesCatalog.ADMIN_CLASS_DETAIL },
}
```

courses 列表頁點擊班級名稱時導航至此路由（使用 `Router.navigate`，傳入 courseId 和 classId）。

**課表 tab**：將現有 `class-detail-dialog.component` 的課表內容重構為獨立的 `ClassScheduleComponent`，同時供 dialog 和詳情頁使用，避免複製代碼。原有 dialog 保留（仍在課程列表頁使用）。

---

## 7. 不在本次範圍

- `invoices` 表及繳費單建立流程
- `fee_templates` 費用計算
- 出缺席與 enrollment 的關聯（attendance 功能）
- 家長端查看報名記錄
- 批次加入學生

---

## 8. 相關檔案

| 類型 | 路徑 |
|------|------|
| Spec | `doc/specs/admin/enrollment/enrollment.md` |
| Migration | `supabase/migrations/YYYYMMDDHHMMSS_create_enrollments.sql` |
| API | `apps/api/src/routes/enrollments.ts` |
| Service | `apps/web/src/app/core/enrollments.service.ts` |
| 詳情頁 | `apps/web/src/app/features/admin/pages/courses/class-detail/` |
| 學生詳情 | `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html` |
