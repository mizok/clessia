# Specs — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-09-04

---

## [[specs/admin/academic/calendar|課堂行事曆（Admin Calendar）]]

統一行事曆介面，管理員可瀏覽課堂並直接處理停課、代課、調課。

Tags: `specs`, `admin`, `academic`, `calendar`

## [[specs/admin/academic/classes|課程管理]]

管理開課班，設定上課時間，產生課堂。

Tags: `specs`, `admin`, `academic`, `classes`

## [[specs/admin/academic/courses|課程列表]]

/admin/courses 的課程列表 —— 管理員瀏覽與維護課程，是開課班（classes）的上層分類。

Tags: `specs`, `admin`, `academic`, `courses`

## [[specs/admin/calendar|課程日曆]]

以日曆視圖查看全校課堂，快速進入課堂詳情。

Tags: `specs`, `admin`, `calendar`

## [[specs/admin/dashboard|管理員儀表板]]

管理員首頁，六張卡各回答一個問題並跳到功能的家；經營區用 view_reports 蓋住。

Tags: `specs`, `admin`, `dashboard`

Links to: [[architecture/admin-dashboard-v1]]

## [[specs/admin/enrollment/enrollment|學生報名]]

管理員直接將學生加入開課班（跳過申請流程），適用現場報名、老生加報、特殊例外。

Tags: `specs`, `admin`, `enrollment`

Links to: [[architecture/enrollment-admin-view]], [[rules/enrollment-rules|報名與繳費規則]], [[flows/enrollment|報名申請流程]]

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

價目表是 org 層的定價（三種計費模式、只給定價不給折扣、停用不刪除），與機構自訂的收費期間同頁管理。折扣引擎與班級層級生效期間已於 2026-08-29 訪談否定。

Tags: `specs`, `admin`, `finance`, `fee-templates`, `billing-periods`

Links to: [[rules/billing-rules]], [[rules/billing-rules]]

## [[specs/admin/finance/meals|餐費管理]]

每日名單勾選：每生每日一筆餐記錄（單價在筆上、訂了沒、收不收費是人工開關），月底加總未結算的筆數開帳單。餐別維度與逐筆手動輸入金額已於 2026-08-29 訪談否定。

Tags: `specs`, `admin`, `finance`, `meals`

Links to: [[rules/meal-rules]], [[specs/admin/finance/payments|繳費紀錄]], [[rules/meal-rules]], [[rules/billing-rules]], [[rules/attendance-rules]]

## [[specs/admin/finance/payments|繳費紀錄]]

帳單與收款一對多，狀態由累計實收推導（未繳/部分繳/繳清）＋逾期是衍生標記；收現金或轉帳（附憑證圖）、開收據、印收費袋、催繳只做可見性。折扣引擎、強制啟用、六種狀態、分期計畫已於 2026-08-29 訪談否定。

Tags: `specs`, `admin`, `finance`, `payments`, `invoices`

Links to: [[rules/billing-rules]], [[architecture/admin-payments-page]], [[rules/billing-rules]], [[rules/meal-rules]], [[flows/enrollment]], [[rules/enrollment-rules]]

## [[specs/admin/finance/reports|營收報表]]

依日期/分校/課程看實收、應收未收、退款；數字一律來自後端聚合端點，不在前端加總分頁明細。

Tags: `specs`, `admin`, `finance`, `reports`

Links to: [[rules/billing-rules]], [[rules/billing-rules]]

## [[specs/admin/notifications|通知中心（管理員）]]

查看系統通知與課務異動通知。

Tags: `specs`, `admin`, `notifications`

## [[specs/admin/roles-and-auth|角色與帳號管理規格]]

三個角色（admin / teacher / parent）存在 user_roles，細部權限存在 user_roles.permissions。密碼登入已於 2026-08 移除，改為 LINE OAuth + 一次性登入連結。

Tags: `specs`, `admin`, `roles-and-auth`

Links to: [[architecture/line-oauth-login]]

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

Links to: [[architecture/line-oauth-login]], [[architecture/line-oauth-login]], [[flows/enrollment|報名申請流程]], [[rules/enrollment-rules|報名與繳費規則]]

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

Links to: [[architecture/line-oauth-login]]

## [[specs/public/login|登入頁]]

一顆「使用 LINE 登入」按鈕。這個系統沒有密碼——首次進入靠管理員發出的一次性連結，綁定 LINE 之後才走這一頁。

Tags: `specs`, `public`, `login`, `oauth`, `line`

Links to: [[architecture/line-oauth-login]], [[architecture/login-experience]], [[architecture/line-oauth-login]], [[architecture/line-oauth-login]], [[architecture/login-experience]]

## [[specs/public/qr-checkin|QR 到班打卡]]

學生掃碼完成當日到班登記。

Tags: `specs`, `public`, `qr-checkin`

## [[specs/public/trial|試聽申請表單]]

新家長為孩子申請課程試聽。

Tags: `specs`, `public`, `trial`

Links to: [[architecture/line-oauth-login]]

## [[specs/README|Clessia 頁面規格文件]]

本目錄包含 Clessia（學程管家）系統所有頁面的功能規格摘要。

Tags: `specs`, `README`

## [[specs/teacher/assessments|考試管理]]

建立考試事件、輸入成績。

Tags: `specs`, `teacher`, `assessments`

## [[specs/teacher/attendance|點名]]

查看和修改當天課堂的出勤狀態。

Tags: `specs`, `teacher`, `attendance`

Links to: [[architecture/teacher-students-view]]

## [[specs/teacher/dashboard|老師儀表板]]

老師首頁，快速掌握今日課程與待處理事項。

Tags: `specs`, `teacher`, `dashboard`

Links to: [[specs/teacher/schedule]], [[architecture/teacher-today-flow]], [[specs/teacher/assessments]]

## [[specs/teacher/notifications|通知中心（老師）]]

查看課務異動通知。

Tags: `specs`, `teacher`, `notifications`

## [[specs/teacher/schedule|課表（我的課表）]]

查看自己任課的課堂，進入課堂詳情。

Tags: `specs`, `teacher`, `schedule`

Links to: [[architecture/teacher-schedule-mobile-day]], [[architecture/teacher-today-flow]], [[architecture/teacher-today-flow]]

## [[specs/teacher/students|學生]]

查看自己任課班級的學生名單。

Tags: `specs`, `teacher`, `students`

Links to: [[specs/teacher/attendance]]

