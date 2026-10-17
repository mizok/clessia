---
title: 連續請假滿 N 個上課日可不收費：提醒行政（設計稿）
summary: 設計稿（#1732；使用者 10-17 已裁三題）。不成文規定「請假照收，但連續請假滿 N 個上課日，這 N 天可以不收」，系統只偵測與提醒、由行政手動調帳單或堂數，**不碰任何計費與開單邏輯**。偵測以學生為單位、某天所有有課的班都請假才算一個請假日、相鄰假單接得起來就合併、N 是機構設定（預設 3）。假單寫入後（管理端與之後的家長端 #1695 共用同一個核心）背景偵測，達標就發站內通知給有 manage_finance 的管理員；帳單頁與學生檔案的標記在讀取時現算；管理員可把一段標為「已處理」，之後被延長會重新出現。一支 migration（機構設定欄位、`leave_streak_reviews` 表、通知 enum），拆三支實作單。待裁 Q1–Q7 已於 10-17 裁定。
category: spec
status: accepted
updated: 2026-10-17
tags: [specs, finance, leave, attendance, notifications, migration]
---

# 連續請假滿 N 個上課日可不收費：提醒行政（設計稿）

> **狀態：已批准（計畫席 2026-10-17，#1733），還沒有實作。** #1732 的三題已於 10-17 裁定（工單留言）；
> 這份稿的 Q1–Q7 也已於 10-17 12:43 裁定（#1733 留言）：**Q2 要做「已處理」**，其餘照預設（§9）。
> 實作照 §8 拆單，每一單仍走 `clessia-feature-slice`；migration 屬保留類，正式 DB 由使用者 Approve。

## 結論先講

| 問題                   | 做法                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 系統做什麼             | **只偵測、只提醒**。不改帳單、不改堂數、不改餐費紀錄；金額由行政自己調（[[rules/billing-rules]] §8 的「人工調整」）                                 |
| 一個「請假日」怎麼算   | 以**學生**為單位：那天該生**每一堂**有課（未停課）的課都被假單蓋到，才算一個請假日（裁定 1）                                                        |
| 「連續」怎麼算         | 只看**該生的上課日序列**：週末、沒課的日子、整天停課的日子都跳過，不算中斷；中間夾一個「有課但沒全請」的上課日才算中斷                              |
| 多張假單               | **接得起來就合併**（裁定 2）。同一學生的假單本來就不重疊（`findConflictingLeave`），所以只會相鄰                                                    |
| 門檻 N                 | 機構設定 `organizations.leave_waiver_days`，預設 3；放在系統設定的財務區塊（裁定 3）                                                                |
| 什麼時候偵測           | 假單**建立、修改、刪除成功之後**，背景跑（照 `queueLeaveNotice` 的寫法，失敗只記 log、不擋假單）                                                    |
| 誰被提醒               | 該生分校範圍內、有 `manage_finance` 的管理員（`adminsForCampuses(..., { permission: 'manage_finance' })`）；新通知種類 `leave_streak`，不推播       |
| 帳單頁與學生檔案的標記 | **讀取時現算**；假單改了、銷假了、停課了，標記自己跟著變。管理員可以把一段標為**已處理**（存 `leave_streak_reviews`），之後那段被**延長**就重新出現 |
| 家長端請假（#1695）    | 家長的假走同一個建立核心（#1695 設計稿已決定把 `routes/leaves.ts` 的建立邏輯抽到 `lib/`），偵測掛在核心之後，**兩個入口只掛一次**                   |
| Migration              | 一支（保留類）：`organizations.leave_waiver_days`、新表 `leave_streak_reviews`、`notification_kind` 加 `leave_streak`                               |

## 1. 現況（10-17 查）

