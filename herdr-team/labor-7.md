# labor-7 席 charter（通用執行席）

> **開席日 2026-09-13。** 第一輪（#762 → #756 的 public 6 + parent 12）做完後蒸餾過一次，
> **下面第五節以後是那一輪的產物**。**這一頁只放「別處沒有的」**：量測方法看
> [`kb/wiki/specs/sitemap/README.md`](../kb/wiki/specs/sitemap/README.md)，
> 團隊通則看 [`README.md`](README.md)，前兩任的坑看
> [`labor-4.md`](labor-4.md) / [`labor-5.md`](labor-5.md)。

## 佇列怎麼查（不寫快照，快照明天就是假的）

```sh
gh issue list --label seat:labor-7 --state open
gh pr list --state open --search "labor-7"     # 共用 GitHub 帳號，要用分支名或標題過濾
```

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

## 四、跨席協調：claude-peers 會雙向靜默失效

**2026-09-13 與 labor-6 之間，兩個方向都沒送到，而兩邊的工具都回 `success`。**

我送出**四則**，每一則 `mcp__claude-peers__send_message` 都回
`Message sent to peer u25ikw25`；它送我的 A/B/C 排班提議我**一則都沒收到**
（`check_messages` 一直回 `No new messages`）。**兩邊都以為自己送到了，兩邊都在等對方。**

> 這是團隊 README「寫在自己 pane 上的字別人看不到」的機器版，**但更難察覺**：
> 那一條至少沒有任何東西跟你說「送出成功」。

**處置**：跨席協調**不要靠 claude-peers 當唯一通道**。我最後是靠計畫席把訊息轉進終端才知道對方在等。
**回別席的話同時寫進自己的終端輸出**，讓計畫席看得到 —— 那是這個團隊實際上可靠的第二通道。

## 五、兩席獨立做出同一件事時，怎麼收（2026-09-13 實例）

限速停機 90 分鐘期間，labor-6 的 #768 合進 main，**獨立發現了我正在修的同一族取樣器缺口**，
而且修法更強（真的 `scrollIntoView` 再測，而我只判「捲得到就算可見」）。

照通則「**誰先開 PR**」切，我把自己那版**整支撤掉**，方法頁以 main 為準。
**但那條通則的後半才是重點：「要比對一次有沒有獨有的正確性」。** 比對之後：

| 我發現的 | 對方有沒有涵蓋 | 處置 |
| --- | --- | --- |
| 垂直捲動容器不是視窗 | 有 | 撤 |
| 水平捲動容器 | 有（`inline:'center'` + `scroller()` 含橫向） | 撤 |
| 被 `fixed` 底欄壓住 ≠ 看不到 | 有 | 撤 |
| **焦點環在這個環境量不到** | **沒有** | **保留** |

**撤掉之後還有一步：用對方的版本重驗自己已經量到的數字。**
我九頁一頁都沒變，但**不驗就不知道** —— 交付用被取代的方法量出來的數字，
跟交付一個沒驗過的數字是同一件事。

## 六、接手一份「已經被別人驗過」的工具時，先找它的歸因句

**方法頁裡最值錢的一句話，通常是寫著「這是量測限制」的那一句。**

#768 記著「`/admin/courses` 390 量到 19/20，少的那一顆是量測位置造成的」。
我在另一頁撞到**逐字同形**的 19/20，追下去是濾網自己的洞（`inView()` 拿 `innerHeight`
當可視區，而內容區只到底欄上緣；底欄是 `position: static` 所以 `fixed`/`sticky` 的
例外判定整條落空）。

> **「量測限制」這四個字的作用跟「沒事」一樣：它會終止調查。**
> 而它比「沒事」更難質疑，因為**它已經承認有問題了**，只是把問題歸給環境。

**可操作**：讀別人的方法頁時，把「這是環境／量測造成的」那幾句**當成待驗清單**，
不是當成結論。驗法就是拿一個**同形的第二實例**去撞 —— 同一個機制會在別的頁面重現，
歸因錯的那些不會。

## 七、給下一個接手的人

**這一席交接時的未完成項**（狀態，會過期，自己查）：

- **teacher 5 頁只做了 3 頁**（`index` / `dashboard` / `schedule`），
  `notifications` 與 `students` 沒做 —— 卡在瀏覽器輪值，等 labor-6 收完 admin
- **#760 要停 8787，而 8787 不是任何席位的** ——
  `lsof -p <pid> -a -d cwd` 查到它的 cwd 是**主 checkout 的 `apps/api`**。
  上任提示寫的「跟 labor-6 對時間」是錯的前提。**共享資源關掉要經過計畫席**（README 那條）
- **`kb/wiki/index.md` 落後 68 頁**（`Total: 123` 而實際 191）。
  `kb:map` 全量重建會一次補進來，但那批索引屬於別席在飛的 PR ——
  **需要一支專門的 PR，等 #756 那批全合完最省事**

**登入身分的競爭沒有結構解，只能縮短窗口**：
`environment.ts` 的 `apiUrl` 寫死 `http://localhost:8787`，所以**換 host 也分不開 cookie**
（我試過 `127.0.0.1`：cookie 綁的是 API 的 host，不是 web 的）。
`list_connected_browsers` 只有一個瀏覽器，也沒有第二個 profile 可用。
**做法是把每一輪量測壓短、前後各打一次 `GET /api/me`，被踢就作廢重做那一輪。**
