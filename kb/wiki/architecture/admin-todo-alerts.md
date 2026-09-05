---
title: 管理端待辦告警系統一（設計草案，待計畫席 STOP gate 批准）
summary: 把管理端六頁的告警拉齊成「一句話+必定帶篩選的入口+落地篩選對得上告警數字」。核心決定：同頁情境延用既有的「單一資料源 computed」模式（多數頁已經是），跨頁情境（儀表板→課堂管理）改用「共用 query 組裝函式」+ 契約測試釘住；新增共用元件 app-todo-banner 統一視覺；GET /api/sessions 補 attendanceTaken 參數。
category: architecture
status: draft
updated: 2026-09-05
tags: [architecture, admin, alerts, dashboard]
---

# 管理端待辦告警系統一

> 2026-09-05，design-web 席設計，依 tester 評測報告
> [`herdr-team/tester-admin-ux-audit-2026-09-05.md`](../../../herdr-team/tester-admin-ux-audit-2026-09-05.md)
> 的 M1「告警只報數字，不給路徑」與 P1-6「儀表板告警落地頁對不上」。
>
> **STOP。這份文件在等計畫席批准，批准前不寫任何實作程式碼。**
> 批准的對象是這份文件；範圍變更要回到這裡重新批准。

## 先訂正兩處 tester 報告與程式碼證據不符的地方

**不要照 tester 報告的字面描述動工**——查過程式碼後，六頁裡有兩頁的判讀需要修正：

1. **課程管理「需介入」pill 其實可以點**（`courses.page.html:11` 的
   `(click)="onFilterIntervention()"`，`courses.page.ts:586-587` 接住並套用**同一份**
   `hasCourseNeedsIntervention` 過濾邏輯到列表）。tester 判成「不可點」的真正原因是
   **`.courses__badge` 全庫零筆 CSS**，吃的是全域 `button` reset（`styles.scss:227-232`），
   看起來就是一段純文字。**這題的修法是補視覺，不是重接邏輯。**
2. **課堂管理「本月未指派」pill 已經完全正確**——badge 數字與點擊後的篩選條件用的是
   同一組 server 端 count 邏輯（`sessions.ts:669-701` 註解明講「跟主查詢用同一個結果，
   兩邊不能各算一次」），CSS 也齊全（`sessions-header.component.scss:28-51`）。
   **這題證據顯示它是對的，不在這輪修改範圍**——如果之後人工重測還是覺得不可點，
   要回頭查是不是別的原因（例如互動熱區、觸控裝置差異），不是重寫這條邏輯。

## 核心機制：兩種情境要用兩種不同的「同源保證」

「數字跟篩選是不是同一支查詢」在同頁跟跨頁是不同的工程問題，不能用同一套方法治：

### 同頁情境（考試/繳費/成績班級視角/課堂"本月未指派"）——已經是對的模式，延用不重造

四個現成範本用的是同一個原則的三種寫法，**都靠「頁面內單一 computed/signal」保證同源**：

- **成績班級視角**是最乾淨的版本：`todoExamCountMap` signal 是唯一資料源，
  頭部總數與列表篩選都是從它 `computed()` 出來的（`class-view.component.ts:116-118,144`）——
  架構上不可能對不齊，不需要額外測試釘住這個保證，**保證來自 computed 的資料流本身**。
- **考試管理／繳費紀錄**是「同一支 API、同一組參數，只是 count 版跟 list 版分開打」——
  也是同源，但同源保證是**人工維持參數一致**，比 computed 模式弱一階。
  這輪不重構它們（沒有壞掉的東西不用修），但**新頁面要做這類告警時，優先抄
  class-view 的 computed 模式，不要抄考試/繳費的雙查詢模式**——理由見下一節的測試設計。

### 跨頁情境（儀表板 → 課堂管理）——computed 抄不過去，要換一種同源保證

儀表板卡片跟課堂管理頁是**兩個元件、兩條路由**，不可能共用同一個 Angular signal。
這是 P1-6 對不上的結構性原因，不是誰忘了接線那麼簡單。全因果鏈（已查證）：

