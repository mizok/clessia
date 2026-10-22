---
title: 報名審核時效與試聽跟進提醒
summary: 申請超過 N 天沒處理、試聽後 N 天還沒報名，提醒分校範圍內有 manage_students 的管理員；天數是機構設定。
category: spec
status: active
updated: 2026-10-22
tags: [specs, admin, enrollment, trial, notifications]
---

# 報名審核時效與試聽跟進提醒（#1821，設計稿 2026-10-22，已裁定）

> 計畫席 10-22 裁定 A–D 照建議，並補兩點（去重鍵帶來源表、跟「新申請」通知的文案分開），都寫在本稿。來源：#1314 SE2 對照（A6 `settings.html` general 的「報名流程」段：
> 報名審核處理時效 3 天、試聽跟進啟動天數 1 天）；使用者 10-22 裁定要做。**保留類**（migration：設定欄位＋通知種類）。

## 0. 現況（查過的）

申請有三個來源，各自的狀態：

| 表                                                   | 狀態                                                                                       | 分校從哪來                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------- |
| `enrollment_requests`（家長端報名申請）              | `pending`、`waitlist`、`awaiting_payment`、`completed`、`rejected`、`cancelled`、`expired` | 班 `class_id` → `classes.campus_id`     |
| `trial_requests`（家長端試聽申請）                   | `pending`、`scheduled`（有 `scheduled_date`）、`completed`、`cancelled`                    | 課程 `course_id` → `courses.campus_id`  |
| `public_applications`（公開表單，`kind` 報名或試聽） | `new`、`contacted`、`converted`、`rejected`、`spam`                                        | `public_application_targets` 的班／課程 |

- 新申請進來時已有通知：`application_received`（`lib/notify-events.ts`，收件人 = 分校範圍內有 `manage_students` 的管理員，`adminsForCampuses`）。
- 每日排程：`lib/push-run.ts` 的 `runPush`，管理員的每日摘要（#1693 `lib/staff-digests.ts`）就掛在這裡，走 pg、一天只算一次。
- 系統**沒有**「申請放太久」或「試聽之後」的任何提醒，也沒有這兩個設定。

## 1. 設定（A6「報名流程」段）

- `organizations.application_review_days`（smallint，預設 **3**）：申請送出後幾天還沒處理就提醒。
- `organizations.trial_followup_days`（smallint，預設 **1**）：試聽日之後幾天還沒報名就提醒跟進。
- 放在設定「一般」分頁的「報名流程」收合段（同 #1824 的 kv 版型，一顆儲存）；寫入門檻 `manage_org_settings`（同出勤模式），讀取對管理員開放。
- 範圍 1–30 天；兩個都允許關掉（裁定 C：天數 0＝關掉）。

## 2. 什麼算「沒處理」

| 來源                  | 「沒處理」                             | 從哪天起算               |
| --------------------- | -------------------------------------- | ------------------------ |
| `enrollment_requests` | `status = 'pending'`                   | `created_at`（台北日期） |
| `trial_requests`      | `status = 'pending'`（還沒安排試聽日） | `created_at`             |
| `public_applications` | `status = 'new'`（還沒聯絡）           | `created_at`             |

- 今天 − 送出日 ≥ `application_review_days` → 提醒一次。
- **`waitlist`（候補）不算**（裁定 A）：行政已經看過、決定讓他候補，那是處理過了；再提醒是噪音。

## 3. 什麼算「試聽後要跟進」

- `trial_requests` 的 `status in ('scheduled','completed')`，而且 `scheduled_date + trial_followup_days ≤ 今天`；
- **而且**這個學生在這門課沒有後續報名：該課程底下的班沒有 `status in ('active','pending_payment')` 的報名、也沒有 `pending`／`waitlist`／`awaiting_payment` 的報名申請。
  （已經報了就不用跟進 —— 判準查得到，不讓行政收到一則「其實已經處理了」的提醒。）
- 公開表單的試聽（`public_applications.kind = 'trial'`）**沒有試聽日欄位**，不做試聽跟進；它只走 §2 的「沒處理」（裁定 B）。

## 4. 提醒怎麼送

- 管道：既有的通知中心＋推播（`notify`），收件人同 `application_received`：該申請所在分校、有 `manage_students` 的管理員（`adminsForCampuses`）。
- 新通知種類（migration，`ALTER TYPE notification_kind ADD VALUE`）：`application_overdue`、`trial_followup`。
- **去重**：每張申請、每個階段只提醒一次；**去重鍵帶階段＋來源表＋申請 id**（家長端與公開表單的 id 空間不同，同 `notify-events.ts` 既有的 `parent_request`／`application` 分法）：
  `overdue:parent_request:enrollment:{id}`、`overdue:parent_request:trial:{id}`、`overdue:application:{id}`、`trial_followup:parent_request:{id}`。唯一鍵 `(user_id, dedupe_key)` 已在 `notifications`；不每天重複（裁定 D）。
- **跟「新申請」通知（`application_received`，#1744）是同一批收件人，文案要一眼分得出來**：

  | 種類                           | 標題                                                     | 內文                                            |
  | ------------------------------ | -------------------------------------------------------- | ----------------------------------------------- |
  | `application_received`（既有） | 新的報名申請／新的試聽申請                               | {學生} 送出報名申請                             |
  | `application_overdue`（新）    | **報名申請已經 {N} 天沒處理**／試聽申請已經 {N} 天沒處理 | {學生}・{送出日} 送出，還在待處理               |
  | `trial_followup`（新）         | **試聽後還沒報名**                                       | {學生} {試聽日} 試聽 {課程}，還沒報名，記得跟進 |

  連結：前兩種到 `/admin/applications`（對應分頁），試聽跟進到試聽分頁。標題開頭不重用「新的」—— 收件人一看標題就知道是新的還是放太久的。

- 觸發：`runPush` 每個 run 呼叫 `applicationReminders(db, today, orgs)`，**一天只算一次**（同 `staffDigests`：今天已算過的 org 第一句就跳過）；走 pg 批次撈候選，判準寫成純函式（`lib/application-reminders.ts`）並有 spec，對真 DB 加一支契約測試（同 `contract/staff-digests.contract.ts`）。

## 5. 裁定（計畫席 2026-10-22）

- **A** 候補（`waitlist`）不算沒處理。
- **B** 公開表單的試聽只走「沒處理」，不做試聽跟進（沒有試聽日）。
- **C** 天數 0＝關掉這種提醒。
- **D** 每張申請每個階段一次（量不大，點了直接到那張；不做每日摘要）。
- 補：去重鍵帶來源表（§4）；跟「新申請」通知的文案分開（§4 的表）。

## 6. 拆單（批准後）

1. 後端（保留類：migration 兩欄＋兩個通知種類、`lib/application-reminders.ts`＋`runPush` 掛載、org-settings 兩欄）—— 開 PR 前報計畫席讀 diff。
2. 前端：設定「一般」分頁的「報名流程」段（kv）；通知中心的兩種新通知（圖示、連結）。
