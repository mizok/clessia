---
title: 孩子切換器（家長端四頁共用）
summary: 家長端橘色頁首上的孩子徽章與切換下拉；三種形態（可切換／靜態／讀取失敗）由 ChildScopeService 決定。
category: spec
status: developing
tags: [sitemap, _shared, parent]
created: 2026-09-12
updated: 2026-09-13
---

# 孩子切換器（ChildSwitcher）

**元件**：`@features/parent/shared/child-switcher/child-switcher.component`
**狀態來源**：`@core/child-scope.service`（`ChildScopeService`，`providedIn: 'root'`）

**四個頁面用它**（`grep -rl app-child-switcher`，排除元件自己）：

- [[specs/sitemap/parent/dashboard]]
- [[specs/sitemap/parent/attendance]]
- [[specs/sitemap/parent/grades]]
- [[specs/sitemap/parent/payments]]

≥ 2 個使用點，所以照[[specs/sitemap/README|方法頁]]的規則獨立成一頁；
上面四頁只放連結，**不要各自抄一份**（c11）。

> **家長端其餘六頁（課表查看／試聽申請／報名申請／加選課程／續課資訊／餐費紀錄）
> 沒有這個東西** —— 它們是 `EmptyState` 佔位頁，連「現在在看哪個孩子」都不顯示。

## 它長在哪裡

在 `app-page-band`（橘色頁首橫幅）的**左上角**，頁面標題的上方。

## 三種形態 —— 這是這一頁最重要的一段

`child-switcher.component.html` 的分支順序就是判斷順序：

| 條件                      | 渲染出什麼                                                    | 可互動？ |
| ------------------------- | ------------------------------------------------------------- | -------- |
| `status() === 'failed'`   | 紅色徽章 `讀不到孩子資料`                                     | 否       |
| `children().length > 1`   | **按鈕**徽章：孩子名字 + `pi-chevron-down`（`--interactive`） | **是**   |
| `children().length === 1` | **靜態** `<span>` 徽章，只有名字，沒有箭頭                    | 否       |
| `children().length === 0` | **整個元件什麼都不渲染**                                      | —        |

`canSwitch()` 就是 `children().length > 1` ——
**跟角色徽章「單一角色不給互動」是同一條規則**（`ChildScopeService` 的註解明寫）。

### ⚠️ `failed` 那一支是刻意存在的，不要當成多餘的分支刪掉

`ChildScopeService._status` 的註解寫得很清楚（#484 M4）：
**`failed` 必須跟「這個帳號沒有孩子」分開**。兩者都會讓 `children()` 是空陣列，
而空陣列時切換器整個不渲染、家長端三頁的 effect 也因為 `activeChildId` 是 null 而不打 API ——
**結果是一個完全空白、沒有任何訊息的家長端，跟「還沒綁孩子」一模一樣。**

## 互動元素

| 元素（畫面上的字） | 類型           | 出現條件                    | 按了之後                   |
| ------------------ | -------------- | --------------------------- | -------------------------- |
| `<孩子名字>` ⌄     | 按鈕（toggle） | **`children().length > 1`** | 開／關下拉（見下方子頁面） |
| `<孩子名字>`       | 靜態徽章       | `children().length === 1`   | —（不是按鈕）              |
| `讀不到孩子資料`   | 靜態徽章       | `status() === 'failed'`     | —（不是按鈕）              |

## 子頁面：切換孩子（下拉）

**開啟方式**：按徽章。**是 PrimeNG 的 `p-popover`，不是對話框。**

**選擇器**（本 repo 的正確答案，加進[[specs/sitemap/README|方法頁]]的選擇器表）：

| 東西       | 選擇器                                                   |
| ---------- | -------------------------------------------------------- |
| 浮層本體   | `.child-switcher-overlay`（實際 class 還帶 `p-popover`） |
| 標頭文字   | `.child-switcher__list-title`                            |
| 每一個選項 | `.child-switcher__list-item`                             |

**不是** `.p-dialog`、**不是** `.popup-menu__panel` —— 實測 `.p-dialog` 與 `.p-drawer` 都是 `null`。

內容：

