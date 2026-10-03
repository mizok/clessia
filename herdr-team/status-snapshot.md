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

## 🚀 線上是哪一版（2026-10-03 19:4x 第七次部署，labor-reviewer-20261001-2204）

**截線 `3590b5f5`**（#1162；`verify` success）：web `main-GXLILR73.js`（有重發，本席 `wrangler pages deploy`；本機 `dist` 15:51 新產物、build exit=0，**兩份產物隔了約四小時，等使用者按 api 期間 `main` 又合了 #1164／#1183 之外的 docs，但截線與 `dist` 都固定在 `3590b5f5`**）、api `7ace638f-7bd9-4427-b302-2abd5b8db006`（使用者 19:47 親跑 `wrangler deploy`，100% 流量，cf-placement `remote-SIN`）。順序：api 先、web 後。
含：api #1180 payment_info（補習班帳戶資訊：機構預設＋分校覆寫、家長繳費頁顯示）；web #1179／#1184／#1162（課表頁、課表甘特 G1、學生列表 A6）等 A6 逐頁換版。
**⓪**：窗口 `9ae774ea..3590b5f5` 的 migration 只有 #1180 的 `20261003071532_payment_info.sql`，**已由 `migrate.yml` run `37106717548` apply 綠套上**（更正第六次紀錄寫的「#1180 migration 等 Approve」——那句在寫下當下為真、之後已過期）。
**部署驗證**：web 線上 `main-GXLILR73.js`＝本機 build；本機 167 個 js 檔線上缺 0 個（部署前 31）、負控 chunk 回 `text/html`；workers.dev 正控 `/api/system-time` 200 JSON、負控 `/no-such-route` 404 JSON、對照 `demo.clessia.cc/no-such-route` 200 text/html；cf-placement `remote-SIN`；`openapi.json` 132 條路徑（與第六次相同，#1180 只改既有端點的欄位）。**限度**：這批 api 是既有端點欄位，openapi 證明不了新程式碼上線，只證明服務正常、版本已換。
**第八批**：#1164（學生檔案 A6，`0bfeab4a`）之後合進 main 的、與 #1183（kiosk 角色 migration，保留類）。
入口 `colo` **會自己漂**（SJC → TPE → NRT，沒人改設定）—— TTFB 比較不可靠，量並行用 `wallTime` 對「合計／最慢」（`deploying.md`，#956；**該判準尚無真實 `[probe]` 驗證過**）。

## 📋 等使用者

> **標題固定，不要改名或搬位置** —— 監工的 charter（#978）用這個標題找它，報「綠 PR 滯留」前先對照這份。
> 最後更新：2026-10-03 15:5x，計畫席 labor-plan-20261003-1534。狀態一律現查：`gh pr list --state open`、`gh issue list --state open --label blocked`。

### 保留類 PR（只有使用者能合）

| PR    | 為什麼保留                                   | 狀態                                                                                                                                                                                                                                  |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1183 | kiosk 角色：migration `20261003073117_kiosk_role.sql`＋授權（daily-checkins 免登入打卡、campus-scope）＋ AGENTS.md 角色表加第四角色 | head `65385b44`，verify 綠。**可否決 kiosk 角色本身**（設計在 #1127 留言與 `kb/wiki/architecture/kiosk-checkin.md`）。合了請在 Actions `prod-db` 按 Approve；**計畫席在您合的瞬間凍結其他合併並掛守衛，apply 綠才解凍**（#1146）。 |

| #1188 | kiosk 帳號 API：POST /api/staff 收 roles=[kiosk]（單獨、一校、無權限、佔位 email）、PUT 限改名／狀態／換校、login-links 對 kiosk 要 manage_staff＋範圍＝綁的分校、打卡回應帶 student.name＋todaySessions | **draft 疊 #1183**，head `742eba92`。1536 的刻意判斷：建機台帳號門檻用 `manage_staff` 不走 `manage_roles`（理由在 PR）—— 您可否決。#1183 合後它轉 base main 再請您合。 |

