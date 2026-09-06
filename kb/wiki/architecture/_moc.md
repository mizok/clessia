# Architecture — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-09-06

---

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

Links to: [[architecture/constitution|c12]], [[architecture/line-oauth-login]], [[architecture/deploying]]

## [[architecture/change-log-view|課務異動紀錄的設計]]

M1 第二個畫面。填掉 admin/changes 空殼，把一直在寫卻沒人看得到的 schedule_changes 呈現出來。唯讀。

Tags: `architecture`, `change-log-view`

## [[architecture/chunk-load-recovery|部署後舊分頁的 chunk 載入失敗復原]]

舊 index 要不到新 chunk 時，導覽失敗自動重載一次、預載失敗顯示提示條；以及為什麼偵測不能靠 ChunkLoadError 或 404。

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

## [[architecture/day-timeline|一日時間軸元件（day-timeline）]]

內部頁橘帶裡那條「今天」的資訊圖 —— 為什麼把排課畫成時間軸而不是再列一張表、佈局數學為什麼放在 pure util、以及 startTime/endTime 可為 null 這件事怎麼處理。

Tags: `architecture`, `day-timeline`, `dashboard`, `direction-d`

Links to: [[architecture/design-language]], [[lessons/awakened-tests-bite]]

## [[architecture/deactivate-vs-archive|停用 vs 封存 —— 不是同一個動作的兩種叫法，裁定不統一]]

M4 詞彙統一（#425）查證結論——停用（可逆）與封存（不可逆）是兩個不同的動作，用字差異忠實反映各自的狀態模型，不該合併成一個字。計畫席裁定：兩個字都留著。

## [[architecture/deploying|部署]]

三個元件（Supabase / Workers / Pages）、哪些步驟只有人能做、以及為什麼 API 必須能在 Node 底下跑。

Tags: `architecture`, `deployment`, `cloudflare`, `supabase`

Links to: [[architecture/vendor-relationship]], [[architecture/constitution|c12]], [[architecture/auth-pool-lifecycle]], [[architecture/bootstrapping-a-deployment]]

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

## [[architecture/line-oauth-login|LINE 登入的設計]]

密碼雜湊超過 Cloudflare Workers 免費方案的 10ms CPU 上限，登入間歇性 503。密碼登入完全移除、改用 OAuth（首發 LINE，Google 延後但架構預留）；破窗改成持有 DATABASE_URL 的人用 CLI 產生一次性登入連結，客戶換掉 DB 密碼就能切斷供應商存取。OAuth 身分靠一次性綁定連結／QR 對應到既有的人員或家長記錄。

Tags: `architecture`, `auth`, `oauth`, `line`, `cloudflare`

Links to: [[lessons/better-auth-session-delegation]], [[architecture/deploying]], [[specs/admin/roles-and-auth]]

## [[architecture/login-experience|登入體驗與角色選擇的設計]]

登入頁重設計（品牌卡片 + LINE 官方規範按鈕）與角色選擇回歸彈窗體感 —— /select-role 路由保留為唯一入口，薄殼自動開動態載入的彈窗，bundle 不回胖、無限重導向不回歸。

Tags: `architecture`, `login`, `select-role`, `ux`

Links to: [[specs/public/login]]

## [[architecture/no-division-scoping|刻意不設計「學部」這一層]]

補習班有國小部／國中部（未來高中部），但系統不建立「部」的概念，也不依部隔離可見範圍。原因是實際的人力本來就跨部。

Tags: `architecture`, `no-division-scoping`

## [[architecture/no-value-display-conventions|「沒有值」的三種寫法，不是同一件事的三種說法]]

M4 詞彙統一（#425）查證結論——「—」/「未填寫」/「無關聯 X」對應三種不同語意（唯讀顯示欄位空值/可編輯欄位未填/關聯不存在），不該合併成一種寫法。

## [[architecture/parent-attendance-grades-billing-pages|家長端三頁前端設計 —— 出缺席／成績／繳費]]

家長端 03 片。三頁共用 #344 的 child-switcher，資料走 #351 三支 childId 必填端點。逐項核對 kb specs 與 design-web 構圖跟 #351 實際契約的落差（4 態出勤/日到班時間/每筆 NEW 標籤/課程篩選/已取消分組都對不上），提出降級方案待批准。

