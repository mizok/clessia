# Clessia Wiki — Index

> Auto-maintained by `kb:map`. Last updated: 2026-09-06

---

## Overview (2)
- [[overview]] — 本文件整理 PRD 第 1-5 章，說明專案背景、系統目標、核心名詞與角色邊界，作為各流程與功能規格的共同語意基準。
- [[roadmap]] — 功能區現況（自動生成、由 gate 盯著）與接下來的優先順序。取代先前手畫的 BACKLOG 依賴圖。

## Architecture (35)
- [[architecture/admin-contact-book-page]] — 管理端的聯絡簿是監看不是撰寫：日期區間列表＋未簽收篩選（API 無分頁且 count 是 exact，所以前端篩是誠實的），編輯已存在的一則走同一支 upsert，但不做「挑學生開新的一則」——那是老師端 P3 的工作流。「今天哪些該寫還沒寫」這輪不做，現有 API 做出來會漏班且是 N+1。
- [[architecture/admin-dashboard-v1]] — 把四張死卡片接上真資料並補行政待辦卡：零後端改動（六種資料既有 API 全有）、未點名卡回溯 7 天且只在逐堂點名模式顯示、報名卡只取 meta.total 以免分頁截斷、經營區用 permission 蓋住、卡片是索引不是工作場。
- [[architecture/admin-payments-page]] — 把 /admin/payments 空殼接上 /api/invoices：狀態由後端推導直接呈現、篩選只做 API 真的支援的兩項（欠繳與單一學生）而不在前端偽造狀態篩選、meta.total 在非 overdue 路徑不可信所以分頁改用「當頁滿即有下一頁」、詳情走 dialog、收款/退費/催繳/手動開帳共用同一個 dialog、列印用 @media print 切區塊。
- [[architecture/admin-todo-alerts]] — 把管理端六頁的告警拉齊成「一句話+必定帶篩選的入口+落地篩選對得上告警數字」。核心決定：同頁情境延用既有的「單一資料源 computed」模式（多數頁已經是），跨頁情境（儀表板→課堂管理）改用「共用 query 組裝函式」+ 契約測試釘住；新增共用元件 app-todo-banner 統一視覺（順帶解掉 courses 徽章的 affordance 問題——藥丸+hover-only 可點暗示讓它讀成狀態標籤）；GET /api/sessions 補 attendanceTaken 參數。
- [[architecture/amending-the-constitution]] — 憲法只能由人修改，agent 被兩條 deny 規則擋住（含 worktree 路徑）。曾經有過的 `tools/amend-constitution.mjs` 因為過度建造已移除——護欄留在 harness 層（A9 斷言 deny 目標存在）。
- [[architecture/announcements]] — 管理員發布、老師收件匣、已讀狀態。取代 LINE 群組通知的第一步，不接外部服務。
- [[architecture/auth-pool-lifecycle]] — createAuth() 每請求開 1–2 個 pg Pool 且從不關閉（批次匯入的迴圈裡一次開 50 個）；Workers 凍結 timer 使 pg 的 idle 自救失效。修法：getAuth(c) 讓同請求共用單一池，收尾交給掛在最前面的 cleanup middleware 在 await next() 之後做。singleton 在 Workers 是錯的，而在 getAuth 裡 waitUntil(pool.end()) 也是錯的。
- [[architecture/authorization-scope]] — 三個軸的範圍限制在建立帳號時都有收，執行時多數沒有用。這一頁記下五個可驗證的洞、補完的設計、以及 fail-closed 上線最真實的風險（既有管理員會看到空白而不是報錯）。
- [[architecture/better-auth-self-vs-admin]] — 使用者更新 API 只服務「本人改自己」；「管理員代改」屬 admin plugin，而它要求角色真相住在 ba_user.role——跟本專案「角色住 user_roles、一人多角色、權限存 jsonb」不相容。想接 admin plugin 之前先讀這頁。
- [[architecture/bootstrapping-a-deployment]] — 建立組織與第一個管理員的唯一路徑。零 demo 資料，走 Better Auth 建帳號，冪等。
- [[architecture/change-log-view]] — M1 第二個畫面。填掉 admin/changes 空殼，把一直在寫卻沒人看得到的 schedule_changes 呈現出來。唯讀。
- [[architecture/chunk-load-recovery]] — 舊 index 要不到新 chunk 時，導覽失敗自動重載一次、預載失敗顯示提示條；以及為什麼偵測不能靠 ChunkLoadError 或 404。
- [[architecture/constitution]] — 具約束力的架構不變量。只陳述「什麼構成違反」，不含強制機制。
- [[architecture/constitution-enforcement]] — 每條 clause 用什麼機制守、在哪一層擋、目前接上了沒有。改機制不算修法。
- [[architecture/day-timeline]] — 內部頁橘帶裡那條「今天」的資訊圖 —— 為什麼把排課畫成時間軸而不是再列一張表、佈局數學為什麼放在 pure util、以及 startTime/endTime 可為 null 這件事怎麼處理。
- [[architecture/deploying]] — 三個元件（Supabase / Workers / Pages）、哪些步驟只有人能做、以及為什麼 API 必須能在 Node 底下跑。
- [[architecture/design-language]] — 白底為基、大面積暖橘作為入口色面、會動的線條場只住在 hero；橘面上一律近黑字，因為亮橘配白字撐不到 4.5:1。token 用值替換而不是改名，既有頁面自動跟上。
- [[architecture/enrollment-admin-view]] — M2。兩個互不依賴的切片：班級頁的 Excel 名單匯入精靈、獨立的報名進出總覽頁。既有的班級／學生兩個報名入口不動。
- [[architecture/gate-map]] — 這個 repo 有哪些自動檢查、各自守什麼、各自看不到什麼，以及要新增一道之前該先問的四個問題。按 gate 組織，與按 clause 組織的 constitution-enforcement 互補。
- [[architecture/line-oauth-login]] — 密碼雜湊超過 Cloudflare Workers 免費方案的 10ms CPU 上限，登入間歇性 503。密碼登入完全移除、改用 OAuth（首發 LINE，Google 延後但架構預留）；破窗改成持有 DATABASE_URL 的人用 CLI 產生一次性登入連結，客戶換掉 DB 密碼就能切斷供應商存取。OAuth 身分靠一次性綁定連結／QR 對應到既有的人員或家長記錄。
- [[architecture/login-experience]] — 登入頁重設計（品牌卡片 + LINE 官方規範按鈕）與角色選擇回歸彈窗體感 —— /select-role 路由保留為唯一入口，薄殼自動開動態載入的彈窗，bundle 不回胖、無限重導向不回歸。
- [[architecture/no-division-scoping]] — 補習班有國小部／國中部（未來高中部），但系統不建立「部」的概念，也不依部隔離可見範圍。原因是實際的人力本來就跨部。
- [[architecture/parent-attendance-grades-billing-pages]] — 家長端 03 片。三頁共用 #344 的 child-switcher，資料走 #351 三支 childId 必填端點。逐項核對 kb specs 與 design-web 構圖跟 #351 實際契約的落差（4 態出勤/日到班時間/每筆 NEW 標籤/課程篩選/已取消分組都對不上），提出降級方案待批准。
- [[architecture/parent-class-logs-read]] — 家長端第二實例，照 parent-read-endpoints.md 的樣板抄：childDb 兩層防線、複用 admin 的 select/mapper、allowlist 欄位過濾。這支的特殊之處是 class_logs 是班級層級不是學生層級，childDb 現有 API 假設表上有 student_id 欄位，需要擴充一個新方法。等 STOP 批准，teacher-pages 的 v1b 讀取頁與發布按鈕卡在這支上。
- [[architecture/parent-data-scope]] — 家長端引入第三個授權維度（org → 分校 → 學生）。範圍在 middleware 注入、家長端 route 拿不到原始 supabase、只拿得到已綁 scope 的 childDb（預審時修正，原本的「必填參數」推論守不住「根本沒呼叫」）；越權指名回 403 不回空；多重角色的身分判定改看 activeRole。拒絕每支 route 自己 join、RLS、前端過濾三種替代。
- [[architecture/parent-read-endpoints]] — 家長端 P4 主體的 API 側設計。三支 GET-only 端點複用既有 admin 查詢邏輯（attendance.ts / scores.ts / invoices.ts 的 select 常數與 mapper），走 childDb + 顯式 childId 查詢參數（403 不回空），欄位過濾表逐支列出，錨點聚合數字放進各自 meta 不另開 dashboard 端點。等 STOP 批准。
- [[architecture/role-authorization]] — 掛載的 route 曾經只驗身分不看角色。改成掛載時強制宣告可用角色、沒宣告就拒絕，並用 harness gate 守住。分兩層：route 層准入、資料層範圍。
- [[architecture/teacher-class-log]] — 一班一天一篇的教學紀錄與作業，從課堂卡的 bottom sheet 寫入。v1a 只寫草稿、刻意不放發布按鈕——因為發布不可逆而下游（家長端可見、LINE 推播）都還不存在。
- [[architecture/teacher-schedule-mobile-day]] — 手機一日一屏、水平 scroll-snap 換日；桌機保留七欄。為什麼不寫手勢 JS、為什麼日期標題放在面板裡。
- [[architecture/teacher-students-view]] — 老師看自己任課班級的學生。同時處理 teacher/attendance 空殼——點名的家是課表，不是另一個選單項目。
- [[architecture/teacher-today-flow]] — 老師端四個介面收成三個，儀表板刪除而非搬移。核心判準是「站在教室門口的老師此刻要做什麼」——凡是不回答這件事的東西都不進來，包含月曆。
- [[architecture/teaching-history-not-payroll]] — 老師多為鐘點計酬，但系統刻意不計算薪資。職責是把「誰在什麼時候上了哪一堂」記到可信，計算方式留給人。
- [[architecture/teaching-log-view]] — M1 第一個畫面。選老師 + 期間，列出課堂並加總時數。不計算薪資，設計原則是可追溯——代課、停課、缺點名證據都看得見。
- [[architecture/timeline-density]] — lane 式時間軸的高度隨並行數長，密集日會把主入口推到摺線下。換成固定高度的密度圖；但「濃度」不能用透明度做——橘帶上整個可用透明度區間只有 1.40:1，編碼必須是柱高。
- [[architecture/vendor-relationship]] — 賣一套系統、客戶自付基礎設施、收維護費。客戶必須隨時能帶著資料離開 —— 這條原則否決了多租戶，也否決了任何 vendor lock-in。

