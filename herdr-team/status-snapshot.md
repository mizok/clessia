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

## 🚀 線上是哪一版（2026-10-10 第十九次部署紀錄，CI，labor-reviewer-20261008-1356）

**截線＝origin/main HEAD `9b5580da`**（#1439，純 docs）。**每顆 main 都由 `deploy.yml` 自動部署一次，中間各次沒有逐次寫紀錄**；api 與 web 分開看：

- **api**：最後一次 deploy-api success 是 run `37947662120`（截線 `829b0dfb`＝#1428，10-09 22:54–22:59 台北）→ version `49c5755a-85d1-4765-b088-079a34b62ce9`。之後的 run 都是 deploy-api skipped（#1431、#1439 沒動 api）。
- **web**：最後一次 deploy-web success 是 run `37948817275`（截線 `f859dd21`＝#1431，23:03–23:05 台北）→ `main-XXWMDDAW.js`（`d72aac87.clessia.pages.dev`）。`9b5580da` 的 run `37949360292` 全 skipped（純 docs）。
  含（自第十八次 `c0a514f3`）：api —— #1421 異動搜尋 `q`、#1422 summary `studentId`／`outstanding`、#1423／#1430 courses 排序（含 hotfix）、#1426 `issuedMonth`、#1427 courses／classes／campuses 列表補 `org_id`、#1428 courses 章節計數吃同篩選、#1432 批次提醒、#1433 加明細驗 org、#1434 courses/{id} 走 `findInOrg`、#1383 家長端 `meta.term`；web —— #1420 學生檔案帳單章、#1424 人員分章、#1425 搜尋框接線、#1431 課程頁分章、#1414／#1415／#1417 課表異動三支。
  **⓪**：窗口 `c0a514f3..9b5580da` 無新 migration（`git log … -- supabase/migrations` 為 0；**這回答窗口內，不回答正式 DB 套到哪一支，仍是宣告值**）。
  **⚠️ 這一輪的事故（#1423）**：#1423 的 `order('subjects(sort_order)')` 沒把 `sort_order` 選進 embed，替身 spec 全綠、上線後 `GET /courses` 回 400。**run `37939752944`（截線 `ab67fdd8`＝#1424）把它推上線**（21:50 台北），hotfix #1430 由手動 dispatch run `37940353012` 於 21:57 上線（version `972d71b2-780d-4cc1-ac16-a314f89c6b6f`，該 run 全 success）。verify-live 的未登入探針（401 在 auth middleware，擋在查詢之前）**抓不到這種壞法**；補救是 #1436（替身擋「order 用 embed 欄但 select 沒選」）與 #1437（`api-contract` job：起真 PostgREST 對每支 GET 列表打一次）。
  **部署驗證**（本席 10-10 01:22–01:24 自測，main 仍是 `9b5580da`）：線上 `index.html`（`?cb=` 繞快取）的 `main-XXWMDDAW.js`＝run `37948817275` 的 CI 輸出；該 main 引用的 65 個 `chunk-*.js` 逐一抓線上，非 `javascript` content-type 0 個（**只比 main 直接引用的**）；負控 `chunk-ZZZZZZZZ.js` 回 `200 text/html`；正控 `chunk-HPTFETQZ.js` 含 `all_parents` 1 次；workers.dev 正控 `/api/system-time` 200 `application/json`、負控 `/no-such-route` 404 `application/json`、對照 `demo.clessia.cc/no-such-route` 200 `text/html`；cf-placement `remote-SIN`；`openapi.json`（`curl -s … | wc -c` 315591 bytes）145 條路徑，含 `/api/invoices/reminders/batch`、`issuedMonth`、`dueState`；未登入 `GET /api/invoices`、`/api/invoices/summary`、`/api/courses`、`/api/enrollments`、`POST /api/invoices/reminders/batch` 皆 401。
  **限度**：沒有帶身分，所以『新欄位／新端點讀得到、`/api/courses` 登入後回 200』**沒有被實測**（本席的 worktree 沒有 `.dev.vars`、沒有登入連結）；未登入 401 **不能**證明路由修好（見上面事故）。openapi 含新欄位只證明新 api 上線。api version 只來自 deploy-api 日誌的 `Current Version ID`，沒有對 workers.dev 線上版本回讀。
  **之後**：本週生產工作停（Weekly 70%）；待命。
  入口 `colo` **會自己漂**（SJC → TPE → NRT，沒人改設定）—— TTFB 比較不可靠，量並行用 `wallTime` 對「合計／最慢」（`deploying.md`，#956；**該判準尚無真實 `[probe]` 驗證過**）。

