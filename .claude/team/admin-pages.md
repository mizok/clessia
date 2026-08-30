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
4. `kb/wiki/architecture/admin-dashboard-v1.md` —— 卡片/索引模式與失敗態
5. `kb/wiki/architecture/teacher-students-view.md` —— 「一個功能一個家」

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
- **「前端能不能篩」看的是資料完不完整，不是「前端篩」這個做法本身。**
  同一個動作在兩支 API 上一個騙人一個不騙：`/api/invoices` 有分頁（前端篩會漏），
  `/api/contact-book` **沒有分頁**且 `meta.total` 是 `count: 'exact'`（前端篩與前端分頁
  都誠實，因為手上就是全部）。**先確認那支 API 有沒有分頁，再決定篩選放哪一端。**

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
7. **生成檔在分支上不要重生，撞到了才重生、絕不手併。**（2026-08-30 更新）
   `roadmap.md` 的 `FEATURE-MAP` 區塊自 PR #70 起：分支上過期只是**提醒不紅燈**，
   main 的 verify workflow 會自動重生 —— harness 自己會叫你別跑，因為
   「這會讓你跟其他並行分支撞在同一張表上」。**照它說的做，別手癢跑 `harness:write`**，
   這比原本「一律重生」省掉一整類衝突。真的撞了才重生（`harness:write` 自 #70 起
   自帶 prettier，不用再手動跑一次）。`kb/wiki/index.md` 與各 `_moc.md` 仍用
   kb-wiki 的 `map` 重生。**任何情況都不手併生成區塊。**
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
14. **交付新頁面要把它認領進 `tools/agent-harness/feature-map.mjs` 的 AREAS**，
    否則 `npm run harness` 會紅（「頁面 未被任何功能區認領」），`harness:test` 也跟著 fail。
    那是 infra 席的檔案，但**這一行是 gate 明確要求交付者補的**，不是主動動 infra ——
    就像新增 skill 之後要跑 `harness:write`。**只補那一行、不要順手重生 roadmap**（坑 #7）；
    PostToolUse 的 prettier 若順手重排了檔案裡其他地方，把那些還原 —— 那是別人的檔案。
    **區分**：紅燈擋住交付 → 自己補；只是顯示不準（route 歸錯功能區之類）→ 回報計畫席。

## 這一席的工作習慣

- **設計文件沒到手不要動工。** 遇過工單說「設計在 main 上」但檔案根本不存在（從沒 commit）。
  查不到就回報計畫席要，不要拿工單摘要當設計自行補完
- **工單裡的資料前提要實際驗證再信。** 儀表板 v1 六張卡有一張的 API 前提是錯的
  （以為有進出聚合，實際只有明細加 total），照原設計做會顯示錯數字。派唯讀 agent
  逐項確認 API 存不存在、回傳什麼形狀，比事後改便宜
- **從空結果推否定結論之前先確認工具沒洞。** 我用 `find -type d` 找一個 symlink 目標，
  回空就斷言「不存在」並寫進 PR —— 是錯的
- **既批 spec 涵蓋的頁面不用補設計文件。** `clessia-feature-slice` 的設計文件是為了
  **取得批准**；工單說「STOP gate 由既批 spec 覆蓋」時，決策記在 commit message 與 PR 即可。
  事後補一份沒人會讀的存檔違反「實作計畫不進 KB」的精神（2026-08-30 計畫席裁定）。
  **但別在 spec 裡引用一份你沒寫的設計文件** —— 我一度寫了 `[[architecture/admin-meals-page]]`
  才發現那頁不存在
- 收工前照 `.github/workflows/verify.yml` 的序列在本機重放一次，不要只跑 affected

## 進行中狀態（2026-08-30 —— 這節會過期，接手第一件事：重寫它）

**交接自 session `admin-pages-1f`。P2 管理端四個功能區全部收官**，六支 PR：

