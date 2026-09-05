---
title: 家長端三頁前端設計 —— 出缺席／成績／繳費
summary: 家長端 03 片。三頁共用 #344 的 child-switcher，資料走 #351 三支 childId 必填端點。逐項核對 kb specs 與 design-web 構圖跟 #351 實際契約的落差（4 態出勤/日到班時間/每筆 NEW 標籤/課程篩選/已取消分組都對不上），提出降級方案待批准。
category: architecture
status: draft
updated: 2026-09-05
tags: [architecture, parent, attendance, grades, billing]
---

# 家長端三頁前端設計 —— 出缺席／成績／繳費

> **這份文件要計畫席批准才能動工。** 依據 [[architecture/parent-read-endpoints]]（#351，
> API 側已定案，此文件的契約直接讀那支 PR 的 diff，不重述）、
> `kb/wiki/specs/parent/{attendance,grades,payments}.md`（規格權威，但**部分內容比
> #351 舊，跟實際交付的欄位對不上**——見下方逐項核對）、
> `herdr-team/design-web-parent-v1-mockup.md`（構圖提案，**同樣有落在 #351 定案之前
> 寫的假設**）。三頁共用 [[architecture/parent-data-scope]] 的授權模型與 #344 的
> `ChildScopeService`/`ChildSwitcherComponent`（複用，不重造）。

## 這份文件在解決什麼

specs 跟構圖是在 #351 的欄位形狀定案**之前**寫的，兩份參考文件都對「API 會回什麼」
做了樂觀假設。**憲法級的既有先例是「前端不承諾後端沒有兌現的東西」**（admin-pages
charter，`/api/invoices` 分頁篩選、`/api/contact-book` permission 兩個實例）——
這裡是同一個病的第三次發作，只是這次病灶在「規格寫欄位存在，API 沒給」而不是
「API 沒檢查」。逐項核對，每一項落差都要有人拍板要不要因為它去加開一個欄位，
還是這一輪先降級。

## 一、跟現有規格／構圖對不上的地方（逐項待批准）

### 1. 出缺席只有三態，沒有「遲到」

`kb/wiki/specs/parent/attendance.md`、design-web 構圖都寫「出席／遲到／請假／缺席」
四態。**`attendance_records.status` 全系統只有 `present`/`absent`**（`attendance.ts:191`），
`on_leave` 是 #351 的 `ParentAttendanceRecordSchema` 併入請假記錄後才有的第三態。
**「遲到」在整個系統裡從來不存在，不是這次漏接。**

**提案**：畫面只做三態（出席／請假／缺席），不留「遲到」的視覺位置（沒有資料
支撐的狀態不該有 UI，之後如果真的要做遲到，那是先加資料模型再加畫面）。

### 2. 沒有「已到班＋時間」這一行

構圖 ASCII 在每天的課堂列表上方多一行「✓ 已到班 08:12」，來源是 `daily_checkins`
的到班掃碼時間。**#351 的 `GET /api/me/attendance` 只查 `attendance_records`，
完全不觸碰 `daily_checkins`**（`parent-read-endpoints.md` 的「複用哪一段」對照表
裡沒有這張表）。

**提案**：v1 不做這一行，日期底下直接列當天課堂與各自狀態。到班掃碼時間是
「今天早上幾點到」，用途是**當下**確認，跟這頁「回顧歷史」的定位本來就有一點
差異——真的要做，應該問「這值得為它開一支新端點嗎」，不是順手塞進這支。

### 3. 「本月缺席＋請假」目前只有合計，不能分開

計畫席暫定「缺席與請假分開顯示，不合併成一個數字」（標了窗口待確認）。
**`meta.monthlyAbsentCount` 是 `status in ('absent','on_leave')` 的合計**
（`parent/attendance.ts` 的 `monthlyResult` 查詢），沒有拆開的兩個數字，而且
**前端不能自己拆**——分頁只回當頁，用當頁筆數分別數缺席/請假，量大時會悄悄
算少（`parent-read-endpoints.md` 自己講的「billing-api 席前一次帳單分頁事故的
同型坑」，這裡是同一個坑的第三個受害位置）。

**兩個選項，都不是我能自己決定**：

- (a) 請 billing-api 把 `monthlyAbsentCount` 拆成 `monthlyAbsentCount` +
  `monthlyLeaveCount`——兩支查詢已經各自算好其中一半（現有查詢是
  `.in('status', ['absent','on_leave'])` 一次算兩態，拆成兩支 `.eq('status', X)`
  是很小的改動）
- (b) v1 先合併顯示（「本月缺席＋請假 N」一個數字），等 (a) 排進去再拆

**我的建議是 (a)**——這是暫定裁決要落地的必要條件，不是可有可無的加分項，而且
成本很小。但這是要不要再麻煩 billing-api 加一個回合的決定，不是我能自己拍板。

