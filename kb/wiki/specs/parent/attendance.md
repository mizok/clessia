---
title: 到班紀錄
summary: 查看孩子的到班歷史。
category: spec
status: active
updated: 2026-10-22
tags: [specs, parent, attendance]
---

# 到班紀錄

**路徑**: `/parent/attendance`
**角色**: Parent

## 核心目的

查看孩子的到班歷史。

## MVP 功能

### 日期列表

- 預設顯示近 10 天
- 每天顯示：
  - 日期
  - 到班狀態（✓ 已到班 + 時間 / ✗ 未到班）
  - 當天課堂列表與出勤狀態

### 頁面錨點

- 橘帶右側顯示**本月缺席次數**（`app-band-anchor`）

> **只算缺席，不含請假**：請假是家長自己送出的，他已經知道；併進去會把唯一需要他反應的
> 訊號稀釋進他早就知道的事情裡。請假次數照常顯示在列表，只是不進錨點。
>
> 這個數字是**自然月至今**，跟下面的日期篩選無關（後端固定用 `monthStart()` 算），
> 所以文案必須把「本月」寫出來 —— 家長把區間切到上個月時，錨點仍然是本月的數字。
>
> **還沒載到值時不顯示錨點**，不是顯示 0 —— 「本月 0 次缺席」是好消息，
> 拿它來表示「還沒有資料」會讓載入失敗看起來像一切正常。

### 狀態顯示

- 若當天無課，顯示「今日無課」
- 出勤狀態：**出席、請假、缺席**（三態）

> **沒有「遲到」不是漏寫。** `attendance_records.status` 這個 enum 從建表起就只有三個值
> （`supabase/migrations/20260330000003_create_attendance_records.sql:4`：
> `CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'on_leave')`），
> 之後沒有任何 `ALTER TYPE` 加值。畫面要有「遲到」得先動 schema，
> **不是前端補一個標籤就好**。這一行 2026-09-06 訂正前寫的是四態。

### 操作

- 點擊課堂**在列內展開**詳情（accordion），再點一次收合

> 原本寫的是 Popup，2026-09-06 計畫席裁定改為列內展開：單手情境下誤觸遮罩外緣的代價
> 高於多滑一段，且與成績頁「點考試展開」對齊，使用者不用學兩套手勢。

- 往下捲動載入更多歷史

### 日期篩選

- 近 10 天
- 近 30 天
- 指定月份

## 每日到班與 A6 版型（#1075，計畫席 2026-10-22 裁）

> 這一節是設計，**批准前不寫程式**。一張單做完版型（A）與到班資料（B），照 A6 `p-attendance` 全採（R1），
> 對齊以 `tools/a6-conformance` 的 `p-attendance` 報告為準。

### 1. 哪些日子有「到班行」

到班是**分校層級**的出勤模式（`campuses.attendance_mode`，null 退回機構預設；#1112／#1132）。
判斷一律走 `lib/attendance-mode.ts` 的 `resolveAttendanceMode`，不自己讀 `organizations`。

- 某一天**有任何一堂**的分校生效模式是 `daily_checkin` → 這天顯示到班行；
  全部在 `per_session` 分校 → 不顯示（隨堂點名的分校沒有到班卡）。
- 到班行的四種字（照 A6）：
  | 情況                             | 字                       |
  | -------------------------------- | ------------------------ |
  | 有刷卡                           | `HH:mm 到班`（台北時間） |
  | 沒刷卡、當天每一堂都是請假或停課 | `這天不用到`             |
  | 沒刷卡、今天                     | `還沒到班`               |
  | 沒刷卡、過去                     | `沒有到班紀錄`           |

### 2. 後端（保留類：家長讀取面）

- **新增** `GET /api/me/attendance/checkins?childId&dateFrom&dateTo`（唯讀）：
  - 走 `childDb.from('daily_checkins', 'student_id')`，再疊 `.eq('student_id', childId)`
    （同一個家長的另一個孩子不能混進來，同 `/api/me/attendance`）；先過 `isChildAllowed`。
  - 回 `{ data: [{ date: 'YYYY-MM-DD', time: 'HH:mm' }], dailyCheckinCampusIds: string[] }`。
    `time` 是 `checked_in_at` 換成台北時間；`dailyCheckinCampusIds` 是這個孩子有報名的班級所在分校裡，
    生效模式是 `daily_checkin` 的那些。
  - **不回** `checked_in_by`、`campus_id`、`created_at`、列 id —— 家長要的只有「幾點到」。
