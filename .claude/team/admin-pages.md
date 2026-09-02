# admin-pages 席

> 管理端頁面。**session 會死，席位不死** —— 接手先讀這份，再讀 [README](README.md) 的通用協定。

## 管什麼

- `apps/web/src/app/features/admin/pages/**` —— 功能區一個目錄，**看目錄不要看清單**
- 被 admin 頁用到的 `apps/web/src/app/shared/components/**`（dialog、responsive-table、
  empty-state、page-breadcrumb 等）。要共用就往 `shared/` 提，feature 之間不互相 import（c5）

**不碰**：`apps/api/**` 與 schema（billing-api 席）、`styles.scss` 與 design tokens（design-web 席）、
CI/harness/依賴（infra 席）。需要新 API 或改 schema → 回報計畫席，不自己動。

## 開工前必讀（依序）

1. `kb/wiki/roadmap.md` 第 0 節現況表 —— 這個功能區是空殼、部分接上、還是已接通？決定工作性質
2. `kb/wiki/specs/admin/<功能>.md` —— 需求真相
3. `kb/wiki/lessons/menu-entry-without-a-route.md` —— **這一席的招牌坑，見下**
4. `kb/wiki/lessons/empty-array-hides-loading.md` —— 空陣列把「還沒載入」講成「真的沒有」，
   含盤點方法與一個 known issue
5. `kb/wiki/architecture/admin-dashboard-v1.md` —— 卡片/索引模式與失敗態
6. `kb/wiki/architecture/teacher-students-view.md` —— 「一個功能一個家」

## 先例（照抄，不要重新發明）

- **路由單一真相是 `core/smart-enums/routes-catalog.ts`。** 跳轉一律
  `RoutesCatalog.X.absolutePath`，不要寫字串字面值 —— 字面值不會被 `app.routes.spec.ts` 守到
- **併發取數 + 每個區塊自己失敗**：`features/admin/pages/dashboard/dashboard.component.ts`
  的 `failSoft()`。`forkJoin` 預設 fail-fast，任一支掛掉整頁空白；每支 source 各自
  `catchError(() => of('error'))` 才做得到部分失敗。三態用 `null` = 載入中、`'error'` = 失敗、
  數字 = 有值
- **有邊界條件的計算抽成純函式 + spec**：`dashboard.util.ts`、`enrollments/enrollment-event.util.ts`、
  `staff/teaching-log-dialog/teaching-log.util.ts` 都是先例。元件測試很難把跨日、空值、
  時間邊界測乾淨，純函式很容易
- **細部權限走 `RouteObj.permission`**（PR #58 建立）：填了它就要兩邊都動 ——
  `NavigationService` 過濾選單（不要讓人點到必然 403 的按鈕）+ `app.routes.ts` 掛
  `permissionGuard`（藏起入口擋不住直接打網址）。**permission 是每條路由自己的值**：
  金流頁 `manage_finance`（會寫）、營收報表 `view_reports`（唯讀）—— 兩者在
  `core/staff.service.ts` 的 union 裡是不同的東西，別當成一個「財務」開關。
  元件內的 `auth.hasPermission()` 留給次級動作（某顆按鈕），要在 `computed` 裡呼叫
  （隨 signal 反應），不要在 field initializer 取快照
- **讓「接對了沒」可斷言 —— 必要時給執行期的東西留一個可讀的標記。** 這是坑 #1 的推廣：
  坑 #1 是「有沒有接」，它的下一階是「接的是不是**對的那個**」，後者更安靜。
  `permissionGuard` 回傳的是一個閉包，從外面看不出它守哪個權限，所以它把權限名
  `Object.assign` 到回傳的 function 上，`app.routes.spec.ts` 才驗得到「選單過濾與路由守衛
  守的是同一個權限」。兩行程式碼換掉一整類「兩邊都有東西但守的不是同一件事」的錯。
  遇到 factory 產生的 guard / interceptor / resolver 都適用
