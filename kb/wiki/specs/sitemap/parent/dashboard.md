---
title: 儀表板（/parent/dashboard）
summary: /parent/dashboard 的實際 UI 地圖：照 A6 p-dashboard —— 色面回答孩子今天到了沒，下面是待繳、今天／接下來的課、考試與成績、聯絡簿、可加選的課。
category: spec
status: developing
tags: [sitemap, parent]
created: 2026-09-12
updated: 2026-10-22
---

# 儀表板

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/parent/dashboard`
**角色**：家長（`parent`）
**選單位置**：（無群組）儀表板
**額外權限**：無

<!-- generated:route-facts end -->

**外框**見 [[specs/sitemap/_shared/shell-layout]]。

## 版面（A6 `p-dashboard.html`，2026-10-22 起）

元件 `features/parent/pages/dashboard/dashboard.component.*`，整理邏輯在 `dashboard.util.ts`。
推播提示卡（#1663）留在最上面（稿沒畫）。整頁本文包在 `app-child-scope-gate` 裡（#749）。
進頁一次打六支（各自失敗：讀不到的那一節說「沒有讀到」，其他節照常）：
`/api/me/sessions`（今天起 14 天）、`/checkins`（今天）、`/billing`、`/grades`（過去 7 天）、`/class-logs`（過去 14 天）、`/catalog`。

1. **色面**：子女切換器；標題「{孩子}」＋到班句：`16:41 到班了。`／`今天請假。`／`還沒到，17:00 有課。`／`還沒到班。`／`今天沒有課。`
   （分校不用日到班時沒有刷卡可看，只寫孩子的名字）。副行「今天 N 堂：17:00 班名、…」或「下一堂 M/D（週）時間 班名」。
2. **待繳條**（有待繳才出現）：`meta.totalDue` 元待繳、最近期限那張的到期日與項目數；逾期紅、3 天內琥珀；「看帳單 →」。
3. **今天的課／接下來的課**：今天有課列今天；否則接下來 3 天；再沒有就接下來 3 堂。標籤：調課／代課／停課、有小考、上課中。
   點了開唯讀詳情（老師、地點、狀態、考試名稱），可去到班紀錄、課表。
4. **考試與成績**（前後 7 天）：要考的在前（`examNames`，#1835：「班名 · 考試名」＋今天考／N 天後考），
   考過的接後（分數、滿分／不及格（滿分的六成）＋鼓勵語、缺考、7 天內登錄的「新成績」）。整列連到成績頁。
5. **最新聯絡簿**（有才出現）：每班最新一篇作業，橫向捲動、不自動播；點了看全文。API 不回老師名，卡片不寫。
6. **可以加選的課**（有才出現）：同年級、還沒報的取 3 個（推薦的排前），時段、老師、參考價；點了看詳情、可去加選頁。

## 跟稿不一樣的地方

- **沒有續課預告條**：`/api/me/renewal-preview` 沒有自動開單日，算不出 T-5～T-0 的出現窗口（計畫席 10-22 裁定，自動續課先不做）。
- 節標題後的「新」是設計說明，不畫。
- 聯絡簿卡片沒有老師名、全文只有作業（API 只回已發布日誌的作業）。

A6 比對：`node tools/a6-conformance/run.mjs diff p-dashboard`（偏離記在 `tools/a6-conformance/lib/config.mjs`）。