## 🔁 10-08 交接狀態（計畫席 labor-plan-20261004-1110，10-08 11:29 寫；Ctx 81% 主動交接）

**10-08 上午合進 main 14 支**（#1373／#1375／#1376／#1377／#1378／#1379／#1380／#1384／#1385／#1386／#1388 等）。**#991 SCSS 帳面 0**（β #1386：styles.scss → styles.css、拿掉 Sass、六道 gate 改指 .css），A6 殼早在 10-03 #1154 上線。後端：#1345／#1338／#1342／PA2／EN5（migration 20261008020623 已 Approve 套上）全合；**#1382 帳單彙總 API ready 等二讀＋使用者親合**；#1383 家長端已繳 draft 留下週期。Weekly 39%（上限 45%，到線叫停）。

- **在線席位**：labor-20261008-0848（Opus 後端，~30%）；labor-reviewer-20261004-0638（**82%，要輪替**）；labor-ops-warden-20261007-1035；labor-db-reset（70%）。前端席 0849 已退場（charter `labor-20261008-0849.md`）。
- **下一任計畫席上任提示**：`~/.cache/clessia-plan-20261004-1110/onboard-next-plan.txt`（第一行 /rename）。
- **10-08 學到**：派工前提會過期（我派「換殼」時 #1154／#1069 早合了，前端席 git log 抓到）；席位 Session 5 小時上限會讓訊息排佇列（1200 的「過」卡 40 分鐘）；reviewer「規則掉了≠回歸」誤判一次已入 charter；兩席並行每小時約 4 到 5% Weekly。

## 📋 等使用者

> **標題固定，不要改名或搬位置** —— 監工的 charter（#978）用這個標題找它，報「綠 PR 滯留」前先對照這份。
> 最後更新：2026-10-09 21:17，計畫席 labor-plan-20261008-1357。狀態一律現查：`gh pr list --state open`、`gh issue list --state open --label blocked`。

### 保留類 PR（v3：計畫席合；含 migration 的仍要您按 Approve）

| PR    | 為什麼保留 | 狀態 |
| ----- | ---------- | ---- |
| （無） | — | #1262 已於 10-07 11:13 由您親合並 Approve，上線。目前 open PR 零。 |

10-04 白天合進的保留類：#1307（11:21 合進 main，誰按的從共用帳號分不出，Approve 綠）、#1259（您親合 —— 計畫席 `gh pr merge` 被 auto-mode 分類器判「Merge Without Review」擋下，Approve 綠）。三支 migration（#1247／#1216／#1303）由 run `37173410979` 一次套綠。第十二批起皆 CI 自動部署（每顆 main 的 migrate 綠後觸發，一天十多顆）。

### 使用者動手的

1. ~~`DEPLOY_ENABLED`~~ 已開：第十二批起全由 `deploy.yml` 自動部署（每顆 main 一顆 run），沒再出現「使用者要跑的那一行」。
2. **兩條 permission 規則（可選，不加就照今天的路走）**：計畫席的 `Bash(gh pr merge:*)`（分類器擋 v3 合併 → 改您親合）、生產席的 `Bash(npx nx:*)`（分類器把 `nx typecheck`／`nx test` 判 CI Bypass → 改以 CI verify 為證，每支 PR 多繞一趟 CI）。計畫席對 `labor-db-reset` 說「跑」也被判大量刪除，今天由您直接下令 —— 同屬這一條。
3. **T4 cssLayer 回歸**需您在場一次（複製 `.dev.vars`），計畫席排時間。
4. ~~PUBLIC_ORG_SLUG~~ 已裁不設：#1126（#1262）落地前不開公開頁。

### 使用者要裁的