- 標頭：`切換孩子`
- **目前選中的孩子不在清單裡**，只列其他孩子（`otherChildren()`）
- 選一個 → `pop.hide()` 然後 `select(child.id)` → `ChildScopeService.setActiveChild()`
  → 各頁的 effect 用新的 `childId` 重新取數

**關閉方式**：再按一次徽章（toggle）、選一個孩子、或點別處失焦。

### ⚠️ 它是 toggle —— Phase 0 差點因此送出一支假 P1

`(click)="pop.toggle($event, switcherTrigger)"`。**按兩次等於沒按**，而症狀是
「有 3 個孩子的家長換不了孩子」。詳見[[specs/sitemap/README|方法頁]]坑 1。

**本輪又被同一族的東西騙了一次**（坑 6）：用 `computer` 真滑鼠點徽章**完全沒反應**，
而 `document` 上的 capture 監聽器顯示**那一下根本沒產生 click 事件** ——
不是元件壞了，是點擊沒送到。

## 驗證紀錄

- **日期**：2026-09-12 ／ **前端版本**：`9f08061a`（主 checkout 的 dev server，port 4200）
- **視窗**：1504 × 695
- **角色帳號**：`parent01@demo.clessia.app`（家長 林志明）
- **身分斷言**：每次量測前後都打 `GET /api/me`，回傳
  `parent01@demo.clessia.app / ["parent"]`（**理由見下方警告**）

### 實測到的（`children().length === 3`，走 `canSwitch` 那一支）

| 量到什麼                  | 結果                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 徽章                      | `button.child-switcher__badge.child-switcher__badge--interactive`，文字 `林子璿`                               |
| 按一下（合成 click）      | 浮層開啟，class 是 `child-switcher-overlay p-component p-popover`                                              |
| 標頭                      | `切換孩子`                                                                                                     |
| 選項                      | `王柏翰`、`盧安琪` —— **目前的 `林子璿` 不在清單裡** ✓                                                         |
| `.p-dialog` / `.p-drawer` | 都是 `null` ✓                                                                                                  |
| 選 `王柏翰`               | 浮層關閉、徽章變成 `王柏翰`、頁面重新取數（在 `/parent/payments` 上量的：空狀態 → `7200 元待繳 / 2 張待付款`） |

**這是 Phase 0 的 `parent/attendance.md` 標成「未驗」的那一條** ——
本輪實際切換了，而且切換後的畫面有變化，所以下拉與重新取數都成立。

### 2026-09-13 補驗：四種形態驗到三種

`#746` 的 seed 造出了單孩與 0 孩的家長帳號之後補的。

| 形態                   | 帳號                      | 量到什麼                                                                                                                                                |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **≥ 2 孩子（可切換）** | `parent01@` / `parent03@` | `button.child-switcher__badge--interactive` + `pi-chevron-down`，按一次開下拉                                                                           |
| **1 個孩子（靜態）**   | `teacher0005@`            | **`<span class="child-switcher__badge">`** —— 不是 `<button>`、**沒有 `--interactive`、沒有箭頭**。`<main>` 內可見互動元素 **0 個**（≥2 孩子時是 1 個） |
| **0 個孩子（不渲染）** | `teacher0006@`            | **`.child-switcher` 整個不存在**，徽章也不存在。`/parent/attendance` 的可見互動元素只剩 3 顆期間鈕                                                      |
| `status === 'failed'`  | —                         | **仍未驗**（要讓 `GET /api/me/children` 失敗）                                                                                                          |

**「0 個孩子時不打 child API」也一併證實了**：`/parent/attendance` 的
`performance.getEntriesByType('resource')` 只有 `/api/me/children`，
**沒有 `/api/me/attendance`** —— 跟 `ChildScopeService` 的 `activeChildId` 保持 `null`、
各頁 effect `if (!childId) return;` 一致。

#### ⚠️ 驗這兩種形態要先過角色選擇彈窗

`teacher0005@` / `teacher0006@` 是**既有老師帳號加上 `parent` 角色**（`seed.sql` 的取捨：
新建帳號會撞憲法 c2 的 `ba_*` 豁免上限）。**所以它們是 teacher + parent 兩個角色** ——
登入後會先進 [[specs/sitemap/public/select-role]] 的彈窗，選「家長」才進得到這裡。

