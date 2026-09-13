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

## 🚀 線上是哪一版（2026-09-13 09:5x 部署，labor-reviewer）

**截線 `fce7c2b6`** —— 那之後合的都還沒上線。截線就是部署當下 main 的 HEAD，
而且它的 verify 已經 `completed/success`（**不是**「等某一支指定的 PR」——
charter 記著那個目標會一直動）。

| | 值 |
| --- | --- |
| web bundle | `main-VWXREIM7.js`（部署前是 `main-AQOBVFQF.js`，2026-09-13 00:3x） |
| api version id | `2d198aac`（部署前是 `fc287869`） |
| 三方比對 | 部署後線上 == 本機 build，且 != 部署前線上 ✓ |
| 這一批 | 上次部署後的 **59 筆**，其中 17 支 feat/fix；**web 81 檔、api 14 檔都有動** |

`styles-NT5GAE5N.css` 前後相同 —— 全域 `styles.scss` 這批沒動，**元件級 SCSS 編進 JS chunk**
（charter 部署備忘），所以那個 hash 不變是正確的，不是沒部署到。

**跨部署的累積紀錄在 `herdr-team/review-steward.md` 的「部署節奏與截線紀錄」表**，
不在這裡 —— 這一節會被清空，那張表不會。

**節奏（2026-09-12 起）**：每次收完一批 PR、或每天最後一支合併之後部署一次。
理由不是「線上不能舊」，是**部署這條路壞了而沒有人知道** ——
`smoke` 證明的是線上那一版還在服務，不是部署還做得動。

### ⚠️ 這次驗了什麼、沒驗什麼

**驗了**：

- **線上實際下載 lazy chunk**：`chunk-D7HVCXT6.js` / `chunk-NCW4Z35I.js` 含
  `manage_org_settings`（#772，上次截線的 web 是 **0 處**），`chunk-2UQO7W2J.js` /
  `chunk-3GZRGV7N.js` 含 `app-load-failed`（#788，上次截線**整個目錄不存在**）——
  四個都是 `application/javascript`
- **負控**：`chunk-ZZZZZZZZ.js` 回 `text/html`（SPA fallback）——
  證明「拿到 JS」這件事有鑑別力。`demo.clessia.cc` 任何路徑都回 200，**做判斷的是 content-type**
- **api 的 `openapi.json` 前後有差，而差的正好是這批改的那支**：
  `/api/login-links` 多了 `403 權限不足`（#464 的 `requiredPermissionsForTarget`）。
  上次那批「逐字相同」是因為一個 api 檔都沒動；這批動了 14 個，所以**該有差**
- api 正控（`workers.dev/api/system-time` → JSON 200）、負控（`workers.dev/no-such-route`
  → **404 + JSON**）、拓撲對照（`demo.clessia.cc/no-such-route` → **200 + HTML**）全部符合 charter

**沒驗**：

> **產物裡有那些字串 ≠ 畫面上那些功能能動。**

本席不碰瀏覽器（Chrome 由 labor-8 獨占），**這批 17 支 feat/fix 沒有一條在線上被實際點過**。
其中權限相關的幾支（#772 權限勾選清單、#464 login-links 的 403）**只有登入之後才看得到**，
而那要一個有瀏覽器、且知道修法前長什麼樣的席。

**⚠️ 這批含授權/權限路徑的改動**（#464 的 mount 權限重掛、#816 的家長清單分校範圍）——
它們是**已經合進 main 的**（保留類的「使用者親合」在合併那一關，不在部署這一關），
但線上生效就是現在。**行為若不對，回退是 `npx wrangler rollback --env production`，
不要現場修。**

### 這半沒有人在做 —— **原本派給 `usability-admin`，那一席已經不在了**

> #655 / #660 / #664 / #672 四條線上驗證（`b5b8ac92` 那批，早就在線上）**從來沒有被走過**。
> 計畫席 2026-09-12 指派給 `usability-admin`，而 `herdr agent list` 上**沒有這一席**了。
>
> **它掃不到，因為它不在 issue 板上** —— 那四個編號是**已合的 PR**，`seat:usability-admin`
> 這個標籤從來不存在。監工席的孤兒 seat 掃描只看 open issue，**派在已合 PR 之後的工作
> 天生沒有載體，席位一死完全沒有任何東西會變樣**。
>
> **修法（2026-09-13 起）**：不要把後續動作掛在 PR 上，**要開 issue**。

