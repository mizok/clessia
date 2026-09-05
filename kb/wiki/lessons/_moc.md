# Lessons — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-09-05

---

## [[lessons/a-field-is-a-snapshot-not-a-path|欄位是狀態的快照，不是路徑的證明]]

看到 published_at 有值就推論「發布流程走過」——實際上那筆是 seed 用 SQL 直接塞的，而發布端點連通知邏輯都還沒寫。同一個形狀在三個席上各出現過一次。

Tags: `lessons`, `verification`, `inference`

Links to: [[lessons/new-field-branches-are-born-untested]]

## [[lessons/agent-workflow-guide|Agent 開發流程指南]]

本文件定義 Claude 與 Codex 協作開發時應遵循的工作流程。 目標：減少 token 消耗、提升成品品質、確保可追蹤性。

Tags: `lessons`, `agent-workflow-guide`

## [[lessons/awakened-tests-bite|修寫法時被喚醒的舊測試，比新測試更會咬人]]

把 @Input/@ViewChild 換成 functional API 這種「機械」重構，讓一段從來沒真正執行過的程式碼第一次跑起來，連帶暴露六支靠「那行沒跑到」才綠的 spec 與一顆 node 解析條件的地雷。

Tags: `lessons`, `awakened-tests-bite`, `angular`, `testing`

Links to: [[lessons/local-green-is-not-repo-green]], [[lessons/generated-tables-need-verifying]]

## [[lessons/backlog-legacy|Clessia 功能開發清單]]

2026-02～03 的功能開發清單與技術債紀錄。歷史文件 —— 其中「忘記密碼」整節已於 2026-08 作廢（系統改用 LINE OAuth）。

Tags: `lessons`, `backlog-legacy`

Links to: [[architecture/line-oauth-login]]

## [[lessons/better-auth-session-delegation|Better Auth 的 session 一律委派官方 API，不要手刻]]

adminCreateSession 不存在；手寫 ba_session + HMAC cookie 會耦合 BA 內部格式。教訓是 session 一律委派官方 API —— 當時委派給 signInEmail / signInUsername，2026-08 密碼登入移除後改為委派 magic-link 與 social provider，原則不變。

Tags: `lessons`, `better-auth-session-delegation`

Links to: [[architecture/line-oauth-login]], [[architecture/constitution|`kb/wiki/architecture/constitution`]]

## [[lessons/broken-looks-identical-to-normal|壞掉的樣子跟正常的樣子一模一樣]]

2026-09-05 一天的 M8 稽核挖出同一族缺陷的 13 個實例——程式碼的語意或邏輯是對的，但渲染結果、觸發條件或視覺回饋錯了，而且錯的方式讓它看起來像對的。判準：「它壞了我們會知道嗎？」

Tags: `lessons`, `silent-failure`, `visual-parity`, `m8-audit`

Links to: [[lessons/empty-array-hides-loading]], [[lessons/status-table-blind-spot]], [[lessons/new-field-branches-are-born-untested]], [[lessons/rls-backstop-drift]], [[lessons/menu-entry-without-a-route]]

## [[lessons/doc-code-drift-2026-08|2026-08 文件與程式碼漂移稽核]]

建立 agent harness 時逐項驗證文件宣稱，找出五處與程式碼不符之處。含一個活的 bug（查詢不存在的資料表）與兩個沉默失效的設定。

Tags: `lessons`, `doc-code-drift-2026-08`

## [[lessons/docker-disk-exhaustion|磁碟爆了怎麼查 —— Docker 佔滿主機的處置流程]]

主機從 2.9 GB 掉到 206 MB 的一次救援，最終回收 126 GB（Docker.raw 163 G → 37 G）。含磁碟量測工具的選用（mole 已棄用，改用 PureMac；含它被 Homebrew CLT 檢查誤擋時的取用方式）。記錄 docker system df 卡死時的替代量法、「兩個世界各看到假數字」為什麼讓自動 GC 永遠不觸發、以及 buildctl 是 shim、prune 兩參數、exit 0 不等於做了事這三個會讓人以為清完了的坑。

Tags: `lessons`, `docker`, `disk`, `dagger`, `ci`, `runbook`

Links to: [[lessons/local-green-is-not-repo-green]]

## [[lessons/empty-array-hides-loading|空陣列把「還沒載入」講成「真的沒有」]]

signal 初始 [] 或 computed 把 null 壓成 [] 之後，畫面就無法區分「還不知道」與「確定沒有」—— 而失敗態通常有人想到，載入態沒有。含一個已知但暫不修的實例（ReferenceDataService → 批次面板的老師名單）。

Tags: `lessons`, `loading-state`, `signals`, `known-issue`

Links to: [[lessons/status-table-blind-spot]]

## [[lessons/generated-tables-need-verifying|生成的表不會因為它是生成的就正確]]

功能區現況表的判定邏輯改了四版。第三版看起來完全合理，卻差點導致刪掉一個會動的功能——只有人工逐一驗證才發現。

