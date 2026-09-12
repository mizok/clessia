---
title: 學生表單對話框（子頁面，3 頁共用）
summary: StudentFormDialogComponent 的 UI 地圖：新增與編輯共用一支，而三個開啟點傳的 data 不同、欄位也不同。
category: spec
status: developing
tags: [sitemap, _shared, admin]
created: 2026-09-12
updated: 2026-09-13
---

# 學生表單對話框（子頁面）

`StudentFormDialogComponent`（`features/admin/pages/students/student-form-dialog.component.*`）。

## ⚠️ 同一支對話框，三個開啟點，能力不同

**這是改版最容易踩到的一點**：讀單一頁面的地圖會以為它永遠長一樣。

| 開啟點                             | 傳進去的 `data`                    | 模式 | 家長欄 |
| ---------------------------------- | ---------------------------------- | ---- | ------ |
| `/admin/students` 的「新增學生」   | `{ student: null }`                | 新增 | **有** |
| `/admin/students` 列選單的「編輯」 | `{ student }`                      | 編輯 | 無     |
| `/admin/parents` 的「新增學生」    | `{ student: null, parentId: ... }` | 新增 | **無** |
| `/admin/students/:id` 的「編輯」   | `{ student: s }`                   | 編輯 | 無     |

條件逐字是 `showParentPicker = isCreateMode() && !presetParentId`
（`student-form-dialog.component.ts:67`）—— 從家長頁建立時那個學生**必然**綁到該家長，
所以選擇器沒有意義；從學生頁建立時留空則是「無家長學生」。

**三個開啟點都確認過是真路由**（`app.routes.ts` 都是 `loadComponent`，不是 `redirectTo`）。

## 畫面區塊

無標準 dialog header（`showHeader: false`），標題在內容區自己畫，右上角一顆 `×`。
寬度 `560px`，modal。

- **標題**：`isCreateMode() ? '新增學生' : '編輯學生資料'`
- **表單**：單欄，欄位見下表
- **底部動作列**：`取消` ／ `建立學生`（新增）或 `儲存`（編輯）

## 互動元素

| 元素（畫面上的字）                                           | 類型     | 出現條件                                   | 按了之後                                                   |
| ------------------------------------------------------------ | -------- | ------------------------------------------ | ---------------------------------------------------------- |
| `×`（右上）                                                  | 圖示鈕   | 永遠                                       | `cancel()` —— 關閉，不回傳                                 |
| `姓名*`／`請輸入學生姓名`                                    | 文字輸入 | 永遠                                       | 必填之一                                                   |
| `家長（選填）`／`輸入姓名搜尋既有家長，留空即建立無家長學生` | 自動完成 | **僅 `isCreateMode() && !presetParentId`** | 搜尋既有家長                                               |
| `年級*`／`選擇年級`                                          | 下拉     | 永遠                                       | 必填之一                                                   |
| `就讀學校*`／`選擇或搜尋學校`                                | 下拉     | 永遠                                       | 必填之一；可就地新建（見下）                               |
| `建立` ／ `取消`（學校）                                     | 按鈕     | **僅 `creatingSchool()`**                  | `建立` 在 `!newSchoolName().trim()` 時 **disabled**        |
| `生日`／`選擇生日`                                           | 日期     | 永遠                                       | 開日曆浮層                                                 |
| `性別`／`選擇性別`                                           | 下拉     | 永遠                                       | —                                                          |
| `學生電話`／`0912-345-678`                                   | 電話     | 永遠                                       | —                                                          |
| `學生 Email`／`student@example.com`                          | Email    | 永遠                                       | —                                                          |
| `居住地址`／`完整居住地址`                                   | 文字     | 永遠                                       | —                                                          |
| `緊急聯絡人姓名`／`緊急聯絡人`                               | 文字     | 永遠                                       | —                                                          |
| `緊急聯絡人電話`／`緊急聯絡電話`                             | 電話     | 永遠                                       | —                                                          |
| `備註`／`特殊需求、注意事項...`                              | 多行文字 | 永遠                                       | —                                                          |
| `取消`                                                       | 按鈕     | 永遠（`loading()` 時 disabled）            | 關閉，不回傳                                               |
| `建立學生` ／ `儲存`                                         | 按鈕     | 永遠                                       | **只在 `loading()` 時 disabled**；驗證沒過會逐欄標錯，見下 |