- **既有** `GET /api/me/attendance` 每筆紀錄加 `campusId`（課堂的分校），前端拿它對 `dailyCheckinCampusIds`。

### 3. 版型（照 A6）

- **色面標題**回答「孩子今天到了沒」：今天的堂從 `GET /api/me/sessions`（只查今天，帶 `campusId`）拿 ——
  還沒點名的課沒有出勤紀錄；今天的刷卡時間從 `/checkins` 拿：
  - 今天沒課 → `○○／今天沒有課。`
  - 有刷卡 → `○○／今天 HH:mm 到班。`
  - 今天的課全是請假 → `○○／今天請假。`
  - 還沒刷卡 → `○○／今天還沒到，HH:mm 上課。`（第一堂開始時間）
  - 今天的課都在 `per_session` 分校 → 維持 `到班紀錄`，不寫到班句
  - 副行 `日到班：刷卡一次，當天所有的課都算到了。` 只在有到班行的孩子出現。
  - 錨點 `N 次 本月缺席` 規則不變（見上「頁面錨點」）。
- **灰帶工具列**：`近 10 天／近 30 天／選月份` 分段鈕＋月份輸入，右側「幫孩子請假」（#1740，位置照 A6 `.tbar__act`）。
- **計數行**：`MM/DD–MM/DD，共 N 天`。
- **一天一章**：左欄日期（`10/22 週四・今天`）＋到班行，右欄當天每堂一行（狀態｜班名粗｜起訖｜∨），
  點了在列內展開（既有 accordion 規則）；沒課的日子壓成一行淡字 `今日無課`。≤860 寬改單欄（照稿）。
- **展開內容**：請假顯示「請假：原因（家長送出／補習班登記）」（#1742 規則不變，補習班登記的不帶原因）；
  停課顯示停課；課堂備註 `note` 照列。
- **載入更多**：照稿以「天」計（`載入更多（還有 N 天）`）；底層仍照紀錄分頁拿資料。

### 4. 偏離與不做（登記到 `a6-adoption-rules.md`）

| 項目                                       | 處理                        | 理由                                                                          |
| ------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------- |
| 到班行的「（掃碼）」                       | 不做                        | `daily_checkins` 沒有到班方式欄位，沒有資料來源（計畫席 10-22）               |
| 展開裡的「老師 · 教室」                    | ✅ #1810 已做（#1809 併入） | 新端點 `/api/me/attendance/days` 帶 `teacherName`／`classroomName`，見下節 §2 |
| 稿的「沒有紀錄／還沒上／上課中」三種堂狀態 | ✅ #1810 已做               | 列表來源改成課堂（`/api/me/attendance/days`），見下節                         |
| 現況有、稿沒畫：分校名                     | 收進展開內容（R2）          | 跨分校的孩子要分得出是哪一校的課                                              |
| 現況有、稿沒畫：「非課堂」標籤             | 保留在列上                  | `sessionStatus` 是 null 時跟正常課堂分開（#514）                              |

## 列出還沒點名的堂（#1810，計畫席 2026-10-22 批准，已實作）

> 計畫席 10-22 批准，四題都照建議（要裁 1–4 的結論寫在各處）。#1809 併入這張。補的是上面 §4 偏離表第三列：A6 的堂狀態有「沒有紀錄／還沒上／上課中」，
> 而現在列表的來源是 `attendance_records` —— 沒點名的堂根本不在清單裡，家長看到的是「那天沒課」。

### 1. 來源：課堂為主、左接出勤，再把漏網的紀錄併回來

新端點 `GET /api/me/attendance/days?childId&dateFrom&dateTo`（唯讀，**保留類：家長讀取面**），一列＝一堂：

1. **課堂**：這個孩子「那天在籍」的班（見 §3）在窗內的 `sessions`，含停課。
2. **左接**這個孩子在那堂的 `attendance_records`（`event_id`）。
3. **再併回**窗內這個孩子所有的 `attendance_records` 裡，**沒被 1 收到的**那些（非課堂事件、`sessionStatus` 是 null 的 #514，
   以及在籍判斷收不到但確實有紀錄的堂）。**保證：窗內每一筆出勤紀錄恰好出現一次** —— 只靠課堂當來源的話，
   有紀錄的堂會因為在籍判斷沒收到而從清單消失，那是比「沒點名的堂不見」更糟的錯。