- **前端不承諾後端沒有兌現的東西。**（PR #66 / #68 建立，計畫席指定入 charter）
  這條有兩個面孔，都是「畫面看起來能用、實際會騙人」的同一個病：
  - **不要做只篩得到當頁的篩選。** `/api/invoices` 有分頁又沒有 `status` 參數，
    前端自己篩狀態只篩得到當頁 20 筆 —— 使用者看到「未繳 3 筆」而真相是 47 筆。
    繳費頁因此不做狀態下拉，改用每列的 Tag + API 真的支援的 `overdue=true`。
  - **不要掛後端不檢查的 `permissionGuard`。** `/api/contact-book` 的 mount 只有角色
    沒有 permission，前端硬掛一個只會得到「選單藏起來但直接打網址就進得去」，
    而且沒有人會發現不一致。上面那條「填了就要兩邊都動」的前提是**後端真的守著它**。
    推廣：交付前問一次「這個畫面承諾的事，後端做得到嗎」。做不到就少做一項並回報，
    不要用前端補一個假的 —— 假的那個會被信。
- **冪等做在後端，信心做在文案。** 月結（`POST /api/billing-runs`）是冪等的 ——
  它只撈沒蓋章的、處理完就蓋上 `invoice_item_id`，所以同一個月跑第二次不會重複開帳單。
  但**行政不知道這件事就不敢按第二次**，而「這個月到底跑過沒」正是他們會猶豫的地方。
  所以 UI 上直接寫「同一個月可以重複跑」。**危險操作的按鈕不是只要能按，還要按得下去** ——
  把工程性質翻譯成一句人話，比任何確認對話框都有用
- **後端刻意暴露出來的東西，前端不要蓋回去。**（#90 建立）
  營收報表的分組有 `（跨分校）` / `（跨課程）` / `（未分類）` 三個桶：一張帳單可以跨班
  也可以完全沒有班，後端**刻意**不做比例拆分（拆出來的數字沒人能跟收據對得起來）也
  不重複計入多個組（那會讓小計大於總計），而是多給一列把模糊**明著標出來**。
  前端把它藏起來、合併掉或改名，等於把那個設計蓋回去，而且會變成「小計加不回總計」
  的無聲錯誤。**照實顯示，再加一句說明它為什麼存在。**
  通則：後端註解裡寫「刻意」「不做 X 因為 Y」的地方，那是設計不是缺陷。
- **後端的形狀決定 UI 能給什麼能力 —— 判斷順序是先看後端吃什麼，再決定畫面給不給那個動作。**
  （#87 建立）餐費的區間模式是**唯讀**的：`GET /api/meals` 區間只回實際記錄、沒有
  「候選」概念（`classNames` 空、`mealDefault` false），而 `POST /batch` 吃的是
  **單一 `date`** —— 跨天的修改沒有對應端點。所以欄位全部 `disabled`、沒有確認按鈕，
  **而不是讓人改了卻存不進去**。這是「前端不承諾後端沒有兌現的東西」在**動作**層的版本
  （上一條是在**資料**層）
- **改一個 design token 的語意時，要掃它的「用途」而不只是找它的名字。**（#100 建立）
  `--accent-*` 從天藍換成品牌橘之後，所有拿 accent 強調**數值**的地方一夜之間跟警示色
  撞在一起（`--accent-600` 與 `--warning-600` 的 RGB 距離只有 34），營收報表的「退款」
  與「應收未收」變成同一個顏色 —— **換色的 PR 全綠，因為沒有任何測試在看顏色的語意**。
  掃的方法：找 `color: var(--token-` 的每一處，用 selector 名稱（value/amount/count/
  total/score…）篩出資料強調用途，再**逐一開檔看上下文**分成「數據」與「互動／狀態」。
  批次套規則會誤傷 —— 「已選 N 個」是選中態不是數值，`--dirty` 是狀態語意組的一員。