Tags: `lessons`, `generated-tables-need-verifying`

## [[lessons/herdr-team-orchestration|Herdr 多席調度]]

計畫席用 herdr+SendMessage 調度 domain 席:開席序列、送達驗證、席名對位、廣度掃描分派形狀、帳面漂移的校正。

Tags: `lessons`, `herdr`, `orchestration`, `agent-team`

## [[lessons/lazy-chunk-is-not-lazy-if-statically-required|拆成 lazy chunk 不等於延後下載]]

xlsx 早就是獨立的 lazy chunk，但被兩個頁面靜態 import，所以打開那兩頁一定會抓它的 96 kB。真正的分界不是「有沒有拆成 chunk」，是「有沒有人靜態指到它」。

Tags: `lessons`, `bundle-size`, `angular`, `code-splitting`

Links to: [[lessons/root-component-pins-the-bundle]]

## [[lessons/line-number-citations-rot|行號引用會腐爛，符號不會]]

第一次 drift 稽核發現 KB 裡 13 條 file:line 引用有 5 條指錯位置——不是內容錯，是每支 PR 都在推移行號。

Tags: `lessons`, `kb`, `drift`, `citation`

Links to: [[lessons/menu-entry-without-a-route]], [[lessons/rls-backstop-drift]]

## [[lessons/local-green-is-not-repo-green|本機綠不等於 repo 綠]]

導入 CI 的過程連紅六次，每一次的根因都是「本機狀態 ≠ 版控狀態」。附上推送前該怎麼自我驗證。

Tags: `lessons`, `local-green-is-not-repo-green`

Links to: [[lessons/awakened-tests-bite]], [[lessons/merged-does-not-mean-main]]

## [[lessons/menu-entry-without-a-route|選單開了、頁面寫了，路由還在 redirect]]

M1 的課務異動畫面上線後完全打不開 —— 元件測試全綠，因為漏掉的東西不在元件裡，而在選單與路由表之間的縫。

Tags: `lessons`, `menu-entry-without-a-route`

## [[lessons/merged-does-not-mean-main|「MERGED」只說明它合進了某個東西，沒說是 main]]

疊 PR 的下層先合併之後，上層的 base 不會自動轉回 main —— 它會靜靜地合進一條已經死掉的分支，GitHub 標成 MERGED、CI 照樣綠，而那份工作從此不在 main 上。

Tags: `lessons`, `merged-does-not-mean-main`, `git`, `ci`

Links to: [[lessons/local-green-is-not-repo-green]], [[lessons/awakened-tests-bite]]

## [[lessons/new-field-branches-are-born-untested|加了新欄位的分支，天生就沒被測到]]

接上 API 新回的欄位、加一個判斷分支之後，989 支測試裡有 986 支照樣全綠 —— 因為舊 fixture 沒有那個欄位，全部走 null 落進舊路徑。全綠在這種改動裡是警訊，不是好消息。

Tags: `lessons`, `testing`, `fixtures`, `mutation-testing`

Links to: [[lessons/awakened-tests-bite]], [[lessons/local-green-is-not-repo-green]]

## [[lessons/rls-backstop-drift|後盾在沒人看的時候悄悄少了一半]]

業務表該一律啟用 RLS 當 fail-closed 後盾，但 30 張裡有 16 張沒開——早期的都有、後期新增的都沒有，而沒有任何東西會提醒。

Tags: `lessons`, `rls-backstop-drift`

## [[lessons/root-component-pins-the-bundle|Root component 掛什麼，所有人就下載什麼]]

一個只有多重角色使用者看得到的角色選擇 dialog，把 PrimeNG 整棵 dialog 依賴樹釘在初始 bundle 上，佔 756 kB 中的 140 kB。順帶記錄 angular.json 其實不生效這個會再踩一次的坑。

Tags: `lessons`, `bundle-size`, `angular`, `primeng`, `nx`

Links to: [[lessons/menu-entry-without-a-route]]

## [[lessons/status-table-blind-spot|現況表只掃了三分之一的系統]]

自動生成的功能區現況表只掃 features/admin/pages，於是家長端 11 個空殼從未出現在任何報告裡 —— 而所有優先順序決策都以那張表為依據。

Tags: `lessons`, `status-table-blind-spot`

## [[lessons/workers-fanout-costs-before-the-db|並行 fan-out 在碰到資料庫之前就已經變慢了]]

儀表板一次打 8 支 API，量測發現「完全不碰 DB」的請求在並行 8 條時 TTFB 從 0.46s 惡化到 1.1s（2.4 倍）。Workers 的 per-request 建池模型下，fan-out 的成本在 DB 工作之前就發生了；先量再猜，別一開始就假設是查詢慢。

Tags: `lessons`, `performance`, `workers`, `database`

Links to: [[architecture/auth-pool-lifecycle]], [[architecture/auth-pool-lifecycle]], [[lessons/local-green-is-not-repo-green]]