要走的四條（下一個拿到瀏覽器、且知道修法前長什麼樣的席）：

| # | 線上該看到什麼 |
| --- | --- |
| #655 | 課堂列表的預設篩選看得見；停課之後那堂課不再「消失」 |
| #660 | 學生搜尋打字到出結果**慢一拍（300ms）—— 那是刻意的**，要確認在線上網路條件下感覺對 |
| #664 | 人員表單驗證失敗**留在欄位上**，不再只有一閃而過的 toast |
| #672 | 公告的「發送對象」下拉**選得到家長**（預設仍是老師） |

## 📋 給使用者：等你的五件（2026-09-13 **15:4x**，計畫席 labor-plan-20260913-1211 收工前重寫）

> **這一節每次計畫席輪替都會重寫**，狀態一律現查：
> `gh pr list --state open`、`gh issue list --state open --label blocked`。

### 1. 部署卡住 —— **只有你能解，卡著 47 筆已合的東西**

`supabase/migrations/20260913101500_audit_logs_subject_organization_resource_types.sql`（#832）
**要你親自套進正式 DB**（schema = 保留類）。**套完之前不能部署 api。**

**為什麼不能先部署**：`logAudit` 是 fire-and-forget（`apps/api/src/utils/audit.ts` 的
`waitUntil?.(promise)`，`catch` 只 `console.warn`）。api 上線而 DB 沒套，insert 被 CHECK 擋掉
⇒ **線上靜默 0 筆稽核**，#828 的症狀搬到線上、更難查。

**套完跟計畫席說，`labor-reviewer` 立刻部署。** 線上現在是 `main-VWXREIM7.js`（09:5x 部的）。

### 2. 三支保留類 PR —— **合併順序有實質差別**

| 順序 | PR | 內容 |
| --- | --- | --- |
| — | **#836** | 人員不能刪除只能封存，建立時接管孤兒 `ba_user`（#833） |
| **先** | **#882** | 建立家長要一併寫入 `user_roles(parent)`（#877） |
| **後** | **#884** | migration：補寫既有家長缺少的 `parent` 角色 |

⚠️ **#884 必須在 #882 之後** —— 反過來的話補完的當下是對的，而在 #882 上線前**每建一個新家長就又多一筆沒角色的**。

**三支我都留了計畫席審查意見在 PR 上**（我開檔驗過的前提、作者怎麼回答關鍵問題），
**不必從頭讀 diff**。#877 的嚴重度值得知道：**UI 建出來的家長不只產不出登入連結，
它們登入後過不了 `roleGuard`，根本進不了家長端** —— 而沒有人早點發現，是因為
**「家長有角色」是 seed 的性質，不是產品的**。

### 3. 心跳腳本 —— **我改不動（權限擋）**

`~/.local/bin/clessia-heartbeat.sh` 的 `WARDEN_MSG` 內文還寫著「喚醒計畫席 `clessia-c8`」。
我下 `sed -i` 被 auto mode 的 `Unauthorized Persistence` 擋掉，**沒有繞過**。

**建議不是改掉這次那個名字，是讓那段訊息不指名任何席位**：

```
! sed -i '' 's/計畫席 clessia-c8/計畫席（用 `herdr agent list` 找當班的 labor-plan-*）/' ~/.local/bin/clessia-heartbeat.sh
```

**理由（labor-reviewer 提的）**：那個檔在 `~/.local/bin/`、不進版控、**沒有任何 gate 看得見**，
所以它每次輪替都會過期一次，而**發現它的每次都是偶然**。改名字只解這一次。

**它壞掉的時機特別糟**：那段話**只在「額度斷線恢復」時才會被讀到**，平常每一輪都看起來正常。
（監工的 charter #865 已經把「復活對象一律現查」寫成防線，所以就算腳本沒改也有一層擋著。）

### 4. #495 要不要架能連真 DB 的驗證環境 —— **消費者已經五個**

| # | 只有正式 DB 說得出的答案 | 需要 |
| --- | --- | --- |
| #485 | 現存資料裡有幾筆被錯扣 | 唯讀 |
| #488 | 那個計數在真實資料上少多少（issue 已關，**問題還在**） | 唯讀 |
| #479 | 真正的並行 | 起服務發並行請求（**貴的那一半**） |
| 部署左邊界 | 正式 DB 現在套到哪一支 migration | 唯讀 |
| **#877** | **正式站有幾個家長沒有 `parent` 角色**（本機 1 筆） | 唯讀 |

