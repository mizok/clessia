# Root 帳號登入擴充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支援 `loginType: 'username'` 讓 root 帳號可透過 `/login?role=root` 登入，無需 email 或手機號碼。

**Architecture:** 後端 `/api/login` 新增 username 分支直接呼叫 `signInUsername`；前端登入頁偵測 `?role=root` query param 切換為簡化 UI（readonly root 欄位，只需輸入密碼）。

**Tech Stack:** Hono (API) + Angular 21 Signals + Better Auth + Vitest

**Design Spec:** `doc/superpowers/specs/2026-03-19-root-account-login-design.md`

---

## 檔案清單

| 動作 | 檔案 | 說明 |
|------|------|------|
| 修改 | `apps/api/src/index.ts` | `/api/login` 加 username 分支 |
| 修改 | `apps/api/src/index.spec.ts` | 新增 username login 測試 |
| 修改 | `apps/web/src/app/core/auth.service.ts` | loginMode 型別加 `'username'` |
| 修改 | `apps/web/src/app/features/public/pages/login/login.component.ts` | 偵測 `?role=root`，加 `isRootMode` signal |
| 修改 | `apps/web/src/app/features/public/pages/login/login.component.html` | root 模式 UI |

---

## Task 1：後端 `/api/login` 支援 `loginType: 'username'`

**Files:**
- Modify: `apps/api/src/index.ts`（約第 155 行）
- Test: `apps/api/src/index.spec.ts`

- [ ] **Step 1：寫失敗測試**

> ⚠️ 此測試為 integration test，需要本地 Supabase 正在運行（`supabase start`）才能執行。測試驗證的是 `loginType` 解析邏輯，不是密碼驗證。

在 `apps/api/src/index.spec.ts` 新增：

```typescript
it('returns 400 when loginType is username but account is missing', async () => {
  const response = await app.request('http://localhost/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '', password: 'anything', loginType: 'username' }),
  });
  // account 為空應回傳 400 MISSING_FIELDS，與 loginType 無關
  expect(response.status).toBe(400);
});
```

此測試不依賴 Supabase（因為 account 空值在查詢前就被攔截）。

- [ ] **Step 2：執行測試確認失敗**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
npx nx test api --testFile=src/index.spec.ts
```

預期：FAIL（`username` 目前被轉成 `email`，但空值攔截邏輯相同，可能直接通過）。確認現有行為後繼續。

- [ ] **Step 3：修改 `apps/api/src/index.ts`**

找到第 155 行：
```typescript
const loginType = body.loginType === 'phone' ? 'phone' : 'email';
```

改為：
```typescript
const loginType = body.loginType === 'phone' ? 'phone'
  : body.loginType === 'username' ? 'username'
  : 'email';
