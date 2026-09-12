---
title: 登入（/login）
summary: /login 的實際 UI 地圖：只有一顆 LINE 登入鍵，加上三種由網址參數驅動的條件式元素（錯誤提示、報名連結、重試）。
category: spec
status: developing
tags: [sitemap, public]
created: 2026-09-12
updated: 2026-09-12
---

# 登入

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/login`
**角色**：公開（未登入可進）
**選單位置**：（無群組）登入
**額外權限**：無

<!-- generated:route-facts end -->

> ⚠️ **「公開（未登入可進）」在這一頁要加一句：登入著的人進不來。**
> `app.routes.ts` 給這條路由掛了 `canActivate: [guestGuard]` ——
> **實測**：帶著 admin session 開 `http://localhost:4200/login`，網址列直接變成
> `/admin/dashboard`。改版時不要假設這一頁在任何情況下都打得開。

**進入方式**：公開頁外框的「登入」連結 / 品牌面的 `Clessia` 字標 / 直接網址 /
**各種 guard 把人踢回來**（`auth.guard` 帶 `?reason=connection-error`、
LINE OAuth 失敗帶 `?error=...`）。

**外框**見 [[specs/sitemap/_shared/public-shell]]。

## 畫面區塊

### 1. 標題

- `登入`（h1）
- 副標 `用 LINE 登入，不需要記密碼。`

### 2. 錯誤提示（條件式）

`app-inline-notice severity="error"`，**只在 `error()` 非 null 時存在**，可關閉。
文字全部來自 `oauth-error.ts` 的對照表或 `auth.guard` 的 reason，**不是後端回來的原文**：

| 來源                       | 顯示的文字                                                             |
| -------------------------- | ---------------------------------------------------------------------- |
| `?error=signup_disabled`   | `這個 LINE 帳號還沒有被登記。如果你已經報名，請向補習班索取專屬連結。` |
| `?error=access_denied`     | `已取消 LINE 登入。`                                                   |
| `?error=<其他任何值>`      | `LINE 登入沒有完成，請稍後再試。`                                      |
| `?reason=connection-error` | `連線異常，請重試。若持續發生請聯繫補習班。`                           |

### 3. LINE 登入鍵（**唯一恆存在的互動元素**）

綠底大鍵，左邊一個綠色 chip 裡放 LINE 官方白色 icon
（`assets/brand/line-logo.png`，`alt=""` + `aria-hidden` —— 純裝飾，右邊的文字已經說了 LINE），
右邊文字 `使用 LINE 登入`。

`submitting()` 為 true 時 `disabled`，內容換成旋轉圖示 + `前往 LINE...`。

### 4. 頁尾兩行提示（純文字，不是連結）

- `第一次使用？請向補習班索取專屬連結，點開後即可綁定 LINE。`
- `還沒有帳號？請聯絡櫃檯開通。`

**這一頁沒有帳號 / 密碼欄位，整個系統沒有密碼**
（理由：密碼雜湊超過 Cloudflare Workers 的 CPU 上限，見 `kb/wiki/architecture/line-oauth-login.md`）。

## 互動元素

| 元素（畫面上的字） | 類型         | 出現條件                                                     | 按了之後                                                                                      |
| ------------------ | ------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 使用 LINE 登入     | 按鈕（主要） | **永遠**（`submitting()` 時 `disabled`）                     | `auth.signInWithLine()` → **整頁離開去 LINE 授權頁**（**未驗，見下**）                        |
| ✕（`關閉訊息`）    | 按鈕         | **只在錯誤提示存在時**（四種參數都會帶出它）                 | `error.set(null)` → 錯誤提示消失，**「重試」也跟著一起消失**（實測，見下）                    |
| 還沒報名？前往報名 | 連結         | **只在 `?error=signup_disabled` 時**（`showEnrollmentLink`） | 導向 `/enrollment`，**SPA 導覽、不重載**（實測）                                              |
| 重試               | 按鈕         | **只在 `?reason=connection-error` 時**（`showRetry`）        | `window.location.reload()` —— **整頁重載**，讓 `AuthService` 重跑一次 `/api/me`（實測，見下） |

