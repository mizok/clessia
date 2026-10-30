# Specs — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-10-21

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

## [[specs/admin/enrollment/approve-request|核准家長的報名申請（開繳費單、建報名、轉待付款；設計稿）]]

設計稿（#1726，保留類、金額路徑，待裁）。管理員在 /admin/applications 核准家長 App 送的報名申請：一個對話框選計費模式與價目表、看首期試算（可改，改了要寫原因）、繳費期限；送出後在**一個 pg 交易**（withTx，repo 不引入 RPC）裡鎖班、重數名額、建 pending_payment 的報名、開一張帳單一列學費明細（填好月份／期別，月結不會重開）、申請轉 awaiting_payment 並寫 enrollment_id。候補可核准但名額照數、額滿 409 不給硬塞。帳單不加欄位，靠 enrollment_requests.enrollment_id → invoice_items → invoices 連回；家長端申請詳情走 childDb 讀這張帳單與班級分校的帳戶。家長通知沿用既有 invoice_due 提醒、核准當下另發一則要加 enum（待裁）。A6 沒畫管理端核准；家長端待付款詳情照 A6 p-enrollment 全採。

Tags: `specs`, `admin`, `enrollment`, `enrollment-requests`, `billing`, `invoices`, `parent`, `design`

Links to: [[rules/enrollment-rules]], [[rules/billing-rules]], [[specs/parent/applications]], [[architecture/pg-pool-writes]], [[architecture/pg-pool-writes]], [[architecture/a6-adoption-rules]], [[architecture/a6-adoption-rules]]

## [[specs/admin/enrollment/payment-activation|收款後報名轉正式、申請轉完成（設計稿）]]

設計稿（#1778，已裁 2026-10-21；保留類、改既有記收款路徑 → 合併由使用者決定）。核准後報名是 pending_payment、申請是 awaiting_payment，原本沒有任何路徑把它們往前推，而月結只對 active 開單。已裁：記收款同一個交易裡，第一筆收款（含定金）就把這張帳單上的 pending_payment 報名轉 active；帳單繳清時把連到它們的 awaiting_payment 申請轉 completed，並發站內＋推播通知家長（新 notification_kind enrollment_completed，migration 獨立 PR）。退費、作廢不倒轉；行政手動轉 active 也一併完成申請；多報名的帳單照帳單算。記收款路由改走 withTx（順便關掉退費先查淨額再寫的競態）。

Tags: `specs`, `admin`, `enrollment`, `enrollment-requests`, `billing`, `payments`, `design`

## [[specs/admin/enrollment/enrollment|學生報名]]

管理員直接將學生加入開課班（跳過申請流程），適用現場報名、老生加報、特殊例外。

Tags: `specs`, `admin`, `enrollment`

Links to: [[architecture/enrollment-admin-view]], [[rules/enrollment-rules]], [[rules/enrollment-rules|報名與繳費規則]], [[flows/enrollment|報名申請流程]]

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

## [[specs/admin/finance/leave-streak-waiver|連續請假滿 N 個上課日可不收費：提醒行政（設計稿）]]

設計稿（#1732，10-17 已批准）：連續請假滿 N 個上課日（機構設定，預設 3）可不收費，系統只偵測與提醒有財務權限的管理員、不碰計費；以學生為單位、某天每一堂都請假才算、相鄰假單合併；標記讀取時現算，可標「已處理」（延長會重新出現）；一支 migration，拆三單。

Tags: `specs`, `finance`, `leave`, `attendance`, `notifications`, `migration`

Links to: [[rules/billing-rules]], [[architecture/leave-session-binding]], [[architecture/deploying]], [[rules/billing-rules]], [[rules/attendance-rules]], [[rules/meal-rules]]

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

Links to: [[a6-adoption-rules]]

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

Links to: [[rules/attendance-rules]], [[rules/attendance-rules]], [[rules/attendance-rules|出勤與請假規則]], [[flows/attendance|到班與出勤流程]]

## [[specs/admin/student-affairs/parents|家長資料]]

管理家長帳號，關聯學生，處理帳號相關操作。

Tags: `specs`, `admin`, `student-affairs`, `parents`

Links to: [[architecture/line-oauth-login]], [[architecture/line-oauth-login]], [[flows/enrollment|報名申請流程]], [[rules/enrollment-rules|報名與繳費規則]]

## [[specs/admin/student-affairs/students|學生資料]]

查詢、新增與編輯學生基本資料。學生資料有兩種來源： - 公開報名：家長透過報名頁填寫，繳費完成後自動建立 - 管理員手動新增：管理員直接在後台建立，適用於內部人員子女入學、現場報名等情境

