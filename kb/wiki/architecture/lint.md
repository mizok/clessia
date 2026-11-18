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

刻意關掉的與理由寫在 `eslint.config.mjs` 旁邊的註解。

### a11y 模板規則（#2558）

angular-eslint `templateAccessibility` 的 11 條全開：`alt-text`、`click-events-have-key-events`、
`elements-content`、`interactive-supports-focus`、`label-has-associated-control`、
`mouse-events-have-key-events`、`no-autofocus`、`no-distracting-elements`、`role-has-required-aria`、
`table-scope`、`valid-aria`。與 harness 已守的 aria-icon-button、touch-target 不重疊。
inline template（`.ts` 內的 `template:`）也掃。立法時存量 116 筆，已於 PR2 **真修到 0**、帳檔刪除（不是用
`eslint-disable` 蓋掉）。修法：

- label：用 `for`＋`id`，或把 input 包進 `<label>`；PrimeNG 元件用 `inputId` 對 `for`（迴圈裡用 `[for]`＋`[inputId]` 帶動態值）。
  沒有對應控制項的群組標題（radiogroup、selectbutton）不是 label —— 用 `<span id>` 搭 `aria-labelledby`
- `autofocus` 屬性不用：一進畫面要聚焦就在 `afterNextRender` 裡對 `viewChild` 呼叫 `.focus()`；中途才長出來的欄位在顯示後再聚焦
- click 非互動元素：**預設**改成 `<button type="button">`；不能改時在**模板**補
  `(keydown.enter)`／`(keydown.space)` 與 `tabindex="0"`＋`role`
- 不准用 `eslint-disable` 或 `--suppress-all` 蓋掉

#### 唯一允許把 click 搬到 host（directive／`host:`）的三種情形

`click-events-have-key-events` 要的是「滑鼠做得到的鍵盤也做得到」。下面三種情形，**鍵盤的對應已經存在、
而且在別的元素上**，所以那個 click 只是滑鼠捷徑；把它從模板搬到 host 監聽，是把「對應關係」寫在
directive 的註解裡、而不是假裝 lint 沒看見。每一種各自的鍵盤對應如下：

| 情形                                             | 做法                                                | 鍵盤的對應                                  |
| ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------- |
| 原生 `<dialog>` 點背景關閉                       | `BackdropCloseDirective`（`dialog[backdropClose]`） | 原生 dialog 的 **Esc**（`cancel`／`close`） |
| 勾選框外層 44px `<label>` 的點擊（為了觸控面積） | `PickClickDirective`（`label[pickClick]`）          | 裡面那個 **checkbox**（Tab、空白鍵）        |
| 列容器「點空白處＝勾選」                         | 元件 `host: { '(click)': … }`（`class-row`）        | 列上的 **checkbox** 與列內的 **button**     |

**其他情況一律在模板補 `keydown`＋`tabindex`（或改成 `<button>`），不准另外寫 directive 繞過 lint。**
新增第四種情形要先在這裡登記、寫明鍵盤的對應，審核以這張表為依據。

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
  api 已於 #2542 PR2、web 已於 #2558 PR2 歸零 —— 目前兩個 project 都沒有帳檔。A31 對 main 上沒有帳檔的路徑以 0 為基準，重錄一份就紅；**重新開規則要立新帳時**，在 `check-harness.mjs` 的 `A31_SEED` 登記該路徑的筆數上限（一次性，帳歸零刪檔的 PR 一併刪掉登記）

## c5 與分層方向不在 ESLint

- feature 互 import 由 harness **A18** 守（#229 起，相對路徑與 `@features/`／`@app/` 別名都認）
- `core/`、`shared/` 不得 import `features/`（分層方向）也在 A18（#2542 加的，立法時 0 違規）
- `@nx/enforce-module-boundaries` 用不上：它看 Nx project 之間的依賴，而 core／shared／features 都是
  `apps/web` 這**一個** project 裡的資料夾
- A18 的盲點（經由 core／shared 的**間接**耦合）任何 linter 都看不到，仍靠 review

## 不用 stylelint

SCSS 帳面已歸零（A24），樣式風險由 harness 守（c6 viewport A12、cascade layer A26、對比、Tailwind 類名）。