範圍照家長端既有作法：先 `isChildAllowed`；`childDb.from('enrollments','student_id').pluck(…, childId)` 拿 `ScopedIds`，
`fromScopedIds('sessions','class_id', ids)` 查堂；出勤、假單都走 `childDb.from(…,'student_id')` 再疊 `.eq('student_id', childId)`
（兄弟姊妹不混）。窗上限 42 天（同 `/api/me/sessions`；近 30 天、選月份 ≤ 31 天都在內），倒置或超過回 400。

**為什麼不直接改 `/api/me/sessions`**：它是課表、首頁共用的，在籍判斷沒看報名狀態（暫停、待繳費的班也算），
而且不併回「沒被課堂收到的紀錄」。在那支上改判準會連帶改掉課表 —— 另起一支，課表不動。
**既有 `GET /api/me/attendance` 先不刪**（加法優先）：月度錨點仍由它算；確認沒有別的呼叫端後另開單收掉。

### 2. 每列回什麼（allowlist）

`key`（`sessionId` ?? `eventId`）、`date`、`startTime`、`endTime`、`className`、`campusId`、`campusName`、
`sessionStatus`（`scheduled|completed|cancelled|null`）、`status`（`present|absent|on_leave|null`，**null＝沒有紀錄**）、
`note`、`leaveSubmittedBy`、`leaveReason`（#1742 規則不變：補習班登記的不回原因）、`leaveDerived`（見 §4-b）、
`teacherName`、`classroomName`（顯示名，同 `/api/me/sessions` 已核准的形狀；**不回** user id、staff id、聯絡方式）。
**老師名只在 `staff.org_id` 等於這筆紀錄的 org 時才回 `display_name`**，否則回 null（#1809 原單的守則，併進來照守）。
`meta.monthlyAbsentCount`／`monthlyOnLeaveCount` 照搬既有算法（紀錄為準、自然月至今）。
**不回** `recorded_by`、`recorded_by_role`、列 id 以外的內部欄位。

### 3. 「那天在籍」的判準（裁定 1：照下表）

一律依**課堂當天**判（rules/attendance-rules §8、#950），在現有 `isEnrolledOn`（生效區間）之外再看報名狀態：

| 報名狀態          | 收哪些堂                                                             |
| ----------------- | -------------------------------------------------------------------- |
| `active`          | 生效區間內                                                           |
| `withdrawal` 退班 | 生效區間內（退班會把 `effective_to` 寫成退班當天，之後的堂自然不收） |
| `suspended` 暫停  | 生效區間內、**且早於 `status_changed_at`**（暫停那天起不收）         |
| `pending_payment` | 不收（還沒開始上課）                                                 |
| `void` 作廢       | 不收（這筆報名視同不存在）                                           |

不收的堂若**有出勤紀錄**，照 §1-3 併回 —— 判準錯了也只會多列，不會吃掉紀錄。
**已知限制**：暫停後又恢復的報名，`status_changed_at` 被恢復那天蓋掉，暫停期間的堂會列成「沒有紀錄」。

### 4. 每一堂顯示什麼（前端判，`now` 來自 `SystemClockService` → `taipeiWallClock`）

| 情況                                                       | 狀態字               |
| ---------------------------------------------------------- | -------------------- |
| 停課（`sessionStatus = cancelled`）                        | `停課`（優先於一切） |
| 有紀錄                                                     | 出席／請假／缺席     |
| 沒紀錄、有假單蓋到這堂（`leaveCoversSession`，同點名名單） | `請假`（裁定 2）     |
| 沒紀錄、還沒開始（今天）                                   | `還沒上`             |
| 沒紀錄、上課中                                             | `上課中`             |
| 沒紀錄、已下課                                             | `沒有紀錄`           |