Tags: `specs`, `admin`, `student-affairs`, `students`

Links to: [[flows/enrollment|報名申請流程]], [[specs/admin/enrollment/enrollment|學生報名 spec]]

## [[specs/admin/system/campus-classrooms|分校的教室與帳戶（#1314 SE3，設計稿）]]

設計稿（#1314 SE3，保留類、要 migration；10-21 已裁）。照 A6 settings.html#campuses：分校 ⋮ 的「教室」對話框（列出教室、新增：名稱、容納人數、設備選填）、列上「N 間教室／還沒有教室」、分校表單加狀態與出勤模式。schema 只缺教室：新表 classrooms（分校底下，名稱分校內唯一、容量選填、設備選填）。帳戶**已存在**（campuses.payment_info，#1073 使用者裁一個多行欄位）—— A6 畫成「收款銀行＋帳號」兩欄，使用者裁不拆、維持一欄，登記 A6 偏離（舊有新無：多帳戶、LINE Pay、現金時段會寫不進去）。狀態、出勤模式 API 早已收，只差表單。A6 在班級時段也用教室（class.html、courses.html），同一支 migration 先加 schedules.classroom_id（可空、SET NULL）、UI 另開單（計畫席裁）。

Tags: `specs`, `admin`, `system`, `campuses`, `classrooms`, `migration`, `design`, `a6`

Links to: [[architecture/deploying]], [[specs/admin/system/campuses]], [[architecture/pg-pool-writes]], [[architecture/a6-adoption-rules]], [[specs/admin/system/campuses]]

## [[specs/admin/system/campuses|分校設定]]

管理分校資訊與教室。

Tags: `specs`, `admin`, `system`, `campuses`

Links to: [[architecture/payment-info]]

## [[specs/admin/system/settings|系統設定]]

全域系統參數設定。

Tags: `specs`, `admin`, `system`, `settings`

Links to: [[architecture/web-push]], [[specs/admin/finance/leave-streak-waiver]], [[architecture/payment-info]]

## [[specs/admin/system/staff|人員管理]]

管理管理員、老師帳號。

Tags: `specs`, `admin`, `system`, `staff`

## [[specs/BRAINSTORM_PROMPT|Clessia 系統架構腦力激盪提示詞 (Brainstorm Prompt)]]

你是一位資深的教育科技架構師與產品經理，專精於補習班（課後輔導）ERP 系統的設計。 你的目標是分析「Clessia」(學程管家) 目前的系統設計，並提出一套完整的 functional specification (功能規格) 結構。

Tags: `specs`, `BRAINSTORM_PROMPT`

## [[specs/parent/add-course|加選課程]]

瀏覽並加選新課程（以課程探索為中心）。

Tags: `specs`, `parent`, `add-course`

## [[specs/parent/applications|家長端送申請與申請紀錄（報名／試聽／加選，設計稿）]]

家長端「報名」「試聽」「加選」三頁目前是空殼（#1727）。照 A6 p-enrollment／p-trial／p-add-course 全採：報名、試聽兩頁各有「新增申請／申請紀錄」分頁，加選頁是課程卡片探索、送出走報名申請。後端 API 大多已在（enrollment-requests、trial-requests、catalog），缺的是目錄的「已在班上／撞時間」、繳費週期與試聽日期欄、待付款的帳單，以及家長送出後通知分校管理員（#1731）。計畫席 10-19 依「A6 全採、操作體驗優先」裁定 Q1–Q8（Q4 待使用者，暫照建議）。

Tags: `specs`, `parent`, `enrollment`, `trial`, `add-course`, `design`

Links to: [[specs/parent/enrollment]], [[specs/parent/trial]], [[specs/parent/add-course]], [[architecture/deploying]]

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

Links to: [[architecture/parent-grades-period-filter]]

## [[specs/parent/leave|幫孩子請假（家長端，設計稿）]]

設計稿（#1695，10-17 已批准）：家長在到班紀錄頁幫孩子請假（照 A6，時間區間、只能請還沒開始的課、沒有課就擋），/api/me/leaves 與管理端共用建立核心，通知管理員（leave_received）與任課老師。

Tags: `specs`, `parent`, `attendance`, `leave`, `design`

Links to: [[rules/attendance-rules]], [[architecture/parent-data-scope]], [[specs/admin/finance/leave-streak-waiver]], [[specs/admin/finance/leave-streak-waiver]]

## [[specs/parent/meals|餐費紀錄]]

