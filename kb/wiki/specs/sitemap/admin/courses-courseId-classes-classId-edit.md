---
title: 編輯班級（/admin/courses/:courseId/classes/:classId/edit）
summary: /admin/courses/:courseId/classes/:classId/edit 的實際 UI 地圖：畫面區塊、互動元素、狀態與子頁面（對話框）。
category: spec
status: seedling
tags: [sitemap, admin]
created: 2026-11-10
updated: 2026-11-10
---

# 編輯班級

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin/courses/:courseId/classes/:classId/edit`
**角色**：管理員（`admin`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：手機（≤860）從課程列表班級列「⋯」→「編輯班級」、開課班詳情「⋮」→「編輯班級」導過來；桌機同一個入口開的是對話框，不到這頁（#2396 L4）。直接打網址也能用。

## 畫面區塊

表單本體就是 `ClassFormDialogComponent`（同對話框，內容見 [[specs/sitemap/admin/courses]] 的新增／編輯班級），
由 `class-form.page.ts` 當宿主：抓課程、全部班、老師、分校、這個班後渲染，底部列黏在捲動容器底。

## 互動元素

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後 |
| --- | --- | --- | --- |
| ✕、取消 | 按鈕 | 一直 | 回上一頁（直接打網址進來的回開課班詳情）；有改過先問「放棄未儲存的變更？」 |
| 儲存 | 按鈕 | 一直 | 存檔後回上一頁，不再問 |
| 系統返回鍵 | — | 一直 | 同 ✕ |

## 狀態

- 載入中：空白（資料到了才渲染表單）
- 載入失敗：「打不開這個班級，請回上一頁再試一次。」

## 驗證紀錄

- **狀態**：未驗證
