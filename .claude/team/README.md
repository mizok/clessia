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
| [infra.md](infra.md)             | CI/harness/依賴/工具債 | verify 序列、gate、憲法 enforcement、升版        | `infra`       |

> Herdr pane 名 = 席位名（`herdr agent rename` 可改）。SendMessage 位址是 session
> 自動命名、session 輪替就會變 —— **不要寫死在任何文件**，用 ListAgents 查當班的是誰。

尚未開席（P3/P4 時增開）：老師端頁面、家長端頁面。

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
