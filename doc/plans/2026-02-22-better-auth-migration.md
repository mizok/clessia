# Better Auth Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Codex 委派原則：** 每個 Task 的實作步驟盡量透過 `mcp__codex-cli__codex` 委派給 Codex，Claude 負責驗證結果。

**Goal:** 將 Supabase Auth 替換為 Better Auth，實現與供應商無關的 auth 架構，支援 email/手機號碼/username 多元登入，且不需要 SMS OTP 費用。

**Architecture:**
- Better Auth 負責所有 auth（user/session/account tables 在 Supabase PostgreSQL）
- Supabase JS Client（service role key）繼續負責業務資料查詢
- RLS 全面移除，改由 Hono middleware 做 org 層級授權
- Angular 使用 Better Auth vanilla client 包成 `AuthService`

**Tech Stack:**
- Better Auth v1.3.x + username plugin + admin plugin
- `@neondatabase/serverless` — 從 Cloudflare Workers 直連 Supabase PostgreSQL（WebSocket 模式）
- Hono（現有）+ `@supabase/supabase-js` service client（保留，用於業務查詢）
- Angular 21 Signals

---

## 背景知識（給 Codex 的重要上下文）

### 專案結構
```
apps/api/src/
  index.ts              # Hono app 入口，AppEnv 型別
  middleware/auth.ts    # 目前用 Supabase Auth 驗證 JWT
  lib/supabase.ts       # Supabase client factory
  routes/               # campuses, courses, staff, subjects

apps/web/src/app/
  core/
    auth.service.ts     # Angular Auth service（Supabase Auth）
    supabase.service.ts # Supabase client wrapper
    auth.interceptor.ts # 把 JWT 塞到 HTTP header
    auth.guard.ts / guest.guard.ts / role.guard.ts / permission.guard.ts
  features/public/pages/
    login / forgot-password / reset-password / change-password
  features/select-role/
  shared/components/layout/shell-layout/

packages/
  shared-types/src/index.ts   # User interface, API types
  validators/src/index.ts     # loginSchema, resetPasswordSchema 等
```

### 現有 Auth 流程（將被替換）
```
Angular → supabase.auth.signInWithPassword() → JWT
Angular → 每個 API 請求帶 Bearer JWT
Hono middleware → supabase.auth.getUser(JWT) → 驗證
Routes → c.get('supabase') 做 DB 查詢（RLS 用 JWT 過濾）
```

### 目標 Auth 流程
```
Angular → Better Auth client.signIn() → session cookie / JWT
Angular → 每個 API 請求帶 session token
Hono → Better Auth.api.getSession() → 驗證 + 取得 userId
Middleware → 用 userId 查 orgId → 注入 context
Routes → c.get('supabase')（service role client）+ c.get('orgId') 做 DB 查詢
```

### 重要決策
- `profiles.id` 改為 standalone UUID（移除 FK to auth.users），Better Auth user.id 對應 profiles.id
- Better Auth 表名前綴：`ba_`（避免與現有 `user_roles` 衝突）
- 手機登入：`phone@clessia.app` 假 email 格式，username 欄位存真實手機號碼
- 不需要 email verification（管理者建帳）
- `user_roles.permissions` 欄位（JSONB）保持不變

---

## Phase 1：安裝依賴

### Task 1.1：更新 API 依賴

**Files:**
- Modify: `apps/api/package.json`

**Codex 委派：**
```
prompt: |
  在 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/ 目錄下，
  更新 package.json 的 dependencies，加入以下套件：
  - better-auth (latest)
  - @neondatabase/serverless (latest)

  然後執行 npm install（在 monorepo 根目錄 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/ 執行）

  注意：不要移除 @supabase/supabase-js，業務資料查詢還需要用到
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
sandbox: workspace-write
```

**驗證：**
```bash
cat /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/package.json
# 確認 better-auth 和 @neondatabase/serverless 出現在 dependencies
```

**Commit:**
```bash
git add apps/api/package.json package-lock.json
git commit -m "chore: add better-auth and neon serverless driver"
```

---

### Task 1.2：更新 Angular 依賴

**Files:**
- Modify: `package.json`（根目錄）