接下來會出現的保留類：#1127 前端後半（1536，疊 #1183）、#1175 課程費用欄（1536）、#1118 餘項推薦課 `is_recommended` migration（1536）。10-03 已合的保留類鏈：#1132／#1137／#1141／#1143／#1145／#1150／#1152／#1180（migration 皆已套、使用者逐一 Approve；#1180 的 run `37106717548` apply 綠）。

10-03 已合的保留類：#1132、#1137、#1141、#1143、#1145、#1150（四支 migration 皆已由 migrate.yml 套、使用者逐一 Approve）。**S3 殼改寫 #1154 15:1x 已合**（使用者看截圖 OK），疊在上面的 #1155／#1159／#1162／#1164 由 1456 逐支轉 main。第五次部署 12:1x 完成（截線 `6103d4d0`，紀錄 #1153）；**第六次等 #1152 合後備**（api：#1141／#1143／#1145／#1150／#1152，web：S3 起）。**教訓（#1146）**：等 Approve 的 apply 會被後續 main 的新 run 取代 → Approve 落地前凍結合併，計畫席掛守衛取消新 run。
**家長端寫入的架構裁定（10-03 11:5x，計畫席裁，您可否決）**：`parent-data-scope.md` 原列「家長端寫入 v1 唯讀」為明確不做；為了候補登記與申請表，改成寫入走 `childDb.insert／update`（scope 外在送 DB 前拒絕）、機構層級參考資料走 `orgRef` 白名單唯讀（classes／courses／enrollments 計數），不用 DB trigger。文件更新跟 #1119 同 PR。

10-03 上午已合的五支保留類：#1069（T4）、#1080（#920）、#1094（#1081）、#1102（#1098）、#1089（#1059），分支皆已刪；#1078（P1）隨後由 reviewer 合。

### 使用者動手的

1. ~~修憲 c6 續跑~~ 已完成：腳本已跑、#1062 於 10-02 23:38 由擁有者合併、`law-c6` worktree 已清。（這一列在 #1061 寫下時腳本還沒跑，10-03 00:2x 複查才發現已過期 —— 快照寫「等使用者」的事項，接手先 `gh pr list --state all --search` 查一次。）
2. ~~兩個 GitHub environment~~ 已設好（10-03 00:0x），#977 已由 migrate.yml 套上；之後遇到 migration 只要在 Actions 的 `prod-db` 按 Approve。
3. **api 部署**：每次由使用者在 reviewer worktree 的 `apps/api` 跑 `npx wrangler deploy --env production`；reviewer 準備截線並驗證。**第七次部署就緒（10-03 15:5x，reviewer 驗過）**：截線 main `3590b5f5`（#1162）；窗口 `9ae774ea..3590b5f5` 唯一 migration 是 #1180 的 `20261003071532_payment_info.sql`，已由 run `37106717548` apply 綠；api 動的是 #1180 帳戶資訊五檔；web 新 `main-GXLILR73.js`（本機 167 個 js 有 31 個線上沒有）。**您按 api 那一行，reviewer 再發 web**：
   `cd .worktrees/labor-reviewer-20261001-2204/apps/api && npx wrangler deploy --env production`
   #1164 與之後合的歸第八次。
4. **T4 cssLayer 回歸**需使用者在場一次（複製 `.dev.vars`），計畫席排時間。

### 使用者要裁的

目前沒有。（P1 admin/changes 五處超出 API 的預設做法仍可否決：老師／班級搜尋不做、批次前端分組、每列「看這堂」不做、時間欄不做、開場標題放頁首。）

> 10-03 已裁：#1109 留歷程、#1113 維持、#1118 人工標記、#1120 試聽算名額、#1074 不顯示確認人、#1076 改用機構的「期」（時間軸收成一條：期＝學期，各校放假日走 #1160 學校行事曆，不做分校學期）、額滿改候補登記、入口頁手機版 V45、S3 OK；**15:5x 再裁三題**：#1127 掃碼機不放公開頁、改登入身分（公開頁拿掉 QR 入口，1307）；#1174 課表甘特直接取代清單（1456）；#1175 課程費用住 classes.default_fee_template_id（1307）。

- **出勤模式層級**：設計稿照 rules 畫成分校層級，日後一支 migration（保留類）；使用者未回，視同同意。
- **#953** 退班後過去課堂在籍、**P4 家長端**（A6 批 5 設計中）、**QR 到班頁空殼**。