**五筆裡四筆只要唯讀。** 建議不變：先做便宜的那一半。

### 5. 排程決策（下次窗口再答就好）

**#758 的 UI 地圖還剩 4 輪（第 6–9）。做完之後全隊要不要轉 P4 家長端？**

`kb/wiki/roadmap.md` 那節寫得很直接：**11 頁全是 14–18 行的空殼，這是產品價值的所在 ——
沒有家長端，這是行政內部工具，不是補習班系統。** 順序 roadmap 也給了
（出缺席 → 繳費 → 成績 → 課表 → 聯絡簿 → 報名／加選）。

**要你決的不是做什麼，是什麼時候切**，以及切的時候 #758 剩下的輪次要收尾還是暫停。


## 收工紀錄（2026-09-13 15:4x，計畫席 labor-plan-20260913-1211）

**使用者要求收尾**（省 token 給另一個專案，週一–週三）。**這不是輪替，是全隊停工** ——
下一個接手的人讀「接手第一件事」那節就好，席位狀態一律現查。

**今天合了 20+ 支**，其中 doc/charter 類佔多數（README 從 1694 → 約 1800 行，
**開頭現在有閱讀導引：新席約 200 行、計畫席約 500 行、其餘 1100 行 grep 不要讀**）。

### 停工前的三個未完狀態

| | 狀態 |
| --- | --- |
| `labor-20260913-1222` | #758 第 6 輪（考務與成績）進行中，**持有瀏覽器**。第 5 輪已合（#878） |
| `labor-20260913-1134` | 手上 **#867**（四條線上驗證）等瀏覽器；#876/#877 已交付（#880 合、#882/#884 等使用者） |
| 兩支 Monitor | **掛在計畫席 session 上，隨它關閉消失** —— 下一任要自己重掛（「接手第一件事」第 6 條） |

### 今天新長出來、寫進 README 的規則（合了才算數，現查 `git log`）

- **怎麼讀 README**（閱讀導引 + 那 1098 行的節加了 15 個 `###` 子標題）
- **「自己開的不自己合」要的是第二次獨立檢查，不是第二個人**
- **禁令擋不住正當需求；而預設值連需求都不需要**（分支名不要用席位名）
- **送達的假陽性與假陰性**（`--wait --until working` 對已在 working 的席位）
- **結論附上取得方式 / 已知上限**（#881，三方碰過：作者寫、監工擋、計畫席裁）
- **抄慣例前先查它有沒有被 ratchet 判死**
- **沒有執行者的期限不是期限**

### 兩件只存在於訊息裡、沒有進任何檔案的

1. **#884 必須排在 #882 之後**（已寫進 #883 的代記與快照第 2 件，但**GitHub 上沒有機制擋**）。
2. **`labor-20260913-1134` 刻意沒在本機套 #884 的 migration** —— 因為 `labor-20260913-1222`
   正在用 DB 做寫入實按，套下去會汙染它每一顆的量測而它不會知道。
   **要真的套一次，得等那一輪結束、reset 之後。**

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

## 接手第一件事（2026-09-13 **12:4x**，計畫席 labor-plan-20260913-1211 上任後重寫）

1. `TZ=Asia/Taipei date` —— 報時間一律實跑。
2. `herdr agent list` + 每席 `herdr agent read <席> | grep Ctx` —— 誰在 working、誰 Ctx 過線。**不要用 issue 板推論席位活動**；反過來也一樣，**席位死掉不會讓 issue 板變樣**。
3. `gh pr list --state open` —— 非 draft、CI 綠、**非保留類**直接合（合前：`git rev-list --count origin/<br>..origin/main` + 檔案交集，交集非空叫作者 rebase）；保留類（migration／金額路徑／授權邏輯）**只有使用者能合**，標題已帶【保留類】。**作者已退場的 PR 由計畫席自己 rebase**（上任當天就撞到一支：#859）。
4. 讀 `herdr-team/README.md`「計畫席消失時怎麼辦」「席位復活程序」「共享資源協定」。
5. 心跳：launchd 每 30 分鐘 prompt 你與 labor-ops-warden；帳戶限速（09-12/13 一天三次、各停 1.5–3 小時）會讓全席出現 `/low-priority` 橫幅。
6. **兩支 Monitor 掛在計畫席 session 上，會隨它關閉而消失 —— 自己重掛**：① open PR 的 verify/seed-reset 結論（**綁 head_sha**，否則會拿到 rebase 前那顆的綠燈）② 席位 idle 集合 + 未認領 issue 的變動。腳本範例在 scratchpad，**注意 macOS 是 bash 3.2，沒有 `declare -A`**（第一版就是這樣 exit 1 的）。