**Codex 委派：**
```
prompt: |
  在 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/ 根目錄的 package.json，
  加入 better-auth 到 dependencies。
  Angular 前端會使用 better-auth/client（vanilla client），
  包含在 better-auth 主套件中，不需要額外安裝。

  執行 npm install
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
sandbox: workspace-write
```

**Commit:**
```bash
git add package.json package-lock.json
git commit -m "chore: add better-auth to web dependencies"
```

---

## Phase 2：資料庫遷移

### Task 2.1：建立 Better Auth migration

**Files:**
- Create: `supabase/migrations/20260222000001_better_auth.sql`

**Codex 委派：**
```
prompt: |
  在 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/supabase/migrations/ 建立新檔案：
  20260222000001_better_auth.sql

  這個 migration 要做以下事情：

  1. 建立 Better Auth 需要的資料表（前綴 ba_）：
     - ba_user (id text PK, name text, email text UNIQUE, emailVerified bool, image text, createdAt timestamptz, updatedAt timestamptz, username text UNIQUE, phone text, orgId uuid)
     - ba_session (id text PK, expiresAt timestamptz, token text UNIQUE, createdAt timestamptz, updatedAt timestamptz, ipAddress text, userAgent text, userId text FK→ba_user(id))
     - ba_account (id text PK, accountId text, providerId text, userId text FK→ba_user(id), accessToken text, refreshToken text, idToken text, accessTokenExpiresAt timestamptz, refreshTokenExpiresAt timestamptz, scope text, password text, createdAt timestamptz, updatedAt timestamptz)
     - ba_verification (id text PK, identifier text, value text, expiresAt timestamptz, createdAt timestamptz, updatedAt timestamptz)

  2. 移除 profiles 表對 auth.users 的 FK 限制：
     ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

  3. 移除 on_auth_user_created trigger 和 handle_new_user function：
     DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
     DROP FUNCTION IF EXISTS public.handle_new_user();

  4. 移除所有 RLS policies（但保留 RLS enabled 狀態，只移除 policies）：
     DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
     DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
     DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;
     -- 以及其他所有表的 policies（organizations, campuses, courses, staff, subjects）
     -- 用 DO block + pg_policies 查詢自動 drop 所有 policies

  5. 新增 index：
     CREATE INDEX IF NOT EXISTS ba_session_user_id_idx ON ba_session(userId);
     CREATE INDEX IF NOT EXISTS ba_account_user_id_idx ON ba_account(userId);
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
sandbox: workspace-write
```

**驗證：**
```bash
supabase db reset
# 確認沒有錯誤
supabase db diff --use-migra
# 確認 ba_* tables 存在，auth.uid() policies 不存在
```

**Commit:**
```bash
git add supabase/migrations/20260222000001_better_auth.sql
git commit -m "feat(db): add Better Auth tables, remove RLS policies and Supabase Auth triggers"
```

---

### Task 2.2：更新 seed.sql

**Files:**
- Modify: `supabase/seed.sql`

**Codex 委派：**
```
prompt: |
  讀取 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/supabase/seed.sql

  找到 INSERT INTO auth.users 的部分（約第 8-50 行），
  將其替換為直接 INSERT INTO ba_user，格式如下：

  INSERT INTO public.ba_user (id, name, email, "emailVerified", username, phone, "orgId", "createdAt", "updatedAt")
  VALUES (
    'demo-admin-id',
    '測試管理員',
    'admin@demo.clessia.app',  -- 內部假 email
    true,
    'admin',
    NULL,
    (SELECT id FROM public.organizations WHERE slug = 'demo' LIMIT 1),
    now(),
    now()
  );

  同時在 ba_account 插入對應的密碼記錄（password 欄位用 bcrypt hash）：
  -- 密碼 'password123' 的 bcrypt hash
  INSERT INTO public.ba_account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  VALUES (
    'demo-admin-account-id',
    'demo-admin-id',
    'credential',
    'demo-admin-id',
    '$2a$10$...', -- bcrypt hash of 'password123'
    now(),
    now()
  );

  注意：
  - 需要先建立 organization，才能有 orgId
  - ba_user 的 id 要和後面 profiles INSERT 的 id 對應
  - profiles 表不再 FK 到 auth.users，但 id 值要和 ba_user.id 對應
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
sandbox: workspace-write
```

