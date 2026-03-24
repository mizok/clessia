# 帳號設定與家長身份啟用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 admin/teacher 帳號持有者可透過右上角 user dropdown 開啟帳號設定 Dialog，修改個人資料（姓名、Email、電話、生日），並可自助啟用家長身份（建立子女學生資料並取得 parent role）。

**Architecture:** 後端新增 `apps/api/src/routes/me.ts`（含擴充版 GET、PATCH、POST activate-parent）並移除 `index.ts` 的舊 GET /api/me；前端新增 `AccountSettingsDialogComponent`，從 `ShellLayoutComponent` user dropdown 開啟。

**Tech Stack:** Hono OpenAPIHono + Angular 21 Signals + PrimeNG 21 + Better Auth + Supabase PostgreSQL + Vitest

**Design Spec:** `doc/superpowers/specs/2026-03-19-account-settings-design.md`

---

## 檔案清單

| 動作 | 檔案 | 說明 |
|------|------|------|
| 新增 | `apps/api/src/routes/me.ts` | GET / PATCH / POST activate-parent |
| 修改 | `apps/api/src/index.ts` | 移除舊 GET /api/me，改用 app.route |
| 修改 | `apps/api/src/index.spec.ts` | 新增 /api/me 的 401 測試 |
| 修改 | `apps/web/src/app/core/auth.service.ts` | 新增 refreshRoles()、擴充 MeResponse |
| 新增 | `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.ts` | Dialog 主元件 |
| 新增 | `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.html` | Dialog 模板 |
| 新增 | `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.scss` | Dialog 樣式 |
| 修改 | `apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.ts` | 加 DialogService provider + openAccountSettings() |
| 修改 | `apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.html` | dropdown 換成「帳號設定」 |

---

## Task 1：後端 `me.ts` 路由

**Files:**
- Create: `apps/api/src/routes/me.ts`
- Modify: `apps/api/src/index.ts`（第 230–250 行）
- Test: `apps/api/src/index.spec.ts`

### 背景知識

- 路由檔案使用 `OpenAPIHono` + `createRoute()` + `app.openapi()` 模式（同 `staff.ts`）
- `AppEnv` 型別匯入自 `'../index'`
- Supabase：`c.get('supabase')`；userId / orgId：`c.get('userId')` / `c.get('orgId')`
- `parents` 表：`id, user_id, org_id, name, status, notes`
- `parent_student_relations` 表：`parent_id (→ parents.id), student_id, is_primary, relation`
- `ba_user` 表可直接用 Supabase 更新：`id (text), email, phone, username, name`
- phone-only 帳號特徵：`ba_user.email IS NULL`，且 `ba_user.username = phone`
- GradeLevel: `'P1'–'P6' | 'J1'–'J3' | 'S1'–'S3'`
- `displayName` 只需更新 `profiles.display_name`（app 所有地方讀的都是這欄），不需要呼叫 BA `updateUser` 更新 `ba_user.name`

- [ ] **Step 1：新增 `apps/api/src/routes/me.ts`**

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const GradeLevelSchema = z
  .enum(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'])
  .openapi('MeGradeLevel');

const MeResponseSchema = z
  .object({
    userId: z.string(),
    orgId: z.string(),
    displayName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    birthday: z.string().nullable(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
  })
  .openapi('MeResponse');

const PatchMeSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().nullable().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .openapi('PatchMeRequest');

const ActivateParentSchema = z
  .object({
    studentName: z.string().min(1),
    grade: GradeLevelSchema,
  })
  .openapi('ActivateParentRequest');

const ErrorSchema = z.object({ error: z.string(), code: z.string() });

const app = new OpenAPIHono<AppEnv>();

// GET /api/me
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '取得目前登入用戶的 profile 和 roles',
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: MeResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const orgId = c.get('orgId');

    const [profileResult, rolesResult, staffResult, baUserResult] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', userId).single(),
      supabase.from('user_roles').select('role, permissions').eq('user_id', userId),
      supabase.from('staff').select('birthday').eq('user_id', userId).maybeSingle(),
      supabase.from('ba_user').select('email, phone').eq('id', userId).single(),
    ]);

    return c.json({
      userId,
      orgId,
      displayName: profileResult.data?.display_name ?? '',
      email: (baUserResult.data?.email as string | null) ?? null,
      phone: (baUserResult.data?.phone as string | null) ?? null,
      birthday: (staffResult.data?.birthday as string | null) ?? null,
      roles: (rolesResult.data ?? []).map((r: { role: string }) => r.role),
      permissions: (rolesResult.data ?? []).flatMap((r: { permissions: unknown[] }) =>
        Array.isArray(r.permissions) ? r.permissions : [],
      ),
    });
  },
);