### 上任當天新學到的三件（都在別處會再撞到）

- **`SendMessage` 的 peer 名跟 herdr 的 `name` 不是同一個命名空間。** `SendMessage to: clessia-c8` 回 `No agent named ... is reachable`，而 ListAgents 上它叫 `clessia-44`。**跨席一律 `herdr agent prompt <herdr 名>`。**
- **`herdr worktree create --path` 是相對於你的 cwd。** 在計畫席的 worktree 裡下相對路徑，會建出 `.worktrees/labor-plan-…/.worktrees/<新席>` 這種巢狀目錄（我建了一次，`herdr worktree remove --workspace <id> --force` 收掉重來）。**一律給絕對路徑。**
- **合併後刪本地分支會失敗，如果那支還 checkout 在別席的 worktree 上。** 遠端刪得掉、本地刪不掉，訊息會指名是哪個 worktree —— 那不是錯誤，是那一席還站在已合併分支上（擱淺的起點），通知它切回去。

### 席位（2026-09-13 12:4x）

| 席 | 在做 | 備註 |
| --- | --- | --- |
| `labor-20260913-1134` | #848（P1，390 版面）→ PR #860 | **持有瀏覽器**；52 頁重掃中，歸零前不合 #860；交還時會明講 |
| `labor-20260913-1222` | #758 寫入實按第 5–9 輪（labor-8 後手） | 等瀏覽器；charter 是 `herdr-team/labor-8.md` |
| `labor-db-reset` | 只做 `npm run db:reset`（deny 行只在它的 worktree 移除，**永不 commit**） | **只接計畫席的請求，別席直接找它會被擋回來** |
| `labor-reviewer` | 代合與部署（取代 review-steward） | **部署前查 migration**；目前部署卡在 `20260913101500` 未套進正式 DB |
| `labor-ops-warden` | 心跳巡檢、備援 | **每輪量計畫席 Ctx，≥80% 叫交接**；孤兒 `seat:` 掃描 |

**已退場**：`labor-8`（charter 隨 #859 進 main）、`labor-9`（#858）、`usability-admin`、`clessia-c8`。

**命名（使用者裁定）**：生產席 `labor-YYYYMMDD-HHMM`；常設席也帶時間戳 `<職務名>-YYYYMMDD-HHMM`；charter 檔名維持職務名。常設席 **context 滿了就交接**（新 session 接同 charter），不是關掉留空。

### 等使用者的 —— **看上面「📋 給使用者」那節**，不在這裡複製

只補一條那節沒有的：`.claude/settings.json` 的 `npm run db:reset*` deny 在主 checkout 仍然在，**只有 `labor-db-reset` 的 worktree 移除了那一行，而且永遠不 commit**。它的 `git status` 常駐一筆 `M .claude/settings.json` 是正常的。
### UI 地圖現況

Phase 1（53 頁 + 10 支 _shared 兩向比對）✅；Phase 2-A 響應式 63/63 ✅、2-C 權限矩陣 ✅（`_shared/permission-matrix.md`：9 個權限只有 2 個改前端）、2-D 載入中／錯誤 63/63 ✅；**2-B 寫入實按 #758 第 3 輪已合、第 4 輪進行中**，共 9 輪；完備度約 90/100，剩下的在 #758 與 #848（地圖量不到版面壞掉，這是方法盲點）。方法頁 `kb/wiki/specs/sitemap/README.md` 12 個坑 + Phase 2 節。

### 今天學到、下一任會再用到的

- **seed = `seed.sql` + `seed-demo.sql`**（#842 起 `config.toml` 兩者都套）；`npx supabase migration up` 可套新 migration 不觸發 deny；CI `seed-reset` job 跑 reset + 哨兵，paths filter 退到 merge-base（#847）。
- 「沒有炸」證不出「資料在」；「屬性設了」不蘊含「看不見」（斷言落在畫面）；替身少記一個東西＝把那件事斷言成永遠正常（labor-9 charter 那張表）。
- 開單前提要自己開檔驗：#722、#784 是幻影單（分別是我沒開檔、ResizeObserver 在量測 iframe 不觸發）。
- 合併 PR 後席位往同分支疊 commit 會擱淺（#692 / #715）；疊 PR 用 draft，合了上游再 rebase 轉 ready。

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
