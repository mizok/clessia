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

**交接自 session `clessia-8f`。** 這一輪交付了三個切片，兩個已合、一個待審。

| 切片 | PR | 狀態 |
| --- | --- | --- |
| finance specs 對齊 2026-08-29 訪談 rules（純 docs） | #56 | ✅ 已合（f4ac284） |
| 費用方案管理頁 + 報名計費設定 + per-route 權限 | #58 | 🔶 **待審，使用者親手合** |

**接手第一件事：看 #58 合了沒。** 合了就往下走，沒合就先處理 review 意見。

### #58 裡有一個要 reviewer 確認的偏離

工單說「報名頁補計費欄位」，但那個前提不成立 —— `/admin/enrollments` 是唯讀列表沒有表單，
而 `POST /api/enrollments/batch` 不吃計費欄位。我把計費設定做成**班級名單每一列的動作選單**
（用既有的 `PUT /api/enrollments/{id}`）。計畫席若不同意這個位置，改的是 dialog 掛哪裡，
dialog 本身可以整包搬。

### 接下來（依序）

1. **P2 剩下的三頁仍是空殼**：餐費、繳費單、營收報表。擋在 billing-api 席的
   **PR #54（A2 帳單與收款）** 與 A3（`meal_records`）—— 三張表在 main 上還不存在。
   合併後**先重驗 API 形狀再開工**，`.claude/team/admin-pages-p2-readiness.md` 第 5 節
   標的都是「⏳ 待 A2」，一個字都沒猜
2. **聯絡簿/教務日誌管理端頁**是真的要開新頁（坑 #1 全額適用）。API 已在 main，
   但 `classes.uses_contact_book` 的 API 暴露是 **PR #55**，還沒合
3. 規格真相看 `kb/wiki/specs/admin/finance/*.md`（我剛重寫過，對齊 rules 了），
   業務真相看 `kb/wiki/rules/` 的 billing / meal / contact-book

### 回報給計畫席、還沒閉環的兩件事

- `POST /api/enrollments/batch` 不接受計費欄位 → 批次招生無法一併帶計費設定（billing-api 席）
- `kb/wiki/rules/enrollment-rules.md` 與 `billing-rules.md` 衝突四處 → 計畫席已接走，
  但注意它的 nuance：`void`「停止入班」可能指**行政手動作廢**，與規則 7 禁的
  「欠繳自動停課」不衝突

### 環境

worktree 在 `.worktrees/admin-pages`（root 與 `apps/api` 都 `npm ci` 過）。
herdr 的 workspace 歸屬要在**開 pane 時**決定 —— 光在磁碟上建 worktree 不會讓既有 session
換 workspace，`herdr pane` / `herdr tab` 都沒有「搬到別的 workspace」的指令。
新 session 用 `herdr worktree open .worktrees/admin-pages` 開，就會長出獨立的
`clessia-admin-pages` workspace，和另外三席對稱。

開工前重新看一次 roadmap 第 0 節現況表 —— 它是自動生成的，比這份 charter 新。