// PATCH /api/me
app.openapi(
  createRoute({
    method: 'patch',
    path: '/',
    tags: ['Me'],
    summary: '更新個人資料',
    request: {
      body: { content: { 'application/json': { schema: PatchMeSchema } } },
    },
    responses: {
      200: {
        description: '更新成功',
        content: { 'application/json': { schema: MeResponseSchema } },
      },
      409: {
        description: 'Email 已被使用',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '伺服器錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (body.displayName !== undefined) {
      await supabase
        .from('profiles')
        .update({ display_name: body.displayName })
        .eq('id', userId);
    }

    if (body.email !== undefined) {
      const { error: emailError } = await supabase
        .from('ba_user')
        .update({ email: body.email })
        .eq('id', userId);
      if (emailError) {
        if (emailError.code === '23505') {
          return c.json({ error: '此 Email 已被使用', code: 'EMAIL_ALREADY_IN_USE' }, 409);
        }
        return c.json({ error: emailError.message, code: 'UPDATE_EMAIL_FAILED' }, 500);
      }
    }

    if (body.phone !== undefined) {
      const { data: baUser } = await supabase
        .from('ba_user')
        .select('email')
        .eq('id', userId)
        .single();

      const updatePayload: Record<string, string | null> = { phone: body.phone };
      if ((baUser as Record<string, unknown> | null)?.['email'] == null) {
        updatePayload['username'] = body.phone;
      }
      await supabase.from('ba_user').update(updatePayload).eq('id', userId);
    }

    if (body.birthday !== undefined) {
      await supabase.from('staff').update({ birthday: body.birthday }).eq('user_id', userId);
    }

    const [profileResult, rolesResult, staffResult, baUserResult] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', userId).single(),
      supabase.from('user_roles').select('role, permissions').eq('user_id', userId),
      supabase.from('staff').select('birthday').eq('user_id', userId).maybeSingle(),
      supabase.from('ba_user').select('email, phone').eq('id', userId).single(),
    ]);

    return c.json({
      userId,
      orgId: c.get('orgId'),
      displayName: profileResult.data?.display_name ?? '',
      email: (baUserResult.data?.email as string | null) ?? null,
      phone: (baUserResult.data?.phone as string | null) ?? null,
      birthday: (staffResult.data?.birthday as string | null) ?? null,
      roles: (rolesResult.data ?? []).map((r: { role: string }) => r.role),
      permissions: (rolesResult.data ?? []).flatMap((r: { permissions: unknown[] }) =>
        Array.isArray(r.permissions) ? r.permissions : [],
      ),
    });
  },
);