## Flows (4)
- [[flows/attendance]] — 本文件整理 PRD 6.4-6.5，並補充 4.16 的模式定義，說明「日到班（Check-in）」如何轉成課堂出勤（Attendance），以及管理員如何補登與補請假。
- [[flows/enrollment]] — 本文件整理 PRD 6.3（並對齊 4.17 的來源/狀態定義），描述報名申請到繳費完成的完整作業流，涵蓋公開報名、家長端報名、加選、續課加選與管理員快速流程。
- [[flows/renewal]] — 本文件整理 PRD 6.10，定義預告制自動續課（Pre-Notification Auto-Renewal）的時間軸、角色動作與例外處理。
- [[flows/trial]] — 本文件整理 PRD 6.2，定義試聽申請從提交、安排、試聽到跟進的完整流程。此流程與報名申請流程獨立，但可在資料層建立來源關聯。

## Lessons (23)
- [[lessons/a-field-is-a-snapshot-not-a-path]] — 看到 published_at 有值就推論「發布流程走過」——實際上那筆是 seed 用 SQL 直接塞的，而發布端點連通知邏輯都還沒寫。同一個形狀在三個席上各出現過一次。
- [[lessons/agent-workflow-guide]] — 本文件定義 Claude 與 Codex 協作開發時應遵循的工作流程。 目標：減少 token 消耗、提升成品品質、確保可追蹤性。
- [[lessons/awakened-tests-bite]] — 把 @Input/@ViewChild 換成 functional API 這種「機械」重構，讓一段從來沒真正執行過的程式碼第一次跑起來，連帶暴露六支靠「那行沒跑到」才綠的 spec 與一顆 node 解析條件的地雷。
- [[lessons/backlog-legacy]] — 2026-02～03 的功能開發清單與技術債紀錄。歷史文件 —— 其中「忘記密碼」整節已於 2026-08 作廢（系統改用 LINE OAuth）。
- [[lessons/better-auth-session-delegation]] — adminCreateSession 不存在；手寫 ba_session + HMAC cookie 會耦合 BA 內部格式。教訓是 session 一律委派官方 API —— 當時委派給 signInEmail / signInUsername，2026-08 密碼登入移除後改為委派 magic-link 與 social provider，原則不變。
- [[lessons/bottom-sheet-meets-mobile-viewport]] — 兩個獨立的缺口都打在同一個位置——釘底面板最下面那排按鈕。一個是 --window-height 用 innerHeight 且只聽 window:resize（iOS 工具列收合發的是 visualViewport.resize），一個是全 repo 沒有任何 env(safe-area-inset-*)。兩者都未經真機確認。
- [[lessons/broken-looks-identical-to-normal]] — 2026-09-05～06 挖出同一族缺陷的 16 個實例（M8 稽核 13 個 + teacher-pages 補 1 個 + 兩個時區/驗證同族案例，另附兩則查證方法本身的盲點）——程式碼的語意或邏輯是對的，但渲染結果、觸發條件或視覺回饋錯了，而且錯的方式讓它看起來像對的。判準：「它壞了我們會知道嗎？」
- [[lessons/doc-code-drift-2026-08]] — 建立 agent harness 時逐項驗證文件宣稱，找出五處與程式碼不符之處。含一個活的 bug（查詢不存在的資料表）與兩個沉默失效的設定。
- [[lessons/docker-disk-exhaustion]] — 主機從 2.9 GB 掉到 206 MB 的一次救援，最終回收 126 GB（Docker.raw 163 G → 37 G）。含磁碟量測工具的選用（mole 已棄用，改用 PureMac；含它被 Homebrew CLT 檢查誤擋時的取用方式）。記錄 docker system df 卡死時的替代量法、「兩個世界各看到假數字」為什麼讓自動 GC 永遠不觸發、以及 buildctl 是 shim、prune 兩參數、exit 0 不等於做了事這三個會讓人以為清完了的坑。
- [[lessons/empty-array-hides-loading]] — signal 初始 [] 或 computed 把 null 壓成 [] 之後，畫面就無法區分「還不知道」與「確定沒有」—— 而失敗態通常有人想到，載入態沒有。含一個已知但暫不修的實例（ReferenceDataService → 批次面板的老師名單）。
- [[lessons/generated-tables-need-verifying]] — 功能區現況表的判定邏輯改了四版。第三版看起來完全合理，卻差點導致刪掉一個會動的功能——只有人工逐一驗證才發現。
- [[lessons/herdr-team-orchestration]] — 計畫席用 herdr+SendMessage 調度 domain 席:開席序列、送達驗證、席名對位、廣度掃描分派形狀、帳面漂移的校正。
- [[lessons/lazy-chunk-is-not-lazy-if-statically-required]] — xlsx 早就是獨立的 lazy chunk，但被兩個頁面靜態 import，所以打開那兩頁一定會抓它的 96 kB。真正的分界不是「有沒有拆成 chunk」，是「有沒有人靜態指到它」。
- [[lessons/line-number-citations-rot]] — 第一次 drift 稽核發現 KB 裡 13 條 file:line 引用有 5 條指錯位置——不是內容錯，是每支 PR 都在推移行號。
- [[lessons/local-green-is-not-repo-green]] — 導入 CI 的過程連紅六次，每一次的根因都是「本機狀態 ≠ 版控狀態」。附上推送前該怎麼自我驗證。
- [[lessons/menu-entry-without-a-route]] — M1 的課務異動畫面上線後完全打不開 —— 元件測試全綠，因為漏掉的東西不在元件裡，而在選單與路由表之間的縫。
- [[lessons/merged-does-not-mean-main]] — 疊 PR 的下層先合併之後，上層的 base 不會自動轉回 main —— 它會靜靜地合進一條已經死掉的分支，GitHub 標成 MERGED、CI 照樣綠，而那份工作從此不在 main 上。
- [[lessons/new-field-branches-are-born-untested]] — 接上 API 新回的欄位、加一個判斷分支之後，989 支測試裡有 986 支照樣全綠 —— 因為舊 fixture 沒有那個欄位，全部走 null 落進舊路徑。全綠在這種改動裡是警訊，不是好消息。
- [[lessons/rls-backstop-drift]] — 業務表該一律啟用 RLS 當 fail-closed 後盾，但 30 張裡有 16 張沒開——早期的都有、後期新增的都沒有，而沒有任何東西會提醒。
- [[lessons/root-component-pins-the-bundle]] — 一個只有多重角色使用者看得到的角色選擇 dialog，把 PrimeNG 整棵 dialog 依賴樹釘在初始 bundle 上，佔 756 kB 中的 140 kB。順帶記錄 angular.json 其實不生效這個會再踩一次的坑。
- [[lessons/silent-tool-failures]] — 一連串「零輸出／綠燈」其實代表「這個檢查根本沒發生」的實例——工具沒壞、用法也對，它只是回答了另一個問題，而正確答案與錯誤答案在畫面上逐字相同。
- [[lessons/status-table-blind-spot]] — 自動生成的功能區現況表只掃 features/admin/pages，於是家長端 11 個空殼從未出現在任何報告裡 —— 而所有優先順序決策都以那張表為依據。
- [[lessons/workers-fanout-costs-before-the-db]] — 儀表板一次打 8 支 API，量測發現「完全不碰 DB」的請求在並行 8 條時 TTFB 從 0.46s 惡化到 1.1s（2.4 倍）。Workers 的 per-request 建池模型下，fan-out 的成本在 DB 工作之前就發生了；先量再猜，別一開始就假設是查詢慢。

