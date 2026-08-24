---
title: Clessia 架構憲法
summary: 具約束力的架構不變量。只陳述「什麼構成違反」，不含強制機制。
category: architecture
status: binding
updated: 2026-08-23
tags: [architecture, constitution]
---

# Clessia 架構憲法

> 本文件是 Clessia 的**不可違反架構不變量（法）**。它只陳述_什麼構成違反_ ——
> 條款用什麼機制守、目前有沒有接上、在哪裡擋，全部在
> [[architecture/constitution-enforcement|`constitution-enforcement.md`]]（**改機制不算修法**）。
>
> 三層真相：**憲法 ▸ 程式碼 ▸ 描述性文件（AGENTS.md、kb/specs、kb/rules）**。
> 程式碼服從憲法；文件描述已經合憲的程式碼。
> **條款的效力與有沒有接上檢查器無關 —— 沒人擋得住的違反仍然是違反。**

## 前言

1. **修法 = 編輯這個檔案**，而且是刻意的人類行為。agent 偵測到程式碼與憲法衝突時
   **只標記、不自行裁決**：由人選擇修程式碼或提出修法。
2. **架構級變更反向流動**：先修法 → 程式碼跟上 → 文件最後描述。只有非架構性的日常改動走
   程式碼 → 文件。
3. **收錄原則**：只收「違反了架構就壞掉」的不變量，刻意保持小而穩定。命名、函式長度、
   設計品味、流程偏好**不是法** → 那些寫在 `AGENTS.md`。

## 圖例

- **Clause ID**：`c1`、`c2` …（穩定識別碼，程式碼註解與 commit 會直接引用）
- **可決定性分類**：
  - **[Deterministic]** — 機器可判定，已經或可以硬擋
  - **[Semantic]** — 需要人或 LLM 判斷，無法化約為確定性規則
- **理由**：指向描述性材料，不在此重述

---

## 第一章 — 資料與授權

### c1 授權發生在 API 層 [Semantic]

任何資料的可見性與可寫性，必須在 `apps/api` 的 middleware / route handler 以 `org_id`
（必要時再加分校、角色、permissions）過濾決定。前端隱藏 UI **不構成授權**。

違反例：route 直接回傳跨 org 的資料，僅靠前端不顯示按鈕來「限制」。

### c2 `ba_*` 表由 Better Auth 獨佔寫入 [Deterministic]

`ba_user`、`ba_session`、`ba_account` 等 Better Auth 管理的表**不得由應用程式碼直接
INSERT / UPDATE / UPSERT / DELETE**。新增使用者走 Better Auth 的 `admin.createUser()` API。

讀取不受限制 —— 查詢這些表取得 email / phone / username 是正常用法。

> 理由：Better Auth 對這些表有自己的一致性假設（雜湊、session 失效、關聯清理），繞過 API
> 直接寫會產生它修不回來的狀態。

---

## 第二章 — Migration

### c3 已提交的 migration 不可修改 [Deterministic]

一旦 migration 檔進了版本控制，其內容即為不可變。schema 變更**一律新增一支
`ALTER TABLE` migration**。

違反的後果不是本機的問題 —— 本機 `db:reset` 會重跑全部所以看起來沒事，但任何已經跑過該支
migration 的環境**永遠不會拿到後來塞進去的變更**。

> 本 repo 已有此模式的正確示範：`20260422000001_school_exams_school_fk.sql` 就是對既有
> `school_exams` 表的後續調整，而不是回頭改建表的那一支。

### c4 Migration 檔名格式 [Deterministic]

`YYYYMMDDHHMMSS_description.sql`，用 `npx supabase migration new <description>` 產生。

---

## 第三章 — 前端結構

### c5 feature 之間不得互相 import [Semantic]

`features/<a>/**` 不得 import `features/<b>/**`。需要共用的元件、directive、pipe 一律上提到
`shared/`；需要共用的狀態一律上提到 `core/`。

> 理由：feature 依角色隔離（admin / teacher / parent / public / select-role）。橫向 import 會讓
> 角色邊界失效，最終退化成一坨互相牽動的頁面。

### c6 禁止 viewport 單位 [Deterministic]

SCSS 不得使用 `vh` / `vw` / `dvh` / `svh` / `lvh`。這些單位在 mobile Safari 位址列伸縮與巢狀
scroll container 下行為不可靠。

