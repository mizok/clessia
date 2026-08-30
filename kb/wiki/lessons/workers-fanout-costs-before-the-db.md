---
title: 並行 fan-out 在碰到資料庫之前就已經變慢了
summary: 儀表板一次打 8 支 API，量測發現「完全不碰 DB」的請求在並行 8 條時 TTFB 從 0.46s 惡化到 1.1s（2.4 倍）。Workers 的 per-request 建池模型下，fan-out 的成本在 DB 工作之前就發生了；先量再猜，別一開始就假設是查詢慢。
category: lesson
status: active
updated: 2026-08-30
tags: [lessons, performance, workers, database]
---

# 並行 fan-out 在碰到資料庫之前就已經變慢了

## 發生什麼

demo 站的管理端儀表板要 **15 秒**才把「載入中」換成內容 —— **而且是在空資料庫上**。

第一直覺是「某支查詢很慢」。但空資料庫沒有資料可以查慢，所以那個直覺一定漏了什麼。

## 量到的東西

對 `demo.clessia.cc` 量未登入的端點（`/api/me` 回 401、`/api/auth/get-session` 回 null）——
這兩條路徑**完全不碰資料庫**（better-auth 沒有 cookie 就早退）：

| 情境                               | TTFB                        |
| ---------------------------------- | --------------------------- |
| 重用連線、單發                     | **0.145s**                  |
| 新連線、單發                       | 0.45 – 1.7s（TLS 佔 0.29s） |
| **8 條並行**（模擬儀表板 fan-out） | 多數 **~1.1s**，最慢 1.88s  |
| 8 條序列對照                       | 多數 **0.46s**              |

**同樣是不碰資料庫的請求，並行 8 條時每一條都慢了 2.4 倍。**

## 教訓

**fan-out 本身有成本，而且發生在任何 DB 工作之前。** 在 Workers 上尤其如此：

- 每個請求各自建 pg Pool（跨請求共用 I/O 是被禁止的，見
  [[architecture/auth-pool-lifecycle]]），8 支並行 = 8 次對資料庫的 TCP+TLS+auth 握手
- 免費方案每個請求 10ms CPU；8 個請求在同一個 isolate 上競爭
- 這兩項都跟「資料有多少」無關 —— **所以空資料庫也一樣慢**

## 怎麼用這條教訓

1. **看到「空資料庫也慢」就別再找慢查詢。** 資料量無關的症狀要配資料量無關的原因：
   冷啟動、連線建立、每請求的固定成本、CPU 競爭。
2. **量到能分開兩件事為止。** 「重用連線 vs 新連線」與「並行 vs 序列」兩組對照，
   就把「網路／TLS」「伺服器固定成本」「併發劣化」分了開來 —— 不用猜。
3. **`forkJoin` 把最慢的那支變成全頁的速度。** 一次等 8 支的畫面，感受到的是 max 不是
   平均。願意分批渲染的話，第一塊內容可以早很多。
4. **連線埠很重要**：per-request 建池的模型下，Supabase 的
   **transaction pooler（6543）比 session pooler／直連（5432）合適** ——
   後者每條連線在 Postgres 上真的佔一個 backend，而 Workers 會同時開很多條。
   這是**部署設定**不是程式碼，但它可能是這裡最大的一塊。

## 還沒查完的

登入後的路徑沒有量到（需要 session cookie）。上面所有數字都是未登入的路徑，
也就是**不含**「session 查詢 + user_roles + staff + parents」那四支 DB 查詢的成本。
15 秒裡有多少是它們造成的，要在登入的瀏覽器裡量。

## See Also

- [[architecture/auth-pool-lifecycle]] —— 為什麼是 per-request 建池、收尾為什麼在 middleware
- [[lessons/local-green-is-not-repo-green]] —— 另一條「不要靠推論、去量」
