# Specs — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-08-19

---

## [[specs/admin/academic/calendar|課堂行事曆（Admin Calendar）]]

統一行事曆介面，管理員可瀏覽課堂並直接處理停課、代課、調課。

Tags: `specs`, `admin`, `academic`, `calendar`

## [[specs/admin/academic/classes|課程管理]]

管理開課班，設定上課時間，產生課堂。

Tags: `specs`, `admin`, `academic`, `classes`

## [[specs/admin/academic/courses|課程列表]]

---

Tags: `specs`, `admin`, `academic`, `courses`

## [[specs/admin/calendar|課程日曆]]

以日曆視圖查看全校課堂，快速進入課堂詳情。

Tags: `specs`, `admin`, `calendar`

## [[specs/admin/dashboard|管理員儀表板]]

管理員首頁，快速掌握今日概況與待辦事項。

Tags: `specs`, `admin`, `dashboard`

## [[specs/admin/enrollment/enrollment|學生報名]]

管理員直接將學生加入開課班（跳過申請流程），適用現場報名、老生加報、特殊例外。

Tags: `specs`, `admin`, `enrollment`

Links to: [[rules/enrollment-rules|報名與繳費規則]], [[flows/enrollment|報名申請流程]]

## [[specs/admin/enrollment/enrollment-requests|報名審核]]

審核家長提交的報名申請。

Tags: `specs`, `admin`, `enrollment`, `enrollment-requests`

Links to: [[flows/enrollment|報名申請流程]], [[rules/enrollment-rules|報名與繳費規則]]

## [[specs/admin/enrollment/renewals|續課管理]]

查看續課狀態、處理異動申請。

Tags: `specs`, `admin`, `enrollment`, `renewals`

Links to: [[flows/renewal|續課流程（預告制）]], [[rules/enrollment-rules|報名與繳費規則]]

## [[specs/admin/enrollment/trials|試聽管理]]

管理試聽申請、安排試聽、跟進結果。

Tags: `specs`, `admin`, `enrollment`, `trials`

Links to: [[flows/trial|試聽申請流程]]

## [[specs/admin/finance/fee-templates|費用方案管理]]

定義開課班的收費標準。

Tags: `specs`, `admin`, `finance`, `fee-templates`

## [[specs/admin/finance/meals|餐費管理]]

新增和查詢餐費紀錄。

Tags: `specs`, `admin`, `finance`, `meals`

## [[specs/admin/finance/payments|繳費紀錄]]

管理繳費單、確認收款。

Tags: `specs`, `admin`, `finance`, `payments`

Links to: [[rules/enrollment-rules|報名與繳費規則]], [[flows/enrollment|報名申請流程]]

## [[specs/admin/finance/reports|營收報表]]

查看營收統計報表。

Tags: `specs`, `admin`, `finance`, `reports`

## [[specs/admin/notifications|通知中心（管理員）]]

查看系統通知與課務異動通知。

Tags: `specs`, `admin`, `notifications`

## [[specs/admin/roles-and-auth|角色與帳號管理規格]]

---

Tags: `specs`, `admin`, `roles-and-auth`

## [[specs/admin/student-affairs/attendance|出勤紀錄]]

查看和修正學生出勤狀態。管理員擁有不限時間、不限課堂的修改權限。

Tags: `specs`, `admin`, `student-affairs`, `attendance`

Links to: [[rules/attendance-rules|出勤與請假規則]], [[rules/attendance-rules|出勤與請假規則]], [[flows/attendance|到班與出勤流程]]

## [[specs/admin/student-affairs/grades|成績查閱]]

查詢所有學生成績。

Tags: `specs`, `admin`, `student-affairs`, `grades`

## [[specs/admin/student-affairs/leave|請假管理]]

建立和查詢請假紀錄。請假只能由管理員建立，支援事後補請。

Tags: `specs`, `admin`, `student-affairs`, `leave`

Links to: [[rules/attendance-rules|出勤與請假規則]], [[flows/attendance|到班與出勤流程]]

## [[specs/admin/student-affairs/parents|家長資料]]

管理家長帳號，關聯學生，處理帳號相關操作。

Tags: `specs`, `admin`, `student-affairs`, `parents`

Links to: [[flows/enrollment|報名申請流程]], [[rules/enrollment-rules|報名與繳費規則]]

## [[specs/admin/student-affairs/students|學生資料]]

查詢、新增與編輯學生基本資料。學生資料有兩種來源： - 公開報名：家長透過報名頁填寫，繳費完成後自動建立 - 管理員手動新增：管理員直接在後台建立，適用於內部人員子女入學、現場報名等情境