### ⚠️ 三個條件式元素互斥的方式跟直覺不一樣

- **`?error=` 與 `?reason=` 不是同一個開關**：`reason=connection-error` 走的是另一段
  `if`，它會**覆蓋** `error()` 並額外打開 `showRetry`。兩個參數同時帶時
  `reason` 的訊息會蓋掉 `error` 的（讀 `login.component.ts` 的建構子順序；**未實測**）
- **「還沒報名？前往報名」只有 `signup_disabled` 一種情況會出現** ——
  `access_denied` 與未知錯誤都不會。這是刻意的：沒登記的人要的是報名入口，
  不是「再試一次」
- **「重試」與「還沒報名」不會同時出現**（各自綁不同的參數）
- **✕ 會把「重試」一起關掉**。`重試` 那顆鍵**巢狀在 `@if (error())` 裡面**
  （不是跟它平行），所以關掉錯誤提示等於連重試入口一起收走。
  **實測**：按 ✕ 之後 `.inline-notice--error` 與 `.login__retry-btn` 同時消失，
  `<main>` 可見互動元素從 3 個掉到 1 個。改版時若想保留重試鍵，要把它移出那個 `@if`

## 狀態

| 狀態                       | 畫面                                                        |
| -------------------------- | ----------------------------------------------------------- |
| 預設（無參數）             | 標題 + 副標 + LINE 鍵 + 頁尾兩行。**可見互動元素 1 個**     |
| `?error=signup_disabled`   | 多出錯誤提示（含 ✕）與「還沒報名？前往報名」。**可見 3 個** |
| `?error=access_denied`     | 多出錯誤提示（含 ✕），**沒有**報名連結。**可見 2 個**       |
| `?error=<未知>`            | 同上，訊息換成通用文案。**可見 2 個**                       |
| `?reason=connection-error` | 多出錯誤提示（含 ✕）與「重試」。**可見 3 個**               |
| 送出中                     | LINE 鍵 disabled、文字變 `前往 LINE...`（**未驗**）         |
| 已登入                     | **看不到這一頁** —— `guestGuard` 把人轉去角色 shell（實測） |
| 載入中 / 空狀態            | 不適用 —— 進頁不取任何資料                                  |

## 驗證紀錄

- **日期**：2026-09-12 ／ **前端版本**：`9f08061a`（主 checkout 的 dev server，port 4200）
- **視窗**：1504 × 695
- **登入狀態**：**已登出**（`POST /api/auth/sign-out` → `200 {"success":true}`）

### 兩向比對（五種狀態各量一次）

| 網址                             | `<main>` 可見互動元素 | 實際是哪幾個                                                                          |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `/login`                         | **1**                 | `login__line-btn`                                                                     |
| `/login?error=signup_disabled`   | **3**                 | `inline-notice__close`、`login__line-btn`、`login__enroll-link`（href `/enrollment`） |
| `/login?error=access_denied`     | **2**                 | `inline-notice__close`、`login__line-btn`                                             |
| `/login?error=zzz_unknown`       | **2**                 | `inline-notice__close`、`login__line-btn`                                             |
| `/login?reason=connection-error` | **3**                 | `inline-notice__close`、`login__retry-btn`、`login__line-btn`                         |

每一種狀態的不可見元素都是 **0**（總數 = 可見數）。

| 方向        | 結果                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 地圖 ⊆ 畫面 | 4 項全部在對應的狀態下量到（LINE 鍵 5 種狀態都在；✕ 在 4 種帶參數的狀態都在；報名連結只在 `signup_disabled`；重試只在 `connection-error`）✓ |
| 畫面 ⊆ 地圖 | 五種狀態合計出現過的 4 種元素全部有列，沒有第 5 種 ✓                                                                                        |

