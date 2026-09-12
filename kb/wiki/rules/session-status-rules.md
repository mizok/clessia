---
title: 課堂狀態（sessions.status）規則
summary: sessions.status 目前只有 scheduled 與 cancelled 會被寫入，completed 沒有任何寫入路徑；這一頁記錄哪些程式碼依賴這個現況、誰會在 completed 第一次被寫入的那天改變行為，以及刪除守門為什麼用 OR 而不是替換條件。
category: rule
status: active
updated: 2026-09-13
tags: [rules, sessions, attendance, classes]
---

# 課堂狀態（`sessions.status`）規則

## 這一頁在守什麼

`sessions.status` 有三個值：`scheduled` / `completed` / `cancelled`（DB 是 `text` +
`CHECK`，不是 enum；欄位 default `'scheduled'`）。

**`completed` 從來沒有被寫入過。** 全 repo 零寫入路徑 —— 於是一整批程式碼實際上活在
「status 永遠是 `scheduled` 或 `cancelled`」的世界裡，而**另一批程式碼已經假設
`completed` 存在**（它們今天全部是死碼）。

**下一個要補上「誰寫 completed」的人，先讀完這一頁。** 那一刻會有一批從來沒在真實
資料上跑過的分支同時第一次生效。

## 驗證狀態

| 項目 | 驗法 | 2026-09-13 的結果 |
| --- | --- | --- |
| 應用程式碼是否寫入 `completed` | `grep -rn "status: 'completed'" apps/api/src apps/web/src supabase \| grep -v '\.spec\.'` | **零命中** |
| `sessions.status` 的實際寫入點 | 同上改查 `update({ status:` | 只寫 `'cancelled'` 與 `'scheduled'`（`classes.ts:2490/2804/2908`、`courses.ts:471/500`、`sessions.ts:1658/2912/3285/3298`） |
| 本機 DB 的實況 | `select status, count(*) from sessions group by 1` | `completed` **60 筆**（2026-06-29 ~ 09-05）、`scheduled` 51、`cancelled` 10 |
| 那 60 筆的來源 | `grep -c completed supabase/seed.sql` | **0** —— 不在任何進版控的檔案裡 |

> ⚠️ **本機那 60 筆 `completed` 沒有來源。** `seed.sql` 造不出它們，migration 只有
> `CHECK`，應用程式碼零寫入。它們是某一輪手動改的，**`db:reset` 之後會消失**。
>
> **後果**：在本機測任何跟 `completed` 有關的守衛，看到的是一個「已經開始寫
> completed」的世界，而正式站是另一個。**「本機驗過」在這一帶特別不可信**，同一支
> 測試在 reset 前後會得到不同答案。
>
> （#762 工單曾把這 60 筆寫成「seed 寫的」，那是轉述時加上的歸因；原始報告 #488
> 明確查過 `seed.sql` 零命中。以本頁的驗法為準。）

## 三類依賴「status 永遠是 scheduled」的程式碼

### (i) `.eq('status', 'scheduled')` —— 今天等於「全部未停課」，那天起會變成「排除已完成」

**全 repo 16 處**（#488 的報告只列了 `classes.ts` 的那 6 處，`sessions.ts` 與
`staff.ts` 的 10 處不在那份清單裡）：

| 檔案 | 行 |
| --- | --- |
| `routes/classes.ts` | `:522`（班級列表「即將到來」統計）、`:1961`（批次改派老師的衝堂偵測）、`:2211` `:2225`（批次調整時間：目標選取＋衝堂）、`:2649` `:2663`（批次恢復課堂：同上） |
| `routes/sessions.ts` | `:933` `:1899` `:2078` `:2088` `:2429` `:2662` `:2677` `:3077` `:3092` |
| `routes/staff.ts` | `:1464` |

每一處今天篩掉的只有 `cancelled`。開始寫 `completed` 之後，**已完成的課會從這 16 條
查詢裡消失** —— 對「未來時段的衝堂偵測」而言合理，對統計與批次選取而言是靜默的語意
改變（數字變小，沒有任何東西會紅）。

`classes.ts:2251` 與 `:2471` 另有 `if (target.status !== 'scheduled') skip` 的同形判斷。

### (ii) `.neq('status', 'completed')` —— 今天是空條件，那天起才第一次作用

- `routes/classes.ts:2896`（班級層批次停課）
- `routes/courses.ts:459`（課程層批次停課）

兩處的本意是「取消未來課堂時排除已完成的」。**在今天的資料下一筆都篩不掉**，所以
**它們從來沒有被執行過，也從來沒有被驗證過**。

### (iii) `domain/session-assignment/session-operation-guard.ts:39`

```ts
if (session.status === 'completed') { throw new SessionCompletedError(); }
```

**今天永遠不會觸發。** 開始寫 `completed` 之後，調課／代課／指派老師會開始對已完成的
課丟錯 —— 那是本意，但同樣**從來沒有在真實資料上跑過**。

### (iv) 前端：已完成狀態的顯示分支也是死碼

`grep` 只查 `apps/api` 會漏掉這一層（#488 的報告就漏了）：