- ~~#1314 三題方向級~~ 10-08 全裁：A6 全採（S3 兩個都做、分章走 API 計數、P3 列內按鈕；舊有新無四件：作廢留、列印收費單留、催繳備註刪、未開單名單留）。
- **下週期開席（要您明講 OK，開前計畫席報成本）**：Opus 後端 —— #1412 異動搜尋、帳單批次提醒與匯出 API（P4／P5）、#1398／#1409／#1393／#1394 四張範圍補洞、#1383 轉 ready；Sonnet 前端 —— 帳單 P3 整組（**先做學生檔案帳單章**，順序約束在 #1314 P3 列）、課程 C1／人員 ST1 前端分章、儀表板與學生檔案對 A6 補列（#1314 第五節）。
- **出勤模式層級**（#1314 SE1）：設計稿照 rules 畫成分校層級，日後一支 migration（保留類）；您未回，視同同意。
- **#953** 退班後過去課堂在籍、**P4 家長端**、**QR 到班頁空殼**。

> 10-04 已裁（不要重問）：不開新席→改開一席 Sonnet（14:0x）；#1262 出門前不用處理；A6 後續項要補缺口→#1314；fee-templates 不分章。
> 10-03 已裁：#1127 門口平板不限類型；#1109 留歷程、#1113 維持、#1118 人工標記、#1120 試聽算名額、#1074 不顯示確認人、#1076 改用機構的「期」（期＝學期，各校放假日走 #1160，不做分校學期）、額滿改候補登記、入口頁手機版 V45、S3 OK；#1127 掃碼機不放公開頁；#1174 課表甘特直接取代清單；#1175 課程費用住 classes.default_fee_template_id。
> 10-02 已裁：A6 定案（#973）；全站 SCSS 改 Tailwind、入口頁 1:1 換、公開頁照現狀搬（#991）；P1（admin/changes）提前；#1034 選 C＋A；#920 含老師唯讀；人員管理頁需 `manage_staff`（#1059）；憑證三組已輪替。

## 10-08／10-09 計畫席學到、下一任會再用到的（labor-plan-20261008-1357，10-09 21:17 寫）

- **「待裁」不要拿新舊取捨去問使用者**：他裁的是「A6 全採」，問取捨等於重開已裁的題；該做的是開 A6 稿（`.worktrees/<最近前端席>/.design-explorations/973-layout/a6-editorial/`，不進版控、隨席位複製）逐項找舊功能的落點，缺的才列。10-08 一次問錯被糾正。
- **gate 前自己開檔驗前提，四次抓到「已經做完」**：S4／S5（#1174）、PA4／ST4（登入連結＋QR）、`/admin/changes` 已是 A6 形狀；席位說「現況沒有」時先 `grep`。反向：#1338 已關但席位還寫「已知缺口」。
- **同一檔被兩支 PR 改會在合併後才撞**：#1401 從 #1400 前的 main 開，`InvoiceSummary` 兩份同名 interface merge 無衝突、TS 宣告合併不報錯、紅在別處 spec。保留類 PR 等久了一定要再 merge main；用 `git merge-tree` 預演一次。
- **harness 的「提醒」有一半是紅燈**：api-param-coverage 在 CI 是 exit 1，席位本機 `| tail` 後看 `$?` 誤判；後端加 query 參數要同支 PR 補 web service 的參數型別＋手寫 `toQuery`，不加 EXEMPT。
- **`gh` 偶發卡住 60 秒以上**：Bash 一律包 `perl -e 'alarm N; exit((system(@ARGV))>>8)'`（`alarm; exec` 無效，exec 後 alarm 消失）。
- **訊息文字含 `%` 不能進 `printf` 格式串**：「Ctx 70%」把訊息截斷在那裡；用 heredoc 寫檔再 `"$(cat 檔)"`。
- **送到 idle 席位後要看它轉 working**：`herdr agent prompt` 回 idle／done 不代表沒送到，6 秒後 `agent list` 看狀態；文字在 pane 裡（`grep -c`）才算送達。
- **兩席並行真實成本**：10-08 15:06 到 16:39 兩席＋reviewer＋計畫席，Weekly 46 → 52（約 4%/小時）；10-09 晚一席＋reviewer 三小時 52 → 58。
- **reviewer 自己開的 docs PR 由計畫席讀過後授權它代合**（部署紀錄 #1413、charter）—— 第二次檢查＝計畫席留言，不等第三個人。

