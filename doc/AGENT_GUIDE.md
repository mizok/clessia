# Agent 開發流程指南

本文件定義 Claude 與 Codex 協作開發時應遵循的工作流程。  
目標：**減少 token 消耗、提升成品品質、確保可追蹤性**。

> **使用方式**：將此文件複製到專案中，並填寫「專案適配」章節。

---

## 核心原則

| 原則 | 說明 |
|------|------|
| 先調查，後動手 | 了解現有環境、版本、風格再開始實作 |
| 分階段驗證 | 每個階段完成後必須驗證才能進入下一階段 |
| Codex 委派要透明 | 所有委派內容必須可追蹤、可審計 |
| 設計系統優先 | UI 開發前必須參考現有組件風格 |
| 規格先於實作 | 先定義完整規格，再開始寫程式 |
| Token 成本意識 | 重複性工作優先委派 Codex，Claude 專注設計判斷 |

---

## 功能開發流程

```
Phase 0: 環境調查                    ← Claude（快速掃描）
    ├── 檢查 package.json / 依賴版本
    ├── 檢查專案設定檔（tsconfig, eslint, etc.）
    ├── 檢查現有組件風格
    └── 檢查環境設定（ports, URLs, env vars）
            ↓
Phase 1: 撰寫功能規格                ← Claude（需求理解）
    └── 使用「功能規格模板」
            ↓
Phase 2: Database / Schema           ← Codex 優先
    ├── 執行者：Codex（規格明確時）
    ├── 產出：migration, schema, seed
    └── 【驗證點】database reset/migrate 無錯誤
            ↓
Phase 3: API / Backend               ← Codex 優先
    ├── 執行者：Codex（CRUD 類型）
    ├── 產出：route, controller, service
    └── 【驗證點】API 測試全部成功（Codex 可執行）
            ↓
Phase 4: Frontend Service            ← Codex 優先
    ├── 執行者：Codex（CRUD service）
    ├── 產出：API client, service layer
    └── 【驗證點】build 無錯誤
            ↓
Phase 5: Frontend UI                 ← Claude 專屬
    ├── 執行者：Claude（需設計判斷）
    ├── 必須：參考設計系統、現有組件
    ├── 產出：component, page, styles
    └── 【驗證點】build 無錯誤 + 視覺檢查
            ↓
Phase 6: 端到端驗證                  ← Codex 可執行
    ├── 執行者：Codex（Playwright 腳本）
    └── 實際操作完整流程
```

### 為什麼要分階段？

- **問題早發現**：Phase 2 的 DB 錯誤不會拖到 Phase 5 才爆發
- **減少返工**：每階段驗證通過才繼續，避免累積錯誤
- **Token 節省**：一次修復 vs 反覆 debug 的差異可達 3-5 倍

---

## 功能規格模板

開始任何功能前，先填寫此模板：

```markdown
## Feature: [功能名稱]

### 概述
[一句話描述]

### 響應式需求
- [ ] 需支援手機版：是 / 否
- [ ] 如需支援，採用 mobile-first 設計

### 共用元件識別
- [ ] 是否有可複用的 UI pattern？（Empty State, Page Header, Card, etc.）
- [ ] 是否有現有 shared component 可使用？
- [ ] 此功能是否應產出新的 shared component？

### Checklist

#### Database
- [ ] Schema changes: [描述]
- [ ] Seed data: [描述]
- [ ] Permissions/RLS: [描述]

#### API
- [ ] Endpoints: [列出]
- [ ] Validation: [列出]
- [ ] Error cases: [列出]

#### Frontend
- [ ] Service methods: [列出]
- [ ] Components: [列出]
- [ ] 設計參考: [列出現有組件]

### 測試情境
1. [Happy path]
2. [Error case 1]
3. [Error case 2]

### 相依性
- [列出相依的功能/資料]
```

---

## Codex 委派指南

### 適用範圍

| ✅ 適合 Codex | ❌ 不適合 Codex |
|--------------|----------------|
| CRUD API | UI/UX 設計 |
| Database schema | 視覺風格決策 |
| Validation schemas | 需要參考設計系統 |
| 重複性高的程式碼 | 需要創意判斷 |
| 規格明確的實作 | 模糊需求 |
| 資料轉換邏輯 | 使用者體驗決策 |

### 委派前 Checklist

- [ ] 完成 Phase 0 環境調查
- [ ] 完成功能規格
- [ ] 準備好相關檔案的 context

### Prompt 結構

