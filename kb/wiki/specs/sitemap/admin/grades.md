---
title: 考務與成績（/admin/grades）
summary: /admin/grades 沒有自己的畫面 —— 它是有子路由的外殼，預設轉到考試管理。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-12
---

# 考務與成績

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin/grades`
**角色**：管理員（`admin`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

## 這一頁是外殼，不是畫面

`app.routes.ts` 的結構：

```
/admin/grades                      → GradesComponent（外殼，有 children）
  ├─ ''                            → redirectTo 'exams'（pathMatch: 'full'）
  ├─ exams                         → ExamsComponent
  ├─ exams/:type/:id/scores        → ScoreEntryComponent（掛 canDeactivate）
  └─ overview
       ├─ ''                       → OverviewComponent
       ├─ student                  → StudentViewComponent
       └─ class                    → ClassViewComponent
```

**打 `/admin/grades` 會直接變成 `/admin/grades/exams`**（實測網址列確認）。
畫面見 [[specs/sitemap/admin/grades-exams]]。

### 三條不在 `RoutesCatalog` 裡的舊路由

```
/admin/grades/academy-exams      → redirectTo exams
/admin/grades/school-exam-entry  → redirectTo exams
/admin/grades/score-records      → redirectTo overview
```

**它們沒有自己的地圖檔**（生成器只認 `RoutesCatalog`，而這三條只存在於 `app.routes.ts`）。
記在這裡，因為舊連結與書籤還會走到它們。**本輪未實測這三條。**

## 互動元素

無 —— **外殼的模板逐字就是一行 `<router-outlet />`**（`grades.component.html`，全檔 1 行）。
它不渲染任何自己的東西，所以子頁的地圖不需要扣掉任何共用版面。

## 驗證紀錄

- **日期**：2026-09-12 ／ 帳號 `admin@demo.clessia.app` ／ 前端 `897d691f`（port 4201）
- 打 `/admin/grades` → 網址列變成 `/admin/grades/exams`，內容為考試管理 ✓
- 路由結構由 `app.routes.ts` 逐行確認 ✓

**兩向比對不適用** —— 這條路由沒有自己的畫面。

### 未驗到的

| 項目 | 原因 |
| --- | --- |
| 三條舊路由 redirect | 未實測 |
