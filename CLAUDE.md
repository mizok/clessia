# Clessia - 學程管家

你是一名資深的全端開發者, 你只會用繁體中文來回應, 你要開發一個名為Clessia的補習班管理系統：管理端優先，支援多分校（一個組織、多個校區）。

## Tech Stack

| Layer     | Technology                                                              |
| --------- | ----------------------------------------------------------------------- |
| Frontend  | Angular 21 (Standalone Components + Signals)                            |
| UI        | PrimeNG 21 + PrimeIcons + `@primeuix/themes` Aura                       |
| Backend   | Better Auth (Auth) + Supabase (PostgreSQL, Storage)                     |
| Deploy    | Vercel                                                                  |
| Utilities | date-fns, xlsx, pdfmake, angularx-qrcode, html5-qrcode, Toast UI Editor |

## 開發流程

**重要**：開發新功能前，必須遵循 [`doc/AGENT_GUIDE.md`](doc/AGENT_GUIDE.md) 的流程。

核心要點：
1. **Phase 0**：先調查環境（版本、設定、現有風格）
2. **分階段驗證**：每階段完成後驗證才能繼續
3. **Codex 委派**：必須指定 `sessionId`，prompt 須包含版本資訊
4. **UI 開發**：必須先參考設計系統，invoke `ui-ux-pro-max` skill

## Claude Code 工作策略

當前 repo 已安裝 `code-review-graph`，Claude Code 在處理此專案時必須優先使用 graph MCP 工具，而不是先大範圍掃描檔案。

### 預設工作順序

1. 先呼叫 `get_minimal_context`，用任務描述當 `task`
2. 若是 review 目前變更，依序優先用 `detect_changes`、`get_affected_flows`、`query_graph`
3. 若是找功能或追邏輯，優先用 `semantic_search_nodes`、`query_graph`
4. 只有在 graph 結果不足時，才用 Grep/Glob/Read 打開少量精準檔案
5. 完成分析後再提出結論，不要先憑印象猜

### Review 規則

- Review 當前 branch 或未提交改動時，先用 `detect_changes`
- 對高風險節點，再用 `query_graph` 的 `tests_for`、`callers_of`、`callees_of`
- 只讀取 graph 指向的相關檔案與行段，不要先通讀整個 feature

### 實作與除錯規則

- 修改前先用 graph 確認呼叫鏈、依賴與波及面
- 如果 graph 顯示資料過舊或查不到新符號，先執行 `code-review-graph update --skip-flows`
- 若 `.code-review-graph/graph.db` 不存在或明顯失效，才執行 `code-review-graph build`

### Angular 專案特別注意

- 找 route、shell、guard、service 關聯時，先用 graph，再讀 `app.routes.ts` 與對應 feature 檔案
- 變更 component / service / guard 前，先確認其 callers、imports、tests，避免只改到表層

## 文件目錄規則

**所有文件必須放在 `doc/` 目錄下，禁止另起 `docs/` 或其他平行目錄。**

| 類型 | 路徑 |
|------|------|
| 功能規格 | `doc/specs/<角色>/<功能>.md` |
| 流程圖 | `doc/flows/<功能>.md` |
| 業務規則 | `doc/rules/<功能>-rules.md` |
| Superpowers 實作計畫 | `doc/superpowers/plans/<日期>-<功能>.md` |
| Superpowers 技術設計 | `doc/superpowers/specs/<日期>-<功能>-design.md` |

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
- 業務表不使用 RLS，授權邏輯在 Hono middleware 層（org_id 過濾）
- 使用 enum types for fixed value sets (e.g. `user_role`)
- Better Auth 管理 user/session/account tables（前綴 ba_），不要手動修改
- 新增用戶透過 Better Auth admin.createUser() API，不直接寫 ba_user

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
| 管理者   | `admin`   | 最高權限，跨分校管理、系統設定、日常營運 |
| 任課老師 | `teacher` | 課表、點名、學生學習紀錄                 |
| 家長     | `parent`  | 查看孩子出缺席、學習進度、繳費           |

### 多重角色

- 一個使用者**可同時擁有多個角色**（例如：既是行政老師也是任課老師）
- DB 使用 `user_roles` junction table（非單一 enum 欄位），需重構目前的 `profiles.role`
- 登入後若有多重角色 → 先進入**角色選擇頁** (`/select-role`)，讓使用者選擇要進入的角色介面
- 若只有單一角色 → 跳過選擇頁，直接導向對應 shell
- 選定的角色存在 `AuthService.activeRole` signal，可隨時切換

### Shell 對應

| 路由                                             | Shell                   | 角色             | 說明                                   |
| ------------------------------------------------ | ----------------------- | ---------------- | -------------------------------------- |
| `/login`, `/trial`, `/enrollment`, `/qr-checkin` | `PublicShellComponent`  | 無需登入         | 雙欄佈局（brand sidebar + content）    |
| `/select-role`                                   | —                       | 已登入、多重角色 | 角色選擇頁                             |
| `/admin/**`                                      | `AdminShellComponent`   | `admin`          | 管理佈局（header + sidebar + content） |
| `/teacher/**`                                    | `TeacherShellComponent` | `teacher`        | 課表、點名為主的簡潔佈局               |
| `/parent/**`                                     | `ParentShellComponent`  | `parent`         | mobile-first 閱讀佈局                  |

### 目錄結構

```text
src/app/
├── core/                  # Singleton（整個 app 只有一份）
│   ├── auth.service.ts        # Auth 狀態 + signIn/signOut + activeRole
│   ├── auth.guard.ts          # 登入檢查
│   ├── role.guard.ts          # 角色權限檢查
│   └── supabase.service.ts    # Supabase client wrapper
│
├── shared/                # 跨角色共用（被多個 feature 引用時才建立）
│   ├── components/
│   ├── directives/
│   └── pipes/
│
├── features/              # 依角色分 shell
│   ├── public/                # 公開頁（無需登入）
│   │   ├── public-shell.*
│   │   └── pages/
│   ├── select-role/           # 角色選擇頁（多重角色時）
│   ├── admin/                 # 負責人 / 管理者 / 行政老師
│   │   ├── admin-shell.*
│   │   └── pages/
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

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
