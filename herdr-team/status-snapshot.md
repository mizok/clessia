# 計畫席狀態快照

> # 📌 上一版這裡有一段「明早第一件事」，我刪掉了 —— 它沒有執行者
>
> 那段要「先跑 #488 留言裡的兩段唯讀 SQL 再打開任何頁面」，理由是時效（每開一次課表
> 就補建 event，數字變小）。**但那兩段要在正式站跑，而沒有任何一席有正式 DB 存取** ——
> 寫它的 labor-4 自己在 #488 裡逐字寫著「我沒有驗證過它，我跑不了正式站」。#488 現已 CLOSED。
>
> **它撐了好幾天是因為它把注意力全放在「什麼時候跑」**，於是每個讀到的人都在算來不來得及，
> 沒有人問誰跑得動。診斷與四個消費者寫進 #495 了。
>
> **可操作：交接文件裡寫「必須在 X 之前做完」的事項，同一行要寫執行者。
> 沒有執行者的期限不是期限，是一段每天被重讀一次的焦慮。**


> 額度逼近或輪替時落檔。**任何 session（含復活的計畫席）接手先讀這裡**，
> 然後 `gh issue list --state open` 與 `gh pr list --state open` 現查 ——
> **本檔記的是「為什麼」，不是「還剩什麼」**。狀態一律用查的。
>
> 最後更新：**2026-09-06 台北 23:2x**（review-steward 補紅燈那節；本體由計畫席 clessia-48 寫於同日 23:21）
>
> ⚠️ 上一版這一行寫「台北 16:5x」，而寫它的 commit `d79ae905` 是 **23:21:51+08:00** ——
> **漂了六個半小時**，就漂在「接手第一件事：報時間一律實跑」的正上方。
> 沒有害到人是因為它旁邊就是那條規則；**但那條規則救不了寫它的人自己。**

## 🚀 線上是哪一版（2026-09-30 13:0x 部署，labor-reviewer）

**截線 `1a57db88`**：web `main-M67JFMAA.js`、api `7cd80d82`、**正式 DB 套到 `20260913143909`**
（跨部署紀錄在 `herdr-team/review-steward.md` 的截線表，那張表現在三欄都對得上實測）。
截線後 main 累積的請現查 `git rev-list --count 1a57db88..origin/main`；截至 14:4x 是 7 筆，
只有 #904（餐費／催繳稽核接線）是 api 行為，其餘 doc / seed。**部署窗口由計畫席叫。**

⓪ 現在分兩類（#905 起）：**schema migration 套完才部署；data backfill 部署完才套；分不出來當 schema。**

## 📋 給使用者：等你的三件（2026-09-30 **14:4x**，計畫席 labor-plan-20260913-1211 交接前重寫）

> 狀態一律現查：`gh issue list --state open --label blocked`、`gh pr list --state open`。

### 1. #898 —— 帳單建立後既刪不掉也作廢不掉：**「作廢 vs 刪除」要你裁一句**

`status` enum 只有 `unpaid | partial | paid`、零 DELETE 路由（計畫席開檔驗過）。金流紀錄通常該作廢不該刪
（審計軌跡），但那是產品決定；決了才開設計（碰 enum = migration、碰合計 = 金額路徑 → 【保留類】）。

### 2. #911 —— 公告三顆寫入零稽核，**要先加 CHECK 值（migration）**

`announcement` 不在 `resource_type` CHECK 也不在 TS union。分兩支：migration 一支（保留類，你親合＋親自套正式 DB，
schema 類 → **套完才部署**）、接線一支。建議只記「發佈」、不記「標記已讀」。

### 3. 排程決策（不急，17 天前就問了）

**#758 剩第 8–9 輪（15 顆）做完之後，全隊要不要轉 P4 家長端？** roadmap：11 頁空殼是產品價值所在。要決的是什麼時候切。

## 今日紀錄（2026-09-30，復工日）

- **合了 20+ 支**（含使用者親合 #836、#882、#884），部署 1 次，正式 DB 套 1 支 backfill（使用者驗 `parents_missing_role = 0`）。
- **修掉三支會壞 showcase 的**：#886 登錄過成績的考試刪不掉（#893：清空分數後儲存 = 刪那一列）、
  **#907 本機 demo「記錄收款」必然失敗**（seed 自算收據號繞過 `receipt_counters`，#909 修 seed）、#877 UI 建的家長沒角色（#882 + #884）。