## Patterns (1)
- [[patterns/tables-use-responsive-table]] — 表格破版的正解是 responsive-table(欄位收合),不是 overflow 捲動;列印版面與臨時止血除外。

## Rules (7)
- [[rules/attendance-rules]] — 本文件整理 PRD 8.3-8.4，定義出勤模式、系統推算邏輯、人工修改權限與請假處理規則，作為到班/點名模組的核心行為準則。
- [[rules/billing-rules]] — 內部人訪談定案的金流業務規則：三種計費模式（月繳/期繳/堂數制）、金額永遠可人工覆寫（不做折扣引擎）、插班退班共用比例試算、帳單與收款一對多、欠繳只做可見性不做強制。
- [[rules/boolean-controls]] — checkbox（表格列的布林事實／集合選取）、toggle switch（表單裡單一實體的設定欄位）、filter chip（頁面層級的檢視篩選）——依「值活在哪個結構裡」挑控制項，不是憑手感。三處既有落差已修：餐費「收費」toggle 改 checkbox 對齊同列的「訂餐」；費用方案「顯示停用方案」、聯絡簿「只看未簽收」從只換文字的按鈕改成視覺會跟著狀態走的 app-filter-chip。
- [[rules/contact-book-rules]] — 內部人訪談定案：每生每日唯一一則自由文字（不分科目）、班級層級開關（低年級用、國中以上不用）、帶班老師撰寫可共編、家長按鈕簽收（記人與時間）且老師看得到已讀狀態。
- [[rules/enrollment-rules]] — 報名審核、繳費關聯與直接報名規範。2026-08-29 依訪談定案的 billing-rules 對齊：繳費狀態由收款推導（三態）、單一 due_date 無寬限期機制、金額調整是議價不是折扣類型。2026-09-06 新增第 8 節：學生的分校歸屬不隨退班消失。
- [[rules/meal-rules]] — 內部人訪談定案：訂餐與出席解耦（有上課不一定訂餐）、每生每日一筆餐記錄（單價在筆上、收不收費是人工開關）、月底加總開帳單；請假只提示不自動改餐記錄。
- [[rules/teaching-log-rules]] — 訪談最大發現：各科老師的教務日誌（教學紀錄+作業安排）現靠紙本拍照進 LINE 相簿、行政再轉貼到年級群組，粒度錯誤導致沒修課的學生也收到作業；系統應以班級名冊為粒度，日誌發布即自動送達該班家長端＋推播。