| 項目           | 現況                                                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 假單           | `leave_requests`（student_id、start_date、end_date、start_time／end_time、submitted_by_role），**沒有狀態欄**，銷假＝刪單；可勾選堂次 `leave_request_sessions`（[[architecture/leave-session-binding]]）                                                                            |
| 假單蓋不蓋某堂 | `lib/leave-covers-session.ts` 的 `leaveCoversSession`：**讀取時推導**，不靠 `attendance_records`（event 懶生成，先請假後生成的堂沒有 on_leave 紀錄）                                                                                                                                |
| 學生的上課日   | 沒有共用函式；最接近的是 `routes/students/attendance-days.ts`：enrollments（非 void、生效區間）× `sessions`（`session_date` 在區間內）→ 逐天分出停課／請假／到班。它的「請假日」是**蓋到任一堂**，跟裁定 1 不同                                                                     |
| 停課、補課     | 停課看 `sessions.status`（`lib/cancelled-session.ts`）；補課是同一班的另一堂 `sessions`（`makeup_for_session_id` 指回原堂），所以照「有報名的班、未停課的堂」算，補課日自然算進上課日                                                                                               |
| 寫入後的掛點   | `routes/leaves.ts` 的 POST／PATCH／DELETE；先例 `queueLeaveNotice` 用 `waitUntilFrom(c)` 背景發 `leave_for_my_class`                                                                                                                                                                |
| 通知寫入層     | `lib/notify.ts`：`notify()` 以 `user_id, dedupe_key` upsert、不丟例外、`push_status='skipped'`；`adminsForCampuses()` 可帶 `permission`                                                                                                                                             |
| 機構設定       | 欄位在 `organizations`，財務類 key 在 `routes/org-settings.ts` 的 `FINANCE_SETTING_KEYS`：**寫入要 `manage_org_settings`（整支設定路由的門）＋ `manage_finance`（財務 key）**；沒有財務權限的人讀到的回應裡沒有這些 key。先例 `billing_reminder_days`（migration `20261004031232`） |
| 三種費用       | 餐費：`meal_records` 每生每日一筆，**單價在筆上**、`chargeable` 是人工開關；學費：月繳／期繳是**整月／整期一口價**（`agreed_amount` 優先，否則價目表），沒有每堂價；堂數制：剩餘堂數是**推導的**（`lib/session-pack.ts`），請假扣不扣看班級的 `leave_deducts_session`（預設不扣）   |

## 2. 偵測演算法

一個純函式加一個讀資料的外殼，放 `apps/api/src/lib/leave-streak.ts`：

```text
detectStreaks(classDays, leaves, attended, n) → Streak[]
```

1. **上課日**：該生在查詢區間內，所有「有報名、在報名生效區間內、未停課」的 `sessions`，依 `session_date` 分組。
   一天有幾堂就是幾堂（跨分校、跨班都算同一天）。
2. **請假日**：某個上課日的**每一堂**，都被該生某一張假單 `leaveCoversSession` 蓋到，而且**沒有出席紀錄**
   （`attendance_records.status = 'present'` 的那堂算有來，見待裁 Q4）。
3. **連續段**：沿著上課日序列往前走，遇到請假日就累加，遇到「非請假的上課日」就斷開。
   不是上課日的日子（週末、沒課、整天停課）**不在序列裡**，所以天然不會中斷。
4. **達標**：連續段長度 ≥ N（讀 `organizations.leave_waiver_days`）的段就是一個 `Streak`：
   `{ studentId, days: [{ date, sessions: [{ sessionId, classId, className }] }], firstDay, lastDay }`。

**查詢區間**：以這次寫入的假單日期為中心，往前往後各抓 **62 天**的上課日與假單，再找出「包含這次日期」的段。
`ponytail:` 固定窗，一段連請超過兩個月會被截斷（實務上不會發生；真的要就改成往外逐段延伸到碰到非請假日為止）。

**未來的日子**：`sessions` 是預先產生的，所以提前請的假（例如下週三天）**也能偵測**；
如果請假日期超過已產生的課表，那幾天沒有 `sessions`，就不算上課日（假單之後才排課的情況，見 §3 的「不重算」）。

**多日假單的時間**：沿用 `leaveCoversSession` 的既有規則（多日假單的 `start_time`／`end_time` 只用在單日假單，多日視為整天）。偵測不另定規則。