```markdown
## Context
- 專案：[名稱]
- Tech Stack：[列出相關技術]
- 參考檔案：[列出路徑]

## 版本資訊
[列出相關依賴版本，從 package.json 取得]

## 任務
[明確描述]

## 限制條件
- [條件 1]
- [條件 2]

## 預期產出
- [檔案路徑 1]
- [檔案路徑 2]

## Seed/測試資料
[如需更新，明確說明]
```

### 委派時必做

```typescript
// 指定 sessionId 以便追蹤
mcp__codex-cli__codex({
  prompt: "...",
  sessionId: "feature-[功能名稱]",  // ← 必填，讓用戶可用 /resume 查看
  workingDirectory: "[專案路徑]"
})
```

**或者**：在呼叫前將完整 prompt 輸出在對話中，讓對話本身成為紀錄。

### 委派後必做

1. 檢查所有產出檔案
2. 執行該階段驗證點
3. 驗證通過後才進下一階段

---

## Token 優化策略

### 為什麼要優化？

- Claude token 成本較高，適合需要判斷力的工作
- Codex token 相對便宜，適合重複性、規格明確的工作
- 合理分工可節省 **40-60%** 的 Claude token 消耗

### Claude vs Codex 分工原則

| Claude 負責 | Codex 負責 |
|-------------|------------|
| 需求理解、規格撰寫 | 規格明確的程式碼生成 |
| UI/UX 設計決策 | CRUD API / Service |
| 設計系統參考 | Database schema / Seed |
| 視覺風格判斷 | 重複性測試（curl, Playwright） |
| 架構決策 | Debug / 問題排查 |
| 最終 Review | 驗證腳本執行 |

### 預設委派清單

以下任務**優先委派給 Codex**：

```markdown
## 每個功能開發時，檢查以下項目是否可委派 Codex

### Phase 2: Database
- [ ] Seed data SQL 生成
- [ ] Migration 檔案撰寫（schema 明確時）

### Phase 3: API
- [ ] CRUD route 實作
- [ ] Validation schema 撰寫
- [ ] API endpoint 測試（curl 指令）

### Phase 4: Frontend Service
- [ ] Service 層 CRUD methods
- [ ] Type definitions

### Phase 6: E2E 驗證
- [ ] Playwright 測試腳本
- [ ] 自動化驗證流程
```

### Session 管理建議

| 情境 | 建議 |
|------|------|
| 開始新功能 | 使用新 session，避免 context 污染 |
| 續接工作 | 優先讀 codebase，不依賴過期記憶 |
| Context 接近上限 | 委派剩餘工作給 Codex，不要硬撐 |

### 預估節省效益

典型 CRUD 功能的 token 分布：

| Phase | 原本全由 Claude | 優化後 Claude | 節省 |
|-------|-----------------|---------------|------|
| Phase 0-1 | ~3K | ~3K | - |
| Phase 2 | ~2K | 0 (Codex) | 2K |
| Phase 3 | ~3K | 0 (Codex) | 3K |
| Phase 4 | ~3K | 0 (Codex) | 3K |
| Phase 5 | ~8K | ~8K | - |
| Phase 6 | ~5K | 0 (Codex) | 5K |
| **總計** | **~24K** | **~11K** | **~54%** |

---

## 驗證點設計

每個階段的驗證應該：

| 原則 | 說明 |
|------|------|
| 可執行 | 有具體指令可以跑 |
| 可判斷 | 成功/失敗有明確標準 |
| 快速 | 不需要完整 E2E，只驗證該階段 |

### 範例

| Phase | 驗證方式 |
|-------|---------|
| Database | `db reset` 或 `migrate` 無錯誤 |
| API | `curl` 測試主要 endpoints |
| Frontend Service | `build` 通過 |
| Frontend UI | `build` 通過 + 瀏覽器檢查 |
| E2E | 實際操作完整流程 |

---

## 響應式與共用元件

### 響應式需求

**在 Spec 階段就要確認**，不是 UI 階段才問。

事後補響應式 = 可能需要重構 HTML + 大幅增加 CSS。

### 共用元件識別

**在 Spec 階段就要識別**，不是看到重複才做。

原因：等看到第二次時，上下文可能已經稀釋，會忘記第一次的實作細節。

---

## 常見錯誤與預防

### 1. 依賴順序錯誤

**症狀**：Migration 失敗、Build 失敗  
**原因**：引用尚未建立的資源  
**預防**：每個 phase 完成立即驗證

### 2. 測試資料遺漏

**症狀**：功能無法運作，缺少關聯資料  
**原因**：功能規格沒列出 seed 需求  
**預防**：規格模板強制填寫 seed 項目

### 3. 版本不相容