// POST /api/me/activate-parent
app.openapi(
  createRoute({
    method: 'post',
    path: '/activate-parent',
    tags: ['Me'],
    summary: '啟用家長身份並建立子女學生資料',
    request: {
      body: { content: { 'application/json': { schema: ActivateParentSchema } } },
    },
    responses: {
      200: {
        description: '啟用成功',
        content: {
          'application/json': {
            schema: z.object({ studentId: z.string(), roles: z.array(z.string()) }),
          },
        },
      },
      500: {
        description: '伺服器錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    // Step 1：取得或建立 parents 記錄
    const { data: existingParent } = await supabase
      .from('parents')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle();

    let parentId: string;

    if (existingParent) {
      parentId = (existingParent as Record<string, unknown>)['id'] as string;
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .single();

      const { data: newParent, error: parentError } = await supabase
        .from('parents')
        .insert({
          user_id: userId,
          org_id: orgId,
          name: (profile as Record<string, unknown> | null)?.['display_name'] ?? '家長',
          status: 'active',
        })
        .select('id')
        .single();

      if (parentError || !newParent) {
        return c.json({ error: '建立家長資料失敗', code: 'CREATE_PARENT_FAILED' }, 500);
      }
      parentId = (newParent as Record<string, unknown>)['id'] as string;
    }

    // Step 2：建立學生記錄
    const { data: newStudent, error: studentError } = await supabase
      .from('students')
      .insert({
        org_id: orgId,
        name: body.studentName,
        grade: body.grade,
        school: '',
        is_active: true,
      })
      .select('id')
      .single();

    if (studentError || !newStudent) {
      return c.json({ error: '建立學生資料失敗', code: 'CREATE_STUDENT_FAILED' }, 500);
    }

    const studentId = (newStudent as Record<string, unknown>)['id'] as string;

    // Step 3：建立 parent_student_relations
    const { error: relError } = await supabase.from('parent_student_relations').insert({
      parent_id: parentId,
      student_id: studentId,
      is_primary: true,
      relation: null,
    });

    if (relError) {
      await supabase.from('students').delete().eq('id', studentId);
      return c.json({ error: '建立關聯失敗', code: 'CREATE_RELATION_FAILED' }, 500);
    }

    // Step 4：新增 parent role
    const { error: roleError } = await supabase.from('user_roles').upsert(
      { user_id: userId, org_id: orgId, role: 'parent', permissions: [] },
      { onConflict: 'user_id,role,org_id', ignoreDuplicates: true },
    );

    if (roleError) {
      // rollback relation + student
      await supabase
        .from('parent_student_relations')
        .delete()
        .eq('parent_id', parentId)
        .eq('student_id', studentId);
      await supabase.from('students').delete().eq('id', studentId);
      return c.json({ error: '賦予角色失敗', code: 'GRANT_ROLE_FAILED' }, 500);
    }

    const { data: rolesResult } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    return c.json({
      studentId,
      roles: (rolesResult ?? []).map((r: { role: string }) => r.role),
    });
  },
);

export default app;
```

- [ ] **Step 2：修改 `apps/api/src/index.ts`**

在檔案頂端 imports 新增（放在最後一個 import 之後）：

```typescript
import meRoute from './routes/me';
```

找到並**刪除** 第 230–250 行的整個 `GET /api/me` handler：

```typescript
// GET /api/me - 取得目前登入用戶的 profile 和 roles
app.get('/api/me', async (c) => {
  // ... 整個 handler
});
```

在 `// Mount routes` 區塊加入（放在第一行）：

```typescript
app.route('/api/me', meRoute);
```

- [ ] **Step 3：寫測試（`apps/api/src/index.spec.ts`）**

在現有測試後新增：

```typescript
describe('GET /api/me', () => {
  it('returns 401 when not authenticated', async () => {
    const response = await app.request('http://localhost/api/me');
    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/me', () => {
  it('returns 401 when not authenticated', async () => {
    const response = await app.request('http://localhost/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Test' }),
    });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/me/activate-parent', () => {
  it('returns 401 when not authenticated', async () => {
    const response = await app.request('http://localhost/api/me/activate-parent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName: 'Test', grade: 'P1' }),
    });
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 4：執行測試**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
npx vitest run apps/api/src/index.spec.ts
```

預期：PASS

- [ ] **Step 5：Commit**

```bash
git add apps/api/src/routes/me.ts apps/api/src/index.ts apps/api/src/index.spec.ts
git commit -m "feat(api): add me.ts routes (GET expanded, PATCH profile, POST activate-parent)"
```

---

## Task 2：前端 `AuthService` 擴充

**Files:**
- Modify: `apps/web/src/app/core/auth.service.ts`

- [ ] **Step 1：擴充 `MeResponse` interface（約第 16 行）**

找到：

```typescript
interface MeResponse {
  userId: string;
  orgId: string;
  displayName: string;
  roles: UserRole[];
  permissions: string[];
}
```

改為：

```typescript
interface MeResponse {
  userId: string;
  orgId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  roles: UserRole[];
  permissions: string[];
}
```

- [ ] **Step 2：新增 `refreshRoles()` 公開方法**

在 `closeRolePicker()` 方法後加入：

```typescript
async refreshRoles(): Promise<void> {
  await this.loadProfile();
}
```

- [ ] **Step 3：確認 TypeScript 編譯無錯**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
npx nx run web:build --configuration=development 2>&1 | grep -i " error TS" | head -20
```

預期：無輸出

- [ ] **Step 4：Commit**

```bash
git add apps/web/src/app/core/auth.service.ts
git commit -m "feat(auth): expand MeResponse with email/phone/birthday, add refreshRoles()"
```

---

## Task 3：`AccountSettingsDialogComponent`

**Files:**
- Create: `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.ts`
- Create: `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.html`
- Create: `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.scss`

### 背景知識

- Dialog 元件**自行提供** `MessageService` 並在模板中放 `<p-toast>` — 此為 PrimeNG dialog 的標準模式（同 `parent-form-dialog`）
- `ConfirmDialogModule` 需指定 `key` 避免與頁面上其他 confirmdialog 衝突
- `GRADE_LEVELS` / `GRADE_LEVEL_LABELS` 匯入自 `@core/students.service`
- 登入使用者的 email 從 `auth.user()?.email` 取得（型別 `string | null | undefined`）

- [ ] **Step 1：建立 TypeScript 檔案**

```typescript
import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { AuthService } from '@core/auth.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '@core/students.service';
import { environment } from '@env/environment';
import { firstValueFrom } from 'rxjs';

type AccountView = 'main' | 'activate-step1' | 'activate-step2';

@Component({
  selector: 'app-account-settings-dialog',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    ButtonModule,
    DatePickerModule,
    SelectModule,
    ConfirmDialogModule,
    ToastModule,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './account-settings-dialog.component.html',
  styleUrl: './account-settings-dialog.component.scss',
})
export class AccountSettingsDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly ref = inject(DynamicDialogRef);
  private readonly auth = inject(AuthService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  protected readonly view = signal<AccountView>('main');
  protected readonly saving = signal(false);
  protected readonly activating = signal(false);

  protected readonly hasParentRole = computed(() =>
    this.auth.roles().includes('parent'),
  );

  protected displayName = this.auth.profile()?.display_name ?? '';
  protected email = this.auth.user()?.email ?? '';
  protected phone = '';
  protected birthday: Date | null = null;

  protected studentName = '';
  protected studentGrade = '';

  protected readonly gradeOptions = GRADE_LEVELS.map((g) => ({
    label: GRADE_LEVEL_LABELS[g],
    value: g,
  }));

  constructor() {
    void this.loadMe();
  }

  private async loadMe() {
    try {
      const me = await firstValueFrom(
        this.http.get<{
          displayName: string;
          email: string | null;
          phone: string | null;
          birthday: string | null;
        }>(`${environment.apiUrl}/api/me`, { withCredentials: true }),
      );
      this.displayName = me.displayName;
      this.email = me.email ?? '';
      this.phone = me.phone ?? '';
      this.birthday = me.birthday ? new Date(me.birthday) : null;
    } catch {
      // silently ignore — 初始值已從 auth.user() 設定
    }
  }

  protected saveDisplayName() {
    this.patchMe({ displayName: this.displayName.trim() }, '顯示名稱已更新');
  }

  protected saveBirthday() {
    this.patchMe({ birthday: this.birthday ? this.formatDate(this.birthday) : null }, '生日已更新');
  }

  protected confirmSaveEmail() {
    this.confirmationService.confirm({
      key: 'account-settings-confirm',
      message: `確定要將 Email 改為「${this.email}」嗎？\n儲存後需用新 Email 登入。`,
      header: '確認修改 Email',
      acceptLabel: '確定修改',
      rejectLabel: '取消',
      accept: () => this.patchMe({ email: this.email.trim() }, 'Email 已更新'),
    });
  }

  protected confirmSavePhone() {
    this.confirmationService.confirm({
      key: 'account-settings-confirm',
      message: `確定要將電話改為「${this.phone}」嗎？\n儲存後需用新電話登入。`,
      header: '確認修改電話',
      acceptLabel: '確定修改',
      rejectLabel: '取消',
      accept: () => this.patchMe({ phone: this.phone.trim() || null }, '電話已更新'),
    });
  }

  private patchMe(payload: Record<string, unknown>, successMsg: string) {
    this.saving.set(true);
    this.http
      .patch(`${environment.apiUrl}/api/me`, payload, { withCredentials: true })
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: successMsg });
          this.saving.set(false);
          void this.auth.refreshRoles();
        },
        error: (err) => {
          const code = (err.error as { code?: string } | null)?.code;
          const msg =
            code === 'EMAIL_ALREADY_IN_USE' ? '此 Email 已被使用' : '更新失敗，請稍後再試';
          this.messageService.add({ severity: 'error', summary: msg });
          this.saving.set(false);
        },
      });
  }

  protected goToChangePassword() {
    const role = this.auth.activeRole();
    this.ref.close();
    this.router.navigate([`/${role}/change-password`]);
  }

  protected startActivateParent() {
    this.studentName = '';
    this.studentGrade = '';
    this.view.set('activate-step1');
  }

  protected goToStep2() {
    if (!this.studentName.trim() || !this.studentGrade) return;
    this.view.set('activate-step2');
  }

  protected goBackToStep1() {
    this.view.set('activate-step1');
  }

  protected confirmActivate() {
    this.activating.set(true);
    this.http
      .post(
        `${environment.apiUrl}/api/me/activate-parent`,
        { studentName: this.studentName.trim(), grade: this.studentGrade },
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          void this.auth.refreshRoles();
          this.messageService.add({
            severity: 'success',
            summary: '家長身份已啟用',
            detail: '下次切換角色時即可使用',
          });
          this.activating.set(false);
          this.view.set('main');
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: '啟用失敗，請稍後再試' });
          this.activating.set(false);
        },
      });
  }

  protected close() {
    this.ref.close();
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
```

- [ ] **Step 2：建立 HTML 模板**

```html
<p-toast position="top-center" [baseZIndex]="30000" />
<p-confirmdialog key="account-settings-confirm" appendTo="body" />

<div class="account-settings">
  <div class="dialog-header-inline">
    <div class="dialog-header-inline__content">
      @if (view() === 'main') {
        <span class="dialog-header-inline__title">帳號設定</span>
      } @else if (view() === 'activate-step1') {
        <button type="button" class="dialog-header-inline__back" (click)="view.set('main')">
          <i class="pi pi-arrow-left"></i>
        </button>
        <span class="dialog-header-inline__title">啟用家長身份（1/2）</span>
      } @else {
        <button type="button" class="dialog-header-inline__back" (click)="goBackToStep1()">
          <i class="pi pi-arrow-left"></i>
        </button>
        <span class="dialog-header-inline__title">啟用家長身份（2/2）</span>
      }
    </div>
    <button type="button" class="dialog-header-inline__close" (click)="close()" aria-label="關閉">
      <i class="pi pi-times"></i>
    </button>
  </div>

  @if (view() === 'main') {
    <section class="account-settings__section">
      <h3 class="account-settings__section-title">基本資料</h3>

      <div class="account-settings__field">
        <label class="account-settings__label">顯示名稱</label>
        <div class="account-settings__input-row">
          <input pInputText [(ngModel)]="displayName" [disabled]="saving()" class="w-full" />
          <p-button label="儲存" size="small" [loading]="saving()" (onClick)="saveDisplayName()" />
        </div>
      </div>

      <div class="account-settings__field">
        <label class="account-settings__label">Email</label>
        <div class="account-settings__input-row">
          <input pInputText type="email" [(ngModel)]="email" [disabled]="saving()" class="w-full" />
          <p-button label="儲存" size="small" [loading]="saving()" (onClick)="confirmSaveEmail()" />
        </div>
        <p class="account-settings__hint">修改後需用新 Email 登入</p>
      </div>

      <div class="account-settings__field">
        <label class="account-settings__label">電話</label>
        <div class="account-settings__input-row">
          <input pInputText type="tel" [(ngModel)]="phone" [disabled]="saving()" class="w-full" />
          <p-button label="儲存" size="small" [loading]="saving()" (onClick)="confirmSavePhone()" />
        </div>
        <p class="account-settings__hint">修改後需用新電話登入</p>
      </div>

      <div class="account-settings__field">
        <label class="account-settings__label">生日</label>
        <div class="account-settings__input-row">
          <p-datepicker
            [(ngModel)]="birthday"
            [showIcon]="true"
            placeholder="選擇生日"
            appendTo="body"
            styleClass="w-full"
            [disabled]="saving()"
          />
          <p-button label="儲存" size="small" [loading]="saving()" (onClick)="saveBirthday()" />
        </div>
      </div>
    </section>

    <section class="account-settings__section">
      <h3 class="account-settings__section-title">安全性</h3>
      <button
        type="button"
        class="account-settings__action-row"
        (click)="goToChangePassword()"
      >
        <i class="pi pi-key account-settings__action-icon"></i>
        <span>修改密碼</span>
        <i class="pi pi-chevron-right account-settings__action-chevron"></i>
      </button>
    </section>

    @if (!hasParentRole()) {
      <section class="account-settings__section">
        <h3 class="account-settings__section-title">家長身份</h3>
        <p class="account-settings__desc">
          啟用後可使用家長 portal 查看子女的出缺席與課表。
        </p>
        <p-button
          label="啟用家長身份"
          icon="pi pi-user-plus"
          [outlined]="true"
          (onClick)="startActivateParent()"
        />
      </section>
    }
  }

  @if (view() === 'activate-step1') {
    <div class="account-settings__step">
      <div class="account-settings__field">
        <label class="account-settings__label">
          子女姓名<span class="account-settings__required">*</span>
        </label>
        <input
          pInputText
          [(ngModel)]="studentName"
          placeholder="子女的真實姓名"
          class="w-full"
        />
      </div>

      <div class="account-settings__field">
        <label class="account-settings__label">
          年級<span class="account-settings__required">*</span>
        </label>
        <p-select
          [options]="gradeOptions"
          [(ngModel)]="studentGrade"
          placeholder="選擇年級"
          class="w-full"
        />
      </div>

      <div class="account-settings__footer">
        <p-button
          label="下一步"
          icon="pi pi-arrow-right"
          iconPos="right"
          [disabled]="!studentName.trim() || !studentGrade"
          (onClick)="goToStep2()"
        />
      </div>
    </div>
  }

  @if (view() === 'activate-step2') {
    <div class="account-settings__step">
      <div class="account-settings__confirm-card">
        <div class="account-settings__confirm-row">
          <span class="account-settings__confirm-label">子女姓名</span>
          <span class="account-settings__confirm-value">{{ studentName }}</span>
        </div>
        <div class="account-settings__confirm-row">
          <span class="account-settings__confirm-label">年級</span>
          <span class="account-settings__confirm-value">{{ studentGrade }}</span>
        </div>
      </div>
      <p class="account-settings__desc">確認後系統將建立子女資料並啟用家長身份。</p>

      <div class="account-settings__footer">
        <p-button
          label="確認啟用"
          icon="pi pi-check"
          [loading]="activating()"
          (onClick)="confirmActivate()"
        />
      </div>
    </div>
  }
</div>
```

- [ ] **Step 3：建立 SCSS**

```scss
.account-settings {
  display: flex;
  flex-direction: column;

  &__section {
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--zinc-200);

    &:last-child {
      border-bottom: none;
    }
  }

  &__section-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--zinc-500);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 var(--space-3);
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-3);

    &:last-child {
      margin-bottom: 0;
    }
  }

  &__label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--zinc-700);
  }

  &__required {
    color: var(--red-500);
    margin-left: 2px;
  }

  &__input-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  &__hint {
    font-size: 0.75rem;
    color: var(--zinc-500);
    margin: 0;
  }

  &__desc {
    font-size: 0.875rem;
    color: var(--zinc-600);
    margin: 0 0 var(--space-3);
  }

  &__action-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--zinc-700);
    font-size: 0.875rem;

    &:hover {
      color: var(--zinc-900);
    }
  }

  &__action-icon {
    color: var(--zinc-500);
  }

  &__action-chevron {
    margin-left: auto;
    color: var(--zinc-400);
    font-size: 0.75rem;
  }

  &__step {
    padding: var(--space-4) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-2);
  }

  &__confirm-card {
    background: var(--zinc-50);
    border: 1px solid var(--zinc-200);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  &__confirm-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.875rem;
  }

  &__confirm-label {
    color: var(--zinc-500);
  }

  &__confirm-value {
    font-weight: 500;
    color: var(--zinc-800);
  }
}
```

- [ ] **Step 4：確認 TypeScript 編譯無錯**

```bash
npx nx run web:build --configuration=development 2>&1 | grep -i " error TS" | head -20
```

預期：無輸出

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/app/shared/components/account-settings-dialog/
git commit -m "feat(ui): add AccountSettingsDialogComponent with profile edit and parent activation"
```