**差異：0 筆。**

錯誤文案也逐字對過 `<main>` 的文字，四種都與 `oauth-error.ts` / `login.component.ts` 一致。

### 已登入時被 `guestGuard` 轉走（實測）

帶著 admin session 開 `http://localhost:4200/login`，等 3 秒後
`location.href` 是 `http://localhost:4200/admin/dashboard`。

### 三顆條件式按鍵的實按結果

| 按了什麼           | 結果                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| ✕（關閉訊息）      | `.inline-notice--error` 與 `.login__retry-btn` **同時消失**，`<main>` 可見互動元素 3 → 1                |
| 重試               | **整頁重載**（`performance.getEntriesByType('navigation')[0].type === 'reload'`，頁面上預埋的變數消失） |
| 還沒報名？前往報名 | 網址變 `/enrollment`，**頁面上預埋的變數還在 → 是 SPA 導覽不是整頁重載**；`<main>` 是報名頁的佔位內容   |

#### ⚠️ 「重試」按下去看起來像沒反應 —— 而那是對的

`window.location.reload()` **不會清掉網址參數**，所以重載後 `?reason=connection-error`
還在，建構子再讀一次、錯誤提示原封不動回來。**畫面上的差異是零。**

但這不是缺陷：這顆鍵要修的是「`/api/me` 剛才 5xx」那個暫時狀況。重載時 `guestGuard`
會重打一次 `/api/me` —— **真的復原了的話使用者會被轉去自己的 shell，根本不會再看到
這一頁**。本輪量到「錯誤又回來」是因為測試當下**真的是登出狀態**，`/api/me` 本來就該失敗。

**把它寫成缺陷之前要先分清楚這兩種情況** —— 它們在畫面上一模一樣。

### ⚠️ 這三顆是用程式化 `click()` 按的，不是真滑鼠

**必須寫出來，因為它決定這三筆的證據等級。**

本輪後半段 `computer` 工具的真滑鼠點擊**完全不再送達頁面**：在 `document` 上掛 capture
監聽器之後，連續 8 次空點（不同座標、涵蓋整個視窗）加上 `hover` + `click`，**一個 click
事件都沒有記錄到**，而同一批次的 `javascript_tool` 與截圖都正常。（同一個 session 前半段
的真滑鼠點擊是正常的 —— `/link-line` 的「稍後再說」就是真按的。）

所以改用 `element.click()`。**它會觸發 Angular 的事件繫結**（已驗證：同一顆 ✕ 用真滑鼠
點沒反應、用 `click()` 就正常關閉），但它是 `isTrusted: false` 的合成事件，
**驗不到任何依賴真實指標事件的行為**（`pointerdown`、hover 才出現的東西、失焦才關的浮層）。
這三顆都是單純的 `(click)` 繫結，所以結論站得住；**換成別的元件不一定。**

> **這個坑值得所有 Phase 1 席位知道** —— 見 [[specs/sitemap/README|方法頁]]
> 「按了但根本沒送到」那一節。它跟 Phase 0 記的「按兩次等於沒按」症狀一模一樣，
> **而兩者都長得像「這個元件壞了」。**

### 未驗到的

| 項目                           | 原因                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **按「使用 LINE 登入」**       | **會整頁離開到 line.me 的授權頁，而且下一步就是把一個真的 LINE 帳號綁上 demo 使用者。寫入類，不按**            |
| 送出中的畫面（`前往 LINE...`） | 同上，要先按那顆鍵才看得到                                                                                     |
| 三顆條件式按鍵的**真滑鼠**行為 | 工具的真滑鼠點擊在本輪後半失效（見上）。合成 `click()` 的結論對 `(click)` 繫結成立，對指標／焦點相關行為不成立 |
| `?error=` 與 `?reason=` 同時帶 | 讀原始碼推論 `reason` 會蓋掉 `error`，**未實測**                                                               |
| 手機寬度                       | 本輪只量 1504px 桌機寬度                                                                                       |
