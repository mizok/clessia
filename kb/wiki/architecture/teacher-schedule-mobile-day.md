---
title: 老師端課表 —— 行動優先單日檢視
summary: 手機一日一屏、水平 scroll-snap 換日；桌機保留七欄。為什麼不寫手勢 JS、為什麼日期標題放在面板裡。
category: architecture
status: active
updated: 2026-08-31
tags: [architecture, teacher, schedule, mobile]
---

# 老師端課表 —— 行動優先單日檢視

**對象**：`/teacher/schedule`（`features/teacher/pages/schedule/`）
**規格**：[[specs/teacher/schedule]]（2026-08-30 裁決手機版為主要形態）

## 為什麼要動

現況是 `grid-template-columns: repeat(7, 1fr)` 配 `min-width: 120px`
（`schedule.page.scss:44-52`）—— 七欄各至少 120px 加 gap，**最少 840px**。
390px 的手機上，老師的主畫面必須橫向捲動才看得完一週；`overflow-x: auto`
讓它不爆版，但那是「不壞掉」不是「好用」。

老師端**幾乎只在手機上用**（roadmap P3），所以手機版不是降級版而是主要形態。
老師端四頁的 SCSS 目前**沒有任何一個 media query**，而全 app 有 39 個檔案在用
`bp.respond-to` —— 慣例是成熟的，只是這裡從來沒採用。

## 這一刀的邊界

**只做視圖層與設計語言對齊，不補 spec 的資料標記。**

做：手機單日檢視、桌機七欄修正、橘帶、狀態編碼、`hasSessionEnded` 統一。
不做：月曆區塊、`[有小考]`、`[代課]`、停課灰底、待處理 `●`、課堂詳情 Popup 的擴充。

不做的那些**全部卡在後端**（見下方「API 缺口」），不是取捨而是阻塞。在前端湊會
產出錯的資料：例如「代課」要比對 `schedules.teacher_id`（固定任課）與
`sessions.teacher_id`（實際上課），而列表端點兩個都沒回。

## 手機：一日一屏，水平 scroll-snap

七天並排成一條水平軌道，每一屏寬度等於視窗寬，`scroll-snap-type: x mandatory`
讓它停在整日的邊界上。

### 不寫手勢 JS

`touchstart` / `pointermove` 那套**一行都不寫**。原生的 overflow scroll 已經給了
慣性、橡皮筋回彈、鍵盤方向鍵捲動、螢幕閱讀器的捲動語意，以及 `prefers-reduced-motion`
下的行為 —— 自己實作等於把這些全部重寫一遍，而且會重寫得比較差。

repo 目前 **零** `touchstart` / `swipe` / `pointerdown` 程式碼。這條債不從這裡開。

### 日期標題放在面板裡，不追捲動位置

每一屏自己帶「2/5（三）」的標題，所以**沒有任何 JS 需要知道現在停在哪一天**。

替代方案是監聽 `scrollend` 把當前日期同步回頁面標頭。拒絕的理由有兩層：
`scrollend` 到 Safari 18.2 才有，本 repo 沒有 `.browserslistrc`、吃 Angular 21
的預設 baseline，得再補一層 IntersectionObserver fallback；而它買到的東西
（標頭上那行字）在標題已經跟著面板走的時候是重複的。

代價：橘帶上的錨點數字是**整週**的（本週 12 堂・3 堂未點名），不是當日的。
這是知情的取捨 —— 當日數字要當日狀態，當日狀態要捲動位置，捲動位置要那層 JS。

### 換週仍是 `<` `>` 按鈕，不做「滑到邊界自動換週」

自動換週會把「現在是哪一週」重新變成一個要追蹤的狀態，跟上面那個取捨直接相衝
（不追捲動位置，就不知道你滑到了邊界）。按鈕是明示的、便宜的、而且它已經在了。

### 沒有日期 pill 列

預設落在今天，鄰近日一滑就到。pill 列等真實使用回饋再加 —— 加的時候也只做
**單向跳轉**（點了捲過去），不反向追蹤當前位置，否則就把取捨 2 買掉的東西還回去了。

### 寬度用 `--window-width`，不用 `vw`

`calc(var(--window-width, 360px) - ...)`。憲法 c6 禁 viewport 單位；
`--window-width` 由 `app.component.html` 上的 `appWindowSize` directive 寫入。

## 桌機：七欄，但拿掉 `min-width`

`min-width: 120px` 是逼出橫捲的那一行。改成 `minmax(0, 1fr)` 讓欄位真的等分、
內容自己收斂。

### 門檻量的是內容區，不是視窗

七欄能不能活，取決於**它拿到多寬**，不是視窗多寬 —— 因為 shell 的 sidebar
在 >=768px 就展開並吃掉 240px。實測（Chrome，2026-08-31）：

| viewport | shell-content | 每欄      |                           |
| -------- | ------------- | --------- | ------------------------- |
| 768      | 528           | **59px**  | 班名一字一行、chip 被裁掉 |
| 1024     | 784           | 96px      |                           |
| 1140     | 900           | **113px** | 密度剛好撐得住            |
| 1280     | 1040          | 133px     |                           |

所以條件是 `@container shell-content (min-width: 900px)`。`shell-content` 是
`shell-layout.component.scss` 已經定義好的具名容器，admin sessions 系列頁在用同一個。