**兩個測試狀態耦合在同一個帳號上**：角色選擇彈窗壞掉的話，這兩種形態也連帶驗不到。
這是**刻意的取捨不是缺陷**，理由在 `seed.sql` 那一段的註解裡。

#### ~~🔴 0 個孩子那一支露出一支真缺陷（#749）~~ —— 已修

切換器不渲染是**對的**，但**其餘頁面照樣渲染，而且講的是不成立的話**：

- `/parent/attendance` → 逐日清單照常，每天印 **「今日無課」**
- `/parent/payments` → **「目前沒有帳單紀錄」**

**那是在正面斷言「你的孩子沒課／沒帳單」，而這個帳號沒有孩子。**
`ChildScopeService` 的註解預言過這個形狀，但只解決了 `failed` 那一半。
**修法（#749）**：四個依賴孩子的頁面（儀表板／到班紀錄／成績查閱／繳費紀錄）
的內容區包進一支共用的 `app-child-scope-gate`，`status === 'ready' && children().length === 0`
時**改渲染一句明確的話**：

> **這個帳號還沒有綁定任何學生** ／ 請聯絡補習班櫃檯協助綁定，綁定之後這裡就會出現孩子的紀錄。

**規則與措辭集中在一支元件**，四頁不各自長出一種說法。
`/parent/notifications` **刻意不包** —— 公告發給全體家長，沒有孩子照樣該看得到。

> ⚠️ **`status === 'ready'` 那個條件不能省**：`children()` 在載入完成之前也是空陣列，
> 只看長度的話**每次進頁都會先閃一下「你沒有綁定學生」** —— 那對有孩子的家長也說謊。
> `failed` 同理不算（讀不到 ≠ 沒有），那條路有切換器自己的紅色徽章。
> 三條都有反向對照測試守著。

### ⚠️ 原本的「三種形態只驗到一種」（保留，說明當時為什麼驗不到）

本機 `parent01` 固定有 3 個孩子。`canSwitch === false`（單一孩子的靜態徽章）、
`length === 0`（整個不渲染）、`status === 'failed'`（紅色徽章）**三種都沒驗到** ——
要驗得換帳號或讓 `GET /api/me/children` 失敗。

### ⚠️ 量測環境警告：auth cookie 是 host 層級，別席登入會把你踢掉

本輪被踢**三次**，其中一次發生在量測中途，而**畫面上看不出來**：

`/parent/payments` 切到 `王柏翰` 之後顯示「**載入失敗 —— 沒有讀到繳費紀錄，可能是連線問題**」，
而 DB 明明有 2 張帳單。**當下的結論幾乎就是一支缺陷。**

真相是**別席在那幾秒間登入了 admin**，`GET /api/me/billing` 回 `403 NOT_PARENT`。
**而頂列徽章還寫著「家長 / 林志明」** —— shell 不會因為 cookie 變了而重繪，
所以**從 DOM 讀身分會給你一個假的安全通過**。重登之後同一支請求三個孩子全部 200。

**所以身分斷言一律打 `GET /api/me`，不要看畫面。** 這一條已加進[[specs/sitemap/README|方法頁]]。

## 390px

- **量測**：390 × 844 與 1504 × 752（對話框只記「版面怎麼變」，不重抄元素表）
- **前端**：主 checkout 的 dev server（port 4200），`543e5eda`
- **手段**：同源 iframe 當 viewport；**開啟一律用 `element.click()`（合成事件，坑 6 的等級標記）**，
  關閉後用輪詢斷言消失（坑 9），疊層時比對**數量**不是 `=== null`

### 版面怎麼變：**兩個寬度完全相同**

| | 390 × 844 | 1504 × 752 |
| --- | --- | --- |
| 徽章 `.child-switcher__badge--interactive` | `74 × 26 @32,88` | `74 × 26 @504,120` |
| 浮層 | `186 × 130 @32,124` | `186 × 130 @504,156` |
| 佔寬比 | `0.48` | `0.12` |
| 項目（`張宇軒` / `范芷寧`） | `144 × 34` | **`144 × 34`** |

**尺寸一格都沒變** —— 浮層跟著徽章走，位置不同而已。**零響應式。**

> **它不是對話框**：`p-popover`，**沒有 `.p-dialog`、沒有遮罩**（實測遮罩數 0）。
> 所以 #784 那一族的問題在它身上不成立 —— 它不靠 flex 置中。