Tags: `architecture`, `parent`, `attendance`, `grades`, `billing`

Links to: [[architecture/parent-read-endpoints]], [[architecture/parent-data-scope]]

## [[architecture/parent-class-logs-read|家長端讀取已發布教務日誌（v1b）]]

家長端第二實例，照 parent-read-endpoints.md 的樣板抄：childDb 兩層防線、複用 admin 的 select/mapper、allowlist 欄位過濾。這支的特殊之處是 class_logs 是班級層級不是學生層級，childDb 現有 API 假設表上有 student_id 欄位，需要擴充一個新方法。等 STOP 批准，teacher-pages 的 v1b 讀取頁與發布按鈕卡在這支上。

Tags: `architecture`, `parent`, `authorization`, `teaching-log`

Links to: [[architecture/parent-read-endpoints]], [[architecture/parent-read-endpoints]], [[architecture/parent-read-endpoints]]

## [[architecture/parent-data-scope|家長端的資料範圍模型]]

家長端引入第三個授權維度（org → 分校 → 學生）。範圍在 middleware 注入、家長端 route 拿不到原始 supabase、只拿得到已綁 scope 的 childDb（預審時修正，原本的「必填參數」推論守不住「根本沒呼叫」）；越權指名回 403 不回空；多重角色的身分判定改看 activeRole。拒絕每支 route 自己 join、RLS、前端過濾三種替代。

Tags: `architecture`, `parent`, `authorization`, `security`

## [[architecture/parent-read-endpoints|家長端三支讀取端點（出缺席／成績／繳費）]]

家長端 P4 主體的 API 側設計。三支 GET-only 端點複用既有 admin 查詢邏輯（attendance.ts / scores.ts / invoices.ts 的 select 常數與 mapper），走 childDb + 顯式 childId 查詢參數（403 不回空），欄位過濾表逐支列出，錨點聚合數字放進各自 meta 不另開 dashboard 端點。等 STOP 批准。

Tags: `architecture`, `parent`, `authorization`, `attendance`, `grades`, `billing`

Links to: [[architecture/parent-data-scope]], [[roadmap]]

## [[architecture/role-authorization|角色授權的設計]]

掛載的 route 曾經只驗身分不看角色。改成掛載時強制宣告可用角色、沒宣告就拒絕，並用 harness gate 守住。分兩層：route 層准入、資料層範圍。

Tags: `architecture`, `role-authorization`

Links to: [[architecture/teacher-students-view]]

## [[architecture/session-makeup|補課（課堂標記「補的是哪一堂停課」）]]

停課的課堂可以被另一堂課補回來。連結存在 sessions.makeup_for_session_id 這個自我參照 FK 上，只為可解釋性——計費完全不需要它，因為補課那堂本來就會扣、停掉的那堂本來就不扣。

Tags: `architecture`, `sessions`, `makeup`, `billing-adjacent`

## [[architecture/teacher-class-log|教務日誌（老師端寫入）]]

一班一天一篇的教學紀錄與作業，從課堂卡的 bottom sheet 寫入。v1a 只寫草稿、刻意不放發布按鈕——因為發布不可逆而下游（家長端可見、LINE 推播）都還不存在。

Tags: `architecture`, `teacher`, `class-logs`, `mobile-first`

Links to: [[rules/teaching-log-rules]], [[architecture/teacher-today-flow]], [[architecture/teacher-schedule-mobile-day]]

## [[architecture/teacher-schedule-mobile-day|老師端課表 —— 行動優先單日檢視]]

手機一日一屏、水平 scroll-snap 換日；桌機保留七欄。為什麼不寫手勢 JS、為什麼日期標題放在面板裡。

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

## [[architecture/vendor-relationship|供應商關係與它推導出的架構約束]]

賣一套系統、客戶自付基礎設施、收維護費。客戶必須隨時能帶著資料離開 —— 這條原則否決了多租戶，也否決了任何 vendor lock-in。

Tags: `architecture`, `business-model`, `tenancy`, `vendor-lock-in`

Links to: [[architecture/constitution|c12]], [[lessons/status-table-blind-spot]], [[lessons/rls-backstop-drift]], [[architecture/line-oauth-login]], [[architecture/bootstrapping-a-deployment]], [[architecture/bootstrapping-a-deployment]]