---

## Task 4：Shell Layout 整合

**Files:**
- Modify: `apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.ts`
- Modify: `apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.html`

### 背景知識

- `shell-layout.component.ts` 目前使用 `@ViewChild('op') op!: Popover;`（decorator 風格），不是 `viewChild()`
- **只修改** `providers` array 和加入新方法／import，不要覆蓋整個 `@Component` decorator

- [ ] **Step 1：修改 `shell-layout.component.ts`**

在現有 imports 後加入：

```typescript
import { DialogService } from 'primeng/dynamicdialog';
import { AccountSettingsDialogComponent } from '@shared/components/account-settings-dialog/account-settings-dialog.component';
```

在 `@Component` decorator 加入 `providers` 陣列（僅新增 providers，不修改 imports 陣列）：

```typescript
@Component({
  selector: 'app-shell-layout',
  standalone: true,
  imports: [/* 保持原有，不修改 */],
  providers: [DialogService],   // <-- 新增這一行
  templateUrl: './shell-layout.component.html',
  styleUrl: './shell-layout.component.scss',
})
```

在 class 內加入（放在 `private readonly router = inject(Router);` 之後）：

```typescript
private readonly dialogService = inject(DialogService);
```

新增方法（放在 `changePassword()` 方法後）：

```typescript
openAccountSettings() {
  this.op.hide();
  this.dialogService.open(AccountSettingsDialogComponent, {
    width: '480px',
    modal: true,
    showHeader: false,
    appendTo: this.overlayContainer ?? 'body',
  });
}
```

