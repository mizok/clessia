# labor-7 席 charter（通用執行席）

> **開席日 2026-09-13。這是開席時建的樁，不是退場蒸餾** —— 照 labor-4 / labor-5 的
> 先例，真正的知識在退場前補。**這一頁只放「別處沒有的」**：量測方法看
> [`kb/wiki/specs/sitemap/README.md`](../kb/wiki/specs/sitemap/README.md)，
> 團隊通則看 [`README.md`](README.md)，前兩任的坑看
> [`labor-4.md`](labor-4.md) / [`labor-5.md`](labor-5.md)。

## 這一輪的佇列

1. **#762** `checkClassesPastSessions()` 改 `OR` + `kb/wiki/rules/session-status-rules.md`
2. **#756** 整站 UI 地圖的 public 6 + parent 12 + teacher 5（方法照 labor-6 的 #765）
3. **#760** 載入中／錯誤狀態（要停 8787，開始前跟 labor-6 對時間）

## 一、驗 PostgREST 查詢語意：唯讀、不造資料、用「已知不同」的對照組

#762 要證明 `.or('session_date.lt.X,status.eq.completed')` 真的是
`class_id IN (...) AND (date < X OR status = completed)`。**單元測試的替身不求值**
（本 repo 每支 spec 各寫一份假 supabase，沒有一份會套用條件），所以那一層只釘得住
「條件的逐字形狀」。

**直接打本機 PostgREST 就能驗，零寫入**：

```sh
set -a; . <主 checkout>/apps/api/.dev.vars; set +a   # DATABASE_URL / SUPABASE_SECRET_KEY 都在這
curl -s -o /dev/null -D - "$SUPABASE_URL/rest/v1/sessions?select=id&<條件>" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Prefer: count=exact" -H "Range: 0-0" | grep -i '^content-range'
```

**對照組要挑「已知會不同」的**（README 那條「兩邊一樣可能是比較分不出來」）：

| 對照                                    | 證明什麼                      |
| --------------------------------------- | ----------------------------- |
| 兩半條件都改成不可能命中 → 應回 `0`     | `or=` 不會退化成「回全部」    |
| `class_id` 換成不存在的 uuid → 應回 `0` | `class_id` 與 `or=` 是 **AND**|
| 日期門檻往前挪，看筆數從 2 跳到 60      | `OR` 真的多抓到已完成的那批   |

**第三列是關鍵**：本機沒有「今天且 `completed`」的課堂可以當 fixture，而**零寫入鐵律
不准造一筆**。把門檻往前挪是等價的唯讀替代 —— 「日期不夠舊但已點名」跟「今天已點名」
在查詢上是同一個形狀。

## 二、替身缺一個方法時，修前的紅是**編譯的紅**，證明不了行為

寫 #762 的測試時第一版把替身的 `lt` 拿掉、只留 `or`。修前那一跑確實紅了 ——
**紅在 `lt is not a function`**，也就是 labor-2.md 第 7 條那個「編譯失敗的紅 vs
斷言的紅」。**那個紅只證明我換了替身的介面，證明不了條件錯。**

處置：**兩個方法都留著並各自記錄**，斷言「`orArgs` 有東西且 `ltArgs` 是空的」。
修前於是紅在 `AssertionError`，而那才是行為的紅。

**可操作版本**：拿掉替身的某個方法來製造修前紅時，先問「這一紅是斷言給的嗎」。

## 三、工單裡的歸因也要當前提驗

#762 寫「本機 DB 已有 60 筆 completed（**seed 寫的**），可直接當 fixture」。
`grep -c completed supabase/seed.sql` → **0**。原始報告 #488 明確查過這件事並寫著
「不在任何進版控的檔案裡」，**括號裡那三個字是轉述時加上的**。

沒有造成傷害（那 60 筆確實存在、確實能當 fixture），但**如果我照著它去 `db:reset`
再驗一次，fixture 會整批消失而我會以為是自己弄壞的**。

這是 README「轉述時證據等級不會自己跟過來」的又一個實例，方向是**歸因**而不是強度。

## 四、給下一個接手的人

- **本機 supabase 在跑**（54321 PostgREST / 54322 Postgres，Docker）。`DATABASE_URL`
  與 service key 在**主 checkout** 的 `apps/api/.dev.vars`（每個 worktree 一份，
  新 worktree 沒有）
- **8787 是別席的**（2026-09-13 是 labor-6）。要停它之前先對時間
- `npm ci` 在這個 worktree 跑過（root + `apps/api` 各一次）