**這推翻了原本的 768px 視窗斷點裁決**（2026-08-31，計畫席重裁）。原裁決的理由是
「七欄約 109px/欄，撐得住」—— 那個 109px 是拿整個 viewport 除的，沒扣掉 sidebar。
實際 59px 的七欄比手機的單日檢視更難用，正是這一刀要修的病。前提倒了，裁決跟著倒。

代價是 **iPad 直立（768）落回單日檢視**。這不是讓步而是修正：528px 寬的單日卡片，
比 59px 的七欄好。iPad 橫放（1024）仍是 96px/欄的七欄，教室場景照樣成立。

900px 是量出來的（7 欄 × ~113px + 間距），**刻意不取 bp map 的 token** —— 那些是
視窗尺度的值，混用會讓下一個人以為這個門檻跟裝置寬有關。用原生 `@container` 而非
`respond-to-container` mixin，是因為後者只產 `max-width`，方向不對。

## 設計語言對齊

- 入口面補 `app-page-band` + `app-band-anchor`（現況是裸 `<h2>`），對齊方向 D 的內部頁
- `✓12 🏳1 ✗2` 這排 emoji 與「未點名」「點名已截止」的裸 `<span>` 改用
  `app-status-dot`：已點名 `done`、還沒上 `pending`、該點沒點 `overdue`。
  **形狀與色相兩個軸**，灰階與色盲下都分得出來
- 校區／課程名之類的身分標籤用 `app-data-chip`，不新開 `p-tag`

## `isFuture` 換成 `hasSessionEnded`

現況 `isFuture()` 是 `!isPast(parseISO(session.eventDate))` —— 只看日期，
所以今天晚上七點的課從凌晨 00:00 起就算「已經開始」。

`shared/utils/session-time.util.ts` 的 `hasSessionEnded` 是同一個問題的既有答案，
儀表板、課堂管理、day-timeline 三處已經在用。第四個使用者不該自己再寫一份 ——
兩份定義會對同一堂課說不一樣的話。

## API 缺口（阻塞 spec 的其餘部分）

| spec 要的      | 卡在哪                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[代課]`       | `GET /api/attendance/sessions` 的 `teacherName` 寫死 `null`（`attendance.ts:1015`）；也沒回 `sessions.teacher_id` vs `schedules.teacher_id` 的比對 |
| 停課灰底       | 同端點 `statusList` 預設 `['scheduled','completed']`，`cancelled` 被濾掉，前端拿不到                                                               |
| `[有小考]`     | 回傳沒有考試關聯欄位                                                                                                                               |
| 待處理 `●`     | `GET /api/contact-book/missing?date=` 是**每生一列**且逐日查，跟課表的一次一週不匹配                                                               |
| 月曆的有課圓點 | 端點是分頁列表，要整月的日期集合得另開或濫用 `pageSize`                                                                                            |

這五項開需求單給計畫席，由 billing-api 席做。**不在前端湊。**

前四項已由 #123 / #131 交付並接上（見下節）；月曆那項仍未做，因為月曆本身還沒做。

## 接線（#123 / #131 之後）

### 停課必須排在「上完了沒」之前

`attendanceTone` 的第一個判斷是 `status === 'cancelled'`，**順序不能動**。
排在 `hasSessionEnded` 後面的話，一堂已過去的停課會被算成「上完了卻沒點」——
那是誣賴老師漏了一堂**根本沒發生**的課。同理它也不計入橘帶錨點的待點名數。

### 狀態文案用 `Record` 不用 `switch`

原本是帶 `default` 的 switch，結果 `inactive`（停課）掉進 default 顯示成「還沒上」，
一堂停掉的課在畫面上看起來像老師還沒去上。**實測時才發現，型別沒擋住。**

改成 `Record<StatusTone, string>`：少一個 case 是編譯錯誤，不是一句錯的話。
帶 `default` 的 switch 在「列舉之後會長出新成員」的地方一律是這個下場。

### 點名閘門查兩個條件

`canTakeAttendance` 同時查 `status !== 'cancelled'` 與 `eventId !== null`。
`status` 是語意上的來源，`eventId` 是它的後果（後端刻意不替停課補建出勤事件）。
只查 `eventId` 的話，後端哪天改成「停課也補建事件」就會靜靜地放行。

### `statuses` 要明式傳

後端預設 `['scheduled','completed']`，**少傳就永遠看不到停課**，而畫面上只會顯示成
「那天沒課」—— 沒有任何錯誤訊息。這條有測試釘著（`schedule.page.spec.ts`）。

### 聯絡簿待辦另外訂閱，不 forkJoin

待辦徽章走 `/api/contact-book/missing/summary`（一次一週，不是 `missing` 打七次）。
它跟課表是兩件事，所以各自訂閱：**它掛掉不該讓課表整個空掉**。
取數失敗時 Map 清空 → 徽章不出現，而不是顯示 0（「查不到」跟「沒有待辦」是兩件事）。

> ⚠️ **待辦徽章目前在老師身上一定是 0**，因為 `apps/api/src/lib/teacher-scope.ts`
> 的 `taughtClassIds` 對沒有 `org_id` 欄位的 `schedules` 表下 `.eq('org_id', ...)`，
> PostgREST 回 `42703`，而 `data ?? []` 把錯誤吞成空陣列。前端接線是好的
> （端點回 200、形狀正確、有測試釘住對應邏輯），這是 API 側的缺陷，已開單。