### 水平溢出

**無** —— 390 下浮層 `left 32 / right 218`，三面都在視窗內。

### 觸控目標 < 44px

| 元素 | 量到 | coarse |
| --- | --- | --- |
| 徽章 | `74 × 26` | **無** |
| 浮層項目 × 2 | `144 × 34` | **無** |

**「切換孩子」這條路徑從頭到尾沒有一個達標的觸控目標** —— 徽章 26、項目 34。
而它是家長端四頁共用的入口。記現況，沒開單。

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| **失焦就關**（坑 5） | 本輪在同一次互動裡讀完，**沒有驗「點別處會不會關」** |
| 單孩／無孩家長 | 那時渲染成靜態 `<span>`，不是互動元素（Phase 1 已記） |
| 768 / 1024 | 兩個極端寬度逐格相同，**中間不可能有斷點**，沒有補量 |

## 載入中 / 錯誤

- **量測**：390 × 844 ／ 主 checkout 的 dev server（port 4200）`7e9da649` ／ `parent01@demo.clessia.app`（三個孩子）
- **手段**：同一個 XHR 包裝 —— 錯誤態把 URL 從 `:8787` 改指到沒人監聽的 `:8799`，
  載入中把 `send` 用 `setTimeout` 延後 3 秒（**只影響那一個 iframe，不動 8787、零寫入**）。
  方法全文見[方法頁 Phase 2-D](../README.md)
- **證據**：每一輪都確認攔截清單不是空的，**請求數 0 的一律作廢**（例外要自己附正控）

資料來源是 `ChildScopeService.load()` → `GET /api/me/children`（攔到 1 支）。

⚠️ **證據等級**：`ChildScopeService` 是 `providedIn: 'root'` 而且有 `loaded` 旗標，
**載入過就不會再取數**，所以攔截器裝好之後沒有東西可攔。本輪的做法是
**重置它的私有狀態再叫一次 `load()`**（`loaded = false`、`_status.set('unloaded')`、
`_children.set([])`、`_activeChildId.set(null)`）——
**這是「重新觸發取數」，不是「首次載入」**，兩者在這支 service 上走同一條 `load()`，
但這一節的證據等級要照實標。

### 載入中（3 秒延遲）

| 徽章在不在 | skeleton | `status()` | `loading()` | 判定 |
| --- | --- | --- | --- | --- |
| **整個不在**（`.child-switcher` 節點不存在） | 0 | `'unloaded'` | `true` | ⚠️ 無訊號，但也沒說謊 |

模板的第一個分支是 `@if (status() === 'failed')`、第二個是
`@else if (children().length > 0)` —— **`'unloaded'` 且清單是空的時候兩個都不成立，
所以整個徽章不渲染**。頂列那個位置在資料回來之前是空的，回來之後才長出「林子璿」。

### 錯誤（API 失敗）

| 判定 | 重試鈕 | toast | 攔到的請求數 |
| --- | --- | --- | --- |
| ✅ **誠實** | 否 | 0 | 1 |

徽章逐字「**讀不到孩子資料**」（`105 × 27`），而不是消失。

> **這一支是全庫少數把「失敗」與「這個帳號沒有孩子」明確分開的元件**，
> 而且理由就寫在 `child-scope.service.ts:16-25` 的註解裡：
> 兩者都會讓 `children()` 是空陣列，而切換器對空陣列的反應是整個不渲染、
> 家長端三頁的 effect 也因為 `activeChildId` 是 null 而不打 API ——
> **結果會是一個完全空白、沒有任何訊息的家長端**（#484 M4）。
>
> **對照組**：`_shared/audit-log-dialog` 與 `_shared/subject-manager` 的 `error:`
> 只做 `loading.set(false)`，沒有 failed 旗標 —— 就是這一則註解在擔心的那件事。

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| **真正的首次載入** | 攔截器裝不到 document 載入之前（見上面的證據等級） |
| 「讀不到孩子資料」之後怎麼重試 | 沒有重試鈕；`load()` 失敗時 `loaded` 會被設回 `false`（`:54`），**所以下一頁的 `ngOnInit` 會再試一次** —— 那一半是讀原始碼得到的，沒有量 |
