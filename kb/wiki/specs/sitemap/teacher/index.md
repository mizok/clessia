---
title: 老師根路由（/teacher）
summary: /teacher 沒有畫面 —— 它是 roleGuard 底下的一個容器，pathMatch full 直接 redirect 到課表。
category: spec
status: developing
tags: [sitemap, teacher]
created: 2026-09-12
updated: 2026-09-13
---

# 老師根路由

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/teacher`
**角色**：老師（`teacher`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：登入後只有老師角色時的落點 / `/select-role` 選「老師」/ 直接網址

## 這一條路由沒有畫面

`app.routes.ts` 裡它是一個 `canActivate: [roleGuard('teacher')]` 的容器，children 有：

| child                      | 內容                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `''`（sidebar 出口）       | `SidebarComponent`                                                  |
| `''`（bottom-bar 出口）    | `BottomBarComponent`                                                |
| `dashboard`                | **redirect** → `schedule`（見 [[specs/sitemap/teacher/dashboard]]） |
| `notifications`            | [[specs/sitemap/teacher/notifications]]                             |
| `schedule`                 | [[specs/sitemap/teacher/schedule]]                                  |
| `students`                 | [[specs/sitemap/teacher/students]]                                  |
| `''` + `pathMatch: 'full'` | **redirect** → `schedule`                                           |

**所以打 `/teacher` 會停在 `/teacher/schedule`**（實測）。

外框（側欄、底部列、頂列）見 [[specs/sitemap/_shared/shell-layout]] ——
老師端與管理端共用同一個 `ShellLayoutComponent`，選單依角色產生。

## 互動元素

**0 個。** 這條路由不渲染任何自己的內容。

## 狀態

| 狀態   | 行為                                                        |
| ------ | ----------------------------------------------------------- |
| 未登入 | `authGuard` → 導向登入                                      |
| 非老師 | `roleGuard('teacher')` 擋下（**未驗** —— 本輪只有老師帳號） |

## 驗證紀錄

- **日期**：2026-09-12 ／ **帳號**：`teacher0003@demo.clessia.app`（張品妍）
- **前端版本**：port 4202（本 worktree），`7622b0c4` ／ **寬度**：1504 CSS px
- **實測**：打 `/teacher` → 網址列停在 `/teacher/schedule`，頁標 `課表` ✓
- **老師端側欄實測三項**：`通知中心`、`課表`、`學生`
  （各出現兩次 —— 側欄與底部列同一組連結，見 [[specs/sitemap/_shared/shell-layout]]）

### 未驗到的

| 項目                   | 原因                   |
| ---------------------- | ---------------------- |
| `roleGuard` 擋下非老師 | 本輪沒有非老師帳號可試 |

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

## 載入中 / 錯誤

**不適用。** `/teacher` 是掛 `roleGuard('teacher')` 的容器，**自己沒有畫面、不取任何資料**，
所以沒有載入中、也沒有錯誤態可量。它的 children 各自有自己的地圖。

外框（側欄／底欄／頂列）的載入中與錯誤態見 [[specs/sitemap/_shared/shell-layout]]。