- **「前端能不能篩」看的是資料完不完整，不是「前端篩」這個做法本身。**
  同一個動作在兩支 API 上一個騙人一個不騙：`/api/invoices` 有分頁（前端篩會漏），
  `/api/contact-book` **沒有分頁**且 `meta.total` 是 `count: 'exact'`（前端篩與前端分頁
  都誠實，因為手上就是全部）。**先確認那支 API 有沒有分頁，再決定篩選放哪一端。**
- **顏色是有預算的 —— 每天都出現的常態花不起警示色。**（刀 3，2026-09 建立）
  餐費頁 8 列有 8 列是黃的、聯絡簿 6 列有 5 列是黃的，而那**就是每天早上的正常樣子**。
  沒人授權過「常態 = 警示」這個宣稱，它是一顆一顆 `severity="warn"` 累積出來的。
  三個可操作的判準：
  - **先問這一態是不是常態。** 是的話它必須沒有色相 —— 否則整欄都是警示，警示就沒有意義
  - **深淺表示「還在等 vs 不再等」，色相才表示「好 vs 壞」。** 一個還沒到期的待辦不是壞事
  - **`opacity` 會穿過對比 gate。** harness 的對比檢查看的是 `color` 與 `background` 的配對，
    `opacity: 0.6` 之後的實際對比它算不到 —— 要淡就調 token，不要調透明度
- **「沒有值」常常是一種值，不要為了消掉警告而消滅它。**（#162 建立）
  工單要把班級日期改必填來消除「無未來排程」的警告。但 `end_date IS NULL` 是**不限期**，
  API 靠它判斷班還在（`classes.ts:426`）、頁面靠它判斷歷史班；改必填等於刪掉一個合法狀態。
  另一半同樣重要：**那個警告不是誤報**，它算的是 sessions 表有沒有未來課堂，跟日期無關。
  **現象對不代表歸因對** —— 收到「A 導致 B」的工單，自己把因果鏈重走一遍：
  這次真正的病灶是補救路徑上多了一道門，不是 A 也不是 B。
  這跟 `empty-array-hides-loading` 是同一族的反面：那邊是把「不知道」寫成一個值，
  這邊是把一個有意義的值當成「還沒填」。**兩邊都要問一次：這個 null 在說什麼。**

## 坑（都是實際踩過的）

1. **選單與路由表之間的縫。** 頁面寫好、`showInMenu` 打開、測試全綠，路由卻還是
   `redirectTo` —— 功能等於沒交付而所有 gate 都綠。現在 `apps/web/src/app/app.routes.spec.ts`
   對每個 `showInMenu` 項目斷言「路由找得到」且「載入的是頁面不是 redirect」。
   **開新頁時它是你的安全網，別跳過它。** 通則：grep 一行不足以證明接線正確，
   路由/註冊/掛載這種「一個位置決定行為」的東西要連上下文一起讀
2. **`GET /api/attendance/sessions` 的 `date` 會蓋掉 `dateFrom`/`dateTo`**
   （`apps/api/src/routes/attendance.ts`）。想同時要「今天」和「一個回溯區間」必須發兩個請求 ——
   這也剛好讓兩個區塊各自失敗，不會一起死
3. **`OrgSettingsService.settings` signal 不是自動填的**，沒有 APP_INITIALIZER。要用
   `attendance_mode` 這類機構設定就自己 fetch，別假設它有值
4. **列表 API 的 `pageSize` 多半上限 100。** 要顯示「這段期間有幾筆」就取 `meta.total`；
   抓單頁明細自己數，會在量大的月份**悄悄少算而且錯得沒有徵兆**
5. **`nx test web --filter=...` 會騙人。** 它是 vitest 的 regex 且比對的不是檔案路徑；
   我試過的寫法讓 0 個測試跑到，卻印 `Successfully ran`。**全部 skip 也是綠的。**
   要嘛跑全套，要嘛核對測試數有沒有增加
6. **web 沒有 `typecheck` target。** `nx affected -t typecheck` 對 web 回 no tasks，
   web 的型別是 angular compiler 在 test 階段檢查的。「affected typecheck 綠」對 web 不構成保證
