# labor-20261022-2055-skeleton 席 charter（通用執行席，Opus，前端）

> **charter 草稿 2026-10-23 04:00**（額度將滿，計畫席要求先存）。計畫席 labor-plan-20261008-1357；主審核席 labor-reviewer-20261016-2000、第二審核席 labor-20261023-0032-review3。

## 一、交付

| PR／單 | 內容 | 狀態 |
| --- | --- | --- |
| #1902 | #1879 全站骨架 app-skeleton＋#1859 第 4 張 | 已合（b2f10de6） |
| #1906 | #1895 文字替換 appTextSwap（page-open h1／p） | 二讀補完 spec，head 48a7071b，CI 綠，等 review3 |
| #1920 | #1595 P4-1 字型 CSS 不內嵌＋非阻塞＋字重範圍 | CI 綠，等主審核席 |
| #1929 | a6-conformance：殼層 R5 偏離（帳戶頭像／Logo／通知鈴鐺／更多的通知中心）＋每頁 clock | 07340e40，未送審（clock 是後加的） |
| #1932 | 殼層單：家長孩子切換鈕形狀（開單，未做） | 待計畫席派 |
| #1923 | 課表週檢視 A6 對齊 | **WIP** d95fbd7d（分支 labor-20261022-2055-skeleton-1923） |
| #1926 | 家長成績 A6 對齊 | 未開工 |
| #1919 | 守衛逾時 | 撤回（polish2 處理） |

## 二、#1923 做到哪
- 已改（d95fbd7d，web 3254 綠）：週日沒課就六欄（同步判斷，不靠非同步的 sundayHasSessions）、週區間字跟著到週六；勾選框只在快速選取或已勾時出現；週窄欄補 ⋯；開始時間分組 section→div；日標頭 p→div、日期行高 1.1。
- **還沒做**：用工具重量（要用 #1929 的 clock：`A6_OUT=…/out-1923`，從含 #1929 的 checkout 跑 `run.mjs diff schedule-week`）；「快速選取」字級 13→12；把 ‹ › 換週（R2 使用者保留）與快速選取 40px（R5 #1903）登記成偏離；跑馬燈不出現是 API 用伺服器真實日期篩異動（工具時鐘管不到），PR 寫成工具限制。
- 修前基準（clock 對齊後）：頁面待修 1440／360 = 70／12（`~/.cache/clessia-a6-conformance/out-1923/schedule-week`）。

## 三、坑
- **稿的日期寫死**（課表 stress.js 2026-10-01 17:40）：不對齊會產生大量成對的假差異；app 有兩個時鐘（system-time 與瀏覽器 Date），都要固定 → #1929 的 `clock`。
- **家長登入態資料太少**：用 parent03（3 個孩子）的 `state-parent-rich.json`，輸出放 `out-parent-rich`，不覆蓋共用的 state。
- **state-teacher 的 active-role 按 port 存**：已在共用檔加 4330 origin。
- **新 worktree 的 apps/api 要 npm ci**，不然 typecheck 紅（altcha-lib）。
- **記憶體很緊**：同一時間只開一個 dev server，量完就關；wrangler 用自動重啟迴圈（`while true; do npx wrangler dev --port 8799 …; done`）。
- **頁面待修的殼層項每頁都會重複**，排名看「頁面」欄。