**驗證：**
```bash
supabase db reset
# 確認沒有錯誤，seed 成功
```

**Commit:**
```bash
git add supabase/seed.sql
git commit -m "feat(db): update seed to use Better Auth user table"
```

---

## Phase 3：API - Better Auth 實例

### Task 3.1：建立 Better Auth 實例

**Files:**
- Create: `apps/api/src/auth.ts`
- Modify: `apps/api/src/lib/supabase.ts`
- Modify: `apps/api/wrangler.toml`

**Codex 委派：**
```
prompt: |
  在 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/src/ 建立 auth.ts：

  這個專案使用 Hono + Cloudflare Workers，後端資料庫是 Supabase PostgreSQL。
  Better Auth 需要直連 PostgreSQL，使用 @neondatabase/serverless（支援 Cloudflare Workers WebSocket 模式）。

  auth.ts 的內容：
  - import { betterAuth } from 'better-auth'
  - import { Pool } from '@neondatabase/serverless'
  - import { username, admin as adminPlugin } from 'better-auth/plugins'
  - export 一個 createAuth(env) function（因為 Cloudflare Workers 環境變數在 runtime 才有）
  - Better Auth 設定：
    * database: new Pool({ connectionString: env.DATABASE_URL })
    * secret: env.BETTER_AUTH_SECRET
    * baseURL: env.BETTER_AUTH_URL
    * emailAndPassword: { enabled: true, requireEmailVerification: false }
    * plugins: [username(), adminPlugin()]
    * user.additionalFields: { phone: { type: 'string', required: false }, orgId: { type: 'string', required: false } }
    * session.cookieCache: { enabled: true, maxAge: 5 * 60 }
    * advanced.database.tablePrefix: 'ba_'  (配合 migration 的 ba_ 前綴)

  同時更新 apps/api/wrangler.toml 的 [vars] 區塊，加入：
  BETTER_AUTH_URL = "http://localhost:8787"
  BETTER_AUTH_SECRET = "dev-secret-change-in-production"
  DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  (本機 Supabase 的直連 URL，port 54322)

  注意：supabase.ts 的 createSupabaseClient 和 createServiceClient 先保留，
  只新增一個 createServiceClientFromEnv(env) 便利函式。

  Angular/前端版本：Angular 21，TypeScript strict mode。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api
sandbox: workspace-write
```

**驗證：**
```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
npx tsc -p apps/api/tsconfig.json --noEmit
# 確認沒有 TypeScript 錯誤
```

**Commit:**
```bash
git add apps/api/src/auth.ts apps/api/src/lib/supabase.ts apps/api/wrangler.toml
git commit -m "feat(api): add Better Auth instance with PostgreSQL direct connection"
```

---

### Task 3.2：更新 API index.ts 和 AppEnv

**Files:**
- Modify: `apps/api/src/index.ts`

**先讀取現有檔案：**
```bash
cat /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/src/index.ts
```

**Codex 委派：**
```
prompt: |
  讀取 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/src/index.ts

  更新這個 Hono app 入口，做以下修改：

  1. 更新 Bindings 型別，加入 BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL，
     保留 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY（業務查詢用），
     移除 SUPABASE_ANON_KEY

  2. 在 app 路由加入 Better Auth handler（必須在其他路由之前）：
     app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
       const auth = createAuth(c.env)
       return auth.handler(c.req.raw)
     })

  3. 保留現有的 /api/subjects, /api/campuses, /api/courses, /api/staff routes

  4. 更新 AppEnv 型別定義（Variables 加入 orgId: string）

  tech: Hono, TypeScript strict, Cloudflare Workers
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api
sandbox: workspace-write
```

**Commit:**
```bash
git add apps/api/src/index.ts
git commit -m "feat(api): add Better Auth handler to Hono app"
```

---

## Phase 4：API - 重寫 Auth Middleware