7. **生成檔在分支上不要重生，撞到了才重生、絕不手併。** `roadmap.md` 的 `FEATURE-MAP`
   在分支上過期只是**提醒不紅燈**（PR #70 起），main 的 verify workflow 會自動重生 ——
   harness 自己會叫你別跑，照它說的做。真的撞了才 `harness:write`（自帶 prettier）；
   `kb/wiki/index.md` 與各 `_moc.md` 用 kb-wiki 的 `map` 重生。**任何情況都不手併生成區塊。**
8. **`map` 會保留既有的 curated summary**，frontmatter 的 `summary` 只對索引裡還沒有的新頁生效。
   改了既有頁的 summary，`index.md` 與該分類 `_moc.md` 那兩行要手動同步，或跑 `map --regen-summaries`
9. **`kb/` 的 design token 不是 `--color-*`。** 實際存在的是 `--zinc-*` / `--accent-*` /
   `--space-*` / `--text-*` / `--radius-*` / `--font-*`（看 `styles.scss`，或直接抄
   `campuses.page.scss`）。我照別的專案的習慣寫了 `var(--color-text-primary)`，
   編得過但整頁沒有顏色 —— **CSS 變數打錯不會報錯，只會靜靜地不生效**
10. **`enrollments.page.ts` 是唯讀瀏覽列表，不是報名表單。** 報名的建立走班級名單的
    `student-picker-dialog`（`POST /api/enrollments/batch`，**不吃計費欄位**），
    單筆修改走班級名單的動作選單（`PUT /api/enrollments/{id}`，吃）。
    工單說「去報名頁加欄位」時先確認它指的是哪一個
11. **不要對 `index.md` / `_moc.md` 跑 prettier** —— 它們是 generator 原始輸出，
    prettier 會在每個 `## 標題` 後插空行製造反向雜訊。`roadmap.md` 相反，它是 prettier 對齊過的
12. **送出時「清空一個欄位」要送 `null` 不是 `undefined`。** 後端把 `undefined` 當成
    「沒給」而保留原值 —— 餐費的備註因此清不掉。`note: row.note.trim() || null` 而不是
    `|| undefined`。這類 null 語意值得一個測試，因為它**只在「把有值的欄位清空」那條
    路徑上錯**，新增與修改都是對的。
13. **渲染大量列的 PrimeNG 輸入元件會 `Maximum call stack size exceeded`。**
    餐費頁的「超過 300 筆擋住」測試原本走 `fixture.whenStable()`，301 列直接爆掉。
    **驗邏輯的測試直接設 signal 不要走渲染** —— 它要驗的是擋不擋得住，不是畫不畫得出來。
14. **自己 grep 出來的推論，比別人給的前提更危險。** 盤點載入態時我看到某個檔案的
    grep 結果裡有 `subscribe`，就推論「這份資料是非同步載入的」並把它列進真陽性清單 ——
    實際上那是批次操作的 subscribe，資料是 `config.data` 同步傳入的，照那個診斷去修會
    做出一個永遠是 false 的假 loading signal。**工單的前提我會驗，自己掃出來的結論
    反而不驗** —— 因為它披著「我親自掃過」的外衣。陽性結論跟否定結論一樣要開檔確認
    （工作習慣那節「從空結果推否定結論之前先確認工具沒洞」的正面版：**否定與肯定的
    結論一樣要驗**）。**同一條線上還有一個更便宜的版本：單次觀察不足以斷定缺陷。**
    我從一次沒點中的滑鼠回報過「這裡有點不到的死區」，用 `elementFromPoint` 量五個位置
    才發現全都在列內 —— 撤回比發出去貴。**發現「怪」到宣稱「壞」之間，補一次測量。**
