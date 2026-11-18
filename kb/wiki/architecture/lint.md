---
title: Lint（ESLint）
summary: 只開會抓真 bug 的規則、存量用 ESLint 原生 suppressions 當只減不增的帳；c5 與分層方向由 harness A18 守，不在 ESLint。
category: architecture
tags: [architecture, lint, eslint, ci, harness]
status: active
updated: 2026-11-18
---

# Lint（ESLint）

設定在根目錄 `eslint.config.mjs`（flat config），`npm run lint` ＝ `nx run-many -t lint`，CI 的 verify job
在 typecheck 之後跑。設計討論與實測數字在 #2542。

## 開哪些規則：只開抓真 bug 的

全開 typescript-eslint `recommendedTypeChecked`＋angular-eslint 推薦集，全庫約 9,000 筆，八成是
型別嚴格度（`no-unsafe-*`）與風格。那是另一個決定，**不能為了「lint 有在跑」混進來**。開的是：

| 規則                                                   | 抓什麼                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `@typescript-eslint/no-unused-vars`（`_` 前綴豁免）    | 死 import／死變數 —— tsconfig 沒開 `noUnusedLocals`，原本沒人抓        |
| `@typescript-eslint/no-floating-promises`              | 沒人接的 rejection。`Router.navigate*` 列為已知安全（router 自己處理） |
| `@typescript-eslint/no-misused-promises`               | `subscribe({ error: async () => … })`：async 回呼丟的錯沒人接          |
| `@typescript-eslint/await-thenable`                    | await 一個不是 Promise 的值，以為有等其實沒有                          |
| `@angular-eslint/no-output-native`                     | output 名稱撞 DOM 事件（`close`／`change`），父層收到兩次              |
| template `banana-in-box`／`no-negated-async`／`eqeqeq` | 寫錯就是 bug；`eqeqeq` 允許 `!= null`（刻意同時擋 null 與 undefined）  |
| `@eslint/js` recommended 的 bug 類                     | `no-dupe-keys`、`no-unreachable`、`no-fallthrough`…                    |
| `reportUnusedDisableDirectives`                        | 失效的 `eslint-disable` 註解                                           |

刻意關掉的與理由寫在 `eslint.config.mjs` 旁邊的註解。a11y 模板規則另案評估（#2558）。

## 存量：原生 bulk suppressions，只減不增

- 每個 project 一份 `eslint-suppressions.json`（`apps/web/`、`apps/api/`），是 ESLint 9.24+ 原生的
  「每檔每規則幾筆」帳，**不是 disable 註解**
- **新違規照紅**；違規修掉了卻沒更新帳，ESLint 也會紅（`There are suppressions left that do not occur anymore`）。
  修完跑：
  ```bash
  npx eslint apps/web/src packages --suppressions-location apps/web/eslint-suppressions.json --prune-suppressions
  npx eslint apps/api/src --suppressions-location apps/api/eslint-suppressions.json --prune-suppressions
  ```
- ESLint 擋不住的只有「重跑 `--suppress-all` 把新違規記進帳」—— harness **A31** 擋：帳上總筆數不得比
  origin/main 多。**不要用 `--suppress-all` 讓 CI 變綠**；要修
- `packages/*` 不是 Nx project，跟著 web 的 lint target 一起掃
- **歸零的 project 把帳檔刪掉、lint target 拿掉 `--suppressions-location`**（帳檔不存在時 ESLint 會以 exit 2 失敗）。
  api 已於 #2542 PR2 歸零。A31 對 main 上沒有帳檔的路徑以 0 為基準，重錄一份就紅

## c5 與分層方向不在 ESLint

- feature 互 import 由 harness **A18** 守（#229 起，相對路徑與 `@features/`／`@app/` 別名都認）
- `core/`、`shared/` 不得 import `features/`（分層方向）也在 A18（#2542 加的，立法時 0 違規）
- `@nx/enforce-module-boundaries` 用不上：它看 Nx project 之間的依賴，而 core／shared／features 都是
  `apps/web` 這**一個** project 裡的資料夾
- A18 的盲點（經由 core／shared 的**間接**耦合）任何 linter 都看不到，仍靠 review

## 不用 stylelint

SCSS 帳面已歸零（A24），樣式風險由 harness 守（c6 viewport A12、cascade layer A26、對比、Tailwind 類名）。