| PR        | 頁                                        | 狀態               |
| --------- | ----------------------------------------- | ------------------ |
| #66 / #72 | 繳費紀錄 + status 篩選與可信 `meta.total` | 已合               |
| #71 / #79 | 聯絡簿 + 「這天還沒寫」當日待辦           | 已合               |
| #82 / #87 | 餐費 + note／班級／區間檢視               | #82 已合、#87 佇列 |
| #90       | 營收報表                                  | 佇列               |

**接手時第一件事：確認 #87 與 #90 合了沒**，合了的話管理端那欄應該全綠。

### 還欠的兩件

1. **視覺回歸確認** —— design-web 席的警示色收斂到琥珀（#89）合併後，要看過這四頁。
   我這幾頁只用既有 token 沒自創樣式，理論上會自動跟上，但**「理論上」不等於看過**。
2. **報表的 CSV 匯出** —— spec 要的是**明細層**欄位（日期、分校、課程、金額、類型），
   而 `/api/reports/revenue` 只回摘要與分組小計。**不要用聚合資料湊一個欄位對不上
   spec 的 CSV** —— 已回報，明細端點排在 billing-api 席佇列。

### 這一輪的節奏（下一輪大概也一樣）

**後端先行，前端接顯示端小追加。** 這一席交付了三輪追加（繳費的 total + status 下拉、
聯絡簿的 missing 清單、餐費的 note/班級/區間），每次都是幾十行。
**開工前先確認欠著的那些做了沒** —— 做了就接。

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
  `POST /batch` 上限 300、已結算的擋下來回 `lockedStudentIds`（要顯示出來）。
  `recordId === null` = **這天還沒人處理**，不是「沒訂」。
  `meta.totalAmount` 是「這段期間吃了多少錢」（已結算的照樣算），不是「還有多少沒收」
- **`/api/reports/revenue`**：聚合端點，`view_reports` 權限。回 `{ summary, groups }`。
  **前端一個數字都不加總。** 篩選是「這張帳單有沒有沾到」，分組是「一張帳單只進一個組」，
  兩者語意不同。三個模糊桶見上面的先例

### 三個做法值得照抄

- **列印**（`invoice-detail-dialog`）：`window.open` 開空白視窗 + `importNode` 搬節點，
  樣式 inline 在那個視窗。**不要跟 `@media print` 打架** —— dialog 是 modal，
  `window.print()` 會連遮罩和背後列表一起印，要壓掉得動 `styles.scss`（不是這席的邊界）
- **後端上限就在前端擋住**（`meals.component.ts`）：`POST /batch` 上限 300，超過就擋並提示。
  靜靜截斷會讓後面的學生沒有記錄**而且沒有徵兆**
- **危險操作把工程性質翻譯成人話**（`billing-run-dialog`）：月結是冪等的，UI 就直接寫
  「同一個月可以重複跑」。不講的話行政不敢按第二次

### 環境

worktree 在 `.worktrees/admin-pages`，待命分支 `admin-pages-idle`。開工一律 `git fetch`
後從 `origin/main` 另開分支。root 與 `apps/api` 都 `npm ci` 過。

**別人的紅燈不要自己補。** 這一輪 main 有一段時間是紅的（`c8` allowlist 過期，
design-web 改完沒清），那**不適用**坑 #14 的「紅燈擋交付→自己補」—— 那條講的是
**自己的交付造成的**紅燈。補別人的會把不相關的改動混進自己的分支。
**但要回報**，否則下一個開分支的人會以為是自己弄壞的（我就花了一次來回確認）。

收工前照 `.github/workflows/verify.yml` 的序列在本機重放：`harness` → `harness:test` →
`nx run-many -t typecheck` → `nx run-many -t test` → **`nx build web --configuration=production`**。
最後那步是**唯一會編譯 Angular 模板的一步**（坑 #6），不要跳。

開工前重新看一次 roadmap 第 0 節現況表 —— 它是自動生成的，比這份 charter 新。
