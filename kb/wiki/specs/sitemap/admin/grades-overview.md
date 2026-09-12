---
title: 成績總覽（/admin/grades/overview）
summary: /admin/grades/overview 是一張兩選一的入口頁：學生視角與班級視角，整頁只有兩個互動元素。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-12
---

# 成績總覽

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin/grades/overview`
**角色**：管理員（`admin`）
**選單位置**：考務與成績 › 成績總覽
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：選單「考務與成績 › 成績總覽」/ 兩個子視角的麵包屑「成績總覽」/ 直接網址

**外框**見 [[specs/sitemap/_shared/shell-layout]]。

## 畫面區塊

麵包屑 `成績總覽`，標題 `成績總覽` + 副標 `選擇檢視模式`，底下兩張並排的大卡片。

**整頁沒有資料** —— 進這一頁不打任何列表 API，就是一個岔路口。

## 互動元素

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後 |
| --- | --- | --- | --- |
| 學生視角<br>`查看個別學生的成績走勢、科目摘要與歷次紀錄` | 整張卡片（button） | 永遠 | 導向 [[specs/sitemap/admin/grades-overview-student]] |
| 班級視角<br>`查看班級考試統計、排名與成績分布，按課程分組` | 整張卡片（button） | 永遠 | 導向 [[specs/sitemap/admin/grades-overview-class]] |

**整頁只有這兩個。**

## 狀態

無條件式狀態 —— 這一頁不取數，沒有載入中／空／錯誤。

## 驗證紀錄

- **日期**：2026-09-12 ／ 帳號 `admin@demo.clessia.app` ／ 前端 `897d691f`（port 4201）

### 兩向比對

| | 數量 |
| --- | --- |
| `<main>` 內 DOM 互動元素 | 2 |
| 不可見 | 0 |
| **可見** | **2** |

| 方向 | 結果 |
| --- | --- |
| 地圖 ⊆ 畫面 | 2 項都找得到 |
| 畫面 ⊆ 地圖 | 2 個可見元素都有列 |

**差異：0 筆。**

「學生視角」**實按過**，網址列變成 `/admin/grades/overview/student` ✓
「班級視角」以直接打網址驗到目的地存在，**卡片本身沒有實按**（兩張卡是同一個
`overview__portal` 元件，形狀相同）。

### 未驗到的

| 項目 | 原因 |
| --- | --- |
| 「班級視角」卡片實按 | 用網址直接到達，沒有點那張卡 |
