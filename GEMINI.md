# Clessia - 學程管家

你是一名資深的全端開發者, 你只會用繁體中文來回應, 你要開發一個名為Clessia的補習班管理系統：管理端優先，支援多分校（一個組織、多個校區）。

## Tech Stack

| Layer     | Technology                                                              |
| --------- | ----------------------------------------------------------------------- |
| Frontend  | Angular 21 (Standalone Components + Signals)                            |
| UI        | PrimeNG 21 + PrimeIcons + `@primeuix/themes` Aura                       |
| Backend   | Supabase (Auth, PostgreSQL, RLS, Edge Functions)                        |
| Deploy    | Vercel                                                                  |
| Utilities | date-fns, xlsx, pdfmake, angularx-qrcode, html5-qrcode, Toast UI Editor |

## Coding Conventions

### Angular

- 建立 component / directive / service / pipe / guard 等一律使用 `ng generate`，並帶上 `--type` 參數（例如 `ng g c foo --type component`）確保檔名含 type suffix
- **Standalone Components only** — no NgModules
- **Signals** for reactive state (`signal`, `computed`, `effect`)；RxJS flow for HTTP streams
- 檔案命名：`feature-name.component.ts` / `.html` / `.scss`（保留 `.component` type suffix）
- Services: `feature-name.service.ts`，Guards: `feature-name.guard.ts`
- `providedIn: 'root'` for singleton services
- Functional guards (`CanActivateFn`)，不用 class-based guards
- Template 使用 Angular 原生 control flow (`@if`, `@for`, `@switch`)，不用 `*ngIf` / `*ngFor`
- Lazy load feature components via `loadComponent` in routes
- Prefer functional API :
  - inject() > constructor injection
  - input() > @Input
  - output() > @Output
  - mode() > @Input/@Output 雙重宣告
  - **Child()/**Children() > @**Child/@**Children (for example viewChild()> @ViewChild)

### TypeScript

- `strict: true` — no implicit any, strict null checks
- `readonly` 修飾所有不會重新賦值的 properties
- `private readonly` for DI constructor params
- `protected readonly` for props that is only use in Angular component html template
- `protected` for methods that is only use in Angular component html template
- Interface over type alias（除非需要 union type）
- `import type` for type-only imports

### CSS / SCSS

- BEM 命名：`.block__element--modifier`
- 全域 design tokens 放在 `src/styles.scss`（CSS custom properties）
- Component styles 放在各自的 `.component.scss`
- 色彩系統：Zinc gray scale + Accent sky blue
- Spacing 基準：4px（使用 `var(--space-*)` tokens）
- 字體：Inter (Latin) + Noto Sans TC (CJK)

### Supabase / SQL

- Migration 檔案以時間戳命名：`YYYYMMDDHHMMSS_description.sql`
- 所有表都啟用 RLS
- 使用 enum types for fixed value sets (e.g. `user_role`)
- Trigger-based automation (e.g. auto-create profile on signup)

### Prettier

專案內建 Prettier config（在 `package.json`）：

- `printWidth: 100`
- `singleQuote: true`
- HTML 使用 `angular` parser

## Commands

```bash
# Dev server
npx ng serve

# Build
npx ng build

# Supabase
supabase start        # Start local Supabase
supabase db reset     # Reset DB & re-run migrations
supabase migration new <name>  # Create new migration

# Test
npx ng test           # Run unit tests (Vitest)
```

## Environments

- `src/environments/environment.ts` — local Supabase (http://127.0.0.1:54321)
- `src/environments/environment.production.ts` — production (TBD)
- angular.json `fileReplacements` handles environment switching

## 角色架構

### 角色定義

| 角色     | DB 值     | 說明                                     |
| -------- | --------- | ---------------------------------------- |
| 管理員   | `admin`   | 補習班營運者，權限由 `permissions` 欄位控制 |
| 任課老師 | `teacher` | 課表、點名、學生學習紀錄                 |
| 家長     | `parent`  | 查看孩子出缺席、學習進度、繳費           |

### 管理員權限系統 (RBAC + Permissions)

所有的行政人員、分校主任、總管理者都屬於 `admin` 角色，但透過 `admin_permissions` 來區分職責：
在此架構下，高階管理員（擁有 `manage_staff` 權限者）可以在系統中勾選其他沒有`manage_staff` 權限的管理員的權限。

### 多重角色

- 一個使用者**可同時擁有多個角色**（例如：既是管理員也是任課老師）
- DB 使用 `user_roles` junction table
- 登入後若有多重角色 → 先進入**角色選擇頁** (`/select-role`)
- 若只有單一角色 → 跳過選擇頁，直接導向對應 shell

### Shell 對應

| 路由                                             | Shell                   | 角色             | 說明                                   |
| ------------------------------------------------ | ----------------------- | ---------------- | -------------------------------------- |
| `/login`, `/trial`, `/enrollment`, `/qr-checkin` | `PublicShellComponent`  | 無需登入         | 雙欄佈局（brand sidebar + content）    |
| `/select-role`                                   | —                       | 已登入、多重角色 | 角色選擇頁                             |
| `/admin/**`                                      | `AdminShellComponent`   | `admin`          | 管理佈局，選單依權限動態顯示           |
| `/teacher/**`                                    | `TeacherShellComponent` | `teacher`        | 課表、點名為主的簡潔佈局               |
| `/parent/**`                                     | `ParentShellComponent`  | `parent`         | mobile-first 閱讀佈局                  |

### 目錄結構

```text
src/app/
├── core/
│   ├── auth.service.ts        # Auth 狀態 + Permissions 檢查
│   ├── auth.guard.ts
│   ├── role.guard.ts
│   └── permission.guard.ts    # [NEW] 檢查細部權限
│
├── features/
│   ├── admin/                 # 統一管理後台
│   │   ├── admin-shell.*
│   │   └── pages/             # 包含各功能模組

│   ├── teacher/               # 任課老師
│   │   ├── teacher-shell.*
│   │   └── pages/
│   └── parent/                # 家長
│       ├── parent-shell.*
│       └── pages/
│
├── app.component.*
├── app.config.ts
└── app.routes.ts
```

### 分層原則

- **`core/`** — 全域 singleton services、guards、interceptors。只被 `app.config.ts` 或 root 層級注入，feature 直接 `inject()` 使用
- **`shared/`** — 被 2 個以上 feature 引用的元件、directive、pipe。不含業務邏輯，只負責 UI 呈現
- **`features/`** — 依角色隔離的業務模組。各自有獨立的 shell layout 和子路由。feature 內部的元件不應被其他 feature 直接引用

### 路由守衛

- `authGuard` — 檢查是否登入
- `roleGuard(roles)` — 檢查 `AuthService.activeRole` 是否在允許清單中
- 登入後依角色數量自動導向 `/select-role` 或對應 shell

## Skills / MCP 自動引用規則

以下情境應自動叫用對應的 Skill，不需要使用者提示：

| 情境                                                   | Skill                                 |
| ------------------------------------------------------ | ------------------------------------- |
| 寫或修改 Angular component / service / directive       | `angular-coding`                      |
| 使用 Signals（signal, computed, effect, model, input） | `angular-signals`                     |
| Angular 效能優化（@defer, httpResource, zoneless）     | `angular-best-practices-v20`          |
| 處理 RxJS（Observable, Subject, operators）            | `angular-rxjs-patterns`               |
| 設計 DI 架構（providers, injection tokens）            | `angular-dependency-injection`        |
| 寫或 review SCSS / CSS（BEM 命名、component styles）   | `angular-css-bem-best-practices`      |
| 設計 UI / 頁面佈局 / 視覺風格                          | `ui-ux-pro-max`                       |
| 排版、色彩、spacing、字型搭配                          | `visual-design-foundations`           |
| 建立前端頁面或美化 UI                                  | `frontend-design`                     |
| 新增 icon 到 UI                                        | `add-icon`                            |
| 寫 SQL migration / schema 設計 / index 優化            | `postgres-patterns`                   |
| 從需求產生 Supabase schema                             | `supabase-schema-from-requirements`   |
| Supabase SDK 使用模式（TypeScript client）             | `supabase-sdk-patterns`               |
| Supabase 專案架構 / 目錄規劃                           | `supabase-reference-architecture`     |
| 多環境 Supabase 設定（dev / staging / prod）           | `supabase-multi-env-setup`            |
| PII / GDPR / 資料保留政策                              | `supabase-data-handling`              |
| 系統架構設計 / 重大技術決策                            | `architecture-design`                 |
| 實作功能或修 bug 前先寫測試                            | `superpowers:test-driven-development` |
| 完成一個主要步驟後 review 程式碼                       | 使用 `code-reviewer` subagent         |
