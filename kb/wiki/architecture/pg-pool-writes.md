---
title: 經過 pg 連線池寫入
summary: PostgREST 一次請求一個交易，要「全有或全無」的多步寫入只能走 auth.pool 的交易（repo 不引入 RPC）。規則：只在多步寫入必須原子時用；用 withTx 包；只用參數化 SQL 且每句帶 org_id；範圍判斷在交易裡用 FOR UPDATE 重做；23503 → 409、其他 → 500；池不在就 500，不退回沒有交易的舊寫法。第一個用的是刪班級（#1652）。
category: architecture
status: active
updated: 2026-10-28
tags: [architecture, database, transaction, authorization]
---

# 經過 pg 連線池寫入

> 2026-10-16，#1652（刪班級沒有交易，最後一步失敗時課堂與報名已經刪掉）。
> 計畫席 gate 的六個條件之一：第一次經過池寫入，要把規則寫下來。

## 為什麼有這條路

API 平常用 supabase-js，走 PostgREST：**一個 HTTP 請求就是一個交易**。多步寫入
（先刪報名、再刪班級）是多個請求，中間任何一步失敗，前面的已經生效。

可選的路與它們為什麼不行：

| 路                                    | 為什麼不走                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plpgsql 函式（RPC）                   | 計畫席 2026-09-06 裁定 repo 不引入 RPC：函式跑在 service role 底下，等於把授權搬到 middleware 下面一層（c1）。見 `apps/api/src/routes/sessions.ts` 的 makeup 段註解 |
| 改 FK 成 CASCADE                      | 拿掉 RESTRICT 這張安全網，別的路徑會連坐刪掉不該刪的（#1652 的 C 案）                                                                                               |
| 補償式（先寫 A，B 失敗就把 A 改回去） | 可行但每條路徑要自己設計失敗態；`sessions.ts` 的 makeup 就是這樣做的。能用交易時不要選它                                                                            |

Better Auth 每個請求本來就建一個 `pg` 池（`getAuth(c).pool`，正式站經 Hyperdrive，
生命週期見 [[architecture/auth-pool-lifecycle]]），身分查詢已經用它讀（`lib/identity-sql.ts`）。
寫入用同一個池，不另開連線。

## 規則

1. **只在「多步寫入必須全有或全無」時用。** 單句寫入照舊走 supabase-js —— PostgREST
   那一句本身就是交易，改走池只是多一套寫法。
   **第二個正當理由是 subrequest 額度**（#1661 推播排程）：免費方案一次 Cron 只有 50 個 subrequest，
   supabase-js 走 HTTP、每句都算一個；pg 走 Hyperdrive 不算。這種情況用池讀寫，但未必需要交易。
2. **用 `withTx(pool, fn)` 包**（`apps/api/src/lib/pg-tx.ts`）：BEGIN → fn → COMMIT；
   fn 丟例外就 ROLLBACK 後原樣丟出；ROLLBACK 也失敗（連線壞了）就 `release(err)`
   讓池丟掉那條連線。不要自己手寫 BEGIN／COMMIT。
3. **只用參數化 SQL，每一句都帶 `org_id = $n`**（c1）。授權仍然發生在 Hono 這一層 ——
   SQL 字串在路由／lib 裡、org 從 context 來，不是交給資料庫自己判斷。
4. **範圍判斷在交易裡重做**：交易一開始用 `SELECT … FOR UPDATE` 鎖住要動的那幾列，
   同時確認在 org 內、在 campusScope 內；不符就整批 not-found（範圍外跟不存在一樣回 404）。
   交易外先查的結果只能拿來顯示（例如稽核要的名字），不能當權威 —— 中間可能被改掉。
   鎖父列也擋住併發：別人插入子列時的 FK 檢查要等這把鎖。
5. **守門也在交易裡**，跟刪除用同一份資料。同一件事的單筆與批次路徑共用同一支函式，
   授權與守門規則只能有一份。
6. **錯誤對成 HTTP**：

   | 情況                              | 回                                                     |
   | --------------------------------- | ------------------------------------------------------ |
   | 範圍不符                          | 404（ROLLBACK 前什麼都沒寫）                           |
   | 業務守門擋下                      | 409 + 具體 code（例如 `HAS_INVOICE_ITEMS`）            |
   | FK 違反（23503，`isFkViolation`） | 409 `IN_USE`，整筆已回滾                               |
   | 其他例外                          | 500，整筆已回滾；**不要折成 404**（#1651 的教訓）      |
   | `getAuth(c).pool` 不在            | 500。**不能退回沒有交易的舊寫法** —— 那條就是 bug 本身 |

7. **交易裡不做對外 I/O**（#1661）：fetch 第三方服務期間交易開著，對方一慢，交易與它握的鎖就跟著拖；
   正式 DB 有沒有 `idle_in_transaction_session_timeout` 之類的逾時也不該由程式碼去賭。要「先佔住、再對外、再回寫」時，
   拆成**短交易認領**（`FOR UPDATE SKIP LOCKED`＋在列上留認領記號）→ **交易外**對外呼叫（每次都帶逾時）→ **短交易回寫**。
   範本：`apps/api/src/lib/push-run.ts`；契約測試在對外呼叫的當下用另一條連線 `FOR UPDATE NOWAIT` 證明鎖已經放了。
8. **要有契約測試對真 Postgres**（`apps/api/src/contract/*.contract.ts`，CI 的 api-contract job 跑）。
   SQL 語意（org 條件、FOR UPDATE、FK）替身驗不出來；替身只驗交易形狀（BEGIN／ROLLBACK／release）。
   契約測試自己建資料、自己清，不碰 seed。

## 讀取也走池：列表的一次往返（#1595 P2）

寫入之外，**慢的列表**也走池：PostgREST 每支 100ms 以上，而且多半慢在往返，不在 DB。目前有 `/api/courses`
（`lib/course-list-sql.ts`，#1933）和 `/api/staff`（`lib/staff-list-sql.ts`）。模式：

1. **SQL 在 lib、池是主路徑，失敗就退回原本的 query builder**：拋錯、超量、結果形狀不對都回 `null`，
   不用猜的值。builder 留著，所以兩份條件會並存。
2. **授權條件由 TS 算一次再傳進去**（例：`campusFilterIds` 的結果）。`null`＝不篩、空陣列＝零筆。
3. **契約逐欄比對兩條路**（`contract/*-list.contract.ts`）：有 pool 走 SQL、pool 拋錯走 builder，各種範圍與篩選下
   回應要逐字相同，另外建一個別的 org 來抓漏寫的 `org_id`。改之前先錄一份 builder 的回應當基準。
4. **只回原料，計數規則留在 TS**（staff）：SQL 回 builder 拿到的那些列，摘要照用同一組 TS 函式。

這次學到的兩件事：

- **排序要有唯一末鍵**。seed 的 99 位人員 `created_at` 全部相同，只按時間排的話，兩條路（甚至同一條路的兩次）
  順序都不固定，沒辦法逐欄比對；人員各關聯的陣列也一樣。兩邊都補 `id`。
- **builder 本來就會撞 URL 上限**：多分校範圍加角色篩選時，章節 head count 要同時帶約 260 個 uuid，結果 414
  → 500（#1928 同一類，supabase-js 給的是空訊息）。SQL 那條沒有 URL。契約把這種題單獨列出來，再用獨立 SQL
  驗它的數字。

## 誰在用

`grep -rn withTx apps/api/src` —— 不在這裡手抄（c11）。第一個是刪班級（#1652）。