1. `StatCard` 介面沒有 `queryParams` 欄位（`dashboard.component.ts:40-46`），模板只綁
   `[routerLink]`，沒有 `[queryParams]`（`dashboard.component.html:64`）
2. 就算補了，`sessions.page.ts` 全檔沒有 import `ActivatedRoute`，`ngOnInit()`
   完全不讀 query params（`sessions.page.ts:317-324`）
3. 就算再補了，`GET /api/sessions` 的 `SessionListQuerySchema`（`sessions.ts:43-66`）
   沒有 `attendanceTaken` 參數——**目的頁的 API 表達不出「未點名」這個篩選概念**，
   跟 badge 數字用的 `GET /api/attendance/sessions?attendanceTaken=false`
   （`attendance.ts:950-974`）是兩支形狀不同的端點

三層都要補，缺一層都還是對不上。**同源保證改成「共用 query 組裝函式」**：

```ts
// apps/web/src/app/features/admin/pages/dashboard/dashboard-alert-queries.ts（新檔，命名待定）
export function pendingAttendanceQuery(days: number) {
  return {
    dateFrom: /* 今天 - days 天 */,
    dateTo: /* 昨天 */,
    attendanceTaken: false,
  };
}
```

儀表板算 badge 數字時打 `attendanceService.sessions(pendingAttendanceQuery(7))`；
`StatCard.queryParams` 也用**同一個函式的回傳值**組出 routerLink 的 query string；
`sessions.page.ts` 收到後，把這組 query params 轉成套用到 `GET /api/sessions` 的篩選
（需要 `GET /api/sessions` 補 `attendanceTaken` 參數，見下一節）。

**這是這份文件對「怎麼讓它壞掉時我們會知道」的答案**：寫一支契約測試，斷言
「`pendingAttendanceQuery(7)` 的回傳值」與「`StatCard` 傳給 sessions 頁的 queryParams
被 sessions.page.ts 解析後、組給 `GET /api/sessions` 的請求參數」**語意等價**
（同一組 filter 值，不要求逐字相同的 key 名，因為兩支 API 的 query shape 本來就不同——
等價的是「哪些 session 會被算進來／篩出來」這件事）。這支測試改任一邊的邏輯
（儀表板怎麼算 7 天、sessions 頁怎麼套用篩選）而沒有同步改另一邊，就會紅——
這正是取代「兩邊各自算、看起來一樣、其實已經漂移」的機制。

**不開新的自動化 gate**（例如「StatCard 的 routerLink 一定要帶 queryParams 才能過 gate」）——
目前只有一個實例會用到這個模式，開 gate 是提前抽象（§三兩道關卡的第一關沒過：
還沒有第二個使用者）。**這輪先用契約測試釘住這一個實例**，等真的有第二張卡需要同樣的
跨頁篩選時，再考慮要不要收成通用 gate。

## API 變更：`GET /api/sessions` 補 `attendanceTaken`

**跨網域，這份文件只定義需求，不代寫**（`apps/api/src/routes/sessions.ts` 屬 billing-api
的領地）。仿照既有 `assignmentStatus` 的寫法（`sessions.ts:61-64`）加一個
`attendanceTaken: z.enum(['true','false']).optional()`，語意對齊
`GET /api/attendance/sessions` 的同名參數（`attendance.ts:950-974` 的
`events.attendance_taken_at IS NULL`），handler 比照 `assignmentStatus` 現有的
where 子句組裝方式接上。

**為什麼補這支而不是讓 sessions 頁改打 `GET /api/attendance/sessions`**：sessions.page.ts
是課堂管理唯一的落地頁，它現在只認 `GET /api/sessions` 一支查詢源。如果為了一個篩選條件
讓它有時打這支、有時打那支（兩支的 query shape 還不一樣——單複數欄位命名都不同），
就是在製造「query 來源分裂」，剛好是這份文件要消滅的病，不能為了修一個 alert 又生一個。