- **#758 到 64/106**；第 8–9 輪不是 5 顆是 **15 顆**（`_shared` 十個共用元件一顆沒按過，`parent-form-dialog` 連頁都沒有），預期表在 `docs/758-round8-9-prep`。
- **兩次額度斷線**（13:0x–14:1x 的 17 天前那次不算；今天 13:35–14:4x 一次）。復工三席把回報**印在 pane 沒送出**，
  一席**送到一半斷線**（12:54，`API Error … mid-response`）—— 監工 charter 現在分兩列處置（#903）。
- **seed 依日期產生**：`seed-demo.sql:1044` 的「聯絡簿缺漏示範生」只在當天有聯絡簿課的日子才建 → `students` 68/69 都對；
  db-reset charter 憑證表不再寫死筆數（#899）。
- **導航員 charter 三份逐字同一句假話**（「api 沒有 test target」）—— #900 修三支；README 加「同一模具壓出來的錯誤，複本一致反而更像佐證」（#902）。
- **Chrome 擴充機器層斷線一次**（`Browser extension is not connected`），只有使用者能重連；線上驗證（#867）要**使用者親自登入 demo 留 session**，席位不該在非 localhost 走 LINE OAuth。

### 兩件只存在於訊息裡、沒有進任何檔案的

1. **`:8787` 現在是 `labor-20260913-1222` 自己起的 dev server**（主 checkout 那支停工期間沒了），跑 `f9656aca`+；別席若以為 8787 是主 checkout 的會判斷錯。
2. **痕跡制文件讓 `grep -c` 驗「假話清光了沒」反向失效**（每清一句就永久 +1 命中，reviewer 在 #902 留言）—— 還沒進 README，跟下面「接手第一件事」第 6 條那句訂正一起，下一次 README 批次落檔。

## main 的 verify 判準（**2026-09-13 12:5x 複查：那批 `cancelled` 已經清空了**）

**上一版這一節寫的是「`gh run list` 現在會顯示一批 `cancelled`，而那不是故障」。那個狀態已經不成立** ——
`#603`（`cancel-in-progress: false`）只做了一半，補完在 **`#613`（group 帶 `github.sha`）**，
它於 **2026-09-06 21:02 已合**。實測（12:5x）：

```
gh run list --workflow verify.yml --branch main --limit 40 --json conclusion \
  --jq 'group_by(.conclusion)|map("\(.[0].conclusion // "running")=\(length)")|join(" ")'
→ success=38  running=2      （回溯到 2026-09-13 00:07，零 cancelled）
```

**所以 main 的 verify 現在讀起來就是字面意思。** 下面留的是**判準**，不是狀態 ——
它在 `cancelled` 再次出現時（改 concurrency、加 workflow、或 GitHub 那邊改行為）還會用到。

### `cancelled` 有兩種，而它們在 `gh run list` 上長得一模一樣

| | `jobs` 長度 | 意思 |
| --- | --- | --- |
| 跑到一半被殺 | **非 0** | 它真的跑過，只是沒跑完 |
| 從頭到尾沒開始 | **0** | 它在排隊時就被丟掉，**一行 log 都沒有** |

**判定一顆 run 有沒有被驗證，要看 `jobs` 長度，不是 `conclusion`。**

```bash
gh run view <run-id> --json jobs --jq '.jobs | length'
gh run list --workflow verify.yml --branch main   # 一定要加 --workflow,否則 smoke 的成功會混進來
```

**這個判準第一次用就改變了結論**（2026-09-07 那批）：最近 30 顆 main 的 verify ——
success 7、cancelled(jobs=2) 15、cancelled(jobs=0) 7、running 1。**30 顆只有 7 顆真的跑完**，
其中 7 顆連一個 job 都沒起過。只看 `conclusion` 的話，那 22 顆跟「有結論」在列表上沒有差別。

> **嚴重度要講準**：那 22 顆的**程式碼**多數驗過了 —— 在 PR head 上驗的。
> 沒驗到的是 **squash 之後的 main 本身**（「這支 PR 跟同時段合進來的其他 PR 併在一起還成不成立」）。
> **風險不是「程式碼沒驗過」，是「它們互相之間沒驗過，而且壞了沒辦法二分」。**

> **⚠️ `cancel-in-progress: false` 不等於「不會取消」**（#603 只做了一半的成因）：
> 它的語意是「不要殺**正在跑**的那顆」，後來的 run 會**排隊**在同一個 group 上，
> 而**同一個 group 最多只留一顆排隊中的** —— 第三顆一到，中間排隊的就被丟掉。
> 行為只是從「新的殺舊的」變成「最舊的活著跑完、中間排隊的被丟掉」。
> **修法是讓每顆 commit 各自一個 group**（group 帶 `github.sha`）。

