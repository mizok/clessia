---
title: 部署後舊分頁的 chunk 載入失敗復原
summary: 舊 index 要不到新 chunk 時，導覽失敗自動重載一次、預載失敗顯示提示條；以及為什麼偵測不能靠 ChunkLoadError 或 404。
category: architecture
tags: [architecture, resilience]
status: active
updated: 2026-10-23
---

# 部署後舊分頁的 chunk 載入失敗復原

## 問題

部署之後，仍然開著的舊分頁手上是**舊版的 `index.html`**，它引用的是舊的 hash 檔名。
使用者點進一個 lazy route，瀏覽器去要那個已經不存在的 chunk —— 失敗，
而 Angular router 在導覽出錯時會 `restoreHistory` 把網址復原，**畫面就停在空白**。

2026-09-05 使用者實際撞到：設定頁全空，看起來像功能壞了。

## 兩個必須先修正的前提

工單原本的描述有兩處與這個專案的實際情況不符。兩處都會讓照著寫的偵測**一次都不命中**。

### 一、沒有 `ChunkLoadError`

`ChunkLoadError` 是 **webpack** 的產物。本專案的 builder 是
`@angular/build:application`（esbuild），路由用的是原生 `import()`
（`apps/web/src/app/app.routes.ts` 全部是 `loadComponent: () => import(...)`）。

失敗時丟出來的是瀏覽器措辭的 `TypeError`，**沒有 `ChunkLoadError` 這個名字**。
各家措辭還不一樣：

| 瀏覽器  | 訊息                                                 |
| ------- | ---------------------------------------------------- |
| Chrome  | `Failed to fetch dynamically imported module: <url>` |
| Firefox | `error loading dynamically imported module: <url>`   |
| Safari  | `Importing a module script failed.`                  |

**所以偵測只能靠形狀，不能靠名字。**

### 二、不會有 404

`apps/web/public/_redirects` 是 `/*  /index.html  200` —— Cloudflare Pages 的 SPA fallback。

它的效果是：**要不到的 chunk 不會回 404，會被重寫成 `index.html`，狀態 200、
`Content-Type: text/html`。** 所以除了上面的措辭，還可能是 MIME 型別錯誤：

> Failed to load module script: Expected a JavaScript module script but the server
> responded with a MIME type of "text/html".

**「等 404」的偵測會永遠等不到。**

> **2026-10-16 更新**：#1611 之後，**不存在的雜湊檔會回 404**（不再被重寫成 index.html）。
> 所以現在多半是「Failed to fetch dynamically imported module」那一類措辭；MIME 型別那條保留，
> 因為 CDN 邊緣可能還在發舊的規則。偵測式本來就寫寬，兩種都認。

> 這兩條也解釋了為什麼這個問題會拖到使用者撞上才被發現：它不會在 console
> 留下任何一眼認得出來的東西，而 SPA fallback 把「檔案不見了」偽裝成「拿到一個網頁」。

## 決策

使用者裁定（2026-09-05）：**導覽失敗自動重載，預載失敗顯示提示條。**

| 觸發                                        | 行為                                                  |
| ------------------------------------------- | ----------------------------------------------------- |
| **導覽時** chunk 載入失敗                   | 自動重載一次（帶防迴圈旗標）—— 使用者本來就在等這一頁 |
| **預載時** chunk 載入失敗                   | 顯示「已有新版本 · 重新載入」提示條，由使用者挑時機   |
| 重載之後**仍然**失敗                        | 不再重載，顯示錯誤 —— 不無限轉                        |
| **按鈕／元件裡的 `import()`** 失敗（#1718） | 顯示提示條，**不自動重載**，也**不顯示成業務錯誤**    |

### 按鈕／元件裡的 `import()`（#1718，2026-10-16）

匯出 Excel、匯入名冊、到班打卡的相機、公開表單的機器人驗證，都是按下去才 `import()`。
**它們各自有 `catch`，會把 chunk 失敗吃掉、顯示成「匯出失敗，請稍後再試」「檔案讀取失敗」「相機無法使用」** ——
到不了全域的 ErrorHandler，而使用者會照著訊息一直重試（重試也一樣失敗）。

- 這些 `catch` 一開頭先問 `AppVersionService.recoverFromImportFailure(err)`：是 chunk 失敗就亮提示條、回 `true`，
  呼叫端就不顯示業務錯誤
- **不自動重載**：按鈕觸發的當下，畫面上可能有選好的檔案、填好的表單，重載會沒收它們
- **沒有自己 `catch` 的不用接**：選身分、儀表板的點名彈窗是 template 事件或 `void` 呼叫，失敗會變成
  unhandled rejection，`provideBrowserGlobalErrorListeners` 交給全域 handler，本來就會亮提示條
- **新增按鈕裡的 `import()` 時**：如果包在 `try/catch` 裡，`catch` 第一行就要問這一句

> **LINE 登入那次（使用者 10-16 撞到的）其實不是 chunk**：那條路上沒有 `import()`（`authClient` 是靜態 import）。
> 比較可能是連線層的 `TypeError: Failed to fetch`，原始錯誤被 `catch` 丟掉了，所以查不到。
> 修法是把原始錯誤記下來（網址的 query 遮掉），訊息改成「連不上伺服器，請重新整理頁面後再試」。

