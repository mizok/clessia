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
- **細部權限**：在 `computed` 裡呼叫 `auth.hasPermission('x')`（隨 signal 反應），
  不要在 field initializer 取快照。注意 `permissionGuard` 已定義但**全 repo 零路由使用中** ——
  頁面級的權限目前都是元件內判斷

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
9. **不要對 `index.md` / `_moc.md` 跑 prettier** —— 它們是 generator 原始輸出，
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

儀表板 v1 已交付合併（PR #32），管理端現況表那欄變 ✅。

**下一個大塊是 P2 管理端補完**（見 `kb/wiki/roadmap.md` 的 `#### P2`）：繳費單產生與收款、
餐費、營收報表、聯絡簿。**擋在 P1 後面** —— 那些頁面現在是空殼是因為沒有 API，
schema 與路由是 billing-api 席的 P1 工作，合併後這一席才有東西可接。
業務規則已由訪談定案，讀 `kb/wiki/rules/billing-rules.md`、`meal-rules.md`、`contact-book-rules.md`。

開工前重新看一次第 0 節現況表 —— 它是自動生成的，比這份 charter 新。