## 接手第一件事（2026-09-30 **14:4x**，計畫席 labor-plan-20260913-1211 交接前重寫）

1. `TZ=Asia/Taipei date` —— 報時間一律實跑。
2. `herdr agent list` + 每席 Ctx（監工的 `ctx()`）—— **不要用 issue 板推論席位活動；席位死掉也不會讓 issue 板變樣。**
3. `gh pr list --state open` —— 非保留類 CI 綠由計畫席收或授權 `labor-reviewer`（合前 `behind` + 檔案交集 + `merge-tree`；**交集非空不等於要作者 rebase，驗語意衝突就好，否則快節奏的板會鎖死**；**零衝突也要讀 —— 它對「你的改動有沒有讓對方那段話變成假的」一無所知**）。保留類三類只有使用者能合。
4. 讀 README 開頭的**閱讀導引**（新席 200 行、計畫席 500 行、其餘 grep），再讀「席位復活程序」「共享資源協定」「計畫席消失時怎麼辦」。
5. 心跳：launchd 每 30 分鐘 prompt 計畫席與監工；**腳本在 `~/.local/bin/clessia-heartbeat.sh`，計畫席名寫死在裡面，改它會被 auto-mode 擋（`Unauthorized Persistence`）→ 輪替時請使用者改**；暫停用 `touch ~/.local/share/clessia-heartbeat.pause`（這個不會被擋）。
6. **兩支 Monitor 掛在計畫席 session 上，且每 30 分鐘到期要重掛**（`persistent: true` 現在不持久）；**腳本放 scratchpad 活不過一次長假（/tmp 會被清）—— 2026-09-30 訂正：要點已經落檔在 README「席位復活程序」節底下的「兩支 Monitor 的腳本要點」，重寫照那幾條走（含一條先前沒寫下來的：idle 監看必須排除 labor-plan / db-reset / reviewer / ops-warden，否則每 30 分鐘 20 則）**。
7. **跨席訊息一律寫檔再 `"$(cat 檔)"`** —— 反引號在雙引號裡會被執行、單引號會被吃掉，今天各踩兩次。`--wait --until working` 對已在 working 的席位回假 timeout，驗送達讀對方 pane 找**原文**（不是自己的摘要）。
8. **席位回報只印在 pane 沒送出**是長假後的集體退化（三席同時）；判斷看**輸出區**，輸入框那句永遠是建議提示殘影，**不構成任何送達判斷**（兩個方向都不能推）。

### 席位（2026-09-30 14:4x）

| 席 | 在做 | 備註 |
| --- | --- | --- |
| `labor-20260913-1134` | **#867** 四條線上驗證（使用者已在 Chrome 登入 demo，席位接著點） | 持瀏覽器；做完交回 1222。Ctx 64% |
| `labor-20260913-1222` | #758 第 8–9 輪 15 顆，預期表已推 | 等瀏覽器＋一次 reset；`:8787` 是它的。Ctx 51% |
| `labor-db-reset` | 開「容器重啟階段 CLI 錯誤不構成 reset 失敗」charter PR | 只接計畫席請求；DB 停在 RESET #6 + 1 筆 #907 驗證收款 |
| `labor-reviewer` | 待命，板空 | 部署 ⓪ 分 schema/backfill；下一批只有 #904 是 api 行為 |
| `labor-ops-warden` | 巡檢；每輪量計畫席 Ctx，≥80% 觸發交接 | 孤兒 seat 掃描、截斷掃描 |

**已退場**：`labor-8`、`labor-9`、`usability-admin`、`clessia-c8`。**模型**：計畫席一律 Fable；生產席依任務 Sonnet/Opus（使用者 09-13 裁）。

### UI 地圖現況

Phase 1 ✅；2-A 響應式 ✅（#848 之後 390 版面歸零）；2-C 權限 ✅；2-D 載入／錯誤 ✅；**2-B 寫入實按 #758 64/106，剩第 8–9 輪 15 顆**（`_shared` 十顆從沒按過）。方法頁 `kb/wiki/specs/sitemap/README.md` 14 個坑。

### 今天學到、下一任會再用到的