查看孩子的餐費紀錄。

Tags: `specs`, `parent`, `meals`

Links to: [[rules/meal-rules]]

## [[specs/parent/notifications|通知中心（家長）]]

查看課務異動通知。

Tags: `specs`, `parent`, `notifications`

## [[specs/parent/payments|繳費紀錄]]

查看繳費單和繳費紀錄。

Tags: `specs`, `parent`, `payments`

Links to: [[architecture/payment-info]]

## [[specs/parent/renewal|續課資訊]]

預覽即將自動續課的內容，申請異動。

Tags: `specs`, `parent`, `renewal`

## [[specs/parent/schedule|課表查看]]

查看孩子的課表和課堂詳情。

Tags: `specs`, `parent`, `schedule`

## [[specs/parent/trial|試聽申請（家長）]]

已有帳號的家長為孩子申請試聽其他課程。

Tags: `specs`, `parent`, `trial`

## [[specs/public/application-forms-a6|公開試聽申請、我要報名表單照 A6（設計稿）]]

已實作上線（#1637；#1665 10-22 結案）：公開試聽／報名表單照 A6；補關係欄、機器人驗證預設 ALTCHA（可切換 Turnstile）、班級公開旗標、所有人員可設暱稱（對外只露任課老師）、申請保存 6 個月；保留裁定與不做的項目。

Tags: `specs`, `public`, `trial`, `enrollment`, `a6`, `security`, `privacy`, `migration`

Links to: [[architecture/a6-adoption-rules]], [[architecture/a6-adoption-rules]], [[rules/enrollment-rules]], [[flows/trial]], [[architecture/a6-adoption-rules]]

## [[specs/public/enrollment|新生報名表單]]

新家長為孩子提交報名申請。

Tags: `specs`, `public`, `enrollment`

Links to: [[architecture/line-oauth-login]], [[architecture/deploying]], [[specs/public/application-forms-a6]]

## [[specs/public/login|登入頁]]

一顆「使用 LINE 登入」按鈕。這個系統沒有密碼——首次進入靠管理員發出的一次性連結，綁定 LINE 之後才走這一頁。

Tags: `specs`, `public`, `login`, `oauth`, `line`

Links to: [[architecture/line-oauth-login]], [[architecture/login-experience]], [[architecture/line-oauth-login]], [[architecture/line-oauth-login]], [[architecture/login-experience]]

## [[specs/public/qr-checkin|QR 到班打卡]]

學生掃碼完成當日到班登記。

Tags: `specs`, `public`, `qr-checkin`

Links to: [[architecture/kiosk-checkin]]

## [[specs/public/trial|試聽申請表單]]

新家長為孩子申請課程試聽。

Tags: `specs`, `public`, `trial`

Links to: [[architecture/line-oauth-login]], [[architecture/deploying]], [[specs/public/application-forms-a6]]

## [[specs/README|Clessia 頁面規格文件]]

本目錄包含 Clessia（學程管家）系統所有頁面的功能規格摘要。

Tags: `specs`, `README`

## [[specs/sitemap/_shared/announcement-inbox|公告收件匣（家長端 / 老師端共用）]]

通知中心的本體：未讀計數、全部標為已讀、逐則展開；展開會順帶把該則標成已讀（寫入）。

Tags: `sitemap`, `_shared`, `parent`, `teacher`

Links to: [[specs/sitemap/parent/notifications]], [[specs/sitemap/teacher/notifications]], [[specs/sitemap/teacher/notifications]], [[specs/sitemap/teacher/notifications]], [[specs/sitemap/parent/notifications]], [[specs/sitemap/teacher/notifications]], [[specs/sitemap/_shared/subject-manager]], [[specs/sitemap/_shared/audit-log-dialog]]

## [[specs/sitemap/_shared/attendance-roster-panel|點名面板（子頁面，多頁共用）]]

AttendanceRosterPanelComponent 的 UI 地圖：三個頁面開得到，逐生出席／缺席與整批出席；副標的時段依呼叫端而異。

Tags: `sitemap`, `_shared`, `admin`, `teacher`

Links to: [[specs/sitemap/admin/dashboard]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/teacher/schedule]], [[specs/sitemap/admin/attendance]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/_shared/subject-manager]]

## [[specs/sitemap/_shared/audit-log-dialog|操作紀錄對話框（子頁面，6 頁共用）]]

AuditLogDialogComponent 的 UI 地圖：唯讀操作紀錄表，由呼叫端指定要看哪些資源類型。

Tags: `sitemap`, `_shared`, `admin`

