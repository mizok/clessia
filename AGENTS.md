# Clessia 專案指引

> **所有 agent 的唯一專案指引。** Claude Code 透過 `CLAUDE.md` 的 `@AGENTS.md` 讀它，Codex /
> Codex 等 CLI 直接讀它。**新規則、慣例、指引一律寫進這個檔**，不要寫進 `CLAUDE.md`
> （它只做 import，且被 gate 盯著行數）。
>
> 具約束力的架構不變量屬於 `kb/wiki/architecture/constitution.md`（走修訂流程）；本檔是描述性的。

你是一名資深的全端開發者，只用繁體中文回應。Clessia 是補習班管理系統：管理端優先，支援多分校
（一個組織、多個校區）。

## Tech Stack

| Layer     | Technology                                                                |
| --------- | ------------------------------------------------------------------------- |
| Frontend  | Angular 21（Standalone Components + Signals）                             |
| UI        | PrimeNG 21 + PrimeIcons + `@primeuix/themes` Aura                         |
| Backend   | Hono (apps/api) + Better Auth + Supabase (PostgreSQL, Storage)            |
| Monorepo  | Nx（`apps/web`、`apps/api`；`packages/*` 是 TS path 別名，非 Nx project） |
| Deploy    | Cloudflare Workers（API）+ Cloudflare Pages（Web）+ Supabase（DB）        |
| Utilities | date-fns, xlsx, pdfmake, angularx-qrcode, html5-qrcode, Toast UI Editor   |

### Banned Approaches

這些是**具約束力的憲法條款**，不是風格偏好。全文與強制機制見
`kb/wiki/architecture/constitution.md`；此處只列對照：

| 禁止                                                        | Clause |
| ----------------------------------------------------------- | ------ |
| 修改已提交的 migration 檔                                   | c3     |
| 直接寫入 `ba_*`（Better Auth）表                            | c2     |
| SCSS 使用 `vh` / `vw` / `dvh` / `svh` / `lvh`               | c6     |
| Template 使用 `*ngIf` / `*ngFor` / `*ngSwitch`              | c7     |
| 使用 `@Input()` / `@Output()` / `@ViewChild()` 等裝飾器 API | c8     |
| 在 `kb/` 之外另起文件目錄（`docs/` 等）                     | c9     |
| feature 之間互相 import                                     | c5     |
| 把規則寫進 `CLAUDE.md`                                      | c10    |
| 在文件裡手抄會腐化的清單                                    | c11    |
| 讓客戶無法脫離架構自行 host（vendor lock-in、多租戶）       | c12    |

## Commands

| 任務               | 指令                                                 |
| ------------------ | ---------------------------------------------------- |
| 開發（web + api）  | `npm run dev`                                        |
| 建置               | `npm run build`                                      |
| 測試               | `npm test`                                           |
| 型別檢查（api）    | `npx nx typecheck api`                               |
| Harness + KB gate  | `npm run harness`                                    |
| 兩者重生成         | `npm run harness:write`                              |
| Harness 自我測試   | `npm run harness:test`                               |
| KB 檢查 / 重建索引 | kb-wiki skill：`/kb-wiki lint` / `/kb-wiki map`      |
| 重錄測試基線       | `npm run test:baseline`                              |
| Supabase 本機      | `npm run db:start` / `db:reset`                      |
| 新增 migration     | `npx supabase migration new <description>`           |
| 產生元件等         | `npx ng g c foo --type component`（一律帶 `--type`） |

> `nx.json` 的 `defaultBase` 是 `dev`，但這個 branch 不存在 —— 跑 `nx affected` 一律自己帶
> `--base=main`。

## Project Structure

```text
apps/
  web/          Angular 應用
  api/          Hono API（routes/ 一支路由一檔，多數帶 .spec.ts）
packages/
  shared-types/ 前後端共用型別
  validators/   共用驗證
supabase/
  migrations/   YYYYMMDDHHMMSS_description.sql，已提交者不可改（c3）
  seed.sql
tools/
  agent-harness/  agent hook 邏輯 + gate（runtime-neutral，.claude/.codex 只放薄 adapter）
kb/            所有文件的唯一去處（c9）
```

