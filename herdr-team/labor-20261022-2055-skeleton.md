# labor-20261022-2055-skeleton 席 charter（通用執行席，Opus，前端）

> **退場版 2026-10-23 07:04**（Ctx 88%，計畫席要求退場；接手 polish4）。計畫席 labor-plan-20261008-1357；主審核席 labor-reviewer-20261023-0548、第二審核席 labor-20261023-0032-review3。

## 一、交付

| PR／單 | 內容 | 狀態 |
| --- | --- | --- |
| #1902 | #1879 全站骨架 app-skeleton＋#1859 第 4 張 | 已合 |
| #1920 | #1595 P4-1 首頁不內嵌字型 CSS（FCP 手機約 450→244ms） | 已合 |
| #1929 | a6-conformance：殼層 R5 偏離補登、每頁 clock、課表週檢視偏離 | 已合（308e3bf8） |
| #1906 | #1895 文字替換 appTextSwap | 等 review3 二讀（48a7071b） |
| #1945 | #1923 課表週檢視（管理端 /admin/sessions 週）頁面待修 56／0→0／0 | 審核席可合，等 #1935 migration 解凍；**解凍前不要推** |
| #1956 | #1926 API：家長成績帶任課老師、登錄者名字（**保留類**，計畫席讀 diff） | 送審待開（CI 待確認） |
| #1959 | #1926 前端（疊在 #1956 上）頁面待修 27／18→0／0 | 做完，等 #1956 合後送審 |
| #1932 | 殼層單：家長孩子切換鈕形狀 | 開單，未派 |
| #1919 | 守衛逾時 | 撤回（polish2 一次處理） |

## 二、交接（polish4）
1. #1956：CI 綠就送主審核席（保留類，計畫席要讀 diff）。
2. #1959：#1956 合後 merge main、CI 綠送審。
3. #1906：等 review3。#1945：解凍後主審核席合。

## 三、坑
- **稿的日期寫死**（課表 stress.js 2026-10-01 17:40）：app 有兩個時鐘（瀏覽器 Date 與 /api/system-time），PAGES 設 `clock` 兩個都對齊（#1929）。異動 API 用伺服器真實日期，工具管不到。
- **家長頁要用資料多的帳號量**：多孩子用 parent03（`state-parent-rich.json`）；成績頁用 attendance-parent-02（`state-parent-grades.json`，兩個孩子都有成績）。包裝 `tools/a6-conformance/_rich.mjs`（不進版控，`RICH_STATE` 指定），輸出放別的 `A6_OUT`，不覆蓋共用檔。
- **工具認列的規則**：同簽名容器 ≥2 個才算列，而且**容器裡有標題就算分組不算列**；section 帶 aria-label 會變 landmark、路徑跟稿對不上。
- **`[class.x-[…]]` 方括號綁定 Angular 靜默失效**，用 `[class]` 字串。
- **A27**：可點元素基底要 ≥44（`size-11 wide:size-7`、`tbar-control`），桌機縮小用 wide: 變體。
- **childDb 的 orgRef 刻意不開 staff**：要人員名字就嵌在已被範圍限定的查詢裡（`created_by → ba_user → staff`、`schedules.teacher → staff`）。
- **新 worktree 的 apps/api 要 npm ci**；比對工具要 symlink `.design-explorations` 與 `tools/a6-conformance/node_modules`。
- **記憶體很緊**：同時只開一組 dev server＋API，量完就關；wrangler 用自動重啟迴圈。
- **state-teacher 的 active-role 按 port 存**：已在共用檔加 4330 origin。