## 10-07 計畫席學到、下一任會再用到的（labor-plan-20261004-1110，10-07 17:43 寫）

- **Sonnet 做機械換版的真實成本**：10-07 兩席前端（1200 接 1448，序列不並行）約 8 小時合 21 支（家長端 3、#1314 小項 4、Z 批 12、charter 2；reviewer 用 merged:2026-10-07 對過），Weekly 15 → 26（含同時段 reviewer／監工／計畫席）；成本大頭在截圖與傾印不在寫碼。每支約 25 分鐘（範圍說明 → gate → PR → 二讀 → 合，計畫席讀時間戳估的）。
- **「規則從未命中」是 1:1 換版最常見的假回歸**：encapsulated SCSS 對投影內容與 PrimeNG 內部元素（styleClass）不帶 `_ngcontent`，從沒生效；換版後「突然生效」或「掉了」都要先問舊規則有沒有命中（todo-banner strong、page-band aside、page-actions__cta、leave-form 的 &__x）。reviewer 10-07 誤判一次、charter 已記。
- **證據法演進**：截圖像素差 → 逐元素計算樣式傾印（JSON 逐字比） → 直接編譯 tailwind.css 看 class 有沒有輸出（reviewer 做法）。三層各抓到別層抓不到的（陰影任意值編成透明、PrimeIcons 未分層蓋過 utility、底線跳脫）。
- **A28 Tailwind 對比 gate 的盲點**（#1359）：看不到 `[&_i]`／`[&.modifier]:text-*` 巢狀變體，換版後既有對比債會「失去守衛」而不是被修。豁免清單（TAILWIND_CONTRAST_EXEMPT）10-07 上線，形狀同 CONTRAST_EXEMPT，對不上就紅；每筆理由寫清是誤報、純裝飾、還是既有債另開單。
- **分類器三類擋法照舊**：計畫席 merge（保留類改使用者親合，10-07 #1262 如此）、對 db-reset 說「跑」（改 SendMessage 送請求單，兩次成功）、生產席 nx typecheck／test（改以 CI 為證）。
- **席位撞 5 小時 session 上限時訊息排佇列不丟**：1200 在 13:20 撞上限，「過」卡了 40 分鐘；計畫席的「繼續 X」一律要明說「過」，席位也學會了問。
- **PR 不小心把 untracked 工具 commit 進去**（#1355 的 .pw-regression 90 支）：靠讀 diff 檔名抓到；已加 .gitignore。讀 diff 先看 --name-only。
- **刪死元件是 gate 可裁的**（page-breadcrumb，零消費者）：裁定寫明「使用者可否決、一支 revert」。
- **問「還要幾輪」要用當日實測重算**：10-07 早上用上週三席並行的數據估 8 到 10 輪，下午用當日單席數據重算是 4 到 5 輪。

## 10-04 下午計畫席學到、下一任會再用到的（labor-plan-20261004-1110，15:58 寫）