### Task 4.1：重寫 auth middleware

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`

**Codex 委派：**
```
prompt: |
  完全重寫 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/src/middleware/auth.ts

  現有實作：用 Supabase JWT 驗證（supabase.auth.getUser()）
  目標：用 Better Auth session 驗證

  新的 auth.ts：

  1. import { createAuth } from '../auth'
  2. import { createServiceClientFromEnv } from '../lib/supabase'
  3. AuthVariables 型別改為：
     { userId: string; orgId: string; supabase: SupabaseClient }
     移除 user: User（Supabase User 型別）

  4. authMiddleware 邏輯：
     a. 從 request header 取得 Authorization: Bearer <token>
        或從 cookie 取得 better-auth.session_token
     b. 呼叫 createAuth(c.env).api.getSession({ headers: c.req.raw.headers })
     c. 若沒有 session → 401
     d. 有 session → 取得 session.user.id
     e. 用 service role supabase client 查詢 profiles 取得 orgId：
        const { data: profile } = await supabase
          .from('profiles')
          .select('org_id')
          .eq('id', session.user.id)
          .single()
     f. 若沒有 profile/orgId → 400 NO_ORG
     g. c.set('userId', session.user.id)
        c.set('orgId', profile.org_id)
        c.set('supabase', supabase)  // service role client

  重要：supabase client 改為 service role（不再用 user JWT），
  因為 RLS 已移除，業務資料過濾改由程式碼明確加 .eq('org_id', c.get('orgId')) 處理。

  tech: Hono middleware, TypeScript strict, Cloudflare Workers, Better Auth v1.3.x
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api
sandbox: workspace-write
```

**驗證：**
```bash
npx tsc -p apps/api/tsconfig.json --noEmit
```

**Commit:**
```bash
git add apps/api/src/middleware/auth.ts
git commit -m "feat(api): rewrite auth middleware to use Better Auth session"
```

---

## Phase 5：API - 更新 Routes

### Task 5.1：更新 4 個 routes（移除 Supabase auth 依賴）

**Files:**
- Modify: `apps/api/src/routes/campuses.ts`
- Modify: `apps/api/src/routes/courses.ts`
- Modify: `apps/api/src/routes/subjects.ts`
- Modify: `apps/api/src/routes/staff.ts`

**Codex 委派：**
```
prompt: |
  讀取以下四個檔案：
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/src/routes/campuses.ts
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/src/routes/courses.ts
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/src/routes/subjects.ts
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api/src/routes/staff.ts

  這些 routes 目前從 context 取得 supabase client 並用它做 DB 查詢。
  middleware 已改為注入 userId 和 orgId，supabase 是 service role client（無 RLS）。

  需要修改的地方：

  1. 所有 routes 中，取得 org_id 的方式從「查詢 profiles」改為直接 c.get('orgId')：
     舊：const { data: profile } = await supabase.from('profiles').select('org_id')...
     新：const orgId = c.get('orgId')

  2. 所有 routes 的 DB 查詢已經有 .eq('org_id', ...) 過濾，保持不變

  3. routes/staff.ts 中，建立 staff 帳號的部分：
     舊：用 supabase.auth.admin.inviteUserByEmail()
     新：改為以下方式（管理者建帳，不需要邀請）

     在 POST /staff route 中，建立帳號的邏輯改為：
     a. 用 Better Auth admin plugin 的 createUser API：
        呼叫 POST /api/auth/admin/create-user（HTTP call to self）
        或者直接用 createAuth(c.env).api.createUser()
     b. 產生隨機初始密碼（8 碼英數字混合）
     c. 將密碼明文回傳給前端（僅建帳時一次），讓管理者告知員工
     d. response 加入 initialPassword 欄位

  4. AppEnv 型別同步：確保 c.get('orgId') 有正確型別

  不要修改業務邏輯、route 定義、schema 驗證等其他部分。

  tech: Hono, @hono/zod-openapi, TypeScript strict, Better Auth admin plugin
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api
sandbox: workspace-write
```

**驗證：**
```bash
npx tsc -p apps/api/tsconfig.json --noEmit
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia && npm run dev:api
# 確認 wrangler dev 啟動無錯誤
curl http://localhost:8787/health
```

**Commit:**
```bash
git add apps/api/src/routes/
git commit -m "feat(api): update routes to use Better Auth session context"
```

---

## Phase 6：Angular - 重寫 AuthService

### Task 6.1：安裝 Better Auth client 並重寫 auth.service.ts

**Files:**
- Modify: `apps/web/src/app/core/auth.service.ts`
- Create: `apps/web/src/app/core/auth-client.ts`

**Codex 委派：**
```
prompt: |
  在 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web/src/app/core/ 做以下工作：

  1. 建立 auth-client.ts（Better Auth 的 singleton client）：

  import { createAuthClient } from 'better-auth/client'
  import { usernameClient, adminClient } from 'better-auth/client/plugins'
  import { environment } from '@env/environment'

  export const authClient = createAuthClient({
    baseURL: environment.apiUrl + '/api/auth',
    plugins: [usernameClient(), adminClient()],
  })

  export type Session = typeof authClient.$Infer.Session
  export type User = typeof authClient.$Infer.Session.user

  2. 完全重寫 auth.service.ts，保持相同的 Signal API（讓 guards 和 pages 改動最小）：

  需保留的 public signals/methods（介面不變）：
  - user: Signal<User | null>
  - profile: Signal<Profile | null>
  - roles: Signal<UserRole[]>
  - permissions: Signal<string[]>
  - activeRole: Signal<UserRole | null>
  - loading: Signal<boolean>
  - isAuthenticated: computed
  - showRolePicker: Signal<boolean>
  - signIn(emailOrPhone: string, password: string): Promise<string | null>
  - signOut(): Promise<void>
  - sendPasswordReset(email: string): Promise<string | null>
  - updatePassword(newPassword: string): Promise<string | null>
  - setActiveRole(role: UserRole): void
  - hasPermission(permission: string): boolean
  - openRolePicker() / closeRolePicker()
  - navigateToRoleShell(role: UserRole): void

  實作說明：
  - 移除 SupabaseService 依賴
  - 改用 authClient（from auth-client.ts）
  - init() 改為 authClient.getSession() 取得初始 session
  - session 監聽：authClient.oneTap 或 polling（Better Auth 沒有 onAuthStateChange，
    改用 interval check 或 reactive store）
    注意：Better Auth vanilla client 的 session 管理：
    - authClient.useSession() 不存在（那是 React hook）
    - 改用 authClient.$store（reactive store）或定期 refresh
    - 簡單方案：init() 時取一次 session，signIn/signOut 後手動更新 signals
  - loadProfile：user ID 取得後，呼叫 GET /api/me（需要 API 端提供）
    或直接呼叫 Supabase（透過 api.service.ts）
  - signIn：改用 authClient.signIn.email({ email, password })
    login page 傳入的是 email 或手機號碼（統一當 email 處理）
  - sendPasswordReset：authClient.forgetPassword({ email, redirectTo })
  - updatePassword：authClient.resetPassword({ newPassword, token })

  Angular 版本 21，使用 Signals（signal, computed, effect），inject() 模式，standalone。
  TypeScript strict mode。不使用 constructor injection，改用 inject()。

  請讀取現有的 auth.service.ts 確認現有介面後再實作。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web