- **seed 用 SQL 抄捷徑就繞過產品維持不變量的東西**，兩個方向：#877 讓斷的路徑看起來通、#907 讓好的路徑看起來壞。**在 seed 資料上點永遠不會發現。**
- **可回收性住在端點的前置檢查與缺席的端點裡**（`HAS_SCORES` #886、`invoices` 零 DELETE #898、`class-logs.publish` 無 unpublish）—— 按之前先讀。
- **「沒有 X」是比「X 在這裡」強得多的斷言**：導航員回來一句零命中，自己換一個 pattern 再跑一次（#895 / #897）。grep 字串 ≠ grep 賦值（我今天把 `seed.sql` 的註解當成賦值）。
- **筆數量不到狀態**（reopen／停用／清空在筆數上跟沒變一樣）—— 殘留清單有狀態改變的項目要連欄位一起給（#910）。
- **backfill 的正確性判準是「它要補的集合空了」，不是「SQL 沒報錯」**（#906）。

## 今天證實的三個環境限制（會讓你誤判）

1. **本機 DB 可能落後 migration** —— 錯誤訊息（`column … does not exist`）跟真的欄位被 DROP **一模一樣**。手動驗證前先 `supabase migration list`。
2. **MCP 瀏覽器沒有真的 device emulation** —— `matchMedia('(pointer: coarse)')` 永遠是 false。繞道法在 design-web charter 坑 34。
3. **瀏覽器 session 是共享的機器狀態** —— 換身分要先登出，會踢掉別席。三席今天各撞一次。權宜做法：**資料連通性用 API 驗，畫面才用瀏覽器**。

## 判準：斷言裡出現第二次 `Date.now()`，就是把時序寫進期望值了

> **這一節的「紅燈」部分已經不成立** —— 那支 flake 由 **`0f5f6599`（#621）** 修掉了
> （2026-09-13 12:5x 複查：測試現在錨在**存進去的那個值**上，`hasReloadBeenAttempted(at + W - 1)`，
> 而不是 `Date.now() + W - 1`；實作的 `hasReloadBeenAttempted(now = Date.now())` 收可注入的 `now`）。
> **判準留著，因為它會在下一支同型的測試上再次成立。**

原本的形狀（`apps/web/src/app/core/chunk-recovery.spec.ts`）：

| 位置 | 做什麼 |
| --- | --- |
| `markReloadAttempted()` | 存 `at = Date.now()` — 記為 `T0` |
| 測試斷言 | `hasReloadBeenAttempted(Date.now() + RELOAD_WINDOW_MS - 1)` — 那個 `Date.now()` 是 `T1 ≥ T0` |
| 實作 | `return now - at < RELOAD_WINDOW_MS` |

代進去：`(T1 + W - 1) - T0 < W` → **`T1 - T0 < 1`**。
**也就是這條測試只有在兩次 `Date.now()` 落在同一毫秒時才會過。** CI 負載一高、跳過 1ms 就紅。

**隔壁那條（`+ W + 1`，期望 false）反而永遠安全**：`T1 - T0 < -1` 恆不成立 ⇒ **斷言恆真，從來不會紅**。

> **同一支檔案裡，一條恆真、一條靠運氣，而它們讀起來對稱。**
> 這是 README「測試不能用被測程式碼自己的算法當裁判」的鄰居，但更薄一層：
> 它連算法都沒共用，只是**把期望值建在第二次讀時鐘上**。
>
> **修法**：`now` 一律錨在「存進去的那個值」上（或注入 `now` / 用 fake timer）。
> **不要只把 `-1` 調成 `-2`** —— 那只是把機率壓小。
>
> **順帶**：兩條裡真正該擔心的是**恆真的那條** —— 靠運氣的那條至少會紅給你看，
> 恆真的那條**綠了多久都不代表它驗過任何東西**。

## 額度行為（今天觀察到的，不是推論）

**額度耗盡不會殺死 session。** review-steward 今天 Session 掉到 0%、出現 `/low-priority` 橫幅，
**沒有人介入，重試之後回到 49% 繼續工作**。真正會終結 session 的是 context 滿或機器重開。

## 前一任計畫席自己犯的（留給下一任，別重犯）

- **拿代理指標代替查證**，一天五次：issue 指派當席位活動、pane 動靜當工作狀態、issue 開著當未交付、板上新 PR 當某席的產出、記憶當時間。
- **開了五支前提錯誤的工單**（#427/#429/#430/#449/#450/#521），全部是「站得住腳的推導 + 沒查前提」。
- **用 `sleep` 迴圈輪詢 CI** 一整天，工具說明第一行就寫著那是被擋的、該用 Monitor。
- **裁了一條架構上不存在的機制**（「同一個 transaction」，而寫入路徑是 PostgREST over HTTP）。
- **README 自己兩條規則一條說兩點一條說三點**，害別席撞到假警報。