Links to: [[specs/sitemap/admin/attendance]], [[specs/sitemap/admin/sessions]]

## [[specs/sitemap/_shared/confirm-dialog|確認對話框（子頁面，8 頁共用）]]

ConfirmDialogComponent 的 UI 地圖：訊息 + 取消/確認兩顆鈕，另有一種「必填原因」型態。

Tags: `sitemap`, `_shared`, `admin`

Links to: [[specs/sitemap/admin/courses-courseId-classes-classId]]

## [[specs/sitemap/_shared/contact-book-entry-dialog|聯絡簿編輯對話框（子頁面，2 頁共用）]]

ContactBookEntryDialogComponent 的 UI 地圖：管理端與老師端各開一次，而兩邊傳的 data 形狀不同。

Tags: `sitemap`, `_shared`, `admin`, `teacher`

Links to: [[specs/sitemap/_shared/student-form-dialog]]

## [[specs/sitemap/_shared/parent-child-switcher|孩子切換器（家長端四頁共用）]]

家長端橘色頁首上的孩子徽章與切換下拉；三種形態（可切換／靜態／讀取失敗）由 ChildScopeService 決定。

Tags: `sitemap`, `_shared`, `parent`

Links to: [[specs/sitemap/parent/dashboard]], [[specs/sitemap/parent/attendance]], [[specs/sitemap/parent/grades]], [[specs/sitemap/parent/payments]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/public/select-role]], [[specs/sitemap/README|方法頁]]

## [[specs/sitemap/_shared/permission-matrix|權限變體矩陣（管理端）]]

九個細部權限各自改變什麼 —— 側欄、進得去哪些頁、頁內按鈕、資料範圍；以及前端只擋四條路由這件事。

Tags: `sitemap`, `_shared`, `admin`, `authorization`

Links to: [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/_shared/public-shell|公開頁外框（PublicShell，login / trial / enrollment / qr-checkin / link-line / select-role 共用）]]

六個公開頁共用的外框：橘色品牌面（字標、標語、流場動畫、四條輕量連結、版權）+ 白色主面。

Tags: `sitemap`, `_shared`, `public`, `rwd`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/public/login]]

## [[specs/sitemap/_shared/shell-layout|外框（ShellLayout，admin / teacher / parent 共用）]]

三個角色共用的外框：左側選單與右上角色徽章；選單項目依角色與 permissions 動態產生。640px 以下換成底欄 + 「更多」面板。

Tags: `sitemap`, `_shared`, `admin`, `teacher`, `parent`, `rwd`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/parent-child-switcher]]

## [[specs/sitemap/_shared/student-form-dialog|學生表單對話框（子頁面，3 頁共用）]]

StudentFormDialogComponent 的 UI 地圖：新增與編輯共用一支，而三個開啟點傳的 data 不同、欄位也不同。

Tags: `sitemap`, `_shared`, `admin`

## [[specs/sitemap/_shared/subject-manager|科目管理（共用元件，3 個使用點）]]

SubjectManagerComponent 的 UI 地圖：科目清單、行內改名、被引用時刪不掉。同一支元件在設定頁是內嵌區塊、在兩支表單裡是對話框。

Tags: `sitemap`, `_shared`, `admin`

Links to: [[specs/sitemap/admin/settings-subjects]], [[specs/sitemap/admin/staff]], [[specs/sitemap/admin/courses]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/admin/settings-subjects]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/admin/settings-subjects]]

## [[specs/sitemap/admin/attendance|課堂出勤紀錄（/admin/attendance）]]

/admin/attendance 沒有畫面 —— 它是轉址到 /admin/sessions；那支接不到的同名元件已於 #698 刪除。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/admin/sessions]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/admin/sessions]]

## [[specs/sitemap/admin/changes|課務異動（/admin/changes）]]

/admin/changes 的實際 UI 地圖：調課／代課／停課的唯讀紀錄表，三個篩選器、零寫入動作。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/sessions]]

## [[specs/sitemap/admin/contact-book|聯絡簿（/admin/contact-book）]]

/admin/contact-book 的實際 UI 地圖：缺漏名單、三個篩選、聯絡簿列表與編輯對話框；預設區間下整頁是空的。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/contact-book-entry-dialog]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/dashboard]], [[specs/sitemap/admin/notifications]]

## [[specs/sitemap/admin/courses|課程管理（/admin/courses）]]

/admin/courses 的實際 UI 地圖：課程分組清單、分校頁籤、每個課程與班級各自的動作與五支對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/admin/courses-courseId-classes-classId]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/admin/courses-courseId-classes-classId|開課班詳情（/admin/courses/:courseId/classes/:classId）]]