sandbox: workspace-write
```

**驗證：**
```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
npx ng build --project web 2>&1 | head -50
# 確認沒有 TypeScript 錯誤
```

**Commit:**
```bash
git add apps/web/src/app/core/auth-client.ts apps/web/src/app/core/auth.service.ts
git commit -m "feat(web): rewrite AuthService using Better Auth vanilla client"
```

---

### Task 6.2：更新 auth.interceptor.ts

**Files:**
- Modify: `apps/web/src/app/core/auth.interceptor.ts`

**Codex 委派：**
```
prompt: |
  讀取 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web/src/app/core/auth.interceptor.ts

  現在改用 Better Auth session token，有兩種方案：

  方案 A（建議）：Better Auth 預設用 cookie，前端不需要手動帶 Authorization header，
  因為 cookie 會自動附帶。但要確保 HTTP client 設定 withCredentials: true。

  改為：
  import { HttpInterceptorFn } from '@angular/common/http'

  export const authInterceptor: HttpInterceptorFn = (req, next) => {
    // Better Auth 使用 cookie，只需確保 withCredentials
    const apiReq = req.url.includes('/api/')
      ? req.clone({ withCredentials: true })
      : req
    return next(apiReq)
  }

  Angular 21，TypeScript strict，functional interceptor。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web
