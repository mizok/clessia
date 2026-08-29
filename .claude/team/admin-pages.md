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
7. **生成檔解衝突一律重生，不手併**：`kb/wiki/index.md`、各 `_moc.md`、
   `roadmap.md` 的 `FEATURE-MAP` 區塊。前兩者用 kb-wiki 的 `map`，後者用 `npm run harness:write`
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
    就像新增 skill 之後要跑 `harness:write`。改完 `harness:write` 重生再 prettier。
    **區分**：紅燈擋住交付 → 自己補；只是顯示不準（route 歸錯功能區之類）→ 回報計畫席。

## 這一席的工作習慣

- **設計文件沒到手不要動工。** 遇過工單說「設計在 main 上」但檔案根本不存在（從沒 commit）。
  查不到就回報計畫席要，不要拿工單摘要當設計自行補完
- **工單裡的資料前提要實際驗證再信。** 儀表板 v1 六張卡有一張的 API 前提是錯的
  （以為有進出聚合，實際只有明細加 total），照原設計做會顯示錯數字。派唯讀 agent
  逐項確認 API 存不存在、回傳什麼形狀，比事後改便宜
- **從空結果推否定結論之前先確認工具沒洞。** 我用 `find -type d` 找一個 symlink 目標，
  回空就斷言「不存在」並寫進 PR —— 是錯的
- 收工前照 `.github/workflows/verify.yml` 的序列在本機重放一次，不要只跑 affected

## 進行中狀態（2026-08-29 —— 這節會過期，接手第一件事：重寫它）

**交接自 session `admin-pages-1f`。** 這一輪交付兩個 PR：**#66**（繳費紀錄頁，已驗收、
解過一次 roadmap 衝突、等使用者合）、**#68**（聯絡簿管理端頁）。P2 的兩張可開工的頁都做完了。

### 這一輪學到、已經寫進上面的東西

先例多了兩條（**前端不承諾後端沒有兌現的東西**、**能不能前端篩看的是資料完不完整**），
坑多了一條（**新頁面要認領進 feature-map**）。那三條是這輪的實質收穫，別只當歷史看。

### 接手時的實際狀況

| 頁                           | 後端                     | 狀態        |
| ---------------------------- | ------------------------ | ----------- |
| 繳費單 `/admin/payments`     | `/api/invoices`          | ✅ #66 交付 |
| 聯絡簿 `/admin/contact-book` | `/api/contact-book`      | ✅ #68 交付 |
| 餐費 `/admin/meals`          | ❌ `meal_records` 不存在 | 擋著，要 A3 |
| 營收報表 `/admin/reports`    | ❌ 沒有聚合端點          | 擋著        |

### 欠著的三個「小追加」——後端做好了就接，不要重做整頁

計畫席都已派工，做好之後這三件各是幾十行的事：

1. **繳費頁的總筆數** —— billing-api 席的 PR #64 修了 `GET /api/invoices` 的 `meta.total`
   （原本非 overdue 路徑回的是當頁筆數）。修好後 `payments.page.ts` 的
   `hasNextPage`（現在靠「當頁滿 20」推）換成真的總數與頁碼。
2. **繳費頁的狀態篩選下拉** —— 同 #64 加的 `status` query 參數。加上去之後才可以做
   狀態篩選，**在那之前不要用前端補**（見上面的先例）。
3. **聯絡簿的「今天哪些該寫還沒寫」** —— 等 billing-api 席的
   `GET /api/contact-book/missing?date=`（server 端算 `uses_contact_book` 的班 × 在籍學生
   × 當日 entries 的差集）。**不要用現有 API 自己組** ——`GET /api/classes` 沒有
   `usesContactBook` 篩選而且列表分頁，撈全部班再前端挑會悄悄漏班（坑 #4），
   而且要逐班打 enrollments，是 N+1。

### 還有一筆待回報的顯示問題（不紅燈，所以我沒動）

`feature-map.mjs` 把 `invoices` route 歸給「計費」功能區，「繳費」的 `routes: []` ——
所以現況表對繳費顯示「已掛載 API 0」。加一行 `'invoices'` 就對（「課務異動」認領
`sessions` 是同檔案裡帶註解祝福的先例）。計畫席已派 infra 席，**確認做了沒**。

### 兩個 domain 的形狀差異（下次動到時直接用）

- **`/api/invoices`**：有分頁；`status`/`total`/`netPaid` 後端推導好；收款與退費同一支
  端點差 `kind`；`receipt_no` 由 DB trigger 取號（退費沒有號）。
- **`/api/contact-book`**：**沒有分頁**，`meta.total` 是 `count: 'exact'`（可信）；
  只有 `GET /` 與 `PUT /`（upsert，鍵是 `student_id, entry_date`）；
  **`PUT` 回裸的 entry 不是 `{ data }`**；mount 只有角色 `['admin','teacher']` 沒有 permission；
  entry **沒有 classId**，所以「按班級看聯絡簿」在資料上做不到。

### 列印的做法（`invoice-detail-dialog`）

dialog 是 modal，`window.print()` 會連遮罩和背後的列表一起印。要壓掉得寫全域規則，
而 `styles.scss` 不是這一席的邊界。所以改成 **`window.open` 開空白視窗 + `importNode`
搬列印節點過去**，樣式 inline 在那個視窗裡。節點用 DOM 搬不拼 HTML 字串（姓名與備註
是使用者輸入）。要再做列印功能照抄它，不要跟 `@media print` 打架。

### 環境

worktree 在 `.worktrees/admin-pages`。**待命分支是 `admin-pages-idle`**；這一輪的兩個功能
分支是 `feat/admin-payments-page` 與 `feat/admin-contact-book`。開工一律 `git fetch` 後從
`origin/main` 另開，不要在 idle 上做。root 與 `apps/api` 都 `npm ci` 過。

收工前照 `.github/workflows/verify.yml` 的序列在本機重放：`harness` → `harness:test` →
`nx run-many -t typecheck` → `nx run-many -t test` → **`nx build web --configuration=production`**。
最後那步是**唯一會編譯 Angular 模板的一步**（坑 #6），不要跳。

開工前重新看一次 roadmap 第 0 節現況表 —— 它是自動生成的，比這份 charter 新。