班級詳情的實際 UI 地圖：學生名單與課表兩個分頁、每位學生的三項動作、必填原因的確認對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/courses]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/courses]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/admin/dashboard|儀表板（/admin/dashboard）]]

/admin/dashboard 的實際 UI 地圖：作業台式儀表板，待處理卡片、今日課表（可直接開點名）、現況數字。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/attendance-roster-panel]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/attendance-roster-panel]], [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/admin/enrollments|報名進出（/admin/enrollments）]]

/admin/enrollments 的實際 UI 地圖：三個篩選、一張唯讀表格，而整頁最主要的互動是取樣器漏掉的那 12 列。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/courses]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/admin/changes]], [[specs/sitemap/admin/courses-courseId-classes-classId]]

## [[specs/sitemap/admin/fee-templates|費用方案管理（/admin/fee-templates）]]

/admin/fee-templates 的實際 UI 地圖：一頁兩個實體（價目表、收費期間），各自一張表與一支表單對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/students]], [[specs/sitemap/admin/meals]]

## [[specs/sitemap/admin/grades|考務與成績（/admin/grades）]]

/admin/grades 沒有自己的畫面 —— 它是有子路由的外殼，預設轉到考試管理。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/admin/grades-exams]], [[specs/sitemap/admin/grades-exams]], [[specs/sitemap/admin/grades-exams]], [[specs/sitemap/admin/settings]]

## [[specs/sitemap/admin/grades-exams|考試管理（/admin/grades/exams）]]

/admin/grades/exams 的實際 UI 地圖：補習班考試與學校考試合併清單、兩條待辦橫幅、每場考試四項動作。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/grades]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/grades-exams-type-id-scores]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/sessions]]

## [[specs/sitemap/admin/grades-exams-type-id-scores|成績登錄（/admin/grades/exams/:type/:id/scores）]]

成績登錄的實際 UI 地圖：逐生輸入的表格，考試已結束時整頁唯讀，離開前有未存變更攔截。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/grades-exams]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/grades-exams]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/grades-exams]]

## [[specs/sitemap/admin/grades-overview|成績總覽（/admin/grades/overview）]]

/admin/grades/overview 是一張兩選一的入口頁：學生視角與班級視角，整頁只有兩個互動元素。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/grades-overview-student]], [[specs/sitemap/admin/grades-overview-class]], [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/admin/grades-overview-class|班級視角（/admin/grades/overview/class）]]

成績總覽的班級視角：依課程分組的班級清單，點一班開考試統計對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/grades-overview]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/grades-overview]], [[specs/sitemap/admin/grades-exams-type-id-scores]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/grades-exams]]

## [[specs/sitemap/admin/grades-overview-student|學生視角（/admin/grades/overview/student）]]

成績總覽的學生視角：可篩選的學生清單，點一位開成績明細對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/grades-overview]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/grades-overview]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/grades-overview-class]], [[specs/sitemap/admin/students]], [[specs/sitemap/admin/grades-overview-class]]

## [[specs/sitemap/admin/index|管理員根路由（/admin）]]

/admin 沒有自己的畫面 —— 它是一條明式 redirect 到儀表板，而那條 redirect 是 children 的最後一筆。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/admin/dashboard]], [[specs/sitemap/admin/dashboard]], [[specs/sitemap/admin/dashboard]]

## [[specs/sitemap/admin/leave|學生請假管理（/admin/leave）]]

/admin/leave 的實際 UI 地圖：兩個篩選、請假表格、每列一顆取消鈕，三支對話框（含兩套不同的對話框系統）。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/admin/students]], [[specs/sitemap/admin/parents]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/admin/students]]

## [[specs/sitemap/admin/meals|餐費管理（/admin/meals）]]

/admin/meals 的實際 UI 地圖：當日名單（可編輯）與區間查詢（唯讀）兩種模式，一支月結對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/fee-templates]]

## [[specs/sitemap/admin/notifications|通知中心（/admin/notifications）]]

/admin/notifications 的實際 UI 地圖：發布表單（4 個欄位）與已發布清單；副標還停在「只能發給老師」的舊世界。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/admin/parents|家長管理（/admin/parents）]]

/admin/parents 的實際 UI 地圖：家長表格、七項列動作選單（依帳號狀態而異）與五支對話框，含一支開了關不掉的。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/students]], [[specs/sitemap/admin/students]], [[specs/sitemap/_shared/student-form-dialog]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/admin/students]], [[specs/sitemap/admin/students]]