## 3. 什麼時候偵測、發給誰

| 觸發                   | 動作                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 假單建立、修改成功     | 背景（`waitUntilFrom`）跑偵測；包含這張假單日期的段若達標、**而且沒有被「已處理」涵蓋**（§4.1）→ 發 `leave_streak`     |
| 假單刪除（銷假）、改短 | **不發撤回通知**。標記是讀取時現算的，會自己消失；通知已經發出去的，點進去看到的是現況（沒有標記）                     |
| 停課、補課、改課表     | **不重算、不發通知**。標記一樣是現算的，所以帳單頁與學生檔案永遠是對的；只是通知不會因為課表改動才冒出來（見 §7 不做） |

- **收件人**：該生這段請假涉及的分校（由那幾堂的 `campus_id` 推導），分校範圍內有 `manage_finance` 的管理員
  （`adminsForCampuses(supabase, orgId, campusIds, { permission: 'manage_finance' })`）。送出假單的人如果自己就是收件人，照樣收（他要處理錢）。
- **去重**：`dedupe_key = leave_streak:<studentId>:<firstDay>:<lastDay>`。
  同一段被改長（又接上一張假單）會變成新的 key、再發一次 —— 這是刻意的：天數變了，要扣的也變了。
- **內容**（不寫金額，金額在學生檔案看）：
  - 標題：「林小華連續請假 3 個上課日」
  - 內文：「10/14（二）、10/16（四）、10/17（五），這幾天的費用可以不收。點進去看明細。」
  - 連結：學生檔案的帳單章（`/admin/students/:id`，錨點到帳單章）
- **管理端與家長端只掛一次**：#1695 的設計稿已經決定把建立核心從 `routes/leaves.ts` 抽到 `lib/`、兩個入口共用。
  偵測掛在這個核心「寫入成功之後」；**哪一支先上線，就由那一支負責抽出核心**（見 §8）。

## 4. 標記與明細（讀取時現算）

新端點（都只給有 `manage_finance` 的人；沒有的人 403，畫面也不顯示）：

