---
title: 開發環境安裝：根與 apps/api 是兩套獨立 lock
summary: 乾淨 clone 要跑兩次 npm ci（根、apps/api）；缺 apps/api 的依賴（例如 pg）會讓 harness 紅得像程式碼問題，npm run harness 第一步的 deps:check 會直接印出該跑的指令。
category: patterns
tags: [patterns, setup, npm, harness]
status: active
updated: 2026-11-18
---

# 開發環境安裝：根與 apps/api 是兩套獨立 lock

`apps/api` 有自己的 `package-lock.json`，**根目錄的 `npm ci` 不會裝它**（#2541）。

## 乾淨 clone 的 setup

```bash
npm ci                      # 根（web、harness、nx）
(cd apps/api && npm ci)     # api（pg、hono…）
npm run harness             # 第一步 deps:check 會驗證上面兩步
```

## 症狀與診斷

缺 `apps/api/node_modules` 時 harness 會紅在「找不到 `pg`」之類，看起來像程式碼壞了。
`npm run deps:check`（`npm run harness` 的第一步）只看兩套 `node_modules` 裝了沒，缺的那套直接印出
`(cd <dir> && npm ci)`，exit 1。它**不**檢查版本是否與 lock 一致；懷疑過期就重跑 `npm ci`。

暫存 worktree 不重裝時，把 `node_modules` 與 `apps/api/node_modules` symlink 回原 worktree 即可通過檢查。

> 注意：`npm run preflight` 是**推送前的分支狀態檢查**（見 `tools/agent-harness/preflight.mjs`），跟這裡的依賴檢查無關。