### 送出鍵：**按得下去，驗證沒過就逐欄標錯**（#716／PR #718）

**這一段在 2026-09-12 當天被改掉了，本頁已同步。**

原本是 `[disabled]="!isFormValid()"` —— 必填沒填時按下去**真的什麼都不會發生**：
沒有 toast、沒有欄位標記、沒有任何解釋。

現在：

- `[disabled]="loading()"` —— **只有送出中才擋**
- `save()` 先跑 `validate()`，**一次收集全部錯誤**（不是遇到第一個就 return），
  寫進 `errors` signal → 欄位標紅 + 欄位下方訊息
- toast 降為**輔助**，不再是唯一訊號

判準（逐字出自 `component.ts:155-166`）：

> **`disabled` 是把「為什麼不行」藏起來，而那正是使用者最需要知道的。
> 按不下去的按鈕不會解釋原因，按得下去的才會。**
> 例外是「按下去會產生後果」的按鈕 —— 而 `loading()` 期間正是那種情況（重複建立）。

三個必填 `name` / `grade` / `schoolId`，訊息分別是
`請填寫姓名` / `請選擇年級` / `請選擇就讀學校`。

> ⚠️ **本頁初版寫的是舊行為**（「剛打開時 `建立學生` 是 disabled」）——
> 那是量測當下的事實，**而它在同一天就過期了**。地圖記現況，現況變了就要跟著改。

## 狀態

`loading()` 為真時**所有輸入與取消鍵都 disabled**，送出鍵轉成 spinner 圖示。
**未驗** —— 那需要送出一次寫入，而地圖驗證不做寫入。

## 驗證紀錄

- **狀態**：已驗（新增與編輯兩種模式）
- **前端版本**：`650d257a`（自架 `:4210`，非 `:4200` —— 後者服的是主 checkout）
- **做法**：從 `/admin/students` 分別開新增與編輯，DOM + visible 濾網取元素，取消關閉後
  斷言 `.p-dialog === null`
- **先預測再實測**：依 `showParentPicker` 的條件預測「編輯模式應該少一欄（家長）、
  標題是編輯學生資料、送出鍵是儲存」—— 實測 11 欄（新增 12 欄）、逐項命中
- **重驗**：送出鍵那一段在 PR #718 之後**重讀原始碼**更新（未重新實機 ——
  改動是換掉 `[disabled]` 並新增 `errors` signal，可見差異在「按下去會發生什麼」，而那是寫入路徑）
- **未驗**：`creatingSchool()` 的就地新建學校分支（會寫入）、`loading()` 狀態、
  從 `/admin/parents` 與 `/admin/students/:id` 開啟的那兩條路徑
  （條件已從原始碼確認，畫面未實測）

## 390px


> ⚠️ **2026-09-13 訂正：上面的對話框尺寸是在 ResizeObserver 失效的環境下量的。**
> `--shell-layout-body-height` 靠 `InheritSizeDirective` 的 ResizeObserver 寫入，
> 而**它在 MCP 的背景分頁 iframe 裡不觸發** —— 於是 `styles.scss:721-722` 的
> `max-height: calc(var(--shell-layout-body-height) - …)` 的 `calc()` 無效，
> **computed 值是 `none`，對話框不受限**。
>
> **真實瀏覽器裡對話框會被限制在 `shell body 高 − 24px`（本輪環境是 `700px`），
> 超出的部分由 `.p-dialog-content` 捲動。** 上面的高度數字要照這個重新讀：
> **矮於 700 的那些是真的，高於 700 的只會出現在這個量測環境裡。**
> 全文與正控見[方法頁](../README.md)的「ResizeObserver 在這個環境完全不觸發」。
- **量測**：390 × 844 與 1504 × 752（對話框只記「版面怎麼變」，不重抄元素表）
- **前端**：主 checkout 的 dev server（port 4200），`543e5eda`
- **手段**：同源 iframe 當 viewport；**開啟一律用 `element.click()`（合成事件，坑 6 的等級標記）**，
  關閉後用輪詢斷言消失（坑 9），疊層時比對**數量**不是 `=== null`

