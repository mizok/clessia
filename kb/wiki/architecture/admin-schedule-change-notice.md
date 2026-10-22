---
title: 課務異動通知發給管理員（依分校範圍）
summary: 課務異動除了任課老師，也寫一則站內通知給範圍涵蓋該班分校的管理員；不需要 migration，收件人推導沿用 adminsForCampuses，同一個入口函式涵蓋所有寫入路徑。
category: architecture
tags: [architecture, notifications, schedule-changes, campus-scope]
status: active
sources: [https://github.com/mizok/clessia/issues/1023]
created: 2026-10-23
updated: 2026-10-23
---

# 課務異動通知發給管理員（依分校範圍）

**裁定來源**：使用者 10-23（#1023）：「課務異動（調課、停課、代課）也要發給管理員，依分校範圍發」。

## 現況（查過的，不是推定的）

| 事實                                                                                                                                     | 證據                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 管理端已有「收到的」收件匣，讀 `notifications` 表、依 `role` 過濾                                                                        | `routes/notifications.ts:95,103,152`（#1692／#1703）                                             |
| `notification_kind` 早就有 `schedule_change`                                                                                             | `supabase/migrations/20261016093442_notification_kinds_staff.sql:22`                             |
| `notifications.role` 是 `user_role`，沒有限制只能 teacher                                                                                | `20261016073848_push_notifications.sql`、`20261016090727_notifications_from_push_deliveries.sql` |
| 管理端 UI 已認得這個 kind（「課務異動」、圖示、連結字）                                                                                  | `features/admin/pages/notifications/notifications.component.ts:47`                               |
| 老師的課務異動通知只有一個入口 `notifyScheduleChange`，所有寫入 `schedule_changes` 的路由都經過它（classes／courses／sessions 共 18 處） | `lib/notify-schedule.ts`；`git grep -nE "queueScheduleChangeNotice\("`                           |
| 「依分校範圍找管理員」已有判準函式，請假與申請通知都在用                                                                                 | `lib/notify.ts` `adminsForCampuses`；`notify-leave.ts:108`、`notify-events.ts:56`                |

→ **不需要 migration。** #1023 在 10-03 寫「要 migration 加 enum」時，管理端收件匣還是打算建在公告上（`announcements.audience` 只有老師、家長兩個值）。#1692 之後收件匣改讀 `notifications`，那個前提已經不成立。

## 設計

在 `notifyScheduleChange` 裡、寫老師那一批的同時，**多寫一批給管理員**：

- **收件人**：每個受影響的班 → 它的 `classes.campus_id` → `adminsForCampuses(org, [campus], { permission: 'basic_operations' })`，也就是範圍是全分校（`null`）或包含這間分校、在職、有 admin 角色且有 `basic_operations` 的人。**做這個異動的人自己不收**（同老師）。一間分校只查一次（整門課停課會跨很多班）。
- **粒度**：跟老師一樣，**一批一班一則**（`batch_id` 依班分組）。一次停掉整門課的 12 堂只會收到一則「等 12 堂」。
- **去重鍵**：`schedule_change:admin:<batch>:<class>`。⚠️ **不能沿用老師的鍵**：`notifications` 是 `UNIQUE(user_id, dedupe_key)`，同一個人同時是老師和管理員時，第二則會被當成重複略過，管理員收件匣就收不到。加了 `admin:` 之後，兩個收件匣各收一則（收件匣本來就依身分分開）。
- **內容**：標題、內文跟老師那則相同（「課務異動：停課」／「國一數學 A 班 10/20 等 3 堂停課」）；`role = 'admin'`；連結 `/admin/changes`（課務異動頁）。
- **不推播**：寫入時 `push_status='skipped'`（`notify()` 現有行為，管理員第一版只進通知中心）。
- **失敗不影響業務**：沿用 `notifyScheduleChange` 的 try/catch 只記 log；管理員那批失敗也不擋老師那批（分兩次 `notify()`）。

`groupByClass` 的 select 多帶 `classes(name, campus_id)`（請假通知已經這樣選），不新增查詢。

### 前端

只改一個字：管理端 `KINDS.schedule_change.go` 從「看這堂」改成「看課務異動」，因為連結是異動列表、不是單堂。

## 裁定（計畫席 10-23，#1023 留言）

1. **權限：要 `basic_operations`**。跟請假通知 `leave_received` 一致：通知是給要處理日常課務的人，只管財務的管理員不必收。這不影響誰能看 `/admin/changes`（讀課務異動頁只要 admin 角色，`index.ts:406`）。
2. **種類：跟老師同一組全部發**：調課、代課、停課、復課、改時間、補課、加開課堂、換老師。入口函式不另設白名單。

## 不做

- 管理員的推播、管理員自己的通知偏好（第一版通知只進通知中心）
- 每日摘要（一天幾十筆異動時改成一則摘要）：等使用者回報量太多再做
- 動到老師那則的內容或收件人

## 影響與風險

- **量**：全分校範圍的管理員會收到 org 內每一批異動。一批一班一則已經收斂過；如果還是太多，就是上面「每日摘要」的觸發條件。
- **分類**：沒有 migration，但**維持保留類**（計畫席裁）：收件人依分校範圍挑，挑錯就是把別分校的課務資訊發給不該看的人。

## 測試

- `notify-schedule.spec`：範圍內的管理員收到、範圍外的不收、全分校範圍的收到、做異動的人不收、同時是老師和管理員的人兩個收件匣各一則（去重鍵不同）、管理員那批寫入失敗時老師那批照寫
- `notify.contract`：`groupByClass` 帶 `campus_id` 的 select 對真 PostgREST 回得來