> 10-02 已裁的（不要重問）：A6 定案（#973）；全站 SCSS 改 Tailwind、入口頁 1:1 換、公開頁照現狀搬（#991）；Tailwind 七點照計畫席建議；P1（admin/changes）提前；#1034 選 C＋A；#920 含老師唯讀；人員管理頁需 `manage_staff` 才能進（#1059，推翻 #1027）；憑證三組已輪替（15:xx）。

## 兩天紀錄（09-30 下午 – 10-01，計畫席 labor-plan-20260930-1448）

- **#915 根因**：正式 DB 漏套 `20260906083827`；截線表「套到 X」只證明最新那支 → 判準改**差集**（#918）。**行為驗證還沒做**（要瀏覽器）。
- **#898 作廢**：使用者裁（作廢不刪、淨額 ≠ 0 擋、不可撤銷、含堂數包擋）→ #921 已合已套、#931 等走查。**`invoices` 沒有 status 欄位**（推導的），別照舊 issue 標題找 enum。
- **#911 公告稽核**：只記發佈 → #934 已合已套、#936 已合已部署。
- **demo 慢**：09-30 下午入口在 SJC（主因），加 placement（#945）；應用層 #948 → #954（api 並行）、#955（開站並行）、#957（課堂頁 4 段/19 輪 → 2 段/6 輪，在籍依課堂日期）全部上線。**索引不用加**。
- **impeccable audit #924**：P1 #926＋gate #933、P2 #942（18 筆，PrimeNG 半是誤報）、P3 #941；課表與點名兩頁未量（等瀏覽器）。
- **貼 SQL 給使用者會壞**：終端機把 `$$` 吃掉 → **一律 `pbcopy` 原檔**，先在本機 `BEGIN…ROLLBACK` 跑過。
- **PR 沒帶 `Closes` 不會自動關** → reviewer 合併後查（#959）；監工掃「在線但已退場」席位名下的 issue（#958）。

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

|                | `jobs` 長度 | 意思                                    |
| -------------- | ----------- | --------------------------------------- |
| 跑到一半被殺   | **非 0**    | 它真的跑過，只是沒跑完                  |
| 從頭到尾沒開始 | **0**       | 它在排隊時就被丟掉，**一行 log 都沒有** |

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

## 接手第一件事（2026-10-02 09:4x，計畫席 labor-plan-20261002-0935 補 5、6 兩條）

1. `TZ=Asia/Taipei date` —— 報時間一律實跑（本任自己也報錯過一次「16:1x」）。
2. `herdr agent list` + 每席 Ctx（監工的 `ctx()`）。**閒置久的席 footer 會收掉 Ctx 列 → 讀不到 ≠ 0%，標「未量」**（#946）。
3. `gh pr list --state open` —— 非保留類：**讀完 diff 才授權，授權後不再補訂正**（鎖 head 擋不到訊息形式的訂正，那三次沒出事是時機）。保留類（migration／金額路徑／授權權限，**分校範圍算授權**）只有使用者能合。
4. README 閱讀導引（計畫席 500 行），再看「席位復活程序」底下的 **Monitor 腳本要點**。
5. 心跳：`~/.local/bin/clessia-heartbeat.sh`，**計畫席名寫死在第 36 行** → **新計畫席自己 `sed` 改**（10-02 實測沒被 auto-mode 擋；先前那句「會被擋 → 請使用者改」是沒驗過就照抄的）。被擋才請使用者。
6. **退場席位由現任計畫席關**：`herdr workspace list` 找 label → `herdr workspace close <workspace_id>`（使用者 10-02 09:5x 裁定「一律請新計畫席關閉」，含輪替時的前一任計畫席；關前驗該 worktree 無未推 commit、無孤兒遠端分支）。
7. 兩支 Monitor 每 30 分鐘到期要重掛；板上沒動靜時可以不掛，心跳會叫醒你。
8. 跨席訊息寫檔再 `"$(cat 檔)"`，heredoc 用**加引號、名字罕見**的分隔符。
9. **要使用者在正式 DB 跑的 SQL：`pbcopy` 原檔，不要貼在訊息裡**（`$$` 會被吃）。