Tags: `specs`, `admin`, `student-affairs`, `students`

Links to: [[flows/enrollment|報名申請流程]], [[specs/admin/enrollment/enrollment|學生報名 spec]]

## [[specs/admin/system/campuses|分校設定]]

管理分校資訊與教室。

Tags: `specs`, `admin`, `system`, `campuses`

## [[specs/admin/system/settings|系統設定]]

全域系統參數設定。

Tags: `specs`, `admin`, `system`, `settings`

## [[specs/admin/system/staff|人員管理]]

管理管理員、老師帳號。

Tags: `specs`, `admin`, `system`, `staff`

## [[specs/BRAINSTORM_PROMPT|Clessia 系統架構腦力激盪提示詞 (Brainstorm Prompt)]]

你是一位資深的教育科技架構師與產品經理，專精於補習班（課後輔導）ERP 系統的設計。 你的目標是分析「Clessia」(學程管家) 目前的系統設計，並提出一套完整的 functional specification (功能規格) 結構。

Tags: `specs`, `BRAINSTORM_PROMPT`

## [[specs/parent/add-course|加選課程]]

瀏覽並加選新課程（以課程探索為中心）。

Tags: `specs`, `parent`, `add-course`

## [[specs/parent/attendance|到班紀錄]]

查看孩子的到班歷史。

Tags: `specs`, `parent`, `attendance`

## [[specs/parent/dashboard|家長儀表板]]

家長首頁，快速掌握孩子今日狀況。

Tags: `specs`, `parent`, `dashboard`

## [[specs/parent/enrollment|報名申請（家長）]]

已有帳號的家長為孩子加報課程、查看申請狀態。

Tags: `specs`, `parent`, `enrollment`

## [[specs/parent/grades|成績查閱]]

查看孩子的考試成績。

Tags: `specs`, `parent`, `grades`

## [[specs/parent/meals|餐費紀錄]]

查看孩子的餐費紀錄。

Tags: `specs`, `parent`, `meals`

## [[specs/parent/notifications|通知中心（家長）]]

查看課務異動通知。

Tags: `specs`, `parent`, `notifications`

## [[specs/parent/payments|繳費紀錄]]

查看繳費單和繳費紀錄。

Tags: `specs`, `parent`, `payments`

## [[specs/parent/renewal|續課資訊]]

預覽即將自動續課的內容，申請異動。

Tags: `specs`, `parent`, `renewal`

## [[specs/parent/schedule|課表查看]]

查看孩子的課表和課堂詳情。

Tags: `specs`, `parent`, `schedule`

## [[specs/parent/trial|試聽申請（家長）]]

已有帳號的家長為孩子申請試聽其他課程。

Tags: `specs`, `parent`, `trial`

## [[specs/public/enrollment|新生報名表單]]

新家長為孩子提交報名申請。

Tags: `specs`, `public`, `enrollment`

## [[specs/public/login|登入頁]]

使用者輸入帳號密碼登入系統。

Tags: `specs`, `public`, `login`

## [[specs/public/qr-checkin|QR 到班打卡]]

學生掃碼完成當日到班登記。

Tags: `specs`, `public`, `qr-checkin`

## [[specs/public/trial|試聽申請表單]]

新家長為孩子申請課程試聽。

Tags: `specs`, `public`, `trial`

## [[specs/README|Clessia 頁面規格文件]]

本目錄包含 Clessia（學程管家）系統所有頁面的功能規格摘要。

Tags: `specs`, `README`

## [[specs/teacher/assessments|考試管理]]

建立考試事件、輸入成績。

Tags: `specs`, `teacher`, `assessments`

## [[specs/teacher/attendance|點名]]

查看和修改當天課堂的出勤狀態。

Tags: `specs`, `teacher`, `attendance`

## [[specs/teacher/dashboard|老師儀表板]]

老師首頁，快速掌握今日課程與待處理事項。

Tags: `specs`, `teacher`, `dashboard`

## [[specs/teacher/notifications|通知中心（老師）]]

查看課務異動通知。

Tags: `specs`, `teacher`, `notifications`

## [[specs/teacher/schedule|課表（我的課表）]]

查看自己任課的課堂，進入課堂詳情。

Tags: `specs`, `teacher`, `schedule`

## [[specs/teacher/students|學生]]

查看自己任課班級的學生名單。

Tags: `specs`, `teacher`, `students`