- **沒有紀錄永遠不寫成缺席**（rules §6：沒有紀錄是訊號，不是待填的空格）。錨點仍只算紀錄上的缺席。
- 停課的堂若有 `on_leave` 紀錄（停課前請的假，#502）：列上寫 `停課`，展開寫「原本已請假」。
- **裁定 3：日到班的堂沒紀錄、但當天有涵蓋這堂的刷卡 → 推導成 `出席`，展開寫「依到班刷卡」**（掃碼只替「刷卡當下已存在的 event」寫出勤，event 是讀取時才補建，
  兩者會分岔 —— TS3 #1811 處理過同一件事）。選項：(a) 照紀錄寫 `沒有紀錄`，靠上方到班行「16:12 到班」說明；
  (b) 推導成 `出席`、展開寫「依到班刷卡」。**採 (b)**：日到班的規則就是「刷卡＝當天的課都到了」（rules §1.1），
  (a) 會讓同一天出現「16:12 到班」＋「沒有紀錄」兩句互相打架。推導用同一條 `checkinCoversSession`（卡帶分校只算那一校）。

### 5. 時間窗與「以天分頁」

- 窗＝畫面選的區間（近 10 天／近 30 天／選月份，**含今天、不含未來**；未來的堂是課表的事）。**一次查完整個窗**，
  不做伺服器分頁 —— 一個孩子一個月的堂是兩位數；前端每次多露 10 天（`載入更多（還有 N 天）`，#1814 已做）。
- 排序：日期新到舊，同一天照開始時間。

### 6. `fillMissingDays` 那類陷阱怎麼防（AGENTS.md test:timetravel 段）

用日期窗重建列表的陷阱是「窗外的資料不是排到後面，是整筆消失」。這張的守法：

1. **窗只算一次**：`dateRange()` 同時是 API 的 `dateFrom/dateTo` 與畫面的天數骨架，不各算一份。
2. **伺服器依課堂日期篩**（`session_date`／`events.event_date`），不是現在的 `created_at` 排序分頁 —— 回來的每一列必然落在窗內。
3. **spec 釘兩條不變式**：(a) 回傳列數 ＝ 各天列數加總（沒有列被 `buildDays` 丟掉）；(b) 窗內每筆出勤紀錄恰好出現一次（§1-3）。
4. **今天與現在**從 `SystemClockService`＋`taipeiWallClock` 取（#1814 版還用 `new Date()`／`todayLocal()`，這張一起換掉）；
   spec 的 fixture 日期一律相對假時鐘，不寫死。
5. 交付前跑 `npm run test:timetravel`（AGENTS.md 觸發條件 2：動到用日期窗重建列表的程式碼）。

### 7. 跟 #1814、#1809 的先後（同一頁、檔案重疊）

三張都動 `routes/parent/attendance.ts`、`features/parent/pages/attendance/attendance.page.*`、`attendance.util.*`、
`core/parent-attendance.service.ts` 與本檔。

- **#1814（classroom 席，開著）先合**：它換了 A6 版型、`buildDays`、以天分頁與到班行，這張疊在它上面改「列的來源」。
- **#1809（老師 · 教室）併進這張（裁定 4 選 A）**：新端點本來就帶 `teacherName`／`classroomName`（§2），#1809 若照原計畫改舊的
  `/api/me/attendance`，這張一換來源那段就白做。當時的兩個選項：
  (A) **#1809 併入 #1810**，classroom 席不做 #1809（建議）；
  (B) 照原計畫 #1814 → #1809 → #1810，#1810 開工前等 #1809 合，並把 #1809 的欄位搬到新端點。
- 這張開工時間：#1814 合進 main 之後；開工前 merge main，不在 #1814 的分支上疊。

### 8. 驗證計畫

- API：權限（非家長 403、別人的孩子 403、兄弟姊妹不混）、窗（倒置／>42 天 400）、在籍判準五種狀態各一支、
  §1-3 併回（非課堂事件、在籍收不到但有紀錄）、停課、讀取失敗回 500（每一支查詢）、allowlist（不回內部欄位）。
- 前端：§4 每一種狀態字、日到班推導（含「卡在別校不算」）、§6 兩條不變式、`test:timetravel`。
- A6：`tools/a6-conformance` 的 `p-attendance`，報告附在 PR。

## 資料依賴

| 操作 | 資料表                                                            |
| ---- | ----------------------------------------------------------------- |
| 讀取 | `daily_checkins`, `sessions`, `attendance_records`, `enrollments` |

## PRD 參考

- 4.7 日到班
- 7.2 家長頁面