15. **交付新頁面要把它認領進 `tools/agent-harness/feature-map.mjs` 的 AREAS**，
    否則 `npm run harness` 會紅（「頁面 未被任何功能區認領」），`harness:test` 也跟著 fail。
    那是 infra 席的檔案，但**這一行是 gate 明確要求交付者補的**，不是主動動 infra ——
    就像新增 skill 之後要跑 `harness:write`。**只補那一行、不要順手重生 roadmap**（坑 #7）；
    PostToolUse 的 prettier 若順手重排了檔案裡其他地方，把那些還原 —— 那是別人的檔案。
    **區分**：紅燈擋住交付 → 自己補；只是顯示不準（route 歸錯功能區之類）→ 回報計畫席。
16. **別人造成的紅燈不要自己補，但一定要回報。** 坑 #15 的「自己補」只適用**自己的交付
    造成的**紅燈。這一輪 main 紅過一段時間（`c8` allowlist 過期，別席改完沒清），
    補它會把不相關的改動混進自己的分支；但不回報的話，**下一個開分支的人會以為是自己
    弄壞的** —— 我就花了一次來回切到乾淨的 `origin/main` 重跑才確認不是我。

17. **standalone 元件的 `imports` 陣列沒有人幫你對帳。** 把模板裡最後一個 `<p-tag>` 換掉之後
    `TagModule` 還留在 `imports` 裡，**編譯、測試、build 全綠** —— 沒用到的 import 不是錯誤。
    改模板時順手掃一次自己動過的元件：移掉的是**依賴**，不是錯誤，所以沒有任何 gate 會提。
    跟坑 #9（CSS 變數打錯不報錯）同族：**靜靜地不生效與靜靜地留著，都不會有紅燈。**
18. **`toISOString()` 是 UTC。** `new Date().toISOString().slice(0, 10)` 在 UTC+8 的
    00:00–08:00 之間回**昨天** —— 三個正式站的地方加兩個測試踩過。要今天的日期用
    `shared/utils/session-time.util.ts` 的 `todayLocal()`。連帶：**測試不要依賴牆上時鐘**，
    把 `now` 當參數傳進去，否則它只在某些時段是綠的。

## 這一席的工作習慣

- **設計文件沒到手不要動工。** 遇過工單說「設計在 main 上」但檔案根本不存在（從沒 commit）。
  查不到就回報計畫席要，不要拿工單摘要當設計自行補完
- **工單裡的前提要實際驗證再信 —— 資料前提如此，它建議的修法也一樣。**
  儀表板 v1 六張卡有一張的 API 前提是錯的（以為有進出聚合，實際只有明細加 total），
  照原設計做會顯示錯數字。派唯讀 agent 逐項確認 API 存不存在、回傳什麼形狀，比事後改便宜。
  **修法的部分**：#162 的工單給了兩個傾向，查完兩個都會製造新問題（見先例「沒有值也是一種值」），
  兩個都沒採用、改提第三條。計畫席的回覆把這件事定了性 ——
  **工單的傾向僅供參考，查證後推翻是本分。** 推翻時要帶著證據回報，不是默默改成別的
- **從空結果推否定結論之前先確認工具沒洞。** 我用 `find -type d` 找一個 symlink 目標，
  回空就斷言「不存在」並寫進 PR —— 是錯的
- **既批 spec 涵蓋的頁面不用補設計文件。** `clessia-feature-slice` 的設計文件是為了
  **取得批准**；工單說「STOP gate 由既批 spec 覆蓋」時，決策記在 commit message 與 PR 即可。
  事後補一份沒人會讀的存檔違反「實作計畫不進 KB」的精神（2026-08-30 計畫席裁定）。
  **但別在 spec 裡引用一份你沒寫的設計文件** —— 我一度寫了 `[[architecture/admin-meals-page]]`
  才發現那頁不存在