| 位置 | 內容 |
| --- | --- |
| `sessions/components/session-list/session-list.component.ts:122/129` | 「已完成」標籤與 `done` 圖示 —— 檔案裡 `:164` 的註解自己寫明這是死碼 |
| `sessions/dialogs/session-detail-dialog/…:44/53` | 同上 |
| `parent/pages/attendance/attendance.util.ts:30` | `SESSION_STATUS_CHIP` 的 `completed` 欄 |
| `admin/pages/dashboard/dashboard.util.ts:45`、`sessions.page.ts:663` | `statuses: ['scheduled','completed']` —— 已經把 `completed` 當正常值送出去 |
| `core/classes.service.ts:40` | 還留著「待老師點名功能完成後，改為依據 `status='completed'` 判斷」的 TODO |

API 側對應的預設值在 `routes/attendance.ts:1002` 與 `routes/sessions.ts:849`
（`?? ['scheduled','completed']`）。**這些預設今天就把 `completed` 算進來了**，
所以寫入開始的那天它們不會變 —— 會變的是 (i) 那 16 處。

## 誰負責寫入 `completed`：三個答案，三種失敗模式（**現階段不做**）

| 寫入時機 | 失敗模式 |
| --- | --- |
| 點名完成時寫 | **沒點名的課永遠不會 `completed`** —— 而「老師忘了點名」是這個系統最常見的狀態（儀表板有一整張「未點名課堂」的卡片） |
| 結束時間過了就寫 | 需要**一個會跑的東西**（cron／排程／懶寫入）。這個 repo **沒有任何排程**寫課堂狀態 |
| 查詢時懶算 | 那就不是欄位是 computed，等於維持現況再包一層，而且每個呼叫端各自算一次 —— 那正是 `checkClassesPastSessions()` 當初被收斂掉的問題 |

**判定「時間過了」的邏輯已經存在**：`lib/session-end-time.ts` 的
`hasSessionEndedByNow()`（含時刻的絕對瞬間，顯式 `+08:00`，處理「今晚的課早上不算
結束」「沒有結束時間就等這天過完」「跨午夜」三個邊界）。前端有一份逐案一致的雙胞胎
`session-time.util.ts` 的 `hasSessionEnded()`。**缺的只是觸發器，不是判定。**

計畫席 2026-09-13 的裁定：**現階段不做** —— 三個答案各有失敗模式，等真的有排程需求
再開。

## 刪除守門為什麼是 `OR`，不是替換（#762）

`lib/class-past-sessions.ts` 的 `checkClassesPastSessions()` 是「這個班有沒有歷史
課堂」的**唯一定義**，三個呼叫端共用（列表顯示、批次刪除守門、單筆刪除守門）。

| 條件 | 漏掉什麼 |
| --- | --- |
| 只有 `session_date < 今天` | **今天稍早已上完並點過名的課** —— 那個班今天一整天被視為沒有歷史課堂，可以被刪掉，報名與出勤紀錄跟著級聯 |
| 只有 `status = 'completed'` | **過去日期但從沒點名的課** —— 因為沒有寫入路徑，這等於把「所有歷史課堂」全部放行。那是「本來擋著的變成不擋」，比上一格危險，而且那正是最可能有排課錯誤、最需要保留證據的班 |

所以是 `session_date.lt.<台北今天>,status.eq.completed` 包在同一個 `.or()` 裡。

**兩半的效力各自實測過**（2026-09-13，本機 PostgREST，唯讀）：把日期門檻挪到
`2026-07-01` 模擬「日期不夠舊但已點名」的課，全庫 `date < 門檻` 是 **2** 筆、
加上 `OR completed` 是 **60** 筆；門檻設 `1900-01-01`＋不存在的 status 回 **0**
（證明 `or=` 不會退化成「回全部」），班級條件改成不存在的 uuid 回 **0**
（證明 `class_id` 與 `or=` 是 AND 不是 OR）。

⚠️ **`class-past-sessions.spec.ts` 的替身不求值** —— 它釘的是查詢條件的逐字形狀，
擋得住「條件被改錯／被拿掉」，擋不住「PostgREST 對這個字串的解讀跟我們以為的不同」。
後者靠上面那組實測，不靠測試。

## 開始寫 `completed` 那天要做的事

1. 先決定寫入時機（上表三選一），**因為 (i) 與 (ii) 的行為完全被它決定**
2. 把 (ii) 的兩處與 (iii) 的守衛**當成新功能驗一次** —— 它們從來沒跑過
3. 把 (i) 的 16 處逐處判斷：要的是「未停課」還是「未完成」，**今天這兩個意思相同，
   那天起不同**
4. 處理本機那 60 筆沒有來源的 `completed`：要嘛寫進 `seed.sql` 讓它可重現，要嘛
   確認它是誤操作並在下次 reset 後不要再造

## 相關

- `lib/class-past-sessions.ts` —— 唯一定義，檔頭寫了為什麼收斂成一份
- `lib/session-end-time.ts` / `session-time.util.ts` —— 「時間過了」的現成判定
- `domain/session-assignment/session-operation-guard.ts` —— 等 `completed` 的守衛
- issue #488（影響半徑報告）、#762（`OR` 修法）
