# Agent Team 席位章程

> 這個專案由一個 agent team 開發：計畫席（planning session）派工、驗收、裁決；
> 實作席按 **domain** 分工。每席一份 charter —— 席位的專長外化在這裡，
> **session 會死，席位不死**：新 session 接手一席，先讀該席 charter 繼承專長。
>
> 維護規則：每完成一個被驗收的切片，該席把「下一個接手的人必須知道的事」
> 蒸餾進自己的 charter（不是流水帳 —— 是會再次用到的知識）。計畫席驗收時檢查。
> charter 是操作設定不是專案文件：專案知識仍歸 `kb/`，charter 只放
> 「這一席怎麼工作」與指向 kb 的地圖。

## 席位表

| Charter                          | Domain                 | 典型工作                                         | Herdr pane 名 |
| -------------------------------- | ---------------------- | ------------------------------------------------ | ------------- |
| [billing-api.md](billing-api.md) | 金流/API/auth 核心     | schema、Hono 路由、Better Auth、Workers 執行環境 | `billing-api` |
| [design-web.md](design-web.md)   | 視覺/設計系統/web 效能 | tokens、SCSS、bundle、mockup、登入與公開頁       | `design-web`  |
| （共用 design-web.md）           | 視覺/設計系統/web 效能 | design-web 的第二席，同 charter，分工由計畫席派  | `design-web-2` |
| [admin-pages.md](admin-pages.md) | 管理端頁面             | admin feature 頁、dialog、表格、儀表板           | `admin-pages` |
| [teacher-pages.md](teacher-pages.md) | 老師端頁面（行動優先） | teacher feature 頁、手機課表、點名、成績登錄    | `teacher-pages` |
| [infra.md](infra.md)             | CI/harness/依賴/工具債 | verify 序列、gate、憲法 enforcement、升版        | `infra`       |

> Herdr pane 名 = 席位名（`herdr agent rename` 可改）。SendMessage 位址是 session
> 自動命名、session 輪替就會變 —— **不要寫死在任何文件**，用 ListAgents 查當班的是誰。

尚未開席（P4 時增開）：家長端頁面。

## 通用協定（每席都適用）

- 工單來自計畫席（SendMessage），完成/卡住回報計畫席，不直接對使用者
- **合併授權（2026-08-29 使用者定案）**：計畫席驗收後可代合的只有三類 ——
  純視覺微調（SCSS/文案）、`kb/` 文件、`.claude/team/` 設定。
  **任何程式碼（含 seed、config、CI、migration）一律使用者親手合，急修也不例外**
  （要代合須先取得使用者當次的明確同意）。代合的 docs PR 攢批處理，降低衝突稅
- 開工前：`git fetch` 從最新 origin/main 開分支；worktree 內 root 與 apps/api 各 `npm ci`
- 憲法（`kb/wiki/architecture/constitution.md`）與 AGENTS.md 永遠先讀
- 設計裁決回計畫席，不自行擴範圍；「刻意的判斷」與「需要人工看的點」寫進 PR

## 開席操作（herdr）

開新席一律用 `herdr worktree open --workspace w2 --path <worktree> --label <席名>` ——
它會在 clessia-plan 底下開成 worktree 連結的子 space。**不要用 `tab create` 硬湊**
（已犯兩次：admin-pages、design-web-2 初開時）。然後 `herdr agent start <席名> --kind claude --pane <root_pane>`。

## 開分支規範（2026-08-30 事故後新增）

worktree 裡開新分支**一律** `git fetch -p origin && git checkout -b feat/x origin/main`，
**絕對不要** `git checkout -B main` / `git reset --hard` 動本地 `main` —— `main` 是主 checkout
擁有的共用 ref，從 worktree 移動它會讓主 checkout 的 HEAD 與 index 脫鉤，顯示成一批
「回退已合併工作」的幽靈變更（已發生兩次，診斷見 reflog 2026-08-30）。

## 疊 PR / squash 倉庫的兩條鐵律

1. **「MERGED」只說明它合進了某個東西，沒說是 main**（#89 事故；#129 重演 —— 使用者
   在下層合併後 51 秒就合了上層，人工轉 base 根本搶不到那個空檔）。因此**疊 PR 開出來
   就標 draft，等 base 轉成 main 才轉 ready** —— 讓「還不能合」變成 GitHub 擋得住的狀態，
   不是靠人搶時間差。下層合併後上層 base 立刻人工轉 main、下層分支即刪；合併後才推上去的 commit 會在已合併分支上擱淺，
   永遠不會自己變成 PR（#105 事故 —— 手機版兩筆 commit 擱淺，#110 撿回）。
2. **squash merge 之後，「commit 在不在 main」只能用內容判斷**（grep 關鍵字串），
   `git merge-base --is-ancestor` 對原始 SHA 永遠回「不在」—— 它在 squash 倉庫裡
   對這個問題永遠給錯的答案。

## 全席通則（自 #108/#109 提煉）

- **gate 寫完一定要塞陷阱看它會不會紅** —— 綠燈有兩種，輸出上一模一樣。
- **規則寫進元件/測試比寫進文件便宜** —— 能用測試釘住的約定就不要只寫在 charter。
- **charter 會腐化，接手時先驗一遍再信它**；寫進 charter 前先問「這是狀態還是知識」。
