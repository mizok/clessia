---
title: 家長端讀取孩子的課堂（課表三頁的共用 API）
summary: GET /api/me/sessions —— 給 p-schedule／p-dashboard 今日課／p-attendance 用。範圍走 childDb：pluck 孩子的 enrollments 得班級 ScopedIds，fromScopedIds 查 sessions，再用 countEnrolledOn 把在籍區間外的堂濾掉（同 class-logs 的轉班防線）。回老師（含代課）、分校、小考數、課務異動、這個孩子那堂的出勤。日期窗必填、上限 42 天。admin 的 summariseSessions 吃原始 supabase，不能複用，只複用純函式。待 STOP 批准。
category: architecture
status: draft
updated: 2026-10-03
tags: [architecture, parent, authorization, sessions, schedule]
---

# 家長端讀取孩子的課堂（#1116）

> 照 [[architecture/parent-read-endpoints]] 的樣板抄，班級層級資料的處理照
> [[architecture/parent-class-logs-read]]（`pluck` → `fromScopedIds`）。這份只寫不一樣的地方。

## 問題

`/api/me` 底下沒有課堂。`/api/sessions` 是 ADMIN_ONLY、`/api/attendance` 只開 admin／teacher，
家長出勤（`parent/attendance.ts`）從 `attendance_records` 出發 —— **沒有點過名的堂（未來的課、
當天還沒上的課）根本不會出現**。課表（`specs/parent/schedule.md`）、首頁今日課、出勤頁三頁都卡在這。

## 端點

`GET /api/me/sessions?childId=&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`（參數名跟 `GET /api/me/attendance` 一致）

- `childId` **必填**（[[architecture/parent-read-endpoints]]：一次看一個孩子；不在 scope → 403，`isChildAllowed`）。
- `dateFrom`／`dateTo` **必填**，**`dateTo - dateFrom ≤ 42 天**（月曆一頁最多 6 週）。不給窗會變成「撈孩子讀過的每一堂」，
  而課表永遠只看一週或一個月。

回應每一堂（`ParentSession`）：

| 欄位                                                                    | 來源                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sessionId`, `date`, `startTime`, `endTime`, `status`（含 `cancelled`） | `sessions`                                                                                          |
| `classId`, `className`, `courseName`                                    | `classes` → `courses`                                                                               |
| `campusName`                                                            | `classes` → `campuses`                                                                              |
| `teacherName`, `isSubstitute`                                           | `sessions.teacher_id` vs `schedules.teacher_id`，判定用 `lib/session-substitute.ts`                 |
| `examCount`                                                             | `academy_exams` ↔ `academy_exam_classes`，配對鍵 (班級, 日期)，`lib/session-exams.ts`               |
| `changes[]`                                                             | `schedule_changes`（改期／代課／停課的說明），掛在 `session_id`，在 sessions 查詢裡 embed           |
| `attendance`：`status`, `checkedInAt`                                   | **這個孩子**在那堂的 `attendance_records`（`childDb.from(…, 'student_id')`）＋當天 `daily_checkins` |

聯絡簿內容與「歷史聯絡簿 10 堂」**不在這支** —— 已有 `GET /api/me/class-logs`，詳情 popup 另打。

## 範圍：兩層，跟 class-logs 同形

1. `childDb.from('enrollments', 'student_id').pluck('class_id, effective_from, effective_to', 'class_id')`
   —— 只拿得到自己孩子的報名，`ids` 是品牌化的 `ScopedIds`。
2. `childDb.fromScopedIds('sessions', 'class_id', ids).select(…).gte/lte('session_date', …)`。
3. **在籍區間過濾**：`countEnrolledOn(ranges, classId, date) > 0`（`lib/session-roster.ts`，底層是
   `isEnrolledOn`，規則在 `rules/attendance-rules.md` 的在籍判定）。**這一層是轉班防線**：只用「讀過的班」
   查 sessions，會看到 A 班在他離開之後、B 班在他加入之前的堂（規格：「只顯示學生報名生效期間內的課堂」）。

報名的狀態：**不濾 status，只看生效區間** —— 跟 `countEnrolledOn` 現有呼叫端一致（退班的人
`effective_to` 已經填了，區間本身就把他切掉）。

## 不能複用的東西

`lib/session-summary.ts` 的 `summariseSessions` 吃**原始 `supabase`**（它自己再查 enrollments／attendance
算全班人數）—— 家長端拿不到，而且**全班人數本來就不該給家長**。只複用純函式
（`isSubstituteSession`、`countExamsBySession`、`isCancelledSession`、`countEnrolledOn`）。

`schedule_changes` **掛在 `session_id` 上**（不是班級）：直接在第 2 步的 sessions 查詢裡 embed
`schedule_changes(...)`，範圍跟著那支 scoped 查詢走。小考走
`fromScopedIds('academy_exam_classes', 'class_id', ids)` embed `academy_exams(exam_date)`，同一份 `ScopedIds`。
**都不需要 `orgRef`**（[[architecture/parent-data-scope]] 二之一的白名單不用擴）。

## 拒絕的替代方案

- **把 `/api/sessions` 開給 parent 再加過濾**：admin 回應帶全班人數、老師備註，要做欄位遮蔽，
  而且那支的範圍模型是分校不是學生 —— 範圍錯一層就是把別人小孩的課表給出去。
- **從 `attendance_records` 出發補未來的堂**：兩個來源拼接，停課、臨時加開的堂要各寫一次。

## 待裁／待確認

1. **停課的堂要不要回**？傾向回（帶 `status: 'cancelled'` 與異動說明）—— 家長最需要知道的就是「這堂不上了」。
2. **代課要不要露出老師名字**？規格只寫「老師」；傾向回實際上課的老師＋`isSubstitute`。
3. 小考只數校內考（`academy_exams`）；**學校段考**（`school_exams`）是學生層級、不掛課堂，不放這支。