sandbox: workspace-write
```

**Commit:**
```bash
git add apps/web/src/app/core/auth.interceptor.ts
git commit -m "feat(web): update auth interceptor for Better Auth cookie-based sessions"
```

---

## Phase 7：Angular - 更新 Login Pages

### Task 7.1：更新 login、forgot-password、reset-password、change-password

**Files:**
- Modify: `apps/web/src/app/features/public/pages/login/login.component.ts`
- Modify: `apps/web/src/app/features/public/pages/forgot-password/forgot-password.component.ts`
- Modify: `apps/web/src/app/features/public/pages/reset-password/reset-password.component.ts`
- Modify: `apps/web/src/app/features/public/pages/change-password/change-password.component.ts`

**先讀取現有檔案：**
```bash
cat /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web/src/app/features/public/pages/reset-password/reset-password.component.ts
cat /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web/src/app/features/public/pages/change-password/change-password.component.ts
```

**Codex 委派：**
```
prompt: |
  讀取以下四個檔案：
  - apps/web/src/app/features/public/pages/login/login.component.ts
  - apps/web/src/app/features/public/pages/forgot-password/forgot-password.component.ts
  - apps/web/src/app/features/public/pages/reset-password/reset-password.component.ts
  - apps/web/src/app/features/public/pages/change-password/change-password.component.ts

  這些 components 目前直接用 SupabaseService 或 AuthService 呼叫 Supabase Auth API。

  需要的修改：

  1. login.component.ts：
     - 確認使用 AuthService.signIn()（不直接呼叫 Supabase）
     - signIn 的第一個參數改名為 emailOrPhone（支援手機號碼登入）
     - label 改為「Email 或手機號碼」

  2. forgot-password.component.ts：
     - 確認使用 AuthService.sendPasswordReset()
     - 若有直接呼叫 Supabase，改為 AuthService 方法

  3. reset-password.component.ts：
     - 目前可能用 supabase.auth.onAuthStateChange 偵測 token
     - 改為從 URL query param 取得 token：
       new URLSearchParams(window.location.search).get('token')
     - 呼叫 AuthService.updatePassword(newPassword) 並帶入 token

  4. change-password.component.ts：
     - 確認使用 AuthService.updatePassword()
     - 若有直接呼叫 Supabase session，改為不需要（cookie 自動處理）

  移除所有 import { SupabaseService } 和直接 supabase.auth.* 呼叫。
  保留 AuthService 注入。
  Angular 21，Signals，TypeScript strict。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web
sandbox: workspace-write
```

**驗證：**
```bash
npx ng build --project web 2>&1 | head -50
```

**Commit:**
```bash
git add apps/web/src/app/features/public/pages/
git commit -m "feat(web): update auth pages for Better Auth flow"
```

---

## Phase 8：Angular - 更新 Guards 和 Shell

### Task 8.1：確認 guards 和 shell 相容性

**Files:**
- Review: `apps/web/src/app/core/auth.guard.ts`
- Review: `apps/web/src/app/core/guest.guard.ts`
- Review: `apps/web/src/app/core/role.guard.ts`
- Review: `apps/web/src/app/core/permission.guard.ts`
- Review: `apps/web/src/app/features/select-role/select-role.component.ts`
- Review: `apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.ts`

**Codex 委派：**
```
prompt: |
  讀取以下 Angular 檔案：
  - apps/web/src/app/core/auth.guard.ts
  - apps/web/src/app/core/guest.guard.ts
  - apps/web/src/app/core/role.guard.ts
  - apps/web/src/app/core/permission.guard.ts
  - apps/web/src/app/features/select-role/select-role.component.ts
  - apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.ts

  這些檔案都使用 AuthService（inject(AuthService)）。
  AuthService 已重寫，但保留了相同的 public signals API：
  - isAuthenticated: Signal<boolean>
  - loading: Signal<boolean>
  - activeRole: Signal<UserRole | null>
  - roles: Signal<UserRole[]>

  請確認：
  1. 若這些檔案只使用上述 public signals 且沒有直接 import SupabaseService，不需要修改
  2. 若有使用已移除的 Supabase 特定 API（如 supabase.auth.*），則修正
  3. 若有 import { User } from '@supabase/supabase-js'，改為 import type { User } from '../auth-client'

  只修改真正需要改的地方，不要重寫正常的程式碼。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web