```

然後在 `if (baUser.email)` / `else if (baUser.phone)` 之前加入 username 分支（在第 190 行的 `try {` 區塊內）：

```typescript
// Username-only login (e.g. root) — skip ba_user lookup, delegate directly
if (loginType === 'username') {
  try {
    const sessionRes = await (auth.api as any).signInUsername({
      body: { username: account, password },
      asResponse: true,
    });
    return sessionRes;
  } catch {
    return c.json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
  }
}
```

> ⚠️ 此區塊必須放在 ba_user 查詢之前（第 163 行之前），跳過 staff/parent 狀態檢查。

完整位置示意：

```typescript
app.post('/api/login', async (c) => {
  const body = ...
  const loginType = ... // 改好的三元

  if (!account || !password) { ... }

  // === 新增：username 分支（root 登入，跳過 ba_user 查詢）===
  if (loginType === 'username') {
    const auth = createAuth(c.env); // 此分支自己建立 auth instance
    try {
      const sessionRes = await (auth.api as any).signInUsername({
        body: { username: account, password },
        asResponse: true,
      });
      return sessionRes;
    } catch {
      return c.json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
    }
  }
  // === 以下維持原樣 ===

  const supabase = createServiceClientFromEnv(c.env);
  const { data: baUser } = ...
  // ...（約第 190 行）const auth = createAuth(c.env); ← 這行保留，供 email/phone 分支使用
```

- [ ] **Step 4：執行測試確認通過**

```bash
npx nx test api --testFile=src/index.spec.ts
```

預期：PASS

- [ ] **Step 5：Commit**

```bash
git add apps/api/src/index.ts apps/api/src/index.spec.ts
git commit -m "feat(api): add loginType:'username' branch to /api/login for root account"
```

---

## Task 2：前端 `AuthService` 支援 `loginType: 'username'`

**Files:**
- Modify: `apps/web/src/app/core/auth.service.ts`

- [ ] **Step 1：修改 `signIn` 方法的型別**

找到 `signIn` 方法（約第 116 行）：

```typescript
async signIn(
  account: string,
  password: string,
  _captchaToken?: string,
  loginType: 'email' | 'phone' = 'email',
): Promise<string | null> {
```

改為：

```typescript
async signIn(
  account: string,
  password: string,
  _captchaToken?: string,
  loginType: 'email' | 'phone' | 'username' = 'email',
): Promise<string | null> {
```

payload 的 `loginType` 已直接傳入 body，不需其他變更。

- [ ] **Step 2：確認 TypeScript 編譯無錯**

> ℹ️ 此 task 只做型別擴充，無邏輯變更，不需新增測試。型別正確性由編譯步驟保證。

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
npx nx run web:build --configuration=development 2>&1 | grep -i " error TS" | head -20
```

預期：無輸出（無 TypeScript 錯誤）

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/app/core/auth.service.ts
git commit -m "feat(auth): extend signIn loginType to support 'username' mode"
```

---

## Task 3：登入頁 `?role=root` 模式

**Files:**
- Modify: `apps/web/src/app/features/public/pages/login/login.component.ts`
- Modify: `apps/web/src/app/features/public/pages/login/login.component.html`

- [ ] **Step 1：修改 `login.component.ts`**

加入 `ActivatedRoute` inject 與 `isRootMode` signal，在 `ngAfterViewInit` 前加入 `ngOnInit`：

```typescript
import { Component, ElementRef, signal, AfterViewInit, OnInit, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { CaptchaService } from '@core/captcha.service';
import { environment } from '@env/environment';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  host: { class: 'u-centered-flex' },
})
export class LoginComponent implements OnInit, AfterViewInit {
  private readonly turnstileContainer = viewChild.required<ElementRef>('turnstileContainer');
  private readonly captchaToken = signal<string | null>(null);
  private readonly auth = inject(AuthService);
  private readonly captcha = inject(CaptchaService);
  private readonly route = inject(ActivatedRoute);

  protected account = '';
  protected password = '';
  protected rememberMe = false;
  protected readonly loginMode = signal<'email' | 'phone' | 'username'>('email');
  protected readonly isRootMode = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly showPassword = signal(false);

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('role') === 'root') {
      this.isRootMode.set(true);
      this.loginMode.set('username');
      this.account = 'root';
    }
  }

  ngAfterViewInit() {
    this.captcha.render(
      this.turnstileContainer().nativeElement,
      environment.turnstileSiteKey,
      (token) => this.captchaToken.set(token),
      { appearance: 'always', size: 'invisible' },
    );
  }

  protected setLoginMode(mode: 'email' | 'phone') {
    this.loginMode.set(mode);
    this.account = '';
    this.error.set(null);
  }

  protected async onSubmit() {
    this.error.set(null);
    this.submitting.set(true);

    this.auth.setRememberMe(this.rememberMe);
    const errorMsg = await this.auth.signIn(
      this.account,
      this.password,
      this.captchaToken() ?? undefined,
      this.loginMode(),
    );
    this.submitting.set(false);

    if (errorMsg) {
      this.error.set(errorMsg);
      return;
    }

    const roles = this.auth.roles();
    if (roles.length === 0) {
      this.error.set('此帳號尚未被指派角色，請聯繫管理員');
      return;
    }

    this.auth.navigateToRoleShell(roles[0]);
  }
}
```

- [ ] **Step 2：修改 `login.component.html`**

將 tabs 和 account input 改為條件式：

```html
<div class="login auth-content">
  <header class="auth-content__header">
    <p class="auth-content__badge">管理系統</p>
    <h1 class="auth-content__title">登入</h1>
  </header>

  <form class="form" (ngSubmit)="onSubmit()">
    @if (error()) {
      <div class="message message--error">
        <i class="pi pi-exclamation-circle"></i>
        {{ error() }}
      </div>
    }

    @if (!isRootMode()) {
      <div class="form__tabs" [attr.data-mode]="loginMode()">
        <div class="form__tabs-indicator"></div>
        <button
          type="button"
          class="form__tab"
          [class.form__tab--active]="loginMode() === 'email'"
          (click)="setLoginMode('email')"
        >
          <i class="pi pi-envelope"></i>
          Email
        </button>
        <button
          type="button"
          class="form__tab"
          [class.form__tab--active]="loginMode() === 'phone'"
          (click)="setLoginMode('phone')"
        >
          <i class="pi pi-phone"></i>
          手機號碼
        </button>
      </div>
    }

    <div class="form__field">
      @if (isRootMode()) {
        <input
          id="account"
          type="text"
          name="account"
          class="form__input"
          [value]="account"
          readonly
          aria-label="帳號"
          autocomplete="username"
        />
      } @else {
        <input
          id="account"
          [type]="loginMode() === 'email' ? 'email' : 'tel'"
          class="form__input"
          [placeholder]="loginMode() === 'email' ? 'Email' : '手機號碼（09xxxxxxxx）'"
          [(ngModel)]="account"
          name="account"
          required
          [attr.aria-label]="loginMode() === 'email' ? 'Email' : '手機號碼'"
          [autocomplete]="loginMode() === 'email' ? 'email' : 'tel'"
        />
      }
    </div>

    <div class="form__field">
      <label class="form__label" for="password">密碼</label>
      <div class="form__input-wrapper">
        <input
          id="password"
          [type]="showPassword() ? 'text' : 'password'"
          class="form__input"
          placeholder="輸入密碼"
          [(ngModel)]="password"
          name="password"
          required
          autocomplete="current-password"
        />
        <button
          type="button"
          class="form__reveal-btn"
          (click)="showPassword.set(!showPassword())"
          [attr.aria-label]="showPassword() ? '隱藏密碼' : '顯示密碼'"
        >
          <i [class]="showPassword() ? 'pi pi-eye-slash' : 'pi pi-eye'"></i>
        </button>
      </div>
    </div>

    @if (!isRootMode()) {
      <div class="form__row">
        <label class="form__checkbox">
          <input type="checkbox" [(ngModel)]="rememberMe" name="rememberMe" />
          <span>記住我</span>
        </label>
        <a class="form__link" routerLink="/forgot-password">忘記密碼？</a>
      </div>
    }

    <div #turnstileContainer></div>

    <button type="submit" class="form__submit" [disabled]="submitting() || !account || !password">
      @if (submitting()) {
        <i class="pi pi-spinner pi-spin"></i>
        登入中...
      } @else {
        登入
      }
    </button>
  </form>
</div>
```

- [ ] **Step 3：確認 TypeScript 編譯無錯**

```bash
npx nx run web:build --configuration=development 2>&1 | grep -E "error" | head -20
```

預期：無錯誤

- [ ] **Step 4：手動驗證**

啟動 dev server：
```bash
npx nx serve web
```

1. 開啟 `http://localhost:4200/login` → 應看到一般登入（email/phone tabs）
2. 開啟 `http://localhost:4200/login?role=root` → 應看到：
   - 無 email/phone tabs
   - 帳號欄顯示 `root`（readonly，無法修改）
   - 無「記住我」
3. 輸入正確密碼（seed 預設：`Test123`）→ 登入後導向第一個 role 的 shell（root 有 admin/teacher/parent，`roles[0]` 為 admin，預期導向 `/admin`）
4. 輸入錯誤密碼 → 應顯示「帳號或密碼錯誤」

> ℹ️ Turnstile widget 在 root 模式下仍會初始化（`#turnstileContainer` 始終存在），token 會被送出但後端目前未嚴格驗證。此為已知行為，不影響功能。

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/app/features/public/pages/login/login.component.ts
git add apps/web/src/app/features/public/pages/login/login.component.html
git commit -m "feat(ui): add root login mode via ?role=root query param"
```

---

## 完成確認

全部完成後執行：

```bash
npx nx test api
npx nx run web:build
```

確認 API 測試全過、前端建置無錯。
