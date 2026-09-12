---
title: 通知中心（/parent/notifications）
summary: /parent/notifications 的實際 UI 地圖：一行薄殼，內容全部是共用的公告收件匣元件。
category: spec
status: developing
tags: [sitemap, parent]
created: 2026-09-12
updated: 2026-09-12
---

# 通知中心

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/parent/notifications`
**角色**：家長（`parent`）
**選單位置**：（無群組）通知中心
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：選單「通知中心」／ 直接網址

**外框**見 [[specs/sitemap/_shared/shell-layout]]。

## 這一頁自己只有一行

```ts
template: `<app-announcement-inbox [heading]="page().label" />`,
```

**沒有橘色頁首、沒有孩子切換器、沒有任何自己的畫面。**
`<main>` 裡看到的一切都屬於 [[specs/sitemap/_shared/announcement-inbox|公告收件匣]]，
那一頁記了全部細節（含**展開一則會順帶標成已讀**這件事）。

這一層唯一做的事是把路由標籤（`通知中心`）當成收件匣的標題傳進去。
元件檔頭明寫「老師端是同一個東西」。

> **注意公告不分孩子。** 家長端有內容的另外四頁都有孩子切換器，
> 這一頁沒有 —— 收件匣打的是 `GET /api/announcements/inbox`，**不帶 `childId`**。

## 畫面區塊

見 [[specs/sitemap/_shared/announcement-inbox]]。

## 互動元素

**全部來自共用元件**，見 [[specs/sitemap/_shared/announcement-inbox]] 的互動元素表。
本頁不新增任何東西。

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後 |
| ------------------ | ---- | -------- | -------- |
| （本頁自己沒有）   | —    | —        | —        |

## 狀態

見 [[specs/sitemap/_shared/announcement-inbox]]。本頁層級唯一的狀態是
`roleGuard` 擋非家長（這條路由沒有 `permission`）。

## 驗證紀錄

- **日期**：2026-09-12 ／ **前端版本**：`9f08061a`（主 checkout 的 dev server，port 4200）
- **視窗**：1504 × 695
- **角色帳號**：`parent01@demo.clessia.app`（家長 林志明）
- **身分斷言**：量測前後各打一次 `GET /api/me`，兩次都是 `parent01@demo.clessia.app / ["parent"]`

### 兩向比對

|                          | 數量  |
| ------------------------ | ----- |
| `<main>` 內 DOM 互動元素 | 2     |
| 其中不可見               | 0     |
| **可見**                 | **2** |

兩個都是收件匣的（`announcement-inbox__mark-all`、`announcement-inbox__summary`），
**本頁自己 0 個** —— 與「這一頁只有一行模板」一致。

| 方向        | 結果                                                                 |
| ----------- | -------------------------------------------------------------------- |
| 地圖 ⊆ 畫面 | 本頁沒有列自己的元素，恆真 ✓                                         |
| 畫面 ⊆ 地圖 | 2 個可見元素都在 [[specs/sitemap/_shared/announcement-inbox]] 有列 ✓ |

**差異：0 筆。**

### 未驗到的

見 [[specs/sitemap/_shared/announcement-inbox]] 的未驗清單。本頁層級額外未驗：

| 項目     | 原因                     |
| -------- | ------------------------ |
| 手機寬度 | 本輪只量 1504px 桌機寬度 |