## [[specs/sitemap/admin/payments|繳費紀錄（/admin/payments）]]

/admin/payments 的實際 UI 地圖：帳單清單、催繳三選一篩選、待開帳提示，以及四支對話框（含一支會再疊一層）。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/meals]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/admin/meals]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/admin/contact-book]], [[specs/sitemap/admin/notifications]], [[specs/sitemap/admin/enrollments]], [[specs/sitemap/admin/fee-templates]]

## [[specs/sitemap/admin/reports|營收報表（/admin/reports）]]

/admin/reports 的實際 UI 地圖：一條開帳流向帶、一句現金註腳、一張三選一的分組統計表。沒有任何對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/admin/sessions|課堂管理（/admin/sessions）]]

/admin/sessions 的實際 UI 地圖：課堂清單、批次操作、每列的六項動作選單，以及七支對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/attendance-roster-panel]], [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/admin/settings|系統設定（/admin/settings）]]

/admin/settings 是一個 tab 殼 —— 它自己不畫內容，只提供四個 tab 與 router-outlet，並把裸網址 redirect 到「分校」。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/settings-campuses]], [[specs/sitemap/admin/settings-schools]], [[specs/sitemap/admin/settings-subjects]], [[specs/sitemap/admin/settings-general]], [[specs/sitemap/admin/settings-schools]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/settings-campuses]], [[specs/sitemap/admin/settings-schools]], [[specs/sitemap/admin/settings-subjects]], [[specs/sitemap/admin/settings-general]], [[specs/sitemap/admin/courses]]

## [[specs/sitemap/admin/settings-campuses|分校設定（/admin/settings/campuses）]]

系統設定的「分校」tab：分校清單、三個統計數字、每列三項動作，兩支對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/settings]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/settings]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/courses]]

## [[specs/sitemap/admin/settings-general|一般設定（/admin/settings/general）]]

系統設定的「一般」tab：整頁只有一個設定 —— 出勤紀錄模式（隨堂點名／日到班）。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/settings]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/settings]], [[specs/sitemap/admin/dashboard]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/courses]], [[specs/sitemap/admin/meals]], [[specs/sitemap/admin/reports]]

## [[specs/sitemap/admin/settings-schools|學校管理（/admin/settings/schools）]]

系統設定的「學校」tab：學生就讀學校的清單、每列改名與刪除，刪除被學生數擋住時只出 toast 不開對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/settings]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/settings]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/courses]]

## [[specs/sitemap/admin/settings-subjects|科目設定（/admin/settings/subjects）]]

系統設定的「科目」tab：整頁只有一個標題和一個共用的科目管理元件。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/admin/settings]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/settings]], [[specs/sitemap/_shared/subject-manager]], [[specs/sitemap/_shared/subject-manager]], [[specs/sitemap/_shared/subject-manager]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/courses]], [[specs/sitemap/admin/courses]], [[specs/sitemap/_shared/subject-manager]], [[specs/sitemap/_shared/subject-manager]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/_shared/subject-manager]], [[specs/sitemap/_shared/subject-manager]]

## [[specs/sitemap/admin/staff|人員管理（/admin/staff）]]

/admin/staff 的實際 UI 地圖：管理員與老師帳號清單、四個篩選、每列五項動作，四支對話框（其中一支關不掉）。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/audit-log-dialog]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/admin/fee-templates]], [[specs/sitemap/admin/reports]], [[specs/sitemap/_shared/subject-manager]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/admin/payments]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/students]], [[specs/sitemap/admin/parents]]

## [[specs/sitemap/admin/students|學生管理（/admin/students）]]

/admin/students 的實際 UI 地圖：橘帶錨點、三個篩選、學生表格與列動作選單，兩支對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/student-form-dialog]], [[specs/sitemap/admin/courses]], [[specs/sitemap/_shared/student-form-dialog]], [[specs/sitemap/_shared/confirm-dialog]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/sessions]]

## [[specs/sitemap/admin/students-id|學生詳情（/admin/students/:id）]]

/admin/students/:id 的實際 UI 地圖：五個區塊（兩個標「開發中」）、在籍班級的條件式計費鈕與三支對話框。

Tags: `sitemap`, `admin`

Links to: [[specs/sitemap/_shared/permission-matrix]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/parents]], [[specs/sitemap/_shared/student-form-dialog]], [[specs/sitemap/admin/students]], [[specs/sitemap/_shared/student-form-dialog]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/students]], [[specs/sitemap/admin/leave]]

