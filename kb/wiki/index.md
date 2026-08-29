# Clessia Wiki — Index

> Auto-maintained by `kb:map`. Last updated: 2026-08-29

---

## Overview (2)
- [[overview]] — 本文件整理 PRD 第 1-5 章，說明專案背景、系統目標、核心名詞與角色邊界，作為各流程與功能規格的共同語意基準。
- [[roadmap]] — 功能區現況（自動生成、由 gate 盯著）與接下來的優先順序。取代先前手畫的 BACKLOG 依賴圖。

## Architecture (17)
- [[architecture/admin-dashboard-v1]] — 把四張死卡片接上真資料並補行政待辦卡：零後端改動（六種資料既有 API 全有）、未點名卡回溯 7 天且只在逐堂點名模式顯示、報名卡只取 meta.total 以免分頁截斷、經營區用 permission 蓋住、卡片是索引不是工作場。
- [[architecture/amending-the-constitution]] — 憲法只能由人修改，agent 被兩條 deny 規則擋住（含 worktree 路徑）。曾經有過的 `tools/amend-constitution.mjs` 因為過度建造已移除——護欄留在 harness 層（A9 斷言 deny 目標存在）。
- [[architecture/announcements]] — 管理員發布、老師收件匣、已讀狀態。取代 LINE 群組通知的第一步，不接外部服務。
- [[architecture/auth-pool-lifecycle]] — createAuth() 每請求開 1–2 個 pg Pool 且從不關閉（批次匯入的迴圈裡一次開 50 個）；Workers 凍結 timer 使 pg 的 idle 自救失效。修法：getAuth(c) 讓同請求共用單一池，收尾交給掛在最前面的 cleanup middleware 在 await next() 之後做。singleton 在 Workers 是錯的，而在 getAuth 裡 waitUntil(pool.end()) 也是錯的。
- [[architecture/bootstrapping-a-deployment]] — 建立組織與第一個管理員的唯一路徑。零 demo 資料，走 Better Auth 建帳號，冪等。
- [[architecture/change-log-view]] — M1 第二個畫面。填掉 admin/changes 空殼，把一直在寫卻沒人看得到的 schedule_changes 呈現出來。唯讀。
- [[architecture/constitution]] — 具約束力的架構不變量。只陳述「什麼構成違反」，不含強制機制。
- [[architecture/constitution-enforcement]] — 每條 clause 用什麼機制守、在哪一層擋、目前接上了沒有。改機制不算修法。
- [[architecture/deploying]] — 三個元件（Supabase / Workers / Pages）、哪些步驟只有人能做、以及為什麼 API 必須能在 Node 底下跑。
- [[architecture/enrollment-admin-view]] — M2。兩個互不依賴的切片：班級頁的 Excel 名單匯入精靈、獨立的報名進出總覽頁。既有的班級／學生兩個報名入口不動。
- [[architecture/line-oauth-login]] — 密碼雜湊超過 Cloudflare Workers 免費方案的 10ms CPU 上限，登入間歇性 503。密碼登入完全移除、改用 OAuth（首發 LINE，Google 延後但架構預留）；破窗改成持有 DATABASE_URL 的人用 CLI 產生一次性登入連結，客戶換掉 DB 密碼就能切斷供應商存取。OAuth 身分靠一次性綁定連結／QR 對應到既有的人員或家長記錄。
- [[architecture/no-division-scoping]] — 補習班有國小部／國中部（未來高中部），但系統不建立「部」的概念，也不依部隔離可見範圍。原因是實際的人力本來就跨部。
- [[architecture/role-authorization]] — 掛載的 route 曾經只驗身分不看角色。改成掛載時強制宣告可用角色、沒宣告就拒絕，並用 harness gate 守住。分兩層：route 層准入、資料層範圍。
- [[architecture/teacher-students-view]] — 老師看自己任課班級的學生。同時處理 teacher/attendance 空殼——點名的家是課表，不是另一個選單項目。
- [[architecture/teaching-history-not-payroll]] — 老師多為鐘點計酬，但系統刻意不計算薪資。職責是把「誰在什麼時候上了哪一堂」記到可信，計算方式留給人。
- [[architecture/teaching-log-view]] — M1 第一個畫面。選老師 + 期間，列出課堂並加總時數。不計算薪資，設計原則是可追溯——代課、停課、缺點名證據都看得見。
- [[architecture/vendor-relationship]] — 賣一套系統、客戶自付基礎設施、收維護費。客戶必須隨時能帶著資料離開 —— 這條原則否決了多租戶，也否決了任何 vendor lock-in。

