---
title: 老師儀表板（/teacher/dashboard）—— 已刪除，只留 redirect
summary: 這一頁已經被刪掉了；路由留著把舊書籤導到課表。元件檔案不存在，不是孤兒程式碼。
category: spec
status: developing
tags: [sitemap, teacher]
created: 2026-09-12
updated: 2026-09-13
---

# 老師儀表板（已刪除）

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/teacher/dashboard`
**角色**：老師（`teacher`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：只剩舊書籤與外部連結。選單、其他頁面都不再連到它。

## 這一頁沒有畫面

`app.routes.ts`：

```ts
{
  // 老師儀表板已刪除（今日流）—— 它獨有的只有四個數字與兩個連結，
  // 而「今日課表」清單跟課表今天那一屏完全重複。
  // **route 留著當 redirect**：老師可能加了書籤，讓它壞掉沒有任何好處。
  path: RoutesCatalog.TEACHER_DASHBOARD.relativePath,
  redirectTo: RoutesCatalog.TEACHER_SCHEDULE.relativePath,
  pathMatch: 'full',
}
```

`RoutesCatalog` 那一則也標了同樣的理由，且 `showInMenu: false`。

## ⚠️ 跟 `/admin/attendance` 不一樣：這裡沒有孤兒元件

[[specs/sitemap/admin/attendance]] 是「路由變成 redirect，但頁面元件還在、
還引用著共用對話框，於是 `grep` 會把一個到不了的開啟點算進去」（issue #698）。

**這一頁不是那個形狀** —— `features/teacher/pages/` 底下**只有
`notifications` / `schedule` / `students` 三個目錄，`dashboard` 目錄不存在**。
元件連同 html / scss / spec 一起刪乾淨了，沒有任何東西會誤把它算成開啟點。

**收在這裡是因為下一個做清理的人會問「這條 redirect 能不能拿掉」** ——
答案是可以拿掉，但沒有好處（成本三行，收益零），而且會讓老師的舊書籤 404。

## 互動元素

**0 個。**

## 狀態

不適用 —— 沒有畫面。

## 驗證紀錄

- **日期**：2026-09-12 ／ **帳號**：`teacher0003@demo.clessia.app`
- **前端版本**：port 4202（本 worktree），`7622b0c4`
- **實測**：打 `/teacher/dashboard` → 網址列停在 `/teacher/schedule`，頁標 `課表` ✓
- **`ls apps/web/src/app/features/teacher/pages/`** → `notifications schedule students`（沒有 `dashboard`）✓

## 390px

- **量測**：390 × 844 與 1504 × 752（這一條路由沒有畫面，兩個寬度就夠 —— 見下）
- **前端**：主 checkout 的 dev server（port 4200），`fce2aefd`（量測期間 `apps/web` 零改動）
- **身分**：`teacher0026@demo.clessia.app`（`roles:["teacher"]`，量測前後各打一次 `GET /api/me`）
- **手段**：同源 iframe 當 viewport

### 版面怎麼變

**不適用 —— 這條路由在 390 一樣沒有自己的畫面。** 兩個寬度打進去，
`location.pathname` 都停在 `/teacher/schedule`，`<main>` 的內容是課表的。

**390 與 1504 的差別完全來自落地的那一頁**（可見互動元素 5 vs 14），
見 [[specs/sitemap/teacher/schedule]] 的 `## 390px`。

### 差集 / 水平溢出 / 觸控目標 / 鍵盤可達性

**全部歸落地頁**，這裡不重抄（c11）。

### 未驗與原因

| 項目                     | 原因                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `roleGuard` 擋下非老師   | 同 Phase 1 —— 本輪的老師帳號只有 `teacher` 角色                 |
| 768 / 1024               | 導向行為與寬度無關（`app.routes.ts` 的 `redirectTo`），沒有量   |