sandbox: workspace-write
```

**Commit:**
```bash
git add apps/web/src/app/core/ apps/web/src/app/features/select-role/ apps/web/src/app/shared/
git commit -m "fix(web): update guards and shell to use Better Auth compatible types"
```

---

## Phase 9：更新 Shared Packages

### Task 9.1：更新 shared-types 和 validators

**Files:**
- Modify: `packages/shared-types/src/index.ts`
- Modify: `packages/validators/src/index.ts`

**Codex 委派：**
```
prompt: |
  讀取以下兩個檔案：
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/packages/shared-types/src/index.ts
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/packages/validators/src/index.ts

  1. shared-types/src/index.ts 的 User interface：
     將 email: string 改為 email?: string | null
     加入 phone?: string | null
     加入 username?: string | null

  2. validators/src/index.ts 的 loginSchema：
     現在是：{ email: z.email(), password: z.string() }
     改為支援 email OR 手機號碼：
     { emailOrPhone: z.string().min(1, '請輸入 Email 或手機號碼'), password: z.string().min(6, ...) }
     export type LoginInput = z.infer<typeof loginSchema>

  3. forgotPasswordSchema：
     保持 email required（忘記密碼只支援有 email 的帳號）

  TypeScript strict mode。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
sandbox: workspace-write
```

**Commit:**
```bash
git add packages/
git commit -m "feat(shared): update types and validators for Better Auth"
```

---

## Phase 10：更新環境設定

### Task 10.1：更新 Angular 環境設定

**Files:**
- Modify: `apps/web/src/environments/environment.ts`
- Modify: `apps/web/src/environments/environment.production.ts`

**Codex 委派：**
```
prompt: |
  讀取：
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web/src/environments/environment.ts
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web/src/environments/environment.production.ts

  修改：
  1. environment.ts：
     - 保留 apiUrl: 'http://localhost:8787'
     - 保留 turnstileSiteKey
     - 移除 supabase: { url, anonKey }（前端不再直接連 Supabase）

  2. environment.production.ts：同上，移除 supabase config

  注意：前端已不需要 Supabase anon key，所有 DB 操作都透過 API。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web
sandbox: workspace-write
```

**Commit:**
```bash
git add apps/web/src/environments/
git commit -m "feat(web): remove Supabase config from environments"
```

---

## Phase 11：移除 SupabaseService

### Task 11.1：移除或降級 supabase.service.ts

**Files:**
- Modify: `apps/web/src/app/core/supabase.service.ts`

**Codex 委派：**
```
prompt: |
  讀取 /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web/src/app/core/supabase.service.ts

  搜尋整個前端（apps/web/src/app/ 目錄）還有哪些檔案 import SupabaseService：
  只有 auth.service.ts（舊版）和直接使用的頁面。

  由於 auth.service.ts 已重寫且不再使用 SupabaseService，
  請確認是否還有其他 component 直接 inject(SupabaseService)。

  如果沒有其他地方用到：
  - 清空 SupabaseService 的實作，改為空的 stub 或直接刪除
  - 如果有任何地方還在用（除了 auth.service.ts），先列出來不要刪

  注意：前端服務（campuses.service.ts, staff.service.ts 等）使用的是 ApiService（HTTP），
  不是直接用 SupabaseService，所以應該不受影響。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web
sandbox: workspace-write
```

**Commit:**
```bash
git add apps/web/src/app/core/supabase.service.ts
git commit -m "refactor(web): remove SupabaseService dependency"
```

---

## Phase 12：更新文件

### Task 12.1：更新 AI agent 指引文件

**Files:**
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`
- Modify: `AGENTS.md`
- Modify: `doc/AGENT_GUIDE.md`

**Codex 委派：**
```
prompt: |
  讀取以下四個檔案：
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/CLAUDE.md
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/GEMINI.md
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/AGENTS.md
  - /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/doc/AGENT_GUIDE.md

  在 CLAUDE.md、GEMINI.md、AGENTS.md 中做以下修改：

  1. Tech Stack 表格的 Backend 欄位：
     舊：Supabase (Auth, PostgreSQL, RLS, Edge Functions)
     新：Better Auth (Auth) + Supabase (PostgreSQL only)

  2. Supabase / SQL 編碼規範章節：
     - 移除：「所有表都啟用 RLS」
     - 移除：「Trigger-based automation (e.g. auto-create profile on signup)」
     - 新增：「Better Auth 管理 user/session/account tables（前綴 ba_）」
     - 新增：「業務表不使用 RLS，授權邏輯在 Hono middleware 層」
     - 新增：「新增用戶透過 Better Auth admin.createUser()，不直接寫 auth.users」

  在 doc/AGENT_GUIDE.md 中：
  - 找到 auth 相關描述並更新為 Better Auth 架構
  - 若有提到 inviteUserByEmail，改為 Better Auth createUser 流程

  只修改與 auth 相關的部分，保留其他內容不變。
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
sandbox: workspace-write
```