### 席位（2026-10-03 15:4x，計畫席 labor-plan-20261003-1534 上任）

> 10-02 關閉的六席：前任計畫席 1448、舊 reviewer、1222、1456（#993）、1037（#997）、1549（#1041）。

| 席                                       | 在做                                                                                                                        | 備註                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `labor-20261003-1552`（Opus）            | 前端：#1174 G2 週視圖 → G3 快速選取、#1138 H1 全站搜尋／H2 CampusContextService、#991 courses 目錄 | 開席 10-03 15:52，接 1456（已關，charter #1186 已合）；設計稿與 .pw-regression 已複製到它 worktree |
| `labor-20261003-1536`（Opus）            | 後端：#1127 後半（kiosk 帳號端點、前端搬頁與登入導向，疊 #1183）→ QR 卡設計 → #1175 → #1118 餘項 | 開席 10-03 15:36，接 1307（charter #1185）；1307 的 #1150 實打殘留在本機 DB（db-reset 已量，下次 reset 逐項對） |
| `labor-plan-20261003-1534`（Fable）      | 計畫席 | 開席 10-03 15:34，接 2351（已關）；心跳腳本已改名 |
| `labor-reviewer-20261001-2204`（Sonnet） | 代合＋部署驗證；今天四十餘支。**分類器擋它**：production deploy、手動 merge、刪遠端分支、部分留言 —— 這幾類走計畫席或使用者 | steward-merge.sh 已修多筆 verify（#1053）                                                   |
| `labor-db-reset`                         | 待命；本機 DB＝main（RESET #13）                                                                                            | charter 新增「筆數也量不到搬移」（#1019）                                                   |
| `labor-ops-warden`                       | 巡檢；10-02 charter 加了 UTC、重讀、[Pasted text]、charter 檔對 origin/main 查、時長判準、backlog 用 blocked 承載           |                                                                                             |

**設計方向（#973）**：使用者選 A 系列（A2 → A5）。顏色分工：橘＝品牌／位置、黑＝全站頁首＋暫時操作（批次列、步驟按鈕列）、白＝內容，A6 加灰。**入口頁的流場＋橘白是錨點**，延伸 style 不延伸 40/60 構圖。第三輪盤點出的功能缺口（沒有新增一堂課的 API、無教室、代課只能單堂、批次改時段只能同日）**尚未開單**，等方向定案一起排。

### UI 地圖現況

**#758 九輪走完 75/106**，剩 31 顆是家長端零寫入與跨輪重複 → blocked 等 P4。方法頁 `kb/wiki/specs/sitemap/README.md`；`labor-8.md` 是接手入口。

### 這兩天學到、下一任會再用到的

- **一個 0／一個 401 有幾條路變成它**：`audit_logs = 0`（沒寫入／logAudit 靜默失敗／讀取路徑補建 events 不經 logAudit）、未登入打 `/api/sessions` 的 401（修前修後都是）。
- **差值要大於同一設定重複量的離散度才能歸因**（#947 的 −0.08 被自己推翻）。
- **lib 是掃描器、gate 才是判準**；**宣告存在 ≠ 宣告生效**（`min-height` 對 inline／table-row 無效，display 讀得到）。
- **找出來的缺陷都修了 ≠ 審查做完了**（#924 還有兩頁未量）。

## 10-03 計畫席學到、下一任會再用到的（labor-plan-20261002-2351，15:1x 寫）