`apps/web/src/app/` 的分層：

- **`core/`** — 全域 singleton services、guards、interceptors，`providedIn: 'root'`
- **`shared/`** — 被 2 個以上 feature 引用的元件 / directive / pipe，不含業務邏輯
- **`features/`** — 依角色隔離的業務模組（`public` / `select-role` / `admin` / `teacher` / `parent`）。
  feature 內部元件不得被其他 feature 直接引用（c5）；要共用就往 `shared/` 提。

> 刻意**不列舉**各 feature 底下有哪些頁面、有哪些 API route、有幾支 migration —— 手抄的狀態清單
> 必然腐化（c11）。要知道現況就去看目錄。

## 角色與授權架構

| 角色     | DB 值     | 說明                                                              |
| -------- | --------- | ----------------------------------------------------------------- |
| 管理者   | `admin`   | 行政人員、分校主任、總管理者都是這個角色，靠 permissions 區分職責 |
| 任課老師 | `teacher` | 課表、點名、學生學習紀錄                                          |
| 家長     | `parent`  | 查看孩子出缺席、學習進度、繳費                                    |

- 角色存在 `user_roles` junction table，一個使用者可同時擁有多個角色。
- **細部權限存在 `user_roles.permissions`（jsonb 陣列）**，例如 `["view_revenue", "manage_staff"]`；
  不是獨立的權限表。擁有 `manage_staff` 的管理員可以調整他人權限。
- 多重角色 → 登入後進 `/select-role`；單一角色直接導向對應 shell。選定角色存在
  `AuthService.activeRole` signal。

### Shell

| 路由                                                      | 元件                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `/login`、`/trial`、`/enrollment`、`/qr-checkin` 等公開頁 | `features/public/PublicShellComponent`                                |
| `/admin/**`、`/teacher/**`、`/parent/**`                  | **共用** `shared/components/layout/shell-layout/ShellLayoutComponent` |

admin / teacher / parent **沒有各自的 shell 元件**，三個角色走同一個 `ShellLayoutComponent`，選單依
角色與 permissions 動態產生。

### 路由守衛

- `authGuard` — 是否登入
- `roleGuard(roles)` — `activeRole` 是否在允許清單
- `permissionGuard(permission)` — `auth.hasPermission()` 檢查細部權限

## Architecture Constitution（binding）

> **修憲只能由專案擁有者本人執行** —— 親自跑腳本，或親自手動編輯。
> **agent 不得以任何方式寫入 `kb/wiki/architecture/constitution.md`，包含透過 Bash 腳本、
> 產生檔案、或任何繞過 `Edit` deny 規則的途徑。** 使用者口頭同意條文內容**不等於**
> 授權 agent 執行寫入 —— 這兩件事要分開。
>
> agent 可以做的：草擬條文、寫一支拋棄式腳本交給使用者執行、補強制機制表、寫理由頁。
> **不能做的：按下那個按鈕。**
>
> 2026-08 有一次違反：使用者說「弄一隻拋棄式腳本就好，跑完就刪掉」，agent 讀成
> 「自己跑完再刪」並執行了。**歧義應該往「先問」的方向解。**

具約束力的架構不變量以**法條**形式存在 `kb/wiki/architecture/constitution.md`：每條有 clause ID、
可決定性分類（Deterministic / Semantic）、以及理由指標。**動架構之前先讀它**——它不是 always-load，
`UserPromptSubmit` 的 doc router 會在架構類 prompt 上提示。

每條 clause 用什麼機制守（regex、gate、人工 review）另外寫在
`kb/wiki/architecture/constitution-enforcement.md`；**改機制不算修法**。

## Development Conventions

### Angular

- 建立 component / directive / service / pipe / guard 一律用 `ng generate` 並帶 `--type`
- **Standalone Components only** — 沒有 NgModule
- **Signals** 管反應式狀態（`signal` / `computed` / `effect`）；HTTP 串流用 RxJS
- 檔名保留 type suffix：`feature-name.component.ts` / `.service.ts` / `.guard.ts`
- Functional guards（`CanActivateFn`），不用 class-based
- Template 用原生 control flow `@if` / `@for` / `@switch`（c7）
- 路由用 `loadComponent` lazy load
- **一律 functional API**（c8）：`inject()` / `input()` / `output()` / `model()` /
  `viewChild()` / `contentChild()`