- **防線分三種，距離不一樣 —— 挑得動的那一種。** 純函式擋住**所有**呼叫端；
  測試擋住**正在改這段的人**；註解只擋**願意停下來讀的人**。
  兩個實例：`session-time.util.ts` 把「這堂課上完了沒」變成一個函式，兩個畫面就不可能
  各說各話；而「teacher dashboard 那支同名概念的 `null` 行為跟這支相反，這是兩個函式
  不是重複」原本只是一句註解，寫成一個**測試**之後，才擋得住「看起來重複所以合併了、
  然後跑 CI」的那個人 —— 而那正是會做這件事的人。**發現一個誤會容易發生時，
  先問這句話能不能升級成程式碼。**
  同一節裡的反面：**型別是一個會過期的保證。** `Session.startTime` 型別上不可為 null，
  但欄位語意會變、schema 會改，執行期的判斷該自己守住 `if (!startTime) return false`。
  型別擋的是**現在**的呼叫端，不是未來的資料
- **判斷一個狀態值的意思，值域和標籤兩邊都要看 —— 然後去讀那個動作的確認文案。**
  考試的 `active`/`closed` 我從值域讀成「啟用/停用」的開關，design-web 從標籤讀成
  「進行中/已結束」，**兩邊都只對一半**。真正的權威定義在按下那顆按鈕的確認對話框裡：
  「結束後將無法再登錄分數」—— 一句話同時給了語意和不可逆性。
  **要知道一個狀態代表什麼，去找改變它的那個動作怎麼跟使用者解釋。**
- **視覺改動可以在部署前用「模擬法」預覽**：在已部署的頁面上用 JS 把那個元素的
  computed style 改成新值 → 截圖 → **改完還原**。比跑本機 dev + seed 便宜得多，
  而且能給出視覺證據。**兩個前提缺一不可**：回報時明講「這是模擬不是部署實況」，
  以及做完把頁面還原（留一個被改過的頁面給別人看比沒截圖更糟）。
- 收工前照 `.github/workflows/verify.yml` 的序列在本機重放一次，不要只跑 affected

## 進行中狀態（2026-09-02 —— 這節會過期，接手第一件事：重寫它）

**P2 管理端四個功能區已收官並全部合進 main。** 之後是一連串顯示端的小追加與修正：
#100（accent 退出數值強調）、#103/#122（漏點名可見性 + `session-time.util`）、
#112（載入態的 kb lesson）、#135（點名的 `null` 不等於缺席）、#142（四件顯示端小修）、
#162（課程頁三個死路）。

**design-web 的「刀 3」已收官**（狀態膠囊遷移，`p-tag` 61 → 8）。剩下的 8 個是刻意不動的
兩批：匯入預覽（那是**行動的預測**不是事物的狀態）與 teaching-log 摘要 chip（描述的是
**集合的問題數**不是單一事物的狀態）。**不要順手把它們也換掉。**

### 掛著的

1. **報表的 CSV 匯出** —— spec 要**明細層**欄位，`/api/reports/revenue` 只回聚合。
   **不要用聚合資料湊一個欄位對不上 spec 的 CSV**；明細端點在 billing-api 佇列
2. **UX 稽核的結構性提案在計畫席的彙整池**（A6 / B1–B4）。頭條是 B3「報名＝開帳是同一件事」——
   金流家族目前**結構上是斷的**：七個頁面裡只有 `enrollments` 有跨頁導覽，其餘六頁
   連一個 `routerLink` 都沒有。等計畫席裁示，不要自己開工

### 已經結案、不要再擔心的

**`attendance_records.status` 的 `DEFAULT 'absent'` 已經拔掉**（billing-api 席，
`20260902020758`）。#135 修的是前端不再把 `null` 講成缺席，這支把 DB 那層也堵上：
**現在忘了給 `status` 的 INSERT 會直接失敗，而不是安靜寫一筆假缺席。**
如果哪天前端漏送 `status`，你會收到 500 —— 那是設計，不是後端壞了。

**「我的 `--warning-*` 與 PrimeNG `severity="warn"` 會不會出現兩種黃」** —— 實測沒有，
兩者是同一組色（`#fef3c7` / `#b45309`，就是 `--warning-100` / `--warning-600`）。
真正的問題不是黃色有幾種，是**黃色太多**（見先例「顏色是有預算的」）。

### 這一輪的節奏（下一輪大概也一樣）