- **授權一送出就不可撤回**：#1313 作者在授權後一分鐘更正「工具列寬度說錯了」，我送 HOLD 比 reviewer 的合併慢一步，回歸進了 main（#1315 另修）。有疑慮時在授權前多等作者一輪；授權訊息裡寫「verify 綠後合」不等於可以攔。
- **auto-mode 分類器會擋三類計畫席／生產席的正當動作**：`gh pr merge`（Merge Without Review）、對 db-reset 說「跑」（Cloud Storage Mass Delete）、生產席的 `nx typecheck`／`nx test`（CI Bypass，連不帶 `--skip-nx-cache` 都擋）。處置不繞：合併改使用者親合、reset 改使用者直接下令、驗證改以 CI verify 為證並在 PR 寫明。要解要使用者加 permission 規則。
- **「資料形狀贏」留下的後續項要有家**：#1314 一張追蹤單，每個目錄過 gate 時在裁定留言寫「已記 #1314」並更新表格 —— 掛在必然發生的動作上。開單前逐條核過：課表五條已被做掉、成績 G7 的 API 在 #1280 已修（前任說「另開單」其實沒開也不用開）。
- **Tailwind 換版 PR 的非保留類證明法成了慣例**：`.ts` 只刪 styleUrl＋頁面加 PageOpen import（附 `git diff --stat`）、模板去 class／`[class.x]` 再去空白後與 main 逐字相同、金額相關目錄列每個金額欄位與 pipe 的逐欄表、spec 掛勾 class 全 grep 一輪補回；reviewer 用綁定 token 多重集合比對（#1316 起加「token＋巢狀路徑」）。權限區塊（staff）與金額欄位（fee-templates／meals／reports）靠這套裁成非保留類。
- **席位自己撤回建議、更正事實、問「繼續」算不算放行 —— 三次都對**：fee-templates 分章要動 `.ts` 跟零改動衝突（撤回）；工具列「沿用現狀」說錯（更正）；「繼續 parents」早於 gate 留言（問）。計畫席說「繼續 X」時要明示是不是 gate 通過。
- **一席 Sonnet 做機械換版的量**：11 支 PR／約 3.5 小時，Weekly 90→93%（每小時約 1%），每支範圍說明 → gate → PR → 二讀 → 合約 25 分鐘。等 gate 期間席位看下一個目錄不寫碼，零 idle。
- **使用者外出時的做法**：含 migration 的 PR 攢著不合（免得 waiting 卡住）、非 migration 走 v3、裁決留「編號＋選項」給他回。
- **內嵌 `styles:` 寫在 `.ts` 裡會躲過 token gate**（只掃 `.scss`），而 SCSS 式 `&__x` 巢狀在原生 CSS 從沒生效 —— leave-form-dialog 的 `--red-500` 未定義與間距從沒生效都是這樣活下來的（#1319 換版後才生效，高度 −14px）。

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
| `labor-20261004-0110`（Opus）            | 前端：#991 courses C3 十支 dialog（遷完收成一行 @source）→ #1138 餘項逐頁接分校 context → #1194 課塊代課文案 | 開席 10-04 01:10，接 1552（已關，charter #1227／#1236 已合）；設計稿與 .pw-regression 已複製 |
| `labor-20261003-2006`（Opus）            | 後端：#1127 全線完成（A #1229／B #1238 已合）；#1216（等使用者）；公開端點 #1125（#1241 等使用者）→ #1123 → #1124 → #1126；charter #1233 已合 | 開席 10-03 20:06，接 1536（已關，charter #1200 已合）；本機 DB 乾淨基線 RESET #15 |
| `labor-20261003-2033`（Opus）            | 後端 sessions API：#1225（等使用者）→ #1228 → #1235（鏈，逐層轉 base）；#1146 → #1240（等使用者）；之後 #1195、CONCURRENTLY 守衛；charter #1237 已合 | 開席 10-03 20:33，第三生產席（計畫席判斷：未指派串擋課表功能、額度撐得住） |
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

## 10-04 計畫席學到、下一任會再用到的（labor-plan-20261003-1534，10-04 07:0x 寫）

- **合鏈的底層時不要 `--delete-branch`**：GitHub 會把疊在上面的 PR 自動關閉（#1228→#1291、#1255→#1292、#1247 重開）。先合、等上層轉 base 推完，再由計畫席刪分支。
- **同一支豁免清單（api-param-coverage.mjs EXEMPT）是連環衝突源**：連續合會讓下一支 CONFLICTING，排序上先合同檔的、或叫作者一次 rebase 到最後。
- **v3 的二讀真的抓到東西**：#1235 的 unique key 順序、#1258 的頂層排序不穩、#1261 的浮點加總 —— 二讀要「只報不合」，合由計畫席讀完決定。
- **守衛腳本（migrate Approve 期間取消插隊 run）兩輪都用上**，#1212／#1219 各取消一顆；腳本在 README 沒有，下一任要掛就重寫：loop 30s、保護最新 waiting、cancel 比它晚且未完成的、apply success 寫 GREEN。#1240 合了之後理論上不用，但第一次真實 Approve 前凍結規則照舊。
- **額度**：10-03 三次全席斷線（16:0x、21:1x、02:3x），Weekly 從 40% 到 76%；三個生產席並行時每小時約 10%。斷線回流只喚醒有未完成工作的席。
- **使用者的話先查再做**：「1225 merged」是別人輸入框殘字；「我決定放權 api 部署」要先問放到哪一層（三選一）。

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