**刪除** `changePassword()` 方法（功能已移至 AccountSettingsDialogComponent）：

```typescript
// 刪除整個方法
changePassword() {
  this.op.hide();
  const role = this.auth.activeRole();
  this.router.navigate([`/${role}/change-password`]);
}
```

> ⚠️ 確認 `router` 是否還有被其他方法使用。若 `changePassword()` 是唯一使用者，也移除 `private readonly router = inject(Router);` 這行。

- [ ] **Step 2：修改 `shell-layout.component.html`**

找到：

```html
<div class="user-menu__items">
  <button class="user-menu__item" (click)="changePassword()">
    <i class="user-menu__item-icon pi pi-key"></i>
    修改密碼
  </button>
  <button class="user-menu__item user-menu__item--danger" (click)="signOut()">
    <i class="user-menu__item-icon pi pi-sign-out"></i>
    登出
  </button>
</div>
```

改為：

```html
<div class="user-menu__items">
  <button class="user-menu__item" (click)="openAccountSettings()">
    <i class="user-menu__item-icon pi pi-user-edit"></i>
    帳號設定
  </button>
  <button class="user-menu__item user-menu__item--danger" (click)="signOut()">
    <i class="user-menu__item-icon pi pi-sign-out"></i>
    登出
  </button>
</div>
```

- [ ] **Step 3：確認 TypeScript 編譯無錯**

```bash
npx nx run web:build --configuration=development 2>&1 | grep -i " error TS" | head -20
```

預期：無輸出

- [ ] **Step 4：手動驗證**

啟動 dev server：

```bash
npx nx serve web
```

1. 登入後點右上角頭像 → 出現「帳號設定」選項（不再有「修改密碼」）
2. 點「帳號設定」→ Dialog 開啟，顯示目前的姓名、Email、電話、生日
3. 修改顯示名稱 → 點儲存 → toast 顯示「顯示名稱已更新」
4. 修改 Email → 點儲存 → 彈出確認 dialog → 確認後更新
5. 點「修改密碼」→ Dialog 關閉，導航至 `/{role}/change-password`
6. 若帳號**沒有** parent role：看到「家長身份」區塊與「啟用家長身份」按鈕
7. 點「啟用家長身份」→ Step 1（填姓名 + 年級）→ Step 2（確認）→ 啟用成功 toast

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.ts
git add apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.html
git commit -m "feat(ui): replace change-password menu item with account settings dialog"
```

---

## 完成確認

```bash
npx vitest run apps/api/src/index.spec.ts
npx nx run web:build
```

確認 API 測試全過、前端建置無錯。