### 4. 成績列沒有「NEW」標籤能貼的欄位

`meta.recentCount` 是「過去 7 天內新登錄」的**聚合數**，但 `ParentScoreRecordSchema`
**沒有 `createdAt`**（`id, type, examName, examDate, subjectName, score, totalScore,
status`），前端沒有任何欄位可以判斷「這一筆是不是那 7 天內登錄的」。錨點數字
（band-anchor 顯示 `recentCount`）沒問題，但**規格要的「每筆成績自己的 NEW 標籤」
做不出來**。

**兩個選項**：

- (a) 請 billing-api 在 `ParentScoreRecordSchema` 加一個 `createdAt`（兩支 select
  已經在撈這欄位算 `recentCount`，只是沒有把它塞進回應物件）
- (b) v1 只顯示彙總的「N 筆新成績」（band-anchor），列表本身不逐筆貼 NEW

同上，**建議 (a)**，理由相同：成本小、規格要的東西補一個欄位就有。

### 5. 成績篩選：沒有課程/學期參數，改用既有的時間範圍 pattern

規格要「課程篩選」「學期篩選（預設當學期）」。`GET /api/me/grades` 的 query 只有
`childId, dateFrom, dateTo, page, pageSize`——**沒有 `subjectId`，也沒有「學期」
這個概念**（「期」是機構自訂的計費日期區間，billing-rules 規則 1，不是學期，
拿計費期間套成「學期篩選」是把兩個不同的業務概念混成一個）。

**提案**：科目篩選在前端做（單一學生一學期的成績量不大，`pageSize` 開到 100～200，
一次拉完再前端篩，**照抄 `student-score-detail-dialog` 現成的 pattern**——
它就是這樣處理 academy+school 混合列表的科目/時間篩選，不是新發明）。
「學期篩選」改成跟 `student-score-detail-dialog` 一樣的**時間範圍**篩選
（近1月／近3月／近半年／全部），不做「學期」這個新概念。

### 6. 繳費：沒有「已取消」狀態，「開課班名稱」「確認人」目前拿不到

構圖與規格都要「已取消」分組，但 **`invoice-status.ts` 的 `InvoiceStatus` 只有
`'unpaid' | 'partial' | 'paid'` 三態，全系統沒有 cancelled/void 這個狀態**——
這條連 admin 端都沒有，是規格本身寫早了，不是 #351 漏接。

「開課班名稱」：`invoice_items` 只查得到 `enrollment_id`，**沒有 join 出
courseName/className**——這是 admin 端 `invoice-query.ts` 本來就沒做的事，
`toInvoiceResponse` 從來沒有回過這個欄位，家長端只是原樣繼承這個既有缺口。

「確認人」（規格要「已付款」詳情顯示確認人）：`recordedBy` 是窗口三決明確要遮的
內部經手人欄位（`parent-read-endpoints.md` 的 allowlist 表），**這不是缺口，
是刻意的決定**，不用再問。

**提案**：

- 分組只做「待付款」（`unpaid`/`partial`）／「已付款」（`paid`）兩組，不做已取消
- 列表不顯示開課班名稱（admin 端自己都沒有這個資訊可顯示）
- 「已付款」詳情不顯示確認人，改成純狀態文字（「補習班已確認收款」），
  不點名是誰確認的——這個資訊本來就不該讓家長看到內部人員身分

### 7. 「本學期已繳總額」不在這輪——構圖已經先降級過一次

舊規格的統計區塊要兩個數字（待繳總額＋本學期已繳總額），**構圖 ASCII 只畫了
一個**（「待繳 $3,200」），跟 `meta.totalDue` 剛好對上。這條不是新發現的落差——
是構圖已經做過這個降級，這裡只是把它跟 API 對一次帳，確認**降級後的版本剛好
可以直接實作**，不用再跟誰確認。

## 二、三頁設計（假設上面七項都照建議降級／補欄位）

### 通用結構

三頁都是：`page-band`（`app-child-switcher` 佔 eyebrow 位置 + 頁面標題 + `bandAside`
放 `app-band-anchor`）→ 篩選列（chip 群，預設值照規格）→ 列表（分頁載入更多，
不是無限捲動自動觸發——先做一顆「載入更多」按鈕，量小的話夠用，之後真的需要
再換自動觸發，不要一次做到最複雜的版本）。

三支各自的 `core/*.service.ts`（`ParentAttendanceService`／`ParentGradesService`／
`ParentBillingService`）都是純 wrapper，直接對應 #351 的三支 schema，型別命名跟
API 回應欄位一致（`ParentAttendanceRecord`／`ParentScoreRecord`／`ParentInvoice`）。

