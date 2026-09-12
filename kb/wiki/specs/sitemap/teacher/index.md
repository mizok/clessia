---
title: 老師根路由（/teacher）
summary: /teacher 沒有畫面 —— 它是 roleGuard 底下的一個容器，pathMatch full 直接 redirect 到課表。
category: spec
status: developing
tags: [sitemap, teacher]
created: 2026-09-12
updated: 2026-09-12
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
