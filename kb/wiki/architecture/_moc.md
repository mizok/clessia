# Architecture — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-11-04

---

## [[architecture/a6-adoption-rules|A6 採用規則（使用者裁定與刻意偏離的出處）]]

A6 設計稿全採；現況有、稿沒畫的功能收進「⋯」或篩選而不刪；可點元素基底 44px；對齊以 conformance 工具報告為準，偏離逐條要有出處。

Tags: `architecture`, `design-system`, `a6`, `conformance`

Links to: [[constitution-enforcement]], [[architecture/a6-adoption-rules#R2]], [[architecture/a6-adoption-rules#R2]], [[specs/parent/attendance]], [[rules/enrollment-rules]], [[specs/public/application-forms-a6]], [[specs/public/application-forms-a6]], [[specs/parent/renewal]]

## [[architecture/admin-contact-book-page|聯絡簿管理端頁的設計]]

管理端的聯絡簿是監看不是撰寫：日期區間列表＋未簽收篩選（API 無分頁且 count 是 exact，所以前端篩是誠實的），編輯已存在的一則走同一支 upsert，但不做「挑學生開新的一則」——那是老師端 P3 的工作流。「今天哪些該寫還沒寫」這輪不做，現有 API 做出來會漏班且是 N+1。

Tags: `architecture`, `admin`, `contact-book`

Links to: [[rules/contact-book-rules]], [[rules/contact-book-rules]]

## [[architecture/admin-dashboard-v1|管理端儀表板 v1 的設計]]

把四張死卡片接上真資料並補行政待辦卡：零後端改動（六種資料既有 API 全有）、未點名卡回溯 7 天且只在逐堂點名模式顯示、報名卡只取 meta.total 以免分頁截斷、經營區用 permission 蓋住、卡片是索引不是工作場。

Tags: `architecture`, `dashboard`, `admin`

Links to: [[architecture/teacher-students-view]]

## [[architecture/admin-payments-page|繳費紀錄頁的設計]]

把 /admin/payments 空殼接上 /api/invoices：狀態由後端推導直接呈現、篩選只做 API 真的支援的兩項（欠繳與單一學生）而不在前端偽造狀態篩選、meta.total 在非 overdue 路徑不可信所以分頁改用「當頁滿即有下一頁」、詳情走 dialog、收款/退費/催繳/手動開帳共用同一個 dialog、列印用 @media print 切區塊。

Tags: `architecture`, `admin`, `finance`, `payments`, `invoices`

Links to: [[specs/admin/finance/payments]], [[rules/billing-rules]], [[architecture/teacher-students-view]]

## [[architecture/admin-schedule-change-notice|課務異動通知發給管理員（依分校範圍）]]

課務異動除了任課老師，也寫一則站內通知給範圍涵蓋該班分校的管理員；不需要 migration，收件人推導沿用 adminsForCampuses，同一個入口函式涵蓋所有寫入路徑。

Tags: `architecture`, `notifications`, `schedule-changes`, `campus-scope`

## [[architecture/admin-todo-alerts|管理端待辦告警系統一（設計草案，待計畫席 STOP gate 批准）]]

把管理端六頁的告警拉齊成「一句話+必定帶篩選的入口+落地篩選對得上告警數字」。核心決定：同頁情境延用既有的「單一資料源 computed」模式（多數頁已經是），跨頁情境（儀表板→課堂管理）改用「共用 query 組裝函式」+ 契約測試釘住；新增共用元件 app-todo-banner 統一視覺（順帶解掉 courses 徽章的 affordance 問題——藥丸+hover-only 可點暗示讓它讀成狀態標籤）；GET /api/sessions 補 attendanceTaken 參數。

Tags: `architecture`, `admin`, `alerts`, `dashboard`

## [[architecture/amending-the-constitution|修憲的機制]]

憲法只能由人修改，agent 被兩條 deny 規則擋住（含 worktree 路徑）。曾經有過的 `tools/amend-constitution.mjs` 因為過度建造已移除——護欄留在 harness 層（A9 斷言 deny 目標存在）。

Tags: `architecture`, `constitution`, `guardrail`

Links to: [[lessons/status-table-blind-spot]], [[lessons/rls-backstop-drift]]

## [[architecture/announcements|站內公告的設計]]

管理員發布、老師收件匣、已讀狀態。取代 LINE 群組通知的第一步，不接外部服務。

Tags: `architecture`, `announcements`

Links to: [[architecture/role-authorization|角色授權設計]]

## [[architecture/auth-pool-lifecycle|認證連線池的生命週期]]

createAuth() 每請求開 1–2 個 pg Pool 且從不關閉（批次匯入的迴圈裡一次開 50 個）；Workers 凍結 timer 使 pg 的 idle 自救失效。修法：getAuth(c) 讓同請求共用單一池，收尾交給掛在最前面的 cleanup middleware 在 await next() 之後做。singleton 在 Workers 是錯的，而在 getAuth 裡 waitUntil(pool.end()) 也是錯的。

Tags: `architecture`, `auth`, `workers`, `database`

Links to: [[architecture/line-oauth-login]]

## [[architecture/authorization-scope|授權範圍 —— 分校、職務、細部權限]]

三個軸的範圍限制在建立帳號時都有收，執行時多數沒有用。這一頁記下五個可驗證的洞、補完的設計、以及 fail-closed 上線最真實的風險（既有管理員會看到空白而不是報錯）。

Tags: `architecture`, `authorization`, `campus`, `teacher-scope`, `permissions`, `security`

## [[architecture/better-auth-self-vs-admin|Better Auth 的「本人模型」與我們的多角色授權是兩套東西]]

使用者更新 API 只服務「本人改自己」；「管理員代改」屬 admin plugin，而它要求角色真相住在 ba_user.role——跟本專案「角色住 user_roles、一人多角色、權限存 jsonb」不相容。想接 admin plugin 之前先讀這頁。

Tags: `architecture`, `auth`, `better-auth`, `authorization`

Links to: [[architecture/constitution-enforcement]], [[architecture/constitution-enforcement]], [[architecture/constitution-enforcement]], [[architecture/line-oauth-login]], [[architecture/role-authorization]]

## [[architecture/bootstrapping-a-deployment|開一個新站]]

建立組織與第一個管理員的唯一路徑。零 demo 資料，走 Better Auth 建帳號，冪等。

Tags: `architecture`, `deployment`, `bootstrap`, `onboarding`

Links to: [[architecture/constitution|c12]], [[architecture/line-oauth-login]], [[architecture/deploying]], [[architecture/google-oauth-login]]

## [[architecture/campus-context|頂欄分校：日常頁一次一間，報表才有「全部分校」]]

管理端頂欄的分校下拉（CampusContextService）是偏好不是權限；日常頁沒有「全部分校」、預設自己被指派的分校，營收報表／人員管理保留全部（儀表板 #2259 起是日常頁）。

Tags: `architecture`, `campus`, `admin`, `topbar`

## [[architecture/change-log-view|課務異動紀錄的設計]]

M1 第二個畫面。填掉 admin/changes 空殼，把一直在寫卻沒人看得到的 schedule_changes 呈現出來。唯讀。

Tags: `architecture`, `change-log-view`

## [[architecture/chunk-load-recovery|部署後舊分頁的 chunk 載入失敗復原]]

舊 index 要不到新 chunk 時，導覽失敗自動重載一次、預載失敗顯示提示條；以及為什麼偵測不能靠 ChunkLoadError 或 404。

Tags: `architecture`, `resilience`

## [[architecture/constitution|Clessia 架構憲法]]

具約束力的架構不變量。只陳述「什麼構成違反」，不含強制機制。

Tags: `architecture`, `constitution`

Links to: [[architecture/constitution-enforcement|`constitution-enforcement`]], [[architecture/vendor-relationship]]

## [[architecture/constitution-enforcement|憲法強制機制索引]]

每條 clause 用什麼機制守、在哪一層擋、目前接上了沒有。改機制不算修法。

Tags: `architecture`, `constitution-enforcement`

Links to: [[architecture/constitution|`constitution`]], [[architecture/gate-map|`gate-map`]]

## [[architecture/dashboard-stat-skeleton|儀表板數值卡的載入態骨架化]]

修 #426——CardValue 的 null/'error' 原本渲染成跟真數字同量級的粗體文字，改用既有的 .p-skeleton 動畫取代純文字，錯誤態改用小圖示+短字降級處理，兩者都不能被誤讀成資料本身。

Tags: `architecture`, `ux`, `loading`, `dashboard`

## [[architecture/date-display-conventions|日期顯示的四種形式，各自回答不同的問題]]

M4 詞彙統一（#425）查證結論——日期不統一成一種格式，而是「完整日期 / 短日期 / 帶星期 / 稽核時間戳」四種各有情境；分隔符一律連字號，斜線是 outlier。

Tags: `architecture`, `ux`, `date`

## [[architecture/day-timeline|一日時間軸元件（day-timeline）]]

內部頁橘帶裡那條「今天」的資訊圖 —— 為什麼把排課畫成時間軸而不是再列一張表、佈局數學為什麼放在 pure util、以及 startTime/endTime 可為 null 這件事怎麼處理。

Tags: `architecture`, `day-timeline`, `dashboard`, `direction-d`

Links to: [[architecture/design-language]], [[lessons/awakened-tests-bite]]

## [[architecture/deactivate-vs-archive|停用 vs 封存 —— 不是同一個動作的兩種叫法，裁定不統一]]

M4 詞彙統一（#425）查證結論——停用（可逆）與封存（不可逆）是兩個不同的動作，用字差異忠實反映各自的狀態模型，不該合併成一個字。計畫席裁定：兩個字都留著。

Tags: `architecture`, `lifecycle`

## [[architecture/deploying|部署]]

三個元件（Supabase / Workers / Pages）、哪些步驟只有人能做、以及為什麼 API 必須能在 Node 底下跑。

Tags: `architecture`, `deployment`, `cloudflare`, `supabase`

Links to: [[architecture/vendor-relationship]], [[architecture/constitution|c12]], [[architecture/google-oauth-login]], [[architecture/web-push]], [[architecture/auth-pool-lifecycle]], [[architecture/bootstrapping-a-deployment]]

## [[architecture/design-language|視覺語言（方向 D：暖橘流場）]]

白底為基、大面積暖橘作為入口色面、會動的線條場只住在 hero；橘面上一律近黑字，因為亮橘配白字撐不到 4.5:1。token 用值替換而不是改名，既有頁面自動跟上。

Tags: `architecture`, `design-system`, `tokens`, `animation`

Links to: [[specs/public/login]], [[specs/public/login]], [[architecture/login-experience]], [[architecture/day-timeline]]

## [[architecture/enrollment-admin-view|報名管理端的設計]]

M2。兩個互不依賴的切片：班級頁的 Excel 名單匯入精靈、獨立的報名進出總覽頁。既有的班級／學生兩個報名入口不動。

Tags: `architecture`, `enrollment-admin-view`

## [[architecture/gate-map|Gate 網地圖]]

這個 repo 有哪些自動檢查、各自守什麼、各自看不到什麼，以及要新增一道之前該先問的四個問題。按 gate 組織，與按 clause 組織的 constitution-enforcement 互補。

Tags: `architecture`, `harness`, `gate`, `ci`

Links to: [[architecture/constitution-enforcement|`constitution-enforcement`]]

## [[architecture/google-oauth-login|Google 登入的設計（第二個 OAuth provider）]]

Google 跟 LINE 走同一套：合成 `<sub>@google.internal` 並標成已驗證、不能建帳號、不能用真 email 對上既有帳號，只能經一次性綁定連結綁上；provider 清單由 API 從環境變數推出，沒設憑證的部署完全看不到 Google 按鈕（c12）。better-auth 1.5.5 的 idToken 入口不看 disableSignUp，所以 Google 必須 disableIdTokenSignIn。

Tags: `architecture`, `auth`, `oauth`, `google`

Links to: [[architecture/line-oauth-login]], [[architecture/deploying]], [[architecture/pwa-oauth-handoff]]

## [[architecture/kiosk-checkin|到班掃碼機台：登入後的掃碼頁＋機台身分（kiosk 角色）]]

使用者裁 #1127：掃碼頁搬到登入後、不做免登入端點。機台身分用新角色 kiosk（user_roles 列舉加值），不用「零權限 admin」—— ADMIN_ONLY 的掛載多半只擋寫，零權限 admin 讀得到學生／家長名冊，機台放在門口等於公開名冊。kiosk 綁單一分校（staff_campuses），只掛得進 POST /api/daily-checkins 與掃碼頁要的那幾支窄讀；分校強制取帳號的、不吃 body。帳號由有 manage_staff 的管理員在人員頁建立，用既有的一次性登入連結 QR 在平板上登入。行政人員也可從管理端開同一頁。公開入口拿掉、/qr-checkin 轉登入。

Tags: `architecture`, `attendance`, `authorization`, `kiosk`, `migration`

## [[architecture/leave-session-binding|請假綁定堂次（leave_request_sessions）]]

請假單可以綁定「勾選的課堂」（規格 specs/admin/student-affairs/leave.md 多選課堂）。新增關聯表 leave_request_sessions（帶 org_id、PK (leave_request_id, session_id)、cascade）；沒有綁定列的假沿用舊語意（整天／單日時間窗），所以既有資料與 seed 不用遷移。判斷核心仍是 leaveCoversSession，加一條「有綁定就只比 id」。寫入面 create／update 收 sessionIds、server 驗在籍與非停課；update 以堂次 diff 做 revert／apply。cancel-leave、日到班 onLeave、報名回補、重疊 409 的新語意已由計畫席裁定（2026-10-03）。

Tags: `architecture`, `attendance`, `leave`, `migration`

## [[architecture/line-oauth-login|LINE 登入的設計]]

密碼雜湊超過 Cloudflare Workers 免費方案的 10ms CPU 上限，登入間歇性 503。密碼登入完全移除、改用 OAuth（首發 LINE，Google 延後但架構預留）；破窗改成持有 DATABASE_URL 的人用 CLI 產生一次性登入連結，客戶換掉 DB 密碼就能切斷供應商存取。OAuth 身分靠一次性綁定連結／QR 對應到既有的人員或家長記錄。

Tags: `architecture`, `auth`, `oauth`, `line`, `cloudflare`

Links to: [[lessons/better-auth-session-delegation]], [[architecture/deploying]], [[specs/admin/roles-and-auth]], [[architecture/google-oauth-login]], [[architecture/pwa-oauth-handoff]]

## [[architecture/list-loading-skeleton-batch|十個檔案的載入態跳版問題 —— 統一做法]]

#508——#426 掃到但根因不同的 10 個檔案，逐檔分類後發現「整塊被文字取代」與「沒有骨架尺寸／會跳版」在這批檔案裡是同一件事，分三類統一做法，全部重用既有 .p-skeleton／.skeleton-list，不新增第三種配方。

Tags: `architecture`, `ux`, `loading`

## [[architecture/load-failed-state|取數失敗要有自己的畫面狀態]]

「失敗」與「成功但沒有資料」在 catchError 回 EMPTY 之後狀態完全相同，於是頁面渲染成「尚未有資料」還附上新增按鈕；修法是一支共用的失敗狀態元件 + 每頁一個 failed 訊號，而不是動 #689 的管線修法。

Tags: `error-state`, `empty-state`, `ux`, `c11`

## [[architecture/login-experience|登入體驗與角色選擇的設計]]

登入頁重設計（品牌卡片 + LINE 官方規範按鈕）與角色選擇回歸彈窗體感 —— /select-role 路由保留為唯一入口，薄殼自動開動態載入的彈窗，bundle 不回胖、無限重導向不回歸。

Tags: `architecture`, `login`, `select-role`, `ux`

Links to: [[specs/public/login]]

## [[architecture/dialog-frame|對話框與貼底面板的共用規則（app-dialog-frame）]]

全站對話框收斂成共用殼 app-dialog-frame；寬三種、內距 token、sticky 底部、貼底底部留白＋safe-area 只墊一次；進退場時長 token，減少動態時只淡入淡出。#2290 分批遷移中。

Tags: `architecture`, `dialog`, `a6`, `motion`, `accessibility`

Links to: [[architecture/motion]], [[architecture/a6-adoption-rules]]

## [[architecture/motion|全站動態規則（設計稿：換頁方向、頁內切換、列表補位、數字變化）]]

設計稿（#1635，未批准）。2026-10-16 在本機實跑盤點：頁內的狀態變化（換週、換日、日／週、篩選切換、tab）全部是瞬間替換；換頁只有內容區淡入淡出，而且沒有處理「減少動態」。提案：換頁依網址深度給方向（往深從右進、返回從左、同層只淡入淡出）；低頻的模式切換用同文件 view transition；連點型控制項（換週箭頭）不能用 VT —— 實測 VT 動畫期間的第二下點擊會被吞掉（規格：期間點擊一律打到 document element），改成內容層的 animate.enter；新增／刪除列照 A6 的 row-new，補位只在刪除時用 VT。曲線沿用 #1634 的 --arrive／--leave，不另訂。

Tags: `architecture`, `motion`, `view-transition`, `a6`, `accessibility`, `performance`

Links to: [[architecture/a6-adoption-rules]]

## [[architecture/no-division-scoping|刻意不設計「學部」這一層]]

補習班有國小部／國中部（未來高中部），但系統不建立「部」的概念，也不依部隔離可見範圍。原因是實際的人力本來就跨部。

Tags: `architecture`, `no-division-scoping`

## [[architecture/no-value-display-conventions|「沒有值」的三種寫法，不是同一件事的三種說法]]

M4 詞彙統一（#425）查證結論——「—」/「未填寫」/「無關聯 X」對應三種不同語意（唯讀顯示欄位空值/可編輯欄位未填/關聯不存在），不該合併成一種寫法。

Tags: `architecture`, `ux`, `empty-value`

## [[architecture/parent-attendance-grades-billing-pages|家長端三頁前端設計 —— 出缺席／成績／繳費]]

家長端 03 片。三頁共用 #344 的 child-switcher，資料走 #351 三支 childId 必填端點。逐項核對 kb specs 與 design-web 構圖跟 #351 實際契約的落差（4 態出勤/日到班時間/每筆 NEW 標籤/課程篩選/已取消分組都對不上），提出降級方案待批准。

Tags: `architecture`, `parent`, `attendance`, `grades`, `billing`

Links to: [[architecture/parent-read-endpoints]], [[architecture/parent-data-scope]]

## [[architecture/parent-catalog-read|家長端課程／開課班目錄（加選、試聽、首頁推薦的共用 API）]]

GET /api/me/catalog?childId= —— 走 childDb.orgRef('classes') 讀機構參考資料（課程、分校、每週時段、任課老師以 embed 帶出），名額用批次版 activeEnrollmentCounts 只回數字，排除孩子已在籍的班。「推薦」與費用都沒有資料來源，推薦等裁、費用附三個選項待裁；分校範圍附兩個選項待裁。疊在 #1141（orgRef）上。裁定（#1152）：分校 A 全機構、年級只標記；推薦改人工標記 `classes.is_recommended`、排最前（#1118）；費用後來改 B（#1175）：班級掛預設範本，回 `fee`（參考價，停用範本回 null）。

Tags: `architecture`, `parent`, `authorization`, `catalog`, `enrollment`

Links to: [[architecture/parent-data-scope]], [[architecture/parent-read-endpoints]]

## [[architecture/parent-class-logs-read|家長端讀取已發布教務日誌（v1b）]]

家長端第二實例，照 parent-read-endpoints.md 的樣板抄：childDb 兩層防線、複用 admin 的 select/mapper、allowlist 欄位過濾。這支的特殊之處是 class_logs 是班級層級不是學生層級，childDb 現有 API 假設表上有 student_id 欄位，需要擴充一個新方法。等 STOP 批准，teacher-pages 的 v1b 讀取頁與發布按鈕卡在這支上。

Tags: `architecture`, `parent`, `authorization`, `teaching-log`

Links to: [[architecture/parent-read-endpoints]], [[architecture/parent-read-endpoints]], [[architecture/parent-read-endpoints]]

## [[architecture/parent-contact-book-sign|家長讀取與簽收個人聯絡簿]]

GET /api/me/contact-book 與 POST /api/me/contact-book/{id}/sign 的範圍與「簽收後有修改」判準為什麼要走 pg 一句 SQL、為什麼管理端 PUT 原文照存不寫。

Tags: `parent`, `contact-book`, `scope`

Links to: [[rules/contact-book-rules]], [[architecture/parent-data-scope]]

## [[architecture/parent-data-scope|家長端的資料範圍模型]]

家長端引入第三個授權維度（org → 分校 → 學生）。範圍在 middleware 注入、家長端 route 拿不到原始 supabase、只拿得到已綁 scope 的 childDb（預審時修正，原本的「必填參數」推論守不住「根本沒呼叫」）；越權指名回 403 不回空；多重角色的身分判定改看 activeRole。拒絕每支 route 自己 join、RLS、前端過濾三種替代。

Tags: `architecture`, `parent`, `authorization`, `security`

## [[architecture/parent-grades-period-filter|家長成績的學期篩選＝機構的「期」（billing_periods）]]

GET /api/me/grades 的 meta 多回機構的期清單（billing_periods，經 childDb.orgRef 白名單讀），前端用考試日期落在期的 start_date～end_date 判歸屬，取代「近1月／3月／半年」按鈕。預設＝含今天的期（重疊取起始日最晚的），沒有期涵蓋今天就預設全部；沒有任何期涵蓋的考試歸「未分期」。段考的 academic_year／semester 只顯示不當篩選鍵。不加欄位、不動 schema。

Tags: `architecture`, `parent`, `grades`, `billing-periods`

## [[architecture/parent-read-endpoints|家長端三支讀取端點（出缺席／成績／繳費）]]

家長端 P4 主體的 API 側設計。三支 GET-only 端點複用既有 admin 查詢邏輯（attendance.ts / scores.ts / invoices.ts 的 select 常數與 mapper），走 childDb + 顯式 childId 查詢參數（403 不回空），欄位過濾表逐支列出，錨點聚合數字放進各自 meta 不另開 dashboard 端點。等 STOP 批准。

Tags: `architecture`, `parent`, `authorization`, `attendance`, `grades`, `billing`

Links to: [[architecture/parent-data-scope]], [[roadmap]]

## [[architecture/parent-schedule-change-notice|課務異動通知發給該班家長]]

課務異動存檔時，接在 notifyScheduleChange 後面多寫一批 role=parent 的個人通知；一批一班一位家長一則，v1 不推播；用班級 id 查在籍（背景工作裡 pg pool 已關）。

Tags: `architecture`, `notifications`, `schedule-changes`, `parent`

Links to: [[architecture/admin-schedule-change-notice]]

## [[architecture/parent-sessions-read|家長端讀取孩子的課堂（課表三頁的共用 API）]]

GET /api/me/sessions —— 給 p-schedule／p-dashboard 今日課／p-attendance 用。範圍走 childDb：pluck 孩子的 enrollments 得班級 ScopedIds，fromScopedIds 查 sessions，再用 countEnrolledOn 把在籍區間外的堂濾掉（同 class-logs 的轉班防線）。回老師（代課露實際老師＋原任課老師）、分校、小考數、課務異動（不帶原因）、停課照回、這個孩子那堂的出勤。日期窗必填、上限 42 天。pluck 改成必填 studentId（scope 含兄弟姊妹）。admin 的 summariseSessions 吃原始 supabase，不能複用，只複用純函式。

Tags: `architecture`, `parent`, `authorization`, `sessions`, `schedule`

Links to: [[architecture/parent-read-endpoints]], [[architecture/parent-class-logs-read]], [[architecture/parent-read-endpoints]], [[architecture/parent-data-scope]], [[specs/parent/leave]]

## [[architecture/payment-info|補習班帳戶資訊（payment_info）：機構預設＋分校覆寫]]

organizations.payment_info（機構預設）＋ campuses.payment_info（分校覆寫，null＝沿用），形狀照 attendance_mode（#1112）。管理端系統設定與分校表單各一個多行欄位，改它要 manage_finance（改帳號＝改錢流向）。家長帳單列表 meta.paymentInfo 回這個孩子在籍分校的生效值（去重，多分校就多筆），沒有在籍分校退機構預設，全空時前端顯示原本的「請洽行政人員」。不做每張帳單各自判分校（帳單沒有分校欄，餐費／調整列沒有報名）。

Tags: `architecture`, `billing`, `parent`, `settings`, `migration`

## [[architecture/permission-vocabulary-single-source|細部權限詞彙表的單一來源]]

manage_org_settings 授不出來的根因是詞彙表有四份、三份在前端手抄；比較三種收斂做法，選出「前端自己有編譯期保證 + gate 守跨 app 一致」這條。

Tags: `permissions`, `authorization`, `c11`

## [[architecture/pg-pool-writes|經過 pg 連線池寫入]]

PostgREST 一次請求一個交易，要「全有或全無」的多步寫入只能走 auth.pool 的交易（repo 不引入 RPC）。規則：只在多步寫入必須原子時用；用 withTx 包；只用參數化 SQL 且每句帶 org_id；範圍判斷在交易裡用 FOR UPDATE 重做；23503 → 409、其他 → 500；池不在就 500，不退回沒有交易的舊寫法。第一個用的是刪班級（#1652）。

Tags: `architecture`, `database`, `transaction`, `authorization`

Links to: [[architecture/auth-pool-lifecycle]]

## [[architecture/pwa-oauth-handoff|iOS 主畫面 PWA 的 LINE 登入（現況：留在 App 內；交接碼已被取代）]]

iOS 主畫面 App 的 LINE 登入整段留在 App 裡（disable_auto_login，同一個視窗發起與回呼，#2063）；原本的交接碼（#2027）因對家長不直覺被取代，前端已拿掉，後端暫留。

Tags: `architecture`, `auth`, `pwa`, `line`, `oauth`

Links to: [[architecture/line-oauth-login]]

## [[architecture/role-authorization|角色授權的設計]]

掛載的 route 曾經只驗身分不看角色。改成掛載時強制宣告可用角色、沒宣告就拒絕，並用 harness gate 守住。分兩層：route 層准入、資料層範圍。

Tags: `architecture`, `role-authorization`

Links to: [[architecture/teacher-students-view]]

## [[architecture/score-deletion|成績的刪除路徑 —— 清空分數後儲存就是刪除那一列]]

登錄過成績的考試刪不掉、成績沒有任何刪除路徑，是三道關卡疊出來的功能缺口。修法是讓「清空分數後儲存」在後端走 delete 而不是把欄位設成 null，三道關卡一次解開；status 為 absent/makeup 的 null 是有意義的狀態，不在此列。

Tags: `architecture`, `grades`, `scores`, `deletion`, `audit`

## [[architecture/session-makeup|補課（課堂標記「補的是哪一堂停課」）]]

停課的課堂可以被另一堂課補回來。連結存在 sessions.makeup_for_session_id 這個自我參照 FK 上，只為可解釋性——計費完全不需要它，因為補課那堂本來就會扣、停掉的那堂本來就不扣。

Tags: `architecture`, `sessions`, `makeup`, `billing-adjacent`

## [[architecture/tailwind-adoption|Tailwind 導入評估（c6、PrimeNG 並存、Angular 21 接法、BEM／SCSS 退場）]]

使用者 2026-10-02 裁定新 UI 改用 Tailwind、入口頁日後重排、不再延續 BEM＋SCSS。本頁回答導入前要先定的五件事：c6 的 regex 抓不到 h-screen 這類沒有數字的 class（三層補法）、PrimeNG 改用 cssLayer 會讓既有覆寫的勝負翻轉、tokens 有一個語意衝突（--font-medium 是字重不是字體）、Tailwind 4 不搭 Sass 所以入口要獨立成 .css、以及五支解析 SCSS 的 gate 會在 Tailwind 頁面上失明。

Tags: `architecture`, `tailwind`, `styling`, `primeng`, `c6`, `migration`

## [[architecture/teacher-class-log|教務日誌（老師端寫入）]]

一班一天一篇的教學紀錄與作業，從課堂卡的 bottom sheet 寫入。v1a 只寫草稿、刻意不放發布按鈕——因為發布不可逆而下游（家長端可見、LINE 推播）都還不存在。

Tags: `architecture`, `teacher`, `class-logs`, `mobile-first`

Links to: [[rules/teaching-log-rules]], [[architecture/teacher-today-flow]], [[architecture/teacher-schedule-mobile-day]]

## [[architecture/teacher-schedule-mobile-day|老師端課表 —— 行動優先單日檢視]]

（2026-10-08 起已被 A6 單日清單取代）原設計：手機一日一屏、水平 scroll-snap 換日。現行：週條（所有寬度、可橫捲）＋單日清單＋首屏「接下來那堂」卡；下文 scroll-snap／手勢／日期標題的取捨是歷史紀錄。

Tags: `architecture`, `teacher`, `schedule`, `mobile`

Links to: [[specs/teacher/schedule]]

## [[architecture/teacher-students-view|老師端學生名單的設計]]

老師看自己任課班級的學生。同時處理 teacher/attendance 空殼——點名的家是課表，不是另一個選單項目。

Tags: `architecture`, `teacher-students-view`

Links to: [[architecture/role-authorization|`角色授權的設計`]]

## [[architecture/teacher-today-flow|老師端今日流]]

老師端四個介面收成三個，儀表板刪除而非搬移。核心判準是「站在教室門口的老師此刻要做什麼」——凡是不回答這件事的東西都不進來，包含月曆。

Tags: `architecture`, `teacher`, `ux`, `mobile-first`

Links to: [[specs/teacher/dashboard]], [[specs/teacher/schedule]], [[specs/teacher/attendance]], [[specs/teacher/dashboard]], [[specs/teacher/attendance]], [[architecture/teacher-schedule-mobile-day]], [[architecture/teacher-schedule-mobile-day]], [[specs/teacher/schedule]], [[specs/teacher/attendance]], [[specs/teacher/dashboard]]

## [[architecture/teaching-history-not-payroll|記錄授課歷程，但不做薪資計算]]

老師多為鐘點計酬，但系統刻意不計算薪資。職責是把「誰在什麼時候上了哪一堂」記到可信，計算方式留給人。

Tags: `architecture`, `teaching-history-not-payroll`

## [[architecture/teaching-log-view|老師授課紀錄的設計]]

M1 第一個畫面。選老師 + 期間，列出課堂並加總時數。不計算薪資，設計原則是可追溯——代課、停課、缺點名證據都看得見。

Tags: `architecture`, `teaching-log-view`

Links to: [[architecture/teaching-history-not-payroll|`記錄授課歷程但不做薪資`]]

## [[architecture/timeline-density|時間軸換畫法 —— 每半小時一根，柱高是同時堂數]]

lane 式時間軸的高度隨並行數長，密集日會把主入口推到摺線下。換成固定高度的密度圖；但「濃度」不能用透明度做——橘帶上整個可用透明度區間只有 1.40:1，編碼必須是柱高。

Tags: `architecture`, `day-timeline`, `dashboard`, `accessibility`, `direction-d`

Links to: [[architecture/day-timeline]], [[architecture/design-language]], [[architecture/day-timeline]], [[lessons/awakened-tests-bite]]

## [[architecture/toast|Toast：全站唯一出口 app-toast]]

所有 MessageService.add() 都送到 App 掛的 <app-toast>（A6 版型）；元件不得自己 provide MessageService 或掛 p-toast，底部動作列要標 data-toast-dock。

Tags: `architecture`, `toast`, `a6`, `feedback`

## [[architecture/vendor-relationship|供應商關係與它推導出的架構約束]]

賣一套系統、客戶自付基礎設施、收維護費。客戶必須隨時能帶著資料離開 —— 這條原則否決了多租戶，也否決了任何 vendor lock-in。

Tags: `architecture`, `business-model`, `tenancy`, `vendor-lock-in`

Links to: [[architecture/constitution|c12]], [[lessons/status-table-blind-spot]], [[lessons/rls-backstop-drift]], [[architecture/line-oauth-login]], [[architecture/bootstrapping-a-deployment]], [[architecture/bootstrapping-a-deployment]]

## [[architecture/web-push|PWA＋Web Push 推播（設計稿，第一個用途：家長繳費提醒）]]

設計稿（#1626，8 題 10-16 全部裁定，仍是 draft —— 實作第一步量 CPU）。手寫最小 service worker（只處理 push／notificationclick，不攔 fetch、不快取）＋ manifest，不用 @angular/service-worker，不碰 #1611 的 immutable 快取。加密與 VAPID 自寫在 WebCrypto 上（RFC 8291／8292，用 RFC 測試向量驗），Workers 與 Node 共用。提醒時間點是機構設定 organizations.invoice_reminder_offsets（預設到期前 3 天、當天、逾期 1、7 天，最多 6 個，manage_finance），去重鍵含時間點。第一版只開家長，但偏好與發送紀錄帶 role，之後開給老師／行政不改 schema。Cron 台北 09:00–11:00 每 10 分鐘送一小批 —— 免費方案每次 Cron 只有 10ms CPU、50 個 subrequest，K 先量再定。實作拆成 #1657–#1663。

Tags: `architecture`, `pwa`, `push`, `parent`, `billing`, `cron`, `settings`, `c12`

Links to: [[architecture/deploying]], [[architecture/chunk-load-recovery]], [[architecture/announcements]], [[architecture/deploying]], [[architecture/pg-pool-writes]], [[architecture/line-oauth-login]], [[specs/admin/system/settings]]

