---
title: 請假綁定堂次（leave_request_sessions）
summary: 請假單可以綁定「勾選的課堂」（規格 specs/admin/student-affairs/leave.md 多選課堂）。新增關聯表 leave_request_sessions（帶 org_id、PK (leave_request_id, session_id)、cascade）；沒有綁定列的假沿用舊語意（整天／單日時間窗），所以既有資料與 seed 不用遷移。判斷核心仍是 leaveCoversSession，加一條「有綁定就只比 id」。寫入面 create／update 收 sessionIds、server 驗在籍與非停課；update 以堂次 diff 做 revert／apply。cancel-leave、日到班 onLeave、報名回補、重疊 409 的新語意列為待裁。待 STOP 批准。
category: architecture
status: draft
updated: 2026-10-03
tags: [architecture, attendance, leave, migration]
---

# 請假綁定堂次（#1114）

## 問題

`leave_requests` 只有 `start_date`／`end_date`＋可選 `start_time`／`end_time`。規格
（`specs/admin/student-affairs/leave.md` 新增請假 3.）要「選日期 → 列出該學生當天在籍的課堂 → **勾選**要請假的課堂」。
現在沒有地方存「勾了哪幾堂」：一天三堂只請其中一堂，只能靠時間窗湊，而且**只有單日假才看時間窗**
（`lib/leave-covers-session.ts`），`applyLeaveAttendance`（`routes/leaves.ts`）寫 `on_leave` 時根本不看時間 ——
**同一張假，roster 推導說只蓋一堂、出勤紀錄卻三堂都寫成請假。**

## Schema（一支新 migration，只加不改 —— c3）

```sql
CREATE TABLE public.leave_request_sessions (
  leave_request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  session_id       uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (leave_request_id, session_id)
);
CREATE INDEX leave_request_sessions_session_idx ON public.leave_request_sessions (session_id);
ALTER TABLE public.leave_request_sessions ENABLE ROW LEVEL SECURITY;  -- fail-closed，無 policy
```

- **帶 `org_id`**：寫入路徑照 c1 以 org 定位，A23 會要求它進 `lib/org-scope.ts` 的 `OrgTable`（照辦）。
  不帶的話刪子表列得先驗父列，每個寫入點多一跳。
- **關聯表而不是 `leave_requests.session_ids uuid[]`**：陣列沒有 FK，堂次被刪（重排課）時留下懸空 id；
  也沒辦法從 session 反查「這堂誰請假」（roster 要的方向）。
- **不加 `student_id`**：學生由父列決定，重複一份就多一個會分岔的地方。

## 語意

| 假單                           | 蓋到哪些堂                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------- |
| **有綁定列**                   | **恰好綁定的那幾堂**，不看日期區間與時間窗                                   |
| 沒有綁定列（舊資料、電話請假） | 沿用現狀：日期區間內整天；單日且有時間窗則做時間重疊（`leaveCoversSession`） |

- **向後相容是刻意的**：既有資料、`seed.sql`／`seed-demo.sql`（全部單日、無時間）、電話請假（只送日期）
  都不用動；`seed-demo.sql` 的「凡 on_leave 必有請假單」守衛照舊成立。
- 有綁定時 `start_date`／`end_date` 仍要填（＝綁定堂次的最早／最晚日期，server 算，不吃 body），
  列表的日期篩選與 campus 過濾才不用改。`start_time`／`end_time` 與 `sessionIds` **互斥**（兩個都給 → 400）。
- 判斷核心仍是 `leaveCoversSession` 一支：`LeaveWindow` 加 `sessionIds: readonly string[] | null`、
  `SessionWindow` 加 `sessionId`；有綁定就只比 id。**所有讀取點（student-day、roster 推導、roster GET、
  日到班 onLeave、workbench）都經過它**，所以改一處、各點只需要把綁定撈出來傳進去。

## 寫入面（`routes/leaves.ts`，管理端）

- `POST /api/leaves`：`sessionIds?: uuid[]`（1～N）。server 驗每一堂：屬於本 org、學生在那天在籍
  （`countEnrolledOn`）、不是停課（`isCancelledSession`）；任一不合 → 400 指名哪一堂。
  驗過之後 insert 假單＋綁定列，`applyLeaveAttendance` **只寫綁定那幾堂**的 `on_leave`。
- `PATCH /api/leaves/:id`：給了 `sessionIds` 就整組替換；用堂次 diff（新增的 apply、拿掉的 revert，
  沿用「只刪 `attendance_taken_at` 為 null 的 event」那條保護）。沒給就不動綁定。
- `DELETE`：綁定列跟著 cascade；revert 只回綁定那幾堂。
- 授權：沿用 `studentWriteScope`（campus-write-guard）；session 走 org 定位查詢（c1）。
- 稽核：綁定變更寫進既有的 `sync_leave_to_attendance`／`revert_leave_attendance` diff。

順帶修：**沒有綁定的單日時間窗假**，`applyLeaveAttendance` 也改成經過 `leaveCoversSession`，
不再整天全寫 —— 這是上面「roster 說一堂、紀錄寫三堂」的分岔，修在共用判斷上。

## 不做

- 家長端請假（**規格與規則矛盾**：`specs/.../leave.md` 寫只有管理員，`rules/attendance-rules.md` §4 寫「管理員或家長」；
  而且目前沒有家長寫入口）→ 另開。
- 批次請假（選一堂 → 多學生）→ 另開；這份 schema 已經撐得住。
- 前端勾選 UI → 前端席另開（現成資料源：`GET /api/attendance/student-day`，電話請假已在用）。

## 待裁

1. **cancel-leave（「請假的學生臨時出現」）**：現在以「那一天」為單位縮短／刪單。綁定型假傾向
   **只移除當天的綁定列**（剩零列就刪單），不動別天。
2. **日到班 `onLeave`**（`attendance.ts` 日到班清單、`workbench.ts`）：傾向「**當天任一堂被蓋到就算**」，
   跟現在整天假的行為一致；另一個選項是「當天所有在籍堂都請假才算」。
3. **報名回補（#568，`enrollments.ts`）**：綁定型假**不回補**到新報名的班（新班的堂不可能在綁定清單裡）；
   整天型照舊回補。
4. **重疊 409**：綁定型之間只在**共用同一堂**時衝突；綁定型與整天型同一天就衝突（整天已經蓋了那堂）。
5. 綁定的堂之後被**停課**：綁定列留著（停課本來就不寫出勤，`isCancelledSession`）；被**刪除**則 cascade 掉，
   假單剩零列時**不自動刪單**（留下一張沒蓋到任何堂的假，列表可見，行政自己決定）。