三頁的資料載入都依賴 `childScope.activeChild()`：進頁先確保 `childScope.load()`
已經跑過（#344 的 dedupe 保證重複呼叫安全），`effect()` 監看 `activeChildId()`
變化重新打對應的 list API——**孩子切換器換孩子時，這三頁都要重新查**，
這是它們跟 02 片試點（dashboard）不同的地方：dashboard 只擺切換器沒有跟著換資料，
這三頁才是切換器真正要驅動的東西。

### 出缺席 `/parent/attendance`

- band anchor：待 §一-3 裁決；先落地成一個支援兩種顯示的元件用法
  （合併一個 `band-anchor` 或拆兩個），裁決出來再定案，不影響其他部分的設計
- 篩選 chip：近10天／近30天／選月份（照規格，`dateFrom`/`dateTo` 直接對應）
- 列表：依 `eventDate` 分組（API 回的是攤平列表，前端分組），當天無課顯示
  「今日無課」；每筆課堂顯示 `className`／`campusName`／`status`／`note`
  （`note` 保留，#351 說它是點名當下的觀察，對家長有意義）
- 互動：點課堂**列內展開**（不是 Popup）——照 design-web 的建議採納，理由是
  跟成績頁「點考試展開」對齊，使用者不用學兩套手勢，而且單手情境下展開比
  跳出遮罩更順手
- 狀態色相：三態都帶嚴重度（缺席 > 請假 > 出席），用 `app-status-dot`
  不是 `app-data-chip`（照抄構圖的判準：這是有序狀態不是身分分類）

### 成績 `/parent/grades`

- band anchor：`meta.recentCount`，直接可用
- 篩選：科目（前端篩，see §一-5）＋ 時間範圍（近1月/3月/半年/全部，
  取代「學期」）
- 列表：依 `subjectName` 分組，每筆顯示日期／考試名稱／分數（`app-data-chip`
  顯示缺考/補考）／及格判斷。及格判斷直接沿用既有 `isFailingScore(score,
{ totalScore })`——**不傳 `passScore`**（API 沒給），純函式本來就有這一層
  退路，行為自動退化成「總分 60%」，不用另外處理
- NEW 標籤：待 §一-4 裁決；裁決出來之前先不做逐筆標籤，只顯示彙總數字

### 繳費 `/parent/payments`

- band anchor：`meta.totalDue`，直接可用
- 分組：待付款（`unpaid`/`partial`，優先顯示）／已付款（`paid`），不做已取消
  （§一-6）
- 列表每筆：帳單編號、金額、狀態標籤、期限（待付款）/ 最後付款日期（已付款）；
  不顯示開課班名稱（資訊不存在）
- 詳情展開（不是獨立頁）：費用明細（`items[].type`/`amount`/`periodMonth`，
  不顯示內部備註——本來就沒回）、付款記錄（`payments[]`）、待付款時顯示付款
  方式說明＋補習班帳戶資訊＋「完成付款後請通知補習班確認」提示（照抄規格原文，
  這條沒有資料依賴，純文案）
- 互動：底部抽屜（`drawer-auto` class，照抄構圖建議，理由是這個 class 已經修過
  `--window-height` 的抽屜高度 bug），不是置中 dialog——桌機版本這輪跟手機一樣
  走抽屜，構圖說桌機可以晚點再談，這輪不特別做兩套

## 三、明確不做（這輪）

- 家長端寫入（請假申請、繳費、成績疑問回報）——parent-data-scope.md 已經講過，
  這裡重申
- v1b 教務日誌讀取——`parent-read-endpoints.md` 已經排除，跟 teacher-pages 的
  P3 設計連動，這份文件不重複
- 學生帳號線（03 之後排的另一刀）——這裡的三頁全部假設「登入者是家長」，
  學生帳號的差異點已經在 `parent-data-scope.md` 的擴充節寫過，這裡不重做一次

## 四、待批准的具體決定（彙整）

1. §一-3：`monthlyAbsentCount` 要不要拆成缺席/請假兩個欄位（建議：要，成本小）
2. §一-4：`ParentScoreRecordSchema` 要不要加 `createdAt`（建議：要，成本小）
3. §一-5：學期篩選改時間範圍篩選，是否同意這個替換
4. §一-1/2/6：三態出勤、無到班時間行、繳費兩分組（不做已取消）、不顯示開課班
   名稱/確認人——這幾條是「規格寫的東西資料模型本來就沒有」，沒有第二個選項，
   只是要一個「知悉並接受」

這四類決定裡，1 跟 2 需要 billing-api 再補一個小回合；3 跟 4 是純前端範圍決定，
不影響 API。若 1、2 要等 billing-api，**這份文件批准後可以先做 §一-3/4 之外的
所有部分**（出缺席不含分開的月度統計、成績不含逐筆 NEW 標籤），API 補齊後
再補上那兩塊——薄切片，不用全部等到位才動工。