改用上層 directive 以 ResizeObserver 寫入的 CSS 自訂屬性：
`calc(var(--window-width, 360px) * 0.9)` 取代 `90vw`。

### c7 Template 只用原生 control flow [Deterministic]

禁止 `*ngIf` / `*ngFor` / `*ngSwitch`，一律用 `@if` / `@for` / `@switch`。

### c8 Angular 一律 functional API [Deterministic]

禁止 `@Input()` / `@Output()` / `@ViewChild()` / `@ViewChildren()` / `@ContentChild()` /
`@ContentChildren()`。改用 `input()` / `output()` / `model()` / `viewChild()` /
`contentChild()`，DI 用 `inject()`。

---

## 第四章 — 文件與 agent harness

### c9 `kb/` 是文件的唯一去處 [Deterministic]

專案只有**一棵文件樹**，它叫 `kb/`。禁止 `doc/`、`docs/` 或任何其他平行文件目錄。

規格、流程、業務規則、架構法條、工程知識**全部住在同一棵樹底下**，靠 `category` 欄位分類
而不是靠平行目錄分家。收錄標準與目錄職責見 [`schema.md`](../../schema.md)。

> 理由：多棵文件樹的下場是同一件事在兩處各記一半，然後各自腐化。本專案已經在 `CLAUDE.md` /
> `AGENTS.md` / `GEMINI.md` 上實測過一次（c10）。

### c10 專案指引單一真相在 `AGENTS.md` [Deterministic]

各 CLI 的入口檔（目前只有 `CLAUDE.md`）只得 import `AGENTS.md` 並補充該 CLI 專屬的操作資訊，
不得承載專案規則。任何 agent 都不得靠「多個檔案各改一遍」來新增規則。

> 理由：本專案曾同時維護三份近似副本，實測漂出 53 行分歧，且分歧的部分描述的是**已經不存在
> 的架構**（三個獨立 shell 元件、`admin_permissions` 表）。

### c11 文件不得手抄會腐化的清單 [Semantic]

任何「目前有哪些 X」的清單（skill、元件、route、lib、已完成功能）**不得手寫**。要嘛自動生成
並由 gate 斷言，要嘛改寫成「指向目錄 + 舉兩個例子」。

> 理由：本專案的 `AGENTS.md` 曾手抄 17 個 skill 的對照表，其中 13 個根本不存在 —— 76% 是假的，
> 而且每個 session 都載入。這類清單沒有例外，一定腐化。

### c12 客戶必須能夠脫離並自架 [Semantic]

任何客戶都必須能夠取走自己的資料、在自己的基礎設施上運行整套系統，
不需要供應商的同意或協助。

推論：

- 禁止多租戶共用資料庫 —— 資料混在一起就無法乾淨取出
- 禁止依賴特定雲端供應商的專屬服務（Workers KV / R2 / Durable Objects 等）
- 禁止 license key、遠端啟用檢查或任何 kill switch

部署目標可以是 Cloudflare / Vercel / 任何地方 —— 限制的是**程式碼不得依賴
它們專屬的能力**，不是不得部署上去。

這條同時約束商業模式：維護費不能靠鎖住客戶來收。

違反例：把 session 存進 Workers KV；把多個客戶的資料放進同一個 Postgres 實例。

> 理由：[[architecture/vendor-relationship]]

---

## 附錄 — 已結案的爭議點

本附錄用來暫放「文件與程式碼不一致、但需要人裁決要改哪一邊」的項目。
**目前沒有待裁決項目。**

- **org_id 來源**（2026-08-11）—— 不是兩種說法，而是寫入端早已搬到 `ba_user.orgId`、
  讀取端留在死掉的 `profiles.org_id`，導致所有由 app 建立的使用者 400 NO_ORG。
  已修，由 `apps/api/src/org-source.spec.ts` 守住。
- **api 測試**（2026-08-11）—— 已補上 vitest 設定與 nx `test` / `typecheck` target，
  101 個測試會執行並接進 Stop gate。
- **業務表 RLS**（2026-08-11）—— 授權確實只在 middleware（service role 繞過 RLS），
  但 RLS 保持啟用且零 policy 是刻意的 fail-closed 後盾，不可關閉。
  三條依賴 `auth.uid()` 與死表 `profiles` 的殭屍 policy 已於
  `20260811034702_drop_zombie_rls_policies.sql` 移除。

詳見 `kb/wiki/lessons/doc-code-drift-2026-08.md`。