### ⚠️ 這一頁曾經被開成 P1（#784），而那一單已撤回 —— 成因是量測環境

**下面這組數字只存在於 ResizeObserver 失效的環境裡**（見本節開頭的訂正）。
留著是因為**它示範了那個環境缺口會長成什麼樣**：一個看起來完全成立的 P1。

| | 390 × 844 |
| --- | --- |
| `.p-dialog` | **`390 × 1130 @0,-143`** |
| 佔高比 | **`1.34`** |
| 對話框範圍 | **`-143 .. 987`**（視窗是 `0 .. 844`） |

五顆按鈕**只有兩顆在視窗內**：

| 按鈕 | `top..bottom` | 在視窗內 |
| --- | --- | --- |
| `Close`（`.dialog-header-inline__close`） | **`-112 .. -80`** | **否（上方）** |
| 日期選擇器的 icon | `198 .. 229` | 是 |
| `Choose Date` | `274 .. 312` | 是 |
| **`取消`** | **`913 .. 954`** | **否（下方）** |
| **`建立學生`** | **`913 .. 954`** | **否（下方）** |

**三種捲動方式都到不了**（`mask.scrollTop` / `documentElement`+`body.scrollTop` /
`scrollIntoView({block:'center'})`，關閉鈕的 `top` 始終是 `-112`）。

機制：`.p-dialog-mask` 是 `display: flex; align-items: center; overflow: visible`
（`clientHeight 844` / `scrollHeight 987`）——**flex 置中讓對話框往兩端溢出，
而 `overflow: visible` 不產生捲軸**。`.p-dialog-content` 雖然是 `overflow-y: auto`，
但它 `scrollHeight === clientHeight`（1128），**自己也沒有捲動空間**。

**點遮罩不關**（已驗；`students.page.ts:294-299` 沒傳 `dismissableMask`，PrimeNG 預設 `false`
——程式碼與實測兩個獨立來源對上）。**`Escape` 未驗**（只能發合成事件）。
**這兩項跟 ResizeObserver 無關，所以仍然成立** —— 只是在對話框不再溢出之後，
它們不構成「關不掉」，因為內容區底部的 `取消` 本來就按得到。

> **當時我把它讀成 #714 那條規則在窄寬度下失效** —— 而那個推導每一句都站得住腳，
> 那正是它通過檢查的原因。**擋得住它的只有一個問題：「這個環境的 ResizeObserver 活著嗎」**，
> 而我在開單前做了三種捲動測試、查了 `dismissableMask`、比對了 #714，**就是沒問那一句**。
>
> **真實瀏覽器裡**：`max-height` 生效 → 對話框 `700`、範圍 `72..772`、
> 關閉鈕 `103..135`、`取消`/`建立學生` `698..739`、內容區 `698 → 1128` 可捲 ——
> **三件事（限高、內容捲動、按鈕在框內）本來就都有。**

### 觸控目標 < 44px