- **migration 的 Approve 會被後續 main 取代**（#1146）：apply 等 Approve 是 waiting 不算 in-progress，下一顆 main 的 run 進來就把它取消。做法：使用者合帶 migration 的 PR 起**凍結所有合併**（含 docs），計畫席掛守衛（背景迴圈：保護最新 waiting 的 run、取消其他），Approve 落地 apply 綠才解凍。昨晚還有一顆 workflow_run 的 run 停在 waiting 沒人理，佔住 concurrency 群組讓新 apply 一直 pending 沒有 Approve 按鈕 —— 先 `gh run list --workflow migrate.yml --status waiting` 看有沒有舊的。
- **`gh run list` 的 headSha 不是那顆 run 處理的 commit**，要讀 plan log 的 `TARGET_SHA`。今天一顆看起來「#1150 的 run apply skipped」其實在處理前一顆。
- **寫時間一律 `TZ=Asia/Taipei date` 用變數帶入**：一晚猜錯三次，每次多一支 commit 更正。
- **授權 reviewer 要在拿到 PR 編號之後另發**：授權訊息跟 `gh pr create` 串同一次呼叫，編號還沒回來就送了，reviewer 得猜。
- **reviewer 回報「已合」要以讀回為準**（#1140）：它把回報 printf 串在 merge 指令同一行，CI 沒報就先送「已合」；兩次抓到。計畫席收到「已合」一律 `gh pr view --json state` 再信。
- **使用者的話先問清楚**：「1-col」是卡片內部不是整頁；「間距」是標題與內容；「更大膽」給中間值不給極值（V42 → V43）；「入口頁只要求有橘色流場」layout 交給計畫席裁；「學期跟學校」其實是排課要看各校行事曆（#1160），不是成績歸屬 —— 問了才知道，推論三次都錯。
- **同一個業務詞的裁定要套到同一族**（額滿→候補套到三頁）；收到裁定 grep 那個詞。
- **時間軸只留一條**：機構的「期」＝學期（billing_periods），各校放假日疊在期裡（#1160），不做分校學期、不用法條函式。
- **席位退場時**：工單標籤要搬（監工會點名）、設計稿只在設計席 worktree（留著，開新席 `cp -R`）、它的 dev server 用 `lsof -ti:port` 對 cwd 確認是它的再 kill、疊在它 PR 上的 draft 要轉 base。
- **一次只 rebase 一支、合一支**：保留類鏈四支＋三支 migration，照序走零衝突；同檔的先 merge-tree 試合。
- **開單前自己開檔驗**：子代理驗 20 條草稿後我再抽驗四處；三條草稿判「非保留」改成保留（新端點要自己守分校／org）。
- **fork／子席的 `pkill -f "字串"` 是子字串比對全機命令列**，會打到 /Applications；FORK-PROMPT 第 8 條。
- **harness 的 gate 依賴要宣告**（#1171）：靠傳遞依賴活著的 import，主 checkout 跑 harness 會紅、訊息像環境壞。
- **實打抓替身盲點**：#1150 的替身無條件補 embed，真路徑實打才抓到 sessionIds 空陣列（#1177）；保留類合併後請 db-reset 重置再實打。

## 10-02 計畫席學到、下一任會再用到的

- **長訊息會停在對方輸入框**（`[Pasted text #N`），herdr 照樣回成功；送完讀對方 pane 的 `❯` 行，只認佔位符本身（README 六、#988／#989）。一天漏收三則回報才抓到。
- **`pgrep -fl`／`ps eww` 會把 npx 行程的整份環境印進轉錄**（README 六、#1003）—— 當天因此輪替三組正式憑證。找行程只印 PID。
- **額度耗盡全席一起停**（共用帳號）：不會殺 session，回流後 prompt 一次就接回；停前叫席位先 push 未推的東西。
- **使用者的話先問清楚**：「看 demo」是 A6 設計稿不是線上站（差點開了 tail）；「都能按」是連得到靜態頁不是接 API；「黑塊」是按鈕不是批次列。三次都問了才對。
- **保留類 PR 要合時再 rebase 一次一支**：#1046–#1049 同一個 baseline 檔，一次推四支會連環衝突；改成「推一支、合一支」就順了。
- **分類器會擋 reviewer 的部署與手動合**：不繞、不放寬；部署改成使用者按一行，計畫席轉達。
- **要使用者在正式 DB 跑 SQL 的念頭要先過 #968**：migration 一律 CI 代套，使用者只按 Approve；當天我差點又讓他手貼差集 SQL。

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

| 位置                    | 做什麼                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `markReloadAttempted()` | 存 `at = Date.now()` — 記為 `T0`                                                             |
| 測試斷言                | `hasReloadBeenAttempted(Date.now() + RELOAD_WINDOW_MS - 1)` — 那個 `Date.now()` 是 `T1 ≥ T0` |
| 實作                    | `return now - at < RELOAD_WINDOW_MS`                                                         |

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