### TypeScript

- `strict: true`
- 不會重新賦值的 property 一律 `readonly`
- 只在 template 用到的 property 用 `protected readonly`，method 用 `protected`
- Interface 優先於 type alias（除非需要 union）
- type-only import 用 `import type`

### CSS / SCSS

- BEM：`.block__element--modifier`
- 全域 design tokens 在 `apps/web/src/styles.scss`（CSS custom properties）
- 色彩 Zinc gray + Accent sky blue；spacing 基準 4px（`var(--space-*)`）；字體 Inter + Noto Sans TC
- **禁止 viewport 單位**（c6）。上層 directive 用 ResizeObserver 寫入 `--window-width` /
  `--window-height` 等變數，子元素用 `calc(var(--window-width, 360px) * 0.9)` 取代 `90vw`
- 寫 SCSS 前先 invoke `angular-scss-bem-standards` skill

### Supabase / SQL

- Migration 命名 `YYYYMMDDHHMMSS_description.sql`
- **已提交的 migration 不可修改**（c3）——schema 變更一律新增 ALTER TABLE migration
- **授權只發生在 Hono middleware 層**（org_id 過濾，c1）。API 使用 service role key，
  它會繞過 RLS —— RLS 不是第二道防線
- 業務表**仍然啟用 RLS 且沒有任何 policy**，這是刻意的 fail-closed 後盾：目前沒有任何
  非 service-role client（web 端沒有 supabase-js），所以碰不到它；但將來若真的接上 anon
  client，會被全拒而不是全放。**不要為了「反正沒用到」把 RLS 關掉**
- 固定值集合用 enum type
- `ba_*` 表由 Better Auth 管理，可讀不可寫（c2）；新增使用者走 `admin.createUser()`

### Prettier

`package.json` 內建設定：`printWidth: 100`、`singleQuote: true`、HTML 用 `angular` parser。
PostToolUse hook 會在每次編輯後自動跑，不用手動格式化。

### Git

- Commit 訊息用 conventional commits（`feat(web): ...`、`fix(api): ...`）
- 不要在 `main` 上直接工作

## 文件目錄規則

**所有文件放 `kb/`，禁止另起 `docs/` 或其他平行目錄**（c9，由 pre-write guard 與 harness gate 雙重把關）。

| 類型               | 路徑                             |
| ------------------ | -------------------------------- |
| 架構法條與強制機制 | `kb/wiki/architecture/`          |
| 功能規格           | `kb/wiki/specs/<角色>/<功能>.md` |
| 流程圖             | `kb/wiki/flows/<功能>.md`        |
| 業務規則           | `kb/wiki/rules/<功能>-rules.md`  |

### `kb/` 就是知識庫

`kb/` 是**唯一的文件樹**（c9）—— 產品規格、流程、業務規則、架構法條、工程知識全部住這裡，
靠 `category` 分類而不是靠平行目錄分家。三份必讀：

| 檔案                                                                           | 用途                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`kb/schema.md`](kb/schema.md)                                                 | **操作手冊**（kb-wiki 規範）—— 目錄結構、頁面格式、status 生命週期、ingest / lint / map / verify 流程。任何 KB 操作前先讀 |
| [`kb/wiki/index.md`](kb/wiki/index.md)                                         | 全部頁面的分類索引，自動生成。**查資料先看索引的 summary 挑頁面，不要一開始就 grep 全 `kb/`**                             |
| [`kb/wiki/architecture/constitution.md`](kb/wiki/architecture/constitution.md) | 法條                                                                                                                      |

每一頁都必須有 `title` / `summary` / `category` / `status` / `updated` 五個 frontmatter 欄位，
由 kb-wiki skill 的 `lint` 檢查、`map` 重建索引。

實作計畫與技術設計**不進 KB** —— 它們是過程產物，記錄的是「當時打算怎麼做」而非現況。
知識沉澱到 `kb/wiki/lessons/`，需求真相沉澱到 `rules` / `flows` / `specs`。

## Operating Principles