| 端點                                                    | 用途                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/students/:id/leave-streaks`                   | 學生檔案：這位學生近期的達標段，**含明細**                                 |
| `GET /api/leave-streaks?studentIds=…`（最多 100 個 id） | 帳單頁：一次問這一頁出現的學生有沒有達標段，**只回有沒有＋天數**，不回明細 |

「近期」＝最後一天落在**今天往前 62 天到往後 62 天**之間的段（跟偵測同一個窗；已處理見 §4.1）。

**明細（學生檔案帳單章）**：一段一張小卡，

- 哪幾天、每天哪幾班（班名、時間）
- **餐費**：那幾天的 `meal_records`，列出「訂了而且收費」的筆數與**單價加總**（單價就在筆上，是確定的數字）；
  已經結算進帳單的（`invoice_item_id` 不是 null）註明「已開在 X 月帳單」
- **學費（月繳／期繳）**：列出那幾天涉及的報名與計費方式（「國二數學 B，月繳」），**不算金額**
  —— 一口價沒有「每天多少」，用天數或堂數比例拆都是在替行政做決定（見待裁 Q7）
- **堂數制**：那幾天的堂次，班級 `leave_deducts_session = true` 的列為「已扣 N 堂，可補回」；
  預設不扣的班寫「請假不扣堂，不用處理」

**帳單頁**（`payments.page` 的列模板）：學生名字旁一個小標「連請 3 天」，連到學生檔案的帳單章；不在帳單頁展開明細。

**已處理的段不顯示小標。**

### 4.1 已處理（裁定 Q2）

- 學生檔案的明細卡上一顆「標為已處理」（只給 `manage_finance`）。按下去寫一列 `leave_streak_reviews`（學生、這一段的起訖日、處理人、時間），
  toast「已標為已處理」帶「復原」（刪掉那一列）。
- **一段算不算已處理**：有一列 review 的區間**完整涵蓋**這一段（`review.first_day <= 段.firstDay` 且 `review.last_day >= 段.lastDay`）。
  - **延長**（又接上一張假單，起或訖往外長）→ 不再被涵蓋 → **重新出現**：帳單頁小標與學生檔案明細都回來，也會再發一次通知（裁定要求）
  - **縮短**（銷掉其中一天但仍達標）→ 仍被涵蓋 → 維持已處理，不再打擾
  - 縮到不達標 → 本來就不算一段，不顯示
- **學生檔案**：未處理的段照常一張明細卡；已處理的段收成一行「已處理：10/14–10/17，王主任 10/20」，可展開看明細（查帳用），沒有按鈕。
- **端點**：`POST /api/students/:id/leave-streaks/reviews`（body `{ firstDay, lastDay }`）、`DELETE /api/students/:id/leave-streaks/reviews/:reviewId`（復原）。
  **授權**：org 範圍（c1，`org_id` 過濾）＋該生在呼叫者的分校範圍內（`outOfCampusScope`，同學生檔案的讀取範圍）＋ `manage_finance`。
  寫入時伺服器**重算一次**這位學生的段，`{ firstDay, lastDay }` 必須正好是一個現存的達標段，不是就 409（防止前端送任意區間）。
- 讀取端點（§4 那兩支）回傳的每一段帶 `review: { id, reviewedBy, reviewedAt } | null`；帳單頁那支只回未處理的。

## 5. 機構設定

- `organizations.leave_waiver_days smallint NOT NULL DEFAULT 3 CHECK (leave_waiver_days BETWEEN 2 AND 30)`
  （1 天就變成「每次請假都不收」，不是這條規定；上限 30 是防手誤）
- API：`routes/org-settings.ts` 的 schema 加 `leaveWaiverDays`，放進 `FINANCE_SETTING_KEYS`
  —— 跟 `billingReminderDays` 同一套：寫入要 `manage_org_settings`＋`manage_finance`，沒有財務權限的人讀不到（待裁 Q6）
- 系統設定頁財務區塊加一個數字欄：「連續請假幾個上課日可以不收費」，說明「達到時提醒有財務管理權限的人，系統不自動改帳單」

## 6. Migration（一支，保留類）

```sql
-- 照 20261004031232_billing_reminder_days.sql：純加欄＋預設值，部署前後套都安全
ALTER TABLE public.organizations
  ADD COLUMN leave_waiver_days smallint NOT NULL DEFAULT 3
  CHECK (leave_waiver_days BETWEEN 2 AND 30);

-- 照 20261016093442_notification_kinds_staff.sql：ADD VALUE 不能跟「使用新值」放在同一個交易，這支只加不用
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'leave_streak';