## Flows (4)
- [[flows/attendance]] — 本文件整理 PRD 6.4-6.5，並補充 4.16 的模式定義，說明「日到班（Check-in）」如何轉成課堂出勤（Attendance），以及管理員如何補登與補請假。
- [[flows/enrollment]] — 本文件整理 PRD 6.3（並對齊 4.17 的來源/狀態定義），描述報名申請到繳費完成的完整作業流，涵蓋公開報名、家長端報名、加選、續課加選與管理員快速流程。
- [[flows/renewal]] — 本文件整理 PRD 6.10，定義預告制自動續課（Pre-Notification Auto-Renewal）的時間軸、角色動作與例外處理。
- [[flows/trial]] — 本文件整理 PRD 6.2，定義試聽申請從提交、安排、試聽到跟進的完整流程。此流程與報名申請流程獨立，但可在資料層建立來源關聯。

## Lessons (10)
- [[lessons/agent-workflow-guide]] — 本文件定義 Claude 與 Codex 協作開發時應遵循的工作流程。 目標：減少 token 消耗、提升成品品質、確保可追蹤性。
- [[lessons/backlog-legacy]] — 2026-02～03 的功能開發清單與技術債紀錄。歷史文件 —— 其中「忘記密碼」整節已於 2026-08 作廢（系統改用 LINE OAuth）。
- [[lessons/better-auth-session-delegation]] — adminCreateSession 不存在；手寫 ba_session + HMAC cookie 會耦合 BA 內部格式。教訓是 session 一律委派官方 API —— 當時委派給 signInEmail / signInUsername，2026-08 密碼登入移除後改為委派 magic-link 與 social provider，原則不變。
- [[lessons/doc-code-drift-2026-08]] — 建立 agent harness 時逐項驗證文件宣稱，找出五處與程式碼不符之處。含一個活的 bug（查詢不存在的資料表）與兩個沉默失效的設定。
- [[lessons/generated-tables-need-verifying]] — 功能區現況表的判定邏輯改了四版。第三版看起來完全合理，卻差點導致刪掉一個會動的功能——只有人工逐一驗證才發現。
- [[lessons/line-number-citations-rot]] — 第一次 drift 稽核發現 KB 裡 13 條 file:line 引用有 5 條指錯位置——不是內容錯，是每支 PR 都在推移行號。
- [[lessons/local-green-is-not-repo-green]] — 導入 CI 的過程連紅六次，每一次的根因都是「本機狀態 ≠ 版控狀態」。附上推送前該怎麼自我驗證。
- [[lessons/menu-entry-without-a-route]] — M1 的課務異動畫面上線後完全打不開 —— 元件測試全綠，因為漏掉的東西不在元件裡，而在選單與路由表之間的縫。
- [[lessons/rls-backstop-drift]] — 業務表該一律啟用 RLS 當 fail-closed 後盾，但 30 張裡有 16 張沒開——早期的都有、後期新增的都沒有，而沒有任何東西會提醒。
- [[lessons/status-table-blind-spot]] — 自動生成的功能區現況表只掃 features/admin/pages，於是家長端 11 個空殼從未出現在任何報告裡 —— 而所有優先順序決策都以那張表為依據。

## Rules (6)
- [[rules/attendance-rules]] — 本文件整理 PRD 8.3-8.4，定義出勤模式、系統推算邏輯、人工修改權限與請假處理規則，作為到班/點名模組的核心行為準則。
- [[rules/billing-rules]] — 內部人訪談定案的金流業務規則：三種計費模式（月繳/期繳/堂數制）、金額永遠可人工覆寫（不做折扣引擎）、插班退班共用比例試算、帳單與收款一對多、欠繳只做可見性不做強制。
- [[rules/contact-book-rules]] — 內部人訪談定案：每生每日唯一一則自由文字（不分科目）、班級層級開關（低年級用、國中以上不用）、帶班老師撰寫可共編、家長按鈕簽收（記人與時間）且老師看得到已讀狀態。
- [[rules/enrollment-rules]] — 本文件整理 PRD 8.9，定義報名審核、繳費狀態、寬限期、直接報名與通知規範，供報名與財務流程實作統一依循。
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
- [[specs/admin/finance/fee-templates]] — 定義開課班的收費標準。
- [[specs/admin/finance/meals]] — 新增和查詢餐費紀錄。
- [[specs/admin/finance/payments]] — 管理繳費單、確認收款。
- [[specs/admin/finance/reports]] — 查看營收統計報表。
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
**Total: 85 pages**
