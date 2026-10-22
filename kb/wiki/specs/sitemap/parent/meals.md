---
title: 餐費紀錄（/parent/meals）
summary: /parent/meals 的實際 UI 地圖：照 A6 p-meals —— 色面（這個月幾餐、多少錢）、期間下拉＋匯出 CSV、每月一個摺疊區。
category: spec
status: developing
tags: [sitemap, parent]
created: 2026-09-12
updated: 2026-10-22
---

# 餐費紀錄

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/parent/meals`
**角色**：家長（`parent`）
**選單位置**：生活與繳費 › 餐費紀錄
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：選單「生活與繳費 › 餐費紀錄」／ 直接網址／繳費紀錄頁底的「看餐費紀錄 →」與帳單明細裡的餐費項

**外框**見 [[specs/sitemap/_shared/shell-layout]]。

## 版面（A6 `p-meals.html`，2026-10-22 起）

元件 `features/parent/pages/meals/meals.component.*`，資料 `GET /api/me/meals`（`routes/parent/meals.ts`，#1117）。
整頁包在 `app-child-scope-gate` 裡（沒有孩子時說「沒有孩子」，不講「沒有紀錄」）。

1. **色面**：子女切換器；標題「{孩子} 這個月 / N 餐，M 元。」（N 只算有收錢的）；
   副行「一個便當 {單價} 元 · 每月月底併入帳單」。色面另打一支本月的請求，跟工具列的期間無關。
2. **灰工具列**：期間下拉（`app-select-field`，標籤只給讀屏）—— 近 3 個月（預設）／近 6 個月／指定月份範圍；
   選「指定」才出現兩個原生月份欄位，反了或超過 12 個月就在內容區說明、不打 API（API 一次最多 366 天）。
   右邊匯出圖示鈕：原生 popover（桌機貼著按鈕往下、手機底部面板），範圍與筆數、欄位、格式 CSV；
   CSV 在前端由已載入的紀錄產生（有 BOM），欄位「日期、金額、收費」。
3. **每月一個 `.coll`**（`name="meals-months"`，一次開一個；第一個預設開）：標題月份（別年帶年）、
   「已併入帳單」或「還沒結算 · 月底併入帳單」（整月每筆都 settled 才算）、右邊「M 元 · N 餐」。
   展開：已結算的月份多一行「已併入帳單 · 看繳費紀錄」；明細一天一列「10/21（三）｜80 元」，不收的寫「不收費」。
4. **空狀態**：「這段期間沒有餐費紀錄」＋「看近 6 個月」捷徑（已經是近 6 個月就不出）。

## 跟稿不一樣的地方

- **沒有餐別、備註兩欄**：API 沒有餐別（meal-rules 每生每日一筆），行政備註不回（#1117 欄位 allowlist）。
  匯出欄位跟著改成「日期、金額、收費」。
- **「併入 N 月的帳單」改成「看繳費紀錄」**：API 只回 settled，不回是哪一張帳單。
- 匯出面板沒有稿上的「新」標記（那是設計說明）。

A6 比對：`node tools/a6-conformance/run.mjs diff p-meals`（偏離與理由記在 `tools/a6-conformance/lib/config.mjs`）。