- **交付一個功能或修跨檔案的 bug？走 `clessia-feature-slice` skill** —— 它強制
  「設計未經批准不得寫實作程式碼」的 STOP gate，並串起探索 → 釐清 → 設計 → worktree →
  test-first → gate → 同步文件 → PR 的完整迴圈
- **開工前先讀 [`kb/wiki/roadmap.md`](kb/wiki/roadmap.md) 的結構現況表** —— 它會告訴你這個功能區
  目前是已接通、空殼、還是未開始
- **先用 graph 再開檔**：本 repo 裝了 `code-review-graph`，探索程式碼優先用 MCP 工具而非大範圍掃檔
- 薄垂直切片：實作 → 測試 → 驗證 → 擴張
- 加法優先：先加新路徑，再移除舊的
- 不要過早抽象：三行相似程式碼好過一個錯的抽象
- 先找既有依賴：加套件或手刻工具前，先確認已安裝的依賴是否已涵蓋（查文件/型別，不要憑記憶）
- **不要手抄會腐化的清單**（c11）：狀態類資訊要嘛自動生成 + gate，要嘛指向目錄

### code-review-graph 使用順序

1. 先 `get_minimal_context`，用任務描述當 `task`
2. Review 改動 → `detect_changes`、`get_affected_flows`、`query_graph`
3. 找功能或追邏輯 → `semantic_search_nodes`、`query_graph`
4. graph 不夠用時才用 Grep/Glob/Read 開少量精準檔案
5. 改 component / service / guard 前，先確認 callers、imports、tests，避免只改到表層
6. graph 過舊 → `code-review-graph update --skip-flows`；`.code-review-graph/graph.db` 不存在才 `build`

## Definition of Done

- 行為符合驗收條件
- `npm test` 沒有新增紅燈（Stop hook 用 `test-baseline.json` 做基線比對，只擋這輪弄壞的）
- `npm run harness` 綠（含 KB gate）
- `npx nx affected -t typecheck` 綠
- 沒有新增 Banned Approaches 表裡的任何一項
- 非顯而易見的新 pattern 有寫進 `kb/`

## Agent skills

第一方 skill 的真身在 `.agents/skills/`，`.claude/skills` 與 `.codex/skills` 都是相對 symlink —— 改一份處處生效。下表由 `npm run harness:write` 從磁碟生成，
**不要手改**；宣稱存在但實際不存在的 skill 會讓 gate 紅燈。

<!-- SKILLS:START — auto-generated by tools/agent-harness/check-harness.mjs; do not hand-edit -->

| Skill | 用途 |
| --- | --- |
| `angular` | >- |
| `angular-best-practices` | Angular performance optimization and best practices guide. Use when writing, reviewing, or refactoring Angu… |
| `angular-scss-bem-standards` | Use when writing, reviewing, or refactoring Angular component styles (SCSS/CSS). Triggers on BEM naming iss… |
| `angular-state-management` | Master modern Angular state management with Signals, NgRx, and RxJS. Use when setting up global state, mana… |
| `angular-ui-patterns` | Modern Angular UI patterns for loading states, error handling, and data display. Use when building UI compo… |
| `clessia-feature-slice` | Use when delivering a Clessia feature or fixing a non-trivial bug end to end — from exploration through a G… |
| `frontend-design` | Create distinctive, production-grade frontend interfaces with intentional aesthetics, high craft, and non-g… |
| `supabase-postgres-best-practices` | Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing,… |
| `ui-ux-pro-max` | UI/UX design intelligence. 50 styles, 21 palettes, 50 font pairings, 20 charts, 9 stacks. |

<!-- SKILLS:END -->

Claude Code 另外透過 plugin 取得 `ui-ux-pro-max` 等 skill（見 `.claude/settings.json` 的
`enabledPlugins`），那些不在上表內。

## MCP servers

`.mcp.json`（進版控、團隊共用）：`code-review-graph`（知識圖譜）、`codex`（委派 OpenAI codex-cli）。

## Knowledge Base

This project maintains a knowledge base under `kb/`. Conventions, page format, and workflows (ingest / query / lint / map / verify / capture / migrate) are defined in `kb/schema.md`. Read it before any KB operation.