390 下可見的 16 個互動元素裡，**10 個以上低於 44**（`p-autocomplete-input` `356 × 38`、
三組 `p-select` 的 label `314/274 × 40` 與 trigger `40 × 40`、`p-datepicker-input` `316 × 38`、
`p-datepicker-dropdown` `40 × 38`…），**沒有一個被 coarse 規則接住**。

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| **按「建立學生」** | **寫入類動作，一律不按** |
| 真 `Escape` | 需要前景分頁（坑 12）。**這一項決定 #784 的嚴重度** |
| 1504 的尺寸 | 本輪把時間花在確認 390 的缺陷上；`width: '560px'`（`students.page.ts:295`） |
| 另外三個開啟點 | 照計畫席「從任一個開啟點開一次就好」。**但它們的表單欄位不同（Phase 1 已記），高度也會不同** |

## 載入中 / 錯誤

- **量測**：390 × 844 ／ 主 checkout 的 dev server（port 4200）`7e9da649`
- **手段**：同一個 XHR 包裝 —— 錯誤態把 URL 從 `:8787` 改指到沒人監聽的 `:8799`，
  載入中把 `send` 用 `setTimeout` 延後 3 秒（**只影響那一個 iframe，不動 8787、零寫入**）。
  方法全文見[方法頁 Phase 2-D](../README.md)
- **證據**：每一輪都確認攔截清單不是空的，**請求數 0 的一律作廢**（例外要自己附正控）

**開啟點**：`/admin/students` 的「新增學生」／每列的編輯。本輪從「新增學生」開。
攔到 `GET /api/schools?isActive=true` 一支（家長是輸入時才查，不在開啟時打）。

### 載入中（3 秒延遲）

| skeleton | spinner | 對話框內互動元素 | 判定 |
| --- | --- | --- | --- |
| **0** | **0** | 17（與載入後相同） | ⚠️ **沒有載入訊號，但也沒有說謊** |

整張表單在延遲期間就已經渲染完成且可填，「就讀學校\*」的下拉顯示佔位字
「選擇或搜尋學校」——**跟「學校清單是空的」長得一樣**。

### 錯誤（學校清單失敗）

| 判定 | 重試鈕 | toast | 攔到的請求數 |
| --- | --- | --- | --- |
| 🔴 **必填欄位靜靜變成空的** | 否 | **0（畫面上）** | 1 |

實測元件狀態（`ng.getComponent`）：

| | 正常 | 失敗 |
| --- | --- | --- |
| `schools` | **`len=24`** | **`len=0`** |
| 畫面上的 `.p-toast-message` | 0 | **0** |

**「就讀學校」是必填**（`就讀學校*`），所以清單空掉之後這張表單填不完，而畫面上沒有任何說明。

### 🔴 為什麼沒有 toast —— 它有寫，只是沒有出口

`student-form-dialog.component.ts:145-151` 的 `error:` **確實** `messageService.add({ summary: '載入失敗', detail: '無法載入學校清單' })`。

**決定性檢查**（執行期比對兩個實例）：

```
ng.getComponent(<students 頁>).messageService === ng.getComponent(<對話框>).messageService
  → false
```

`students.page.html:1` 的 `<p-toast>` 綁的是**頁面**提供的 MessageService（`students.page.ts:97`），
而對話框自己 `providers: [MessageService]`（`:41`）、模板裡**沒有 `<p-toast>`**
→ **它 add 的每一則訊息都沒有訂閱者。**

**同一個形狀還有三支**（`providers` 有 `MessageService`、自己的模板沒有 `p-toast`）：
`grades/overview/class-view`、`grades/overview/student-view`、`score-entry/school-score-editor`。
**已開 issue #809 給計畫席**（不順手修）。

> **這一則改變了修法方向**：把它記成「這一頁沒有錯誤處理」會導向「補一則 toast」，
> 而 toast 已經寫好了，補第二則一樣不會出現。

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| 家長搜尋（`parentSuggestions`）失敗的樣子 | 那支請求要**輸入文字**才會打，本輪沒有輸入（`parentSuggestions: len=0` 是「還沒查」不是「查失敗」） |
| 送出失敗的樣子 | 寫入類動作，一律不按 |
| 編輯既有學生時的樣子 | 只從「新增」開 |