## Specs (46)
- [[specs/admin/academic/calendar]] — 統一行事曆介面，管理員可瀏覽課堂並直接處理停課、代課、調課。
- [[specs/admin/academic/classes]] — 管理開課班，設定上課時間，產生課堂。
- [[specs/admin/academic/courses]] — /admin/courses 的課程列表 —— 管理員瀏覽與維護課程，是開課班（classes）的上層分類。
- [[specs/admin/calendar]] — 以日曆視圖查看全校課堂，快速進入課堂詳情。
- [[specs/admin/dashboard]] — 管理員首頁，六張卡各回答一個問題並跳到功能的家；經營區用 view_reports 蓋住。
- [[specs/admin/enrollment/enrollment]] — 管理員直接將學生加入開課班（跳過申請流程），適用現場報名、老生加報、特殊例外。
- [[specs/admin/enrollment/enrollment-requests]] — 審核家長提交的報名申請。
- [[specs/admin/enrollment/renewals]] — 查看續課狀態、處理異動申請。
- [[specs/admin/enrollment/trials]] — 管理試聽申請、安排試聽、跟進結果。
- [[specs/admin/finance/fee-templates]] — 價目表是 org 層的定價（三種計費模式、只給定價不給折扣、停用不刪除），與機構自訂的收費期間同頁管理。折扣引擎與班級層級生效期間已於 2026-08-29 訪談否定。
- [[specs/admin/finance/meals]] — 每日名單勾選：每生每日一筆餐記錄（單價在筆上、訂了沒、收不收費是人工開關），月底加總未結算的筆數開帳單。餐別維度與逐筆手動輸入金額已於 2026-08-29 訪談否定。
- [[specs/admin/finance/payments]] — 帳單與收款一對多，狀態由累計實收推導（未繳/部分繳/繳清）＋逾期是衍生標記；收現金或轉帳（附憑證圖）、開收據、印收費袋、催繳只做可見性。折扣引擎、強制啟用、六種狀態、分期計畫已於 2026-08-29 訪談否定。
- [[specs/admin/finance/reports]] — 依日期/分校/課程看實收、應收未收、退款；數字一律來自後端聚合端點，不在前端加總分頁明細。
- [[specs/admin/notifications]] — 查看系統通知與課務異動通知。
- [[specs/admin/roles-and-auth]] — 三個角色（admin / teacher / parent）存在 user_roles，細部權限存在 user_roles.permissions。密碼登入已於 2026-08 移除，改為 LINE OAuth + 一次性登入連結。
- [[specs/admin/student-affairs/attendance]] — 查看和修正學生出勤狀態。管理員擁有不限時間、不限課堂的修改權限。
- [[specs/admin/student-affairs/grades]] — 查詢所有學生成績。
- [[specs/admin/student-affairs/leave]] — 建立和查詢請假紀錄。請假只能由管理員建立，支援事後補請。
- [[specs/admin/student-affairs/parents]] — 管理家長帳號，關聯學生，處理帳號相關操作。
- [[specs/admin/student-affairs/students]] — 查詢、新增與編輯學生基本資料。學生資料有兩種來源： - 公開報名：家長透過報名頁填寫，繳費完成後自動建立 - 管理員手動新增：管理員直接在後台建立，適用於內部人員子女入學、現場報名等情境
- [[specs/admin/system/campuses]] — 管理分校資訊與教室。
- [[specs/admin/system/settings]] — 全域系統參數設定。
- [[specs/admin/system/staff]] — 管理管理員、老師帳號。
- [[specs/BRAINSTORM_PROMPT]] — 你是一位資深的教育科技架構師與產品經理，專精於補習班（課後輔導）ERP 系統的設計。 你的目標是分析「Clessia」(學程管家) 目前的系統設計，並提出一套完整的 functional specification (功能規格) 結構。
- [[specs/parent/add-course]] — 瀏覽並加選新課程（以課程探索為中心）。
- [[specs/parent/attendance]] — 查看孩子的到班歷史。
- [[specs/parent/dashboard]] — 家長首頁，快速掌握孩子今日狀況。
- [[specs/parent/enrollment]] — 已有帳號的家長為孩子加報課程、查看申請狀態。
- [[specs/parent/grades]] — 查看孩子的考試成績。
- [[specs/parent/meals]] — 查看孩子的餐費紀錄。
- [[specs/parent/notifications]] — 查看課務異動通知。
- [[specs/parent/payments]] — 查看繳費單和繳費紀錄。
- [[specs/parent/renewal]] — 預覽即將自動續課的內容，申請異動。
- [[specs/parent/schedule]] — 查看孩子的課表和課堂詳情。
- [[specs/parent/trial]] — 已有帳號的家長為孩子申請試聽其他課程。
- [[specs/public/enrollment]] — 新家長為孩子提交報名申請。
- [[specs/public/login]] — 一顆「使用 LINE 登入」按鈕。這個系統沒有密碼——首次進入靠管理員發出的一次性連結，綁定 LINE 之後才走這一頁。
- [[specs/public/qr-checkin]] — 學生掃碼完成當日到班登記。
- [[specs/public/trial]] — 新家長為孩子申請課程試聽。
- [[specs/README]] — 本目錄包含 Clessia（學程管家）系統所有頁面的功能規格摘要。
- [[specs/teacher/assessments]] — 建立考試事件、輸入成績。
- [[specs/teacher/attendance]] — 查看和修改當天課堂的出勤狀態。
- [[specs/teacher/dashboard]] — 老師首頁，快速掌握今日課程與待處理事項。
- [[specs/teacher/notifications]] — 查看課務異動通知。
- [[specs/teacher/schedule]] — 查看自己任課的課堂，進入課堂詳情。
- [[specs/teacher/students]] — 查看自己任課班級的學生名單。

## Sources (1)
- [[summaries/interview-insider-2026-08-29]] — 目標補習班內部員工的一手訪談（20 題，透過使用者當傳聲筒），P1 資料模型的主要輸入。

---
**Total: 118 pages**