### 為什麼預載失敗不直接自動重載

`app.config.ts` 用 `withPreloading(PreloadAllModules)`，43 條路由在首次導覽完成後
全部預載。所以**部署後舊分頁不需要使用者做任何事就會撞到失敗**。

在那個時間點自動重載，等於可能在使用者正在填表時把輸入清掉。
提示條是被動通知，不打斷 —— 使用者知道有新版本，但何時重載由他決定。

### 為什麼預載失敗也不能忽略不管

讀 `@angular/router` 的實作：

```js
router.events
  .pipe(
    filter(NavigationEnd),
    concatMap(() => this.preload()),
  )
  .subscribe(() => {});
```

`subscribe` **沒有 error callback**。所以預載失敗會冒到全域
（被既有的 `provideBrowserGlobalErrorListeners()` 接住），而且因為 `concatMap`
掛在同一條訂閱上，**第一次失敗就讓整個預載機制永久死掉**。

也就是說：舊分頁會丟出**一次**失敗然後預載全滅，而使用者**完全不會察覺**，
直到他點進某一頁看到空白。提示條補的正是這個缺口。

## 拒絕的替代方案

**「任何 chunk 失敗都自動重載」** —— 程式碼最少、復原最快。否決的理由是上面那條：
預載失敗發生在背景、與使用者的動作無關，在那個時機重載會沒收未存的輸入。

**「在每個 lazy route 包 `catch` 重試」** —— 要改 43 條路由，而且重試同一個
已經不存在的 hash 檔名沒有意義（它不是網路抖動，是檔案真的不在了）。

**「用 Service Worker 控制版本」** —— 能做得更好（可以先偵測到新版本再提示），
但那是另一個量級的工程，而且本專案目前沒有 SW。這一刀不引入。

**「提示條用 `app-inline-notice`」** —— 那支元件沒有動作按鈕，而提示條的重點就是
那顆「重新載入」。改它會影響既有的 11 處用法。root component 的提示條用純標記寫，
**零新依賴** —— `app.component.ts` 有一條明文約束：不要再往 root 加 UI 依賴
（曾經因為 DynamicDialog 讓初始 bundle 多 140 kB）。

## 提早知道有新版（#1723）

上面的復原都要等舊分頁**真的去要一個不在的 chunk** 才觸發。在那之前，舊前端照樣打新的 API。
`AppVersionService.checkForNewVersion()` 在**開站一次、回到前景（節流 60 秒）**時，用
`cache: 'no-store'`＋`?v=時間戳` 抓線上的 `index.html`，比它引用的入口檔名
（`main-<內容雜湊>.js`）跟自己載入的那支；不一樣就 `markStale()` 亮同一條提示條。

- **比入口檔名，不比 commit sha**：sha 每次部署都變，只改 API、只改文件的部署也會讓所有分頁
  亮「有新版本」—— 狼來了。入口檔名是內容雜湊，前端產物沒變它就不變。
- **lazy chunk 改了，入口檔名會跟著變**（2026-10-23 實測：只改班級視角一個模板，那支 chunk 改名、
  `main-CKOO7OEG.js` → `main-DUELNGWS.js`；只改註解空白、產物不變時兩者都不變）。入口檔引用 lazy
  chunk 的檔名，雜湊會往上傳。萬一哪天換 builder 不再往上傳，下一次導覽時上面的 chunk 404 重載仍會接住。
- **不另放 `/version.json`**：要改 build、要加 `_headers` 不快取，而且不存在的檔被 SPA fallback 回成
  HTML 的坑（#1599）會讓它讀到 index.html。直接讀 `index.html` 沒有這些事，自架也自動成立（c12）。
- 讀不到、非 2xx、回來的頁面裡找不到入口檔名（錯誤頁、維護頁）→ 當作沒比到，**不**亮。
- dev server 的入口是 `main.js`（沒有雜湊）→ 拿不到自己的入口檔名，整個不比。

## 防迴圈

旗標存 `sessionStorage`（不是 `localStorage`）—— 它跟著分頁走，
關掉分頁就重置，不會讓「三天前那次失敗」影響今天。

清除時機是**下一次成功導覽**。所以：

- 部署 → 重載 → 成功 → 旗標清掉 → 同一個 session 裡的下一次部署還能再救一次
- 部署 → 重載 → **還是失敗**（例如 CDN 邊緣仍在發舊的 `index.html`）→ 旗標還在
  → 不再重載，顯示錯誤條

## 已知的不確定

**實際的錯誤措辭要等線上驗證。** 因為 SPA fallback 會把缺檔偽裝成 200 text/html，
Chrome 究竟丟 `Failed to fetch dynamically imported module` 還是 MIME 型別錯誤，
在本機重現不出來（本機 dev server 沒有那個 rewrite）。

所以偵測**刻意寫寬**，並且**把原始錯誤訊息記進 console**。
線上撞到第一次之後，就能拿真實措辭把偵測收窄。
在那之前，寧可多攔一點（多攔的代價是一次不必要的重載，少攔的代價是使用者看到空白）。
