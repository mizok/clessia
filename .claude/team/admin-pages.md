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
12. **交付新頁面要把它認領進 `tools/agent-harness/feature-map.mjs` 的 AREAS**，
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

**交接自 session `admin-pages-1f`。** P2 的管理端頁**四張全部交付完畢**：

| PR  | 內容                                     | 狀態               |
| --- | ---------------------------------------- | ------------------ |
| #66 | 繳費紀錄頁                               | 已合               |
| #71 | 聯絡簿管理端頁                           | 已合               |
| #72 | 繳費頁的 status 篩選 + 可信 `meta.total` | 已合               |
| #79 | 聯絡簿「這天還沒寫」的當日待辦           | 驗收過，使用者佇列 |
| #82 | 餐費管理頁                               | 驗收過，使用者佇列 |

營收報表 `/admin/reports` 仍是空殼 —— **沒有聚合端點**（`invoices` 是明細 API），
這是 P2 唯一還擋著的管理端頁。

### 你接手時欠著一個追加

**餐費頁的三個缺口已轉派 billing-api 席**（2026-08-30），做好之後接顯示端：

1. `meal_records.note` 的**讀寫都不通** —— 欄位在 DB 裡，`GET /api/meals` 不回、
   `POST /batch` 不吃。通了之後餐費頁加一個備註欄（現在刻意沒做：存不進去的欄位比沒有更糟）
2. `MealRosterRow` **不回 `className`** —— spec 說每列要顯示班級
3. `GET /api/meals` **只吃單日**，沒有區間、沒有學生篩選、沒有 `meta` ——
   spec 的「查詢與統計」整節因此做不了

**這是這一席的常態節奏**：後端先行，前端接顯示端小追加。前一輪也欠過三個
（繳費的 total、status 下拉、聯絡簿的 missing 清單），都在 #72 / #79 清掉了。
**接手時第一件事是確認這三個做了沒**，做了就接，那通常是幾十行的事。

### 三個 domain 的 API 形狀差異（下次動到直接用，不用重讀）

- **`/api/invoices`**：有分頁；`status`/`total`/`netPaid` 後端推導好；`status` 與 `overdue`
  可並用且都走「全撈→篩→`sliceDerivedPage` 切頁」那條路徑（所以 `meta.total` 是**篩後全體**）；
  收款與退費同一支端點差 `kind`；`receipt_no` 由 DB trigger 取號（退費沒有號）
- **`/api/contact-book`**：**沒有分頁**，`meta.total` 是 `count: 'exact'`（可信）；
  `GET /`（區間）、`PUT /`（upsert，鍵是 `student_id, entry_date`，**回裸 entry 不是 `{ data }`**）、
  `GET /missing?date=`（**每生一列不是每班一列**，且「該寫」綁的是「這個班那天有課」）；
  mount 只有角色沒有 permission；entry **沒有 classId**
- **`/api/meals`**：**只吃單日**；`GET` 回 `{ data, defaultUnitPrice }`（沒有 meta）；
  `POST /batch` 上限 **300 筆**、已結算的擋下來回 `lockedStudentIds`（要顯示出來，
  後端刻意不靜靜跳過）。`recordId === null` = **這天還沒人處理**，不是「沒訂」

### 兩個做法值得照抄

- **列印**（`invoice-detail-dialog`）：dialog 是 modal，`window.print()` 會連遮罩和背後列表
  一起印。改成 `window.open` 開空白視窗 + `importNode` 搬節點，樣式 inline 在那個視窗。
  節點用 DOM 搬不拼 HTML 字串（姓名與備註是使用者輸入）。**不要跟 `@media print` 打架**
- **後端上限就在前端擋住**（`meals.component.ts`）：`POST /batch` 上限 300，超過就擋並提示回報。
  靜靜截斷會讓後面的學生沒有記錄**而且沒有徵兆**

### 環境

worktree 在 `.worktrees/admin-pages`，待命分支 `admin-pages-idle`。開工一律 `git fetch`
後從 `origin/main` 另開分支。root 與 `apps/api` 都 `npm ci` 過。

**內部視覺正在被 design-web 席大改（PrimeNG 主題層）** —— 只用既有 token 與元件慣例寫，
別自創樣式，他們那刀合了你的頁會自動跟上。

收工前照 `.github/workflows/verify.yml` 的序列在本機重放：`harness` → `harness:test` →
`nx run-many -t typecheck` → `nx run-many -t test` → **`nx build web --configuration=production`**。
最後那步是**唯一會編譯 Angular 模板的一步**（坑 #6），不要跳。

開工前重新看一次 roadmap 第 0 節現況表 —— 它是自動生成的，比這份 charter 新。