## [[specs/sitemap/parent/add-course|加選課程（/parent/add-course）]]

/parent/add-course 的實際 UI 地圖：目前是 EmptyState 佔位頁，<main> 內零互動元素。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/parent/attendance]]

## [[specs/sitemap/parent/attendance|到班紀錄（/parent/attendance）]]

/parent/attendance 的實際 UI 地圖：家長端到班紀錄，孩子切換器、三種期間、逐日清單、可展開的出勤列。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/parent/payments]]

## [[specs/sitemap/parent/dashboard|儀表板（/parent/dashboard）]]

/parent/dashboard 的實際 UI 地圖：橘色頁首 + 孩子切換器，本文目前是「更多內容還在準備中」的佔位空狀態。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/parent/index]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/parent/attendance]]

## [[specs/sitemap/parent/enrollment|報名申請（/parent/enrollment）]]

/parent/enrollment 的實際 UI 地圖：目前是 EmptyState 佔位頁，<main> 內零互動元素。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/parent/attendance]]

## [[specs/sitemap/parent/grades|成績查閱（/parent/grades）]]

/parent/grades 的實際 UI 地圖：科目下拉 + 四段期間切換 + 依科目分組的成績清單；含一支切換孩子後篩選器殘留的缺陷。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/parent-child-switcher]]

## [[specs/sitemap/parent/index|家長根路由（/parent）]]

/parent 本身沒有畫面，它是一條轉址：直接打開會落在 /parent/dashboard。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/parent/dashboard]], [[specs/sitemap/parent/dashboard]], [[specs/sitemap/parent/dashboard]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher]]

## [[specs/sitemap/parent/meals|餐費紀錄（/parent/meals）]]

/parent/meals 的實際 UI 地圖：目前是 EmptyState 佔位頁，<main> 內零互動元素。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/parent/attendance]]

## [[specs/sitemap/parent/notifications|通知中心（/parent/notifications）]]

/parent/notifications 的實際 UI 地圖：一行薄殼，內容全部是共用的公告收件匣元件。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/announcement-inbox|公告收件匣]], [[specs/sitemap/_shared/announcement-inbox]], [[specs/sitemap/_shared/announcement-inbox]], [[specs/sitemap/_shared/announcement-inbox]], [[specs/sitemap/_shared/announcement-inbox]], [[specs/sitemap/_shared/announcement-inbox]]

## [[specs/sitemap/parent/payments|繳費紀錄（/parent/payments）]]

/parent/payments 的實際 UI 地圖：待付款／已付款兩段清單、頁首待繳金額錨點、帳單明細抽屜。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/parent-child-switcher]], [[specs/sitemap/parent/attendance]]

## [[specs/sitemap/parent/renewal|續課資訊（/parent/renewal）]]

/parent/renewal 的實際 UI 地圖：目前是 EmptyState 佔位頁，<main> 內零互動元素。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/parent/attendance]]

## [[specs/sitemap/parent/schedule|課表查看（/parent/schedule）]]

/parent/schedule 的實際 UI 地圖：目前是 EmptyState 佔位頁，<main> 內零互動元素。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/parent/attendance]]

## [[specs/sitemap/parent/trial|試聽申請（/parent/trial）]]

/parent/trial 的實際 UI 地圖：目前是 EmptyState 佔位頁，<main> 內零互動元素。

Tags: `sitemap`, `parent`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/parent/attendance]]

## [[specs/sitemap/public/enrollment|我要報名（/enrollment）]]

/enrollment 的實際 UI 地圖：目前是純佔位殼，<main> 內零互動元素，只有標題與「開發中」提示。

Tags: `sitemap`, `public`

Links to: [[specs/sitemap/public/login]], [[specs/sitemap/_shared/public-shell]], [[specs/sitemap/_shared/public-shell]]

## [[specs/sitemap/public/link-line|綁定 LINE（/link-line）]]

/link-line 的實際 UI 地圖：一次性連結兌換後的落地頁，兩顆按鈕（綁定 LINE / 稍後再說）。需要登入。

Tags: `sitemap`, `public`

Links to: [[specs/sitemap/_shared/public-shell]], [[specs/sitemap/public/select-role]], [[specs/sitemap/_shared/public-shell]]

## [[specs/sitemap/public/login|登入（/login）]]

/login 的實際 UI 地圖：只有一顆 LINE 登入鍵，加上三種由網址參數驅動的條件式元素（錯誤提示、報名連結、重試）。

Tags: `sitemap`, `public`

Links to: [[specs/sitemap/_shared/public-shell]], [[specs/sitemap/README|方法頁]], [[specs/sitemap/_shared/public-shell]]

