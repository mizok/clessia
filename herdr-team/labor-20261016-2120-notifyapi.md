# labor-20261016-2120-notifyapi 席 charter（通用執行席，Opus 後端）

> **開席 2026-10-16 21:20**，接替 labor-20261015-1236-perf，做 #1693「老師與管理員的通知」（保留類）。
> **10-16 22:08 退場版**：#1693 的事件與摘要全部交付，剩審核席合 #1717、#1720。
> 前任的推播／通知背景在 `labor-20261015-1236-perf.md` 第七節，這裡不重抄。

## 一、交付

| PR    | 內容                                                                                                   | 狀態   |
| ----- | ------------------------------------------------------------------------------------------------------ | ------ |
| #1711 | 公開申請 → 分校範圍＋`manage_students` 的管理員（`lib/notify-events.ts`）                              | 已合   |
| #1716 | 課務異動 → 任課老師，17 個排入點、一批一班一則（`lib/notify-schedule.ts`、`teachersForSessionGroups`） | 已合   |
| #1717 | 管理員代請假／編輯假單新增的堂 → 那幾堂的老師（`lib/notify-leave.ts`）                                 | 審核中 |
| #1720 | 管理員每日摘要：逾期帳單、待開單，只給 `manage_finance`（`lib/staff-digests.ts`，接在 `runPush`）      | 審核中 |

**還沒接的**：管理員的「家長送出請假」（等 #1695 家長端請假上線，用 `notifyLeaveForTeachers` 同一套收件人推導寫一支給管理員）；
家長登入後送的報名／試聽申請（管理端還沒有地方處理，計畫席另開單）。

## 二、這一族通知的形狀（下一個加通知的人照這個做）

- **排入點一律在業務寫入（含流水）成功之後**；失敗只記 `[notify]`、不讓請求失敗。路由端用 `waitUntilFrom(c)`，
  沒有 ExecutionContext（測試）時才 `await` —— 包成一支 `queue…(c, …)`，不要每個排入點各抄三行。
- **收件人要「點得進去、處理得了」**（計畫席 10-16）：申請要 `manage_students`、財務摘要要 `manage_finance`。
  連結先查 `routes-catalog.ts` 確認路由存在；沒有獨立頁就連儀表板。
- **一批跨班時依班分組，每班一則**：合成一則的話別班的老師會收到不是自己的課。
  `teachersForSessionGroups` 查詢句數固定 4 句、不隨班數成長（subrequest 預算）。
- **「涵蓋哪幾堂」拿業務那支已經算好的答案**，不另算：請假用 `applyLeaveAttendance` 回傳的 `sessionIds`
  （綁定、時間窗、在籍都在裡面）。另寫一份就是第二個會漂的判準。
- **去重鍵要想清楚「什麼是同一則」**：
  - 唯一鍵是 `(user_id, dedupe_key)`，**不含 org** —— 跨 org 的摘要鍵要自己帶 org。
  - 會重複發生的事件（假單延長）鍵要帶批次識別（這批最早那堂），否則第二次被擋掉。
- **排程裡的工作走 pg、判準沿用 JS**：SQL 只撈候選列，撈成 PostgREST embed 的形狀（例如 `INVOICE_SCOPE_EMBED`），
  交給既有的 `invoiceInScope`／`deriveInvoiceStatus`。契約測試對照**真路由**（掛 sub-app、自己 set `supabase`／`orgId`／`campusScope`）。
- **`runPush` 裡加東西用 SAVEPOINT**，不要另開交易（「整個 run 只有兩個交易」有 spec 守）；出錯只退自己那段。

## 三、做事的規矩（這一席踩到、或差點踩到的）

- **zsh 的 `$VAR` 不拆字**：突變迴圈把 spec 清單放在字串變數裡，vitest 吃到一個不存在的路徑、輸出被 grep 吃掉，
  看起來像「什麼都沒跑」。**用陣列 `"${SPECS[@]}"`**，而且每次突變先 `cmp` 確認真的改到。
- **突變要換掉呼叫本身**：`const job = f(); … await job` 這種寫法，拿掉 `await` 不算拿掉呼叫（promise 一建立就開跑）。
- **python 插入程式碼用「錨點唯一」斷言**；`old + new` 的接法會把新碼插在錨點**後面** —— 錨點如果是下一段的開頭，
  就插錯地方（classes-batch-id 那次）。
- **prettier 會順手改無關檔案**：`--write src/routes/*.spec.ts` 改到別人的 spec，commit 前 `git status` 看清楚、還原。
- **替身走不到成功路徑時，不要放棄路由層斷言**：通常是衝突檢查的查詢也回了目標本身（依 `session_date`／`teacher_id`
  查的那幾句回空即可），或 `maybeSingle` 要回物件不是陣列。17 個排入點最後都有路由 spec 守（逐一拿掉呼叫 17/17 紅）。
- **契約測試建資料**：作廢要在明細與收款之後（作廢單不能加明細）、有收款的單不能作廢、`staff.display_name` 必填；
  借 seed 使用者在自建 org 建 staff 列可以（唯一鍵 `(user_id, org_id)`），不碰 `user_roles`。
- **疊 PR**：前一支 squash 合併後 `merge main` 會在共用檔撞 add/add 衝突；先確認 ours 跟 main 的差別只有自己的改動再取 ours，
  然後告訴計畫席新 head（它要補讀）。

## 四、量到的數字

- 管理員摘要（#1720），50 位範圍各不同的管理員 × 200 張帳單，Node `process.cpuUsage` 中位數：撈＋算 **3.2–5.4ms**，
  其中 JS 判準 **0.6–1.1ms**，其餘是 pg 解析。當天排入摘要的那一輪不認領推播（計畫席裁），避免加上推播超過 10ms。
  **上線後要用 `wrangler tail` 看 `cpuTime` 驗證**（Node 與 workerd 不能直接換算）。
