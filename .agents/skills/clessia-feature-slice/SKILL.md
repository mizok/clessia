---
name: clessia-feature-slice
description: Use when delivering a Clessia feature or fixing a non-trivial bug end to end — from exploration through a GitHub PR. Enforces the spec-approval STOP gate before any implementation code. Skip for typos, doc-only edits, or work already covered by an approved spec.
---

# Clessia Feature Slice

一個功能區的實作、或跨越多個檔案的 bug 修正，走這個流程。**跳過的情況**：改錯字、
純文件編輯、以及已經有批准過的 spec 涵蓋的工作。

## 流程

### 1. 探索

- 先讀 [`kb/roadmap.md`](../../../kb/roadmap.md) 的**結構現況表** —— 確認這個功能區目前是
  已接通、空殼、還是未開始。這決定了工作的性質（補後端 vs 從零 vs 改既有）。
- 派對應的唯讀領域導航員（`enrollment-domain` / `attendance-domain` / `grades-domain`），
  它們只回報 `path:line` 證據、不改檔。
- 用 `code-review-graph` 的 MCP 工具追呼叫鏈與波及面，不要一開始就大範圍掃檔。
- 需要規格意圖時讀 `kb/specs/`；需要業務規則讀 `kb/rules/`；跨角色流程讀 `kb/flows/`。
- 版本敏感的 API（Angular / Nx / Better Auth / PrimeNG）**一律查 context7 或型別定義**，
  不要憑記憶 —— 本專案有過因為假設某個 SDK 方法存在而繞遠路的紀錄
  （見 `kb/wiki/lessons/better-auth-session-delegation.md`）。

### 2. 釐清範圍

一次問一個問題，把公開介面、資料流、邊界情境、以及**明確不做什麼**談清楚。
範圍由使用者拍板，不是由你推定。

### 3. 寫設計、然後停下來

把設計決策寫成 `kb/wiki/architecture/<slug>.md` 或 `kb/wiki/patterns/<slug>.md`：
**為什麼這樣設計、拒絕了哪些替代方案、影響哪些既有元件**。

實作步驟（第幾步改哪個檔）**不落地** —— 那是過程產物，寫完就沒有價值。本專案曾保留
44 份實作計畫，事後證實幾乎撈不出可用的東西（見 `kb/wiki/lessons/doc-code-drift-2026-08.md`）。

> **STOP。取得使用者對這份設計的明確批准之後，才能寫任何實作程式碼。**
> 批准的對象是那份文件，不是口頭的「好」。範圍變更要回到這一步重新批准。

### 4. 隔離

`git worktree add .worktrees/<name> -b <branch>`，從當前的整合分支開。
不要在 `main` 上直接工作，也不要把不相關的改動混進同一個分支。

**worktree 開好後要先在 `apps/api` 跑一次 `npm ci`** —— 它是獨立的 npm package，
根目錄的 node_modules 走 walk-up 解析不到它的依賴（`pg`、`better-auth` 等），
不裝的話 api 測試會以 `Cannot find package 'pg'` 失敗。web 的依賴可從根目錄解析，不用裝。

**step 3 的設計文件記得搬進這個分支** —— 它是在開 worktree 之前寫的，會留在原本的
checkout 裡。第一次跑這個流程時就漏了一次。

### 5. 實作，測試先行

每個行為：先看到一個失敗的測試 → 最小改動讓它通過 → 重構 → commit。

- 憲法的 Banned Approaches 由 PreToolUse guard 即時擋，違規會 exit 2 並指回法條
- 寫 SCSS 前先 invoke `angular-scss-bem-standards`
- **修 bug 要修根因**：先 grep 所有呼叫端，不要只補報告裡提到的那條路徑

### 6. 驗證

```bash
npm run harness                                  # 文件/KB/現況表是否同步
npm run harness:test                             # harness 自身
npx nx affected -t typecheck,test --base=main    # 型別 + 測試
```

**收工前在乾淨 clone 上重放一次 CI 序列**（見
`kb/wiki/lessons/local-green-is-not-repo-green.md`）—— 本機綠不等於 repo 綠，
這個專案在導入 CI 時因此連紅六次。

不要把「跳過的測試」或「沒跑到的測試」當成綠燈。

### 7. 同步文件

- 新功能區、或功能區狀態改變 → `npm run harness:write` 重生現況表
- 非顯而易見的新 pattern 或踩過的坑 → `kb/wiki/`
- 需求真相改變 → 對應的 `kb/specs` / `kb/rules` / `kb/flows`
- `kb/roadmap.md` 第 2 節「接下來」是人工維護的，狀態欄不要手改

### 8. 開 PR

`gh pr create`，內容涵蓋範圍、證據、跑過的 gate、風險、以及明確的延後項目。
**絕不自行 merge，也不啟用 auto-merge** —— merge 是使用者的決定。

## 停止條件

- 設計未經明確批准，不得寫實作程式碼
- 不得把跳過或未執行的測試當成通過
- 不得在未讀 diff、未重跑 gate 的情況下宣稱完成
- 不得把不相關的改動混進同一個分支
- 不得修改已提交的 migration（憲法 c3）—— schema 變更一律新增 ALTER migration
