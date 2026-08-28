# Lessons — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-08-28

---

## [[lessons/agent-workflow-guide|Agent 開發流程指南]]

本文件定義 Claude 與 Codex 協作開發時應遵循的工作流程。 目標：減少 token 消耗、提升成品品質、確保可追蹤性。

Tags: `lessons`, `agent-workflow-guide`

## [[lessons/backlog-legacy|Clessia 功能開發清單]]

2026-02～03 的功能開發清單與技術債紀錄。歷史文件 —— 其中「忘記密碼」整節已於 2026-08 作廢（系統改用 LINE OAuth）。

Tags: `lessons`, `backlog-legacy`

Links to: [[architecture/line-oauth-login]]

## [[lessons/better-auth-session-delegation|Better Auth 的 session 一律委派官方 API，不要手刻]]

adminCreateSession 不存在；手寫 ba_session + HMAC cookie 會耦合 BA 內部格式。教訓是 session 一律委派官方 API —— 當時委派給 signInEmail / signInUsername，2026-08 密碼登入移除後改為委派 magic-link 與 social provider，原則不變。

Tags: `lessons`, `better-auth-session-delegation`

Links to: [[architecture/line-oauth-login]], [[architecture/constitution|`kb/wiki/architecture/constitution`]]

## [[lessons/doc-code-drift-2026-08|2026-08 文件與程式碼漂移稽核]]

建立 agent harness 時逐項驗證文件宣稱，找出五處與程式碼不符之處。含一個活的 bug（查詢不存在的資料表）與兩個沉默失效的設定。

Tags: `lessons`, `doc-code-drift-2026-08`

## [[lessons/generated-tables-need-verifying|生成的表不會因為它是生成的就正確]]

功能區現況表的判定邏輯改了四版。第三版看起來完全合理，卻差點導致刪掉一個會動的功能——只有人工逐一驗證才發現。

Tags: `lessons`, `generated-tables-need-verifying`

## [[lessons/line-number-citations-rot|行號引用會腐爛，符號不會]]

第一次 drift 稽核發現 KB 裡 13 條 file:line 引用有 5 條指錯位置——不是內容錯，是每支 PR 都在推移行號。

Tags: `lessons`, `kb`, `drift`, `citation`

Links to: [[lessons/menu-entry-without-a-route]], [[lessons/rls-backstop-drift]]

## [[lessons/local-green-is-not-repo-green|本機綠不等於 repo 綠]]

導入 CI 的過程連紅六次，每一次的根因都是「本機狀態 ≠ 版控狀態」。附上推送前該怎麼自我驗證。

Tags: `lessons`, `local-green-is-not-repo-green`

## [[lessons/menu-entry-without-a-route|選單開了、頁面寫了，路由還在 redirect]]

M1 的課務異動畫面上線後完全打不開 —— 元件測試全綠，因為漏掉的東西不在元件裡，而在選單與路由表之間的縫。

Tags: `lessons`, `menu-entry-without-a-route`

## [[lessons/rls-backstop-drift|後盾在沒人看的時候悄悄少了一半]]

業務表該一律啟用 RLS 當 fail-closed 後盾，但 30 張裡有 16 張沒開——早期的都有、後期新增的都沒有，而沒有任何東西會提醒。

Tags: `lessons`, `rls-backstop-drift`

## [[lessons/status-table-blind-spot|現況表只掃了三分之一的系統]]

自動生成的功能區現況表只掃 features/admin/pages，於是家長端 11 個空殼從未出現在任何報告裡 —— 而所有優先順序決策都以那張表為依據。

Tags: `lessons`, `status-table-blind-spot`