-- 已處理（裁定 Q2）。授權只在 Hono middleware（c1）；RLS 開著、沒有 policy＝fail-closed 後盾（同其他業務表）
CREATE TABLE public.leave_streak_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  first_day   date NOT NULL,
  last_day    date NOT NULL,
  reviewed_by text NOT NULL REFERENCES public.ba_user(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (first_day <= last_day),
  UNIQUE (student_id, first_day, last_day)
);
CREATE INDEX leave_streak_reviews_student_idx ON public.leave_streak_reviews (student_id, last_day);
ALTER TABLE public.leave_streak_reviews ENABLE ROW LEVEL SECURITY;
```

沒有 backfill。不動任何既有欄位。`reviewed_by` 只是**參照** `ba_user`（不寫它，c2），`ON DELETE RESTRICT` 照既有的 `requested_by` 寫法（人員走停用，不會真的刪帳號）。

## 7. 明確不做

- **不改任何金額、帳單、堂數、餐費紀錄**：`lib/billing_run.ts`、`lib/proration.ts`、`lib/session-pack.ts`、
  `routes/invoices.ts`、`routes/meals.ts` 一行不動。這張單**不屬於「改既有金額路徑」**
- 不自動開折讓、不自動退堂、不自動把餐費標成不收費
- 不推播（管理員本來就不推，#1693）
- 不在課表異動（停課、補課）時重算並發通知；標記是現算的，所以畫面永遠正確，只是通知只在假單寫入時發
- 不估算學費的每日金額
- 不通知家長（見待裁 Q3）

## 8. 實作拆單

| 單   | 內容                                                                                                                                                                                                                                                                                                                              | 類別                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| PR-1 | Migration（§6，含 `leave_streak_reviews` 表）＋ org-settings 的 `leaveWaiverDays`（財務 key）＋系統設定頁的欄位                                                                                                                                                                                                                   | 保留類                   |
| PR-2 | `lib/leave-streak.ts`（純函式＋讀資料外殼，spec 以純函式為主：跨班、停課跳過、相鄰假單、部分請假斷開、有出席斷開、門檻邊界、已處理涵蓋／延長／縮短）；把假單建立核心抽到 `lib/`（若 #1695 還沒抽）並在寫入成功後背景偵測；`notify.ts` 加 `leave_streak`；兩支讀取端點＋已處理的寫入與復原端點（伺服器重算驗證區間）；規則文件同步 | 保留類（新端點的權限門） |
| PR-3 | 前端：學生檔案帳單章的明細卡（含「標為已處理」與復原、已處理收成一行）、帳單頁列上的小標、通知中心 `KINDS` 加「連續請假」標籤                                                                                                                                                                                                     | 一般類                   |

PR-2 依賴 PR-1 的 migration 套上正式 DB；PR-3 依賴 PR-2。

**規則文件（PR-2 一起改）**：

- [[rules/billing-rules]] §8「缺課不退不抵」後面加：「**例外：連續請假滿 N 個上課日（機構設定，預設 3），這 N 天可以不收**
  —— 系統只提醒有財務管理權限的人，由行政手動調整帳單或堂數（#1732）」
- [[rules/attendance-rules]] §4 請假規則加一條：連續請假的計算方式（§2 的 1–3 點）與偵測時機
- [[rules/meal-rules]] 不用改：「請假模組只提示、不自動改 meal_record」本來就是這個精神

## 9. 待裁題（10-17 12:43 全部裁定，#1733 留言）

| #   | 題目                                     | 裁定                                                                                             |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Q1  | 連請 5 天（N＝3）免 5 天還是 3 天？      | 照預設：**整段都列出來**，提醒寫實際天數，由行政決定                                             |
| Q2  | 標記掛多久？要不要「已處理」？           | **要「已處理」**：標記後不再提醒；同一段之後被延長要重新出現（§4.1）；併進同一支 migration（§6） |
| Q3  | 要不要告訴家長「連請 N 天可以不收費」？  | 照預設：**不告訴**                                                                               |
| Q4  | 請了假又來上課（點名出席）算不算請假日？ | 照預設：**不算**                                                                                 |
| Q5  | 門檻範圍與關閉                           | 照預設：**2–30**，沒有關閉開關                                                                   |
| Q6  | 誰能改門檻？                             | 照預設：跟其他財務設定一樣（`manage_org_settings`＋`manage_finance`）                            |
| Q7  | 學費要不要估每日金額？                   | 照預設：**不估**；餐費照單價加總                                                                 |

## 10. 裁定紀錄（#1732 留言，10-17）

- **費用種類**：餐費、學費（月繳／期繳）、堂數制，三種都適用
- **連續的算法**：連續 3 個上課日，週末與沒課的日子不算中斷（例：週四、週五、下週一＝連續 3 天）
- **怎麼處理**：行政手動處理；系統不自動扣款、不自動退堂，只提醒
- **待裁 1**：同一天只請其中一班，那天**不算**請假日（那天所有有課的班都請假，才算一個請假日）
- **待裁 2**：多張相鄰假單**接得起來就算**
- **待裁 3**：做成機構設定「連續請假幾個上課日可以不收費」，預設 3，放系統設定的財務區塊，只有 manage_finance 能改