**後端先行，前端接顯示端小追加**，每次幾十行；**開工前先確認欠著的那些做了沒**。
另一個穩定的節奏是**跨席的視覺／token 改動會回頭波及已交付的頁**（#95 換 accent 語意 → #100）。
design-web 的刀合併後回去看一眼自己的頁，不要假設「只用既有 token 就一定沒事」。

### 四個 domain 的 API 形狀（下次動到直接用，不用重讀 route 檔）

- **`/api/invoices`**：有分頁；`status`/`total`/`netPaid` 後端推導好；`status` 與 `overdue`
  可並用且都走「全撈→篩→`sliceDerivedPage` 切頁」（所以 `meta.total` 是**篩後全體**）；
  收款與退費同一支端點差 `kind`；`receipt_no` 由 DB trigger 取號（退費沒有號）
- **`/api/contact-book`**：**沒有分頁**，`meta.total` 是 `count: 'exact'`；
  `PUT /` **回裸 entry 不是 `{ data }`**（鍵是 `student_id, entry_date`）；
  `GET /missing?date=` **每生一列不是每班一列**，且「該寫」綁的是「這個班那天有課」；
  mount 只有角色沒有 permission；entry **沒有 classId**
- **`/api/meals`**：**兩種模式回同一種列** —— `date=` 是候選+記錄（可編輯），
  `dateFrom/dateTo` 只回實際記錄（`classNames` 空、`mealDefault` false，**唯讀**）。
  `POST /batch` 上限 **300 筆**、已結算的擋下來回 `lockedStudentIds`（要顯示出來）。
  `recordId === null` = **這天還沒人處理**，不是「沒訂」。
  `meta.totalAmount` 是「這段期間吃了多少錢」（已結算的照樣算）
- **`/api/reports/revenue`**：聚合端點，`view_reports` 權限。回 `{ summary, groups }`。
  **前端一個數字都不加總。** 篩選是「這張帳單有沒有沾到」，分組是「一張帳單只進一個組」；
  `（跨分校）`/`（未分類）` 是**刻意暴露的模糊桶**，照實顯示（見先例）

### 四個做法值得照抄

- **列印**（`invoice-detail-dialog`）：`window.open` 開空白視窗 + `importNode` 搬節點，
  樣式 inline 在那個視窗。**不要跟 `@media print` 打架** —— dialog 是 modal，
  `window.print()` 會連遮罩和背後列表一起印
- **後端上限就在前端擋住**（`meals.component.ts`）：`POST /batch` 上限 300，超過就擋並提示。
  靜靜截斷會讓後面的學生沒有記錄**而且沒有徵兆**
- **危險操作把工程性質翻譯成人話**（`billing-run-dialog`）：月結是冪等的，UI 就直接寫
  「同一個月可以重複跑」。不講的話行政不敢按第二次
- **跨頁共用的判斷抽成 `shared/utils/*.util.ts`**（`session-time.util.ts`，理由見工作習慣
  「防線分三種」）：吃**最小結構介面**而不是 domain 型別（兩邊欄位名不同），
  呼叫端各自適配一行

### 環境

worktree 在 `.worktrees/admin-pages`，待命分支 `admin-pages-idle`。開工一律 `git fetch`
後 **`git checkout -b <new> origin/main`** —— 注意是 `-b` 不是 `-B`：`-B` 會移動既有的
分支指標，而多 worktree 共用同一組 ref，主 checkout 的 HEAD 會被拖著跳、index 脫鉤
（2026-08-30 全隊查過一次的幽靈回退變更就是這樣來的，規則已進 README）。

root 與 `apps/api` 都 `npm ci` 過。

收工前照 `.github/workflows/verify.yml` 的序列在本機重放：`harness` → `harness:test` →
`nx run-many -t typecheck` → `nx run-many -t test` → **`nx build web --configuration=production`**。
最後那步是**唯一會編譯 Angular 模板的一步**（坑 #6），不要跳。

開工前重新看一次 roadmap 第 0 節現況表 —— 它是自動生成的，比這份 charter 新。