## [[specs/sitemap/public/qr-checkin|QR 到班打卡（/qr-checkin）]]

/qr-checkin 的實際 UI 地圖：目前是純佔位殼，<main> 內零互動元素，沒有相機也沒有掃碼器。

Tags: `sitemap`, `public`

Links to: [[specs/public/qr-checkin]], [[architecture/kiosk-checkin]]

## [[specs/sitemap/public/select-role|選擇角色（/select-role）]]

/select-role 的實際 UI 地圖：一個薄殼路由，長相在彈窗裡；單一角色會直接轉走、零角色只留一句說明。

Tags: `sitemap`, `public`

Links to: [[specs/sitemap/_shared/public-shell]], [[specs/sitemap/public/link-line]], [[specs/sitemap/README|方法頁]]

## [[specs/sitemap/public/trial|試聽申請（/trial）]]

/trial 的實際 UI 地圖：目前是純佔位殼，<main> 內零互動元素，只有標題與「開發中」提示。

Tags: `sitemap`, `public`

Links to: [[specs/sitemap/_shared/public-shell]], [[specs/sitemap/_shared/public-shell]]

## [[specs/sitemap/README|整站 UI 地圖 —— 方法頁]]

怎麼畫一頁 UI 地圖、怎麼用瀏覽器兩向比對驗證它，以及十二個會讓驗證靜靜失效的坑。

Tags: `sitemap`, `method`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/attendance-roster-panel]], [[specs/sitemap/parent/attendance]], [[specs/sitemap/admin/fee-templates]], [[specs/sitemap/parent/attendance]], [[specs/sitemap/parent/payments]], [[specs/sitemap/parent/attendance]], [[specs/sitemap/admin/dashboard]], [[specs/sitemap/admin/sessions]], [[specs/sitemap/parent/attendance]], [[specs/sitemap/public/login]], [[specs/sitemap/public/trial]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/public-shell]], [[specs/sitemap/_shared/attendance-roster-panel]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/public-shell]]

## [[specs/sitemap/teacher/dashboard|老師儀表板（/teacher/dashboard）—— 已刪除，只留 redirect]]

這一頁已經被刪掉了；路由留著把舊書籤導到課表。元件檔案不存在，不是孤兒程式碼。

Tags: `sitemap`, `teacher`

Links to: [[specs/sitemap/admin/attendance]], [[specs/sitemap/teacher/schedule]], [[specs/sitemap/teacher/schedule]]

## [[specs/sitemap/teacher/index|老師根路由（/teacher）]]

/teacher 沒有畫面 —— 它是 roleGuard 底下的一個容器，pathMatch full 直接 redirect 到課表。

Tags: `sitemap`, `teacher`

Links to: [[specs/sitemap/teacher/dashboard]], [[specs/sitemap/teacher/notifications]], [[specs/sitemap/teacher/schedule]], [[specs/sitemap/teacher/students]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/teacher/schedule]], [[specs/sitemap/_shared/shell-layout]]

## [[specs/sitemap/teacher/notifications|通知中心（/teacher/notifications）]]

老師端通知中心：整頁就是共用的公告收件匣，只換一個標題。

Tags: `sitemap`, `teacher`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/announcement-inbox]], [[specs/sitemap/_shared/announcement-inbox]], [[specs/sitemap/_shared/announcement-inbox]], [[specs/sitemap/parent/notifications]]

## [[specs/sitemap/teacher/schedule|課表（/teacher/schedule）]]

老師端的主畫面：橘帶錨點、週條、一日一屏的水平軌道，每堂課依狀態長出點名／日誌／聯絡簿三種入口。

Tags: `sitemap`, `teacher`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/_shared/attendance-roster-panel]], [[specs/sitemap/_shared/attendance-roster-panel]]

## [[specs/sitemap/teacher/students|學生（/teacher/students）]]

老師任課班級的在籍學生，依班級分組。整頁只有兩個互動元素，學生列不可按。

Tags: `sitemap`, `teacher`

Links to: [[specs/sitemap/_shared/shell-layout]], [[specs/sitemap/admin/students-id]]

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

Links to: [[architecture/teacher-schedule-mobile-day]], [[architecture/teacher-today-flow]], [[architecture/teacher-class-log]], [[rules/contact-book-rules]], [[architecture/teacher-today-flow]]

## [[specs/teacher/students|學生]]

查看自己任課班級的學生名單。

Tags: `specs`, `teacher`, `students`

Links to: [[specs/teacher/attendance]]