**這個 API 變更同時解掉兩個問題**：課堂管理頁自己的「今日未點名」pill（點擊後現在只設
`date=今天`，沒有任何 attendanceTaken 相關參數，跟 badge 數字對不上）跟儀表板的
跨頁 handoff，都靠同一個新參數解決，不用分開修兩次。

## 新共用元件：`app-todo-banner`

**全庫掃過，零筆共用告警元件**——考試/繳費/班級視角/課堂/課程五處現有告警各自獨立
刻了一份 SCSS/HTML，樣式不統一（有的有底色 pill、有的完全沒 CSS）。這是這輪唯一
值得新造共用元件的地方——**已經有 5 個活的使用點**，不是提前抽象，抽的時機到了。

```
┌─────────────────────────────────────────┐
│ ⚠  有 26 筆生效中的報名還沒開過帳單        │  ← 點擊整條可點,不是只有文字
└─────────────────────────────────────────┘
```

介面草案（供批准後實作時參考，不是最終定案）：

```ts
@Component({ selector: 'app-todo-banner' })
export class TodoBannerComponent {
  readonly count = input.required<number>();
  readonly message = input.required<string>(); // 「有 {count} 筆...」呼叫端自己組文字
  readonly onAction = output<void>();
}
```

`count === 0` 時整條不渲染（沒有待辦就不佔位，呼應「儀表板是索引不是工作場」的既有原則）。
色相走中性到 warning 之間的既有 tone（不新增色階）——**這輪不重新設計視覺語言**，
只是把既有五處的呈現收斂成一份實作。

**這輪只換皮不換邏輯**：五個呼叫端各自的資料查詢與篩選套用邏輯完全不動（除了 courses
補 CSS、sessions 補 API 參數這兩處本來就要改的），只是把 HTML/SCSS 換成呼叫這個共用
元件——降低這次改動的風險，視覺統一跟邏輯修正是兩件事，不要混在一次 diff 裡讓 review
分不清哪裡是真的行為變更。

## 明確排除範圍（這輪不做，理由要寫出來）

- **課程管理 P1-2（每堂課的 ⚠️ tooltip 是死路）**——tooltip 點了只會展開/收合
  （`courses.page.html:150` 的 `toggleCourse()`），不會導到具體班級，而且班級詳情頁
  本身沒有「指派老師」的 UI 入口。**這不是告警路由問題，是缺一個完整的指派功能**——
  混進這輪會讓「告警系統統一」同時交付一個新功能，範圍失控。留成獨立工單。
- **課堂管理「本月未指派」pill**——證據顯示已經正確，這輪不動（見前段訂正）。
- **課程管理視覺樣式的其餘部分**（M2 狀態欄同值、M6 同圖示兩種行為等）——tester 報告
  的其他模式跟這份文件的主題（告警路由）無關，各自需要獨立的設計文件。

## 分工建議

| 誰                                                           | 做什麼                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| design-web（這席）                                           | `app-todo-banner` 元件；courses badge 補 CSS/tooltip；`pendingAttendanceQuery` 共用函式 + 契約測試；dashboard `StatCard.queryParams` + sessions.page.ts 讀取 `ActivatedRoute` 並套用篩選；五處現有告警換皮接上新元件 |
| billing-api（或負責 `apps/api/src/routes/sessions.ts` 的席） | `GET /api/sessions` 補 `attendanceTaken` 參數（schema + handler，仿 `assignmentStatus` 寫法）                                                                                                                        |

design-web 這邊的前端接線**依賴** API 那半先落地（`sessions.page.ts` 套用篩選那段需要
新參數才能真的過濾），順序上 API 先行或至少同批次進，不然前端那段接了線也沒有效果。

## 待批准後才做的事（本文件到此為止，以下不是這輪交付）

- 實作步驟不落地在這份文件——過程產物，寫了也會腐化（`kb/wiki/lessons/doc-code-drift-2026-08.md`）
- 批准後開 worktree、test-first 實作，PR 涵蓋範圍/證據/跑過的 gate/風險/延後項
