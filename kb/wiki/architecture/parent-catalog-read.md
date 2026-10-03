---
title: 家長端課程／開課班目錄（加選、試聽、首頁推薦的共用 API）
summary: GET /api/me/catalog?childId= —— 走 childDb.orgRef('classes') 讀機構參考資料（課程、分校、每週時段、任課老師以 embed 帶出），名額用批次版 activeEnrollmentCounts 只回數字，排除孩子已在籍的班。「推薦」與費用都沒有資料來源，推薦等裁、費用附三個選項待裁；分校範圍附兩個選項待裁。疊在 #1141（orgRef）上。待 STOP 批准。
category: architecture
status: draft
updated: 2026-10-03
tags: [architecture, parent, authorization, catalog, enrollment]
---

# 家長端課程／開課班目錄（#1118）

> 參考資料怎麼讀照 [[architecture/parent-data-scope]]「二之一」（`orgRef` 白名單、名額只給數字）。
> 這份只寫目錄本身；**「推薦加選」那半等裁**（schema 沒有推薦欄位，人工標記＝migration）。

## 問題

加選（`specs/parent/add-course.md`）、試聽（`specs/parent/trial.md`）、首頁推薦（`specs/parent/dashboard.md`）
三頁都要「這間補習班開了哪些班」。`/api/courses`、`/api/classes` 都是 ADMIN_ONLY，`/api/me` 底下沒有目錄。

## 端點

`GET /api/me/catalog?childId=`

- `childId` 必填、不在 scope → 403（[[architecture/parent-read-endpoints]]）。要 childId 是因為
  「排除已報名」與「年級」都是**這個孩子**的。
- 只回 `classes.is_active = true` 且（`end_date` 為 null 或 ≥ 今天）的班。

回每一班（`ParentCatalogClass`）：

| 欄位                                                     | 來源                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `classId`, `className`, `gradeLevels`                    | `classes`                                                                       |
| `courseId`, `courseName`, `subject`, `courseDescription` | `classes → courses`（embed）                                                    |
| `campusName`                                             | `classes → campuses`（embed）                                                   |
| `slots[]`：`weekday`, `startTime`, `endTime`             | `classes → schedules`（embed，只取今天仍有效的：`effective_to` null 或 ≥ 今天） |
| `teacherNames[]`                                         | `schedules → staff.display_name`（去重）                                        |
| `maxStudents`, `remainingSeats`                          | `classes.max_students` − `activeEnrollmentCounts`（不低於 0）                   |
| `matchesGrade`                                           | 孩子的 `students.grade` 在 `classes.grade_levels`（空陣列＝不限）               |

**排除孩子已在籍的班**：`childDb.from('enrollments', 'student_id').select('class_id, effective_from, effective_to').eq('student_id', childId)`，
今天在籍（`countEnrolledOn`）的班不回。這裡不需要 `ScopedIds`（只拿來排除、不拿去查別的表），所以不用 `pluck` —— 也就不依賴 #1145。

## 範圍與授權

1. `orgRef('classes').select(…embed…)` —— **只帶 `org_id`、不套孩子 scope**：目錄是機構參考資料，不是孩子的資料。
   embed 帶出的 `courses`／`campuses`／`schedules`／`staff.display_name` 同屬參考資料；**`enrollments` 不 embed**。
   白名單**不用擴**（base table 仍是 `classes`）。
2. **名額**：新增 `childDb.activeEnrollmentCounts(classIds)` —— 一次查 N 班，**在 child-db 內**聚合成
   `Map<classId, number>` 才交出去，route 拿不到任何報名列。現有單班版 `activeEnrollmentCount` 是 N 次 head 查詢，
   目錄一頁幾十班不適用。
3. 年級：`childDb.from('students', 'id').select('grade').eq('id', childId)`。
4. 不回：`next_class_id`、`created_by`／`updated_by`、任何報名或學生列、老師 id。

## 拒絕的替代方案

- **把 `/api/classes` 開給 parent**：admin 回應帶在籍人數明細、內部欄位，範圍模型是分校管理員不是家長。
- **前端打 N 次 `activeEnrollmentCount`**：N+1，且讓名額的聚合邏輯離開 child-db。

## 待裁

### 1. 費用從哪來（spec 要卡片顯示費用）

`fee_templates` 沒有掛在班或課程上 —— 費用是**每筆報名**選範本（`enrollments.fee_template_id`／`agreed_amount`），
目前 schema 裡**沒有「這個班多少錢」這個事實**。

| 選項                          | 做法                                                               | 代價                                                                           |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **A. 這版不顯示費用**（傾向） | 回應不帶費用；卡片寫「費用請洽櫃台」                               | 規格那一欄空著；零 migration，不卡目錄本身                                     |
| B. 班級掛預設範本             | migration：`classes.default_fee_template_id`，目錄帶範本名稱＋金額 | 保留類；管理端班級表單要加欄位；「預設」跟實際報名金額可能不同，家長會拿來比價 |
| C. 回機構所有啟用中的範本     | `orgRef` 白名單擴 `fee_templates`，前端自己列「月繳 X／期繳 Y」    | 範本不分課程，一律列出容易誤導（國小班看到高中價）                             |

### 2. 分校範圍

| 選項                          | 做法                                              | 代價                                                                   |
| ----------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| **A. 全機構所有分校**（傾向） | 只帶 `org_id`；卡片顯示分校名，前端可加分校篩選   | 家長會看到遠的分校；但規格詳情本來就列「上課地點／分校」，表示預期跨校 |
| B. 只限孩子目前在籍的分校     | 先從孩子的 enrollments 推分校，`.in('campus_id')` | 新生／沒有在籍班的孩子看到空目錄；想轉分校的家長看不到                 |

### 3. 年級：server 過濾還是只標記

傾向**只標記**（`matchesGrade`），前端預設篩掉、但可切換「顯示全部」—— 跳級／補救班是常態，
server 硬濾掉就沒有路看到。

### 4. 推薦加選

等使用者裁（人工標記＝migration，或由規則推導）。這版回應**不帶**推薦欄位，加的時候是純加法。