**Commit:**
```bash
git add CLAUDE.md GEMINI.md AGENTS.md doc/AGENT_GUIDE.md
git commit -m "docs: update tech stack and auth architecture docs for Better Auth"
```

---

### Task 12.2：更新 spec 文件

**Files:**
- Modify: `doc/specs/public/login.md`
- Modify: `doc/specs/admin/system/staff.md`
- Modify: `doc/specs/admin/student-affairs/parents.md`

**Codex 委派：**
```
prompt: |
  讀取並更新以下規格文件：

  1. doc/specs/public/login.md：
     - 登入欄位改為「Email 或手機號碼」
     - 說明：無 email 的家長用手機號碼（格式 09xxxxxxxx）登入
     - 密碼重設：有 email 才能自助重設，其他請聯絡管理者

  2. doc/specs/admin/system/staff.md：
     - 建立帳號流程改為：Better Auth admin.createUser()，系統產生初始密碼
     - 初始密碼由管理者告知員工（不再發送 email 邀請）
     - 移除 inviteUserByEmail 相關說明

  3. doc/specs/admin/student-affairs/parents.md：
     - 補充驗證與登入設計章節（如先前討論的設計）：
       * 有 email → email + 密碼
       * 只有手機 → 手機號碼 + 密碼（後端 username 欄位存手機）
       * 忘記密碼：有 email → Magic Link；沒有 → 聯絡管理者
       * 帳號建立：管理者後台建立，系統產生初始密碼，不需要 SMS OTP
workingDirectory: /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
sandbox: workspace-write
```

**Commit:**
```bash
git add doc/specs/
git commit -m "docs: update specs for Better Auth login and account management"
```

---

## Phase 13：整合驗證

### Task 13.1：啟動全部服務並驗證

**步驟：**

```bash
# 1. Reset DB
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
supabase db reset

# 2. 啟動 API
npm run dev:api
# 確認 http://localhost:8787/health 回傳 {"healthy": true}

# 3. 測試 Better Auth 登入
curl -X POST http://localhost:8787/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@demo.clessia.app", "password": "password123"}'
# 期望：200 + session cookie

# 4. 測試受保護 API
curl http://localhost:8787/api/campuses \
  -H "Cookie: <session cookie from above>"
# 期望：200 + campuses list

# 5. 啟動前端
npm run dev:web
# 確認 http://localhost:4200 正常載入

# 6. 測試前端登入
# 瀏覽器打開 http://localhost:4200/login
# 輸入 admin@demo.clessia.app + password123
# 確認成功導向 /admin
```

### Task 13.2：Build 驗證

```bash
npx ng build --project web
# 確認 build 成功，無 TypeScript 錯誤

npx wrangler deploy --dry-run --env development
# 確認 API build 成功
```

---

## 注意事項

### Supabase JS Client 角色轉變
遷移後 `@supabase/supabase-js` 只用於業務資料查詢：
- API 端：`createServiceClientFromEnv(env)` — service role key，無 RLS
- 前端：完全移除（所有 DB 操作改為透過 API）

### supabase/config.toml
Supabase Auth 設定保留（本機開發 `supabase start` 需要），但系統不再使用它。
可選擇性地關閉 email/phone providers 以減少資源使用。

### 未來擴充
- LINE OAuth：Better Auth 社群 plugin 出現時，在 `apps/api/src/auth.ts` 的 `plugins[]` 加入即可
- Admin TOTP 2FA：Better Auth `twoFactor()` plugin 已設定，前端 enable 即可
- 手機登入 UX：login page 已支援「手機號碼」輸入，後端將其視為 username 處理