**症狀**：使用已棄用的 API  
**原因**：沒檢查 package.json 版本  
**預防**：Phase 0 必須檢查版本，Codex prompt 必須包含版本

### 4. 設計不一致

**症狀**：新頁面風格與現有頁面不符  
**原因**：沒參考現有組件就開始寫  
**預防**：Phase 5 必須先看設計系統

### 5. 環境設定不一致

**症狀**：連不上 API、Port 錯誤
**原因**：環境設定檔之間不同步
**預防**：Phase 0 檢查所有環境設定

### 6. 響應式事後補救

**症狀**：桌面版完成後才發現手機版不能用
**原因**：Spec 階段沒確認響應式需求
**預防**：功能規格模板強制填寫「響應式需求」

### 7. 共用元件提取過晚

**症狀**：多個頁面有相似 UI，但實作方式不一致
**原因**：沒在 Spec 階段識別潛在共用元件
**預防**：功能規格模板強制填寫「共用元件識別」；上下文稀釋前就做決定

---

## Checklist 總表

每個功能開發時複製使用：

```markdown
## [功能名稱] Checklist

### Phase 0: 環境調查
- [ ] 依賴版本確認
- [ ] 專案設定確認
- [ ] 現有組件風格確認
- [ ] 環境設定確認

### Phase 1: 功能規格
- [ ] 規格模板填寫完成
- [ ] 響應式需求確認（是否支援手機版）
- [ ] 共用元件識別完成
- [ ] 所有 checklist 項目列出
- [ ] 測試情境定義

### Phase 2: Database
- [ ] Schema/Migration 建立
- [ ] Seed 更新（如需要）
- [ ] 【驗證】DB 操作成功

### Phase 3: API
- [ ] Endpoints 建立
- [ ] 【驗證】API 測試通過

### Phase 4: Frontend Service
- [ ] Service 建立
- [ ] 【驗證】Build 成功

### Phase 5: Frontend UI
- [ ] 設計系統參考完成
- [ ] 共用元件使用/建立
- [ ] Component 建立
- [ ] 響應式樣式（如 Spec 有要求）
- [ ] 【驗證】Build 成功
- [ ] 【驗證】視覺檢查通過

### Phase 6: E2E
- [ ] 完整流程測試通過
```

---

## 專案適配：Clessia

### 技術棧

```
Frontend: Angular 19 + PrimeNG 19 + Signals
Backend:  Hono (Cloudflare Workers)
Database: Supabase (PostgreSQL + RLS)
Deployment: Cloudflare Pages + Workers
```

### 版本檢查指令

```bash
# 取得主要依賴版本
cat package.json | grep -E '"(@angular/core|primeng|zod|hono|@supabase)"' | head -10
```

### 設計系統參考檔案

| 檔案 | 用途 |
|-----|------|
| `apps/web/src/styles.scss` | 全域 CSS 變數（色彩、間距、字型） |
| `apps/web/src/app/shared/components/layout/shell-layout/` | Header 樣式 |
| `apps/web/src/app/features/public/public-shell.component.scss` | Sidebar 樣式 |
| `apps/web/src/app/shared/styles/_dashboard.scss` | Dashboard 卡片樣式 |

### 色彩/樣式變數

```scss
// Primary（深色背景，用於 header/sidebar/button）
Primary:    var(--zinc-900)
Primary-hover: var(--zinc-800)

// Accent（連結、icon highlight）
Accent:     var(--accent-500) / var(--accent-600)

// Text
Text:       var(--zinc-900)
Muted:      var(--zinc-500)

// Background
Background: var(--zinc-50)
Card:       #fff + border: var(--zinc-200)
```

### 環境設定檔案

| 檔案 | 用途 |
|-----|------|
| `apps/web/src/environments/environment.ts` | Frontend 本地環境 |
| `apps/web/src/environments/environment.production.ts` | Frontend 生產環境 |
| `apps/api/wrangler.toml` | API Worker 設定 |
| `apps/api/.dev.vars` | API 本地環境變數 |

### Database 驗證指令

```bash
# 重置並驗證 migration
supabase db reset

# 確認 seed 資料
supabase db dump --local --data-only -f /tmp/check.sql
grep -A5 "INSERT INTO.*[table_name]" /tmp/check.sql
```

### API 測試指令

```bash
# 啟動 API
nx serve api

# 測試（需替換 TOKEN）
curl http://localhost:8787/health
curl -H "Authorization: Bearer $TOKEN" http://localhost:8788/api/[resource]
```

### Build 指令

```bash
# Frontend
nx build web --configuration=development

# API
nx build api
```
