---
title: 課堂出勤紀錄（/admin/attendance）
summary: /admin/attendance 沒有畫面 —— 它是轉址到 /admin/sessions；那支接不到的同名元件已於 #698 刪除。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-13
---

# 課堂出勤紀錄

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin/attendance`
**角色**：管理員（`admin`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

## ⚠️ 這一頁沒有自己的畫面

`app.routes.ts:103-106` 逐字：

```ts
{
  path: RoutesCatalog.ADMIN_ATTENDANCE.relativePath,
  redirectTo: RoutesCatalog.ADMIN_SESSIONS.relativePath,
},
```

**純 `redirectTo`，沒有 `loadComponent`。** 打 `/admin/attendance` 會直接變成
`/admin/sessions`，畫面完全是 [[specs/sitemap/admin/sessions]] 那一頁。

**所以這一頁的 UI 地圖就是課堂管理那一份**，不在這裡重複。

## 進入方式

| 來源                     | 連結                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 儀表板「未點名課堂」卡片 | `/admin/attendance?dateFrom=<7天前>&dateTo=<今天>&attendanceTaken=false&endedOnly=true&statuses=scheduled,completed` |
| 直接打網址               | 同上                                                                                                                 |

選單裡沒有這一項（`showInMenu = false`）。

> **帶著 query 參數轉址過去之後、那些參數有沒有被 `/admin/sessions` 套用，本輪未驗** ——
> 見驗證紀錄。`sessions.page.ts` 的 `ngOnInit` 有一支 `applyIncomingAttendanceFilter()`，
> 看起來就是接這個的，但**「有一支看起來在接的函式」不等於「參數真的活著」**。

## ~~有一支接不到的頁面元件~~ —— 已刪除（#698）

`apps/web/src/app/features/admin/pages/attendance/` 底下曾經有完整的一頁
（`.ts` 15.7 KB、`.html` 4.6 KB、`.scss` 4.0 KB、`.spec.ts` 21.8 KB），
**而全庫沒有任何地方 import 它** —— 唯一會渲染它的那條路由早就改成 redirect 了。

當時記下的三件事，是它值得刪的理由：

- 它的畫面**使用者到不了**
- 它的 21.8 KB 測試**還在跑、還是綠的** —— 綠燈證明的是那個元件內部一致，不是它接得上
- 它註冊為 [[specs/sitemap/_shared/audit-log-dialog]] 的開啟點之一
  （`resourceTypes: ['attendance']`），而那個開啟點**永遠不會被走到** ——
  於是 `grep -rl` 數出來的「七個開啟點」有一個是假的

> **2026-09-12 使用者裁決全刪**，連同 `sessions/dialogs/` 底下兩支同樣沒人 import 的
> 對話框（`session-leave-roster-dialog`、`session-overflow-dialog`）。
> **這條 `redirectTo` 保留** —— 舊書籤與儀表板的「未點名課堂」卡片都還指著它。

**刪除之後這一頁的內容不變**：`/admin/attendance` 本來就沒有自己的畫面。

## 互動元素

無 —— 這條路由不渲染任何東西。實際互動元素見 [[specs/sitemap/admin/sessions]]。

## 狀態

無 —— 同上。

## 驗證紀錄

- **日期**：2026-09-12 ／ 帳號 `admin@demo.clessia.app` ／ 前端 `c1535d04`（port 4201）

### 實測

1. 開 `/admin/attendance` → **網址列變成 `/admin/sessions`**，頁面標題「課堂管理」，
   元素清單與 `/admin/sessions` 逐項相同（57 個 DOM 互動元素、其中 3 個手機版不可見，
   與 [[specs/sitemap/admin/sessions]] 那一輪量到的數字一致）✓
2. `grep` 確認 `app.routes.ts` 是 `redirectTo` 而非 `loadComponent` ✓
3. `grep` 確認 admin 的 `AttendancePage` 無人 import ✓
   —— **注意 `app.routes.ts` 那一筆 `AttendancePage` 是家長端的同名 class**
   （`@features/parent/pages/attendance/attendance.page`）。刪除前重查時就是靠這一點
   分辨的：**兩個 feature 有同名元件，只 grep 類別名會看到一筆假的引用。**

### 兩向比對

**不適用** —— 這條路由沒有自己的畫面。轉址目的地的比對記在
[[specs/sitemap/admin/sessions]]（差異 0 筆）。

### 未驗到的

| 項目                                      | 原因                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **帶 query 參數轉址後，參數有沒有被套用** | 正要驗的時候 session 被另一席的登入踢掉（auth cookie 是 host 層級、不分 port），重登之後沒有回頭補。**這是儀表板「未點名課堂」卡片的整條路徑，值得單獨驗一次** |
| ~~那支接不到的 `AttendancePage` 的畫面~~  | **已無此問題** —— 元件已於 #698 刪除                                                                                                                           |

## 390px

- **量測**：390 × 844 ／ 前端 `3f2197f8`（4200，主 checkout ＝ `origin/main`）／ 身分 `admin@demo.clessia.app`

**不適用 —— 這條路由在任何寬度都不渲染內容。**

實測：390 × 844 下開 `/admin/attendance`，`location.pathname` 落在 `/admin/sessions`，
`<main>` 內 44 個互動元素**全部屬於課堂管理**。轉址行為與 1504 完全相同。

窄寬度的現況記在 [[specs/sitemap/admin/sessions]] 的 `## 390px`。

### 未驗與原因

| 項目                                | 原因                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| 帶 query 參數轉址後參數有沒有被套用 | 同 1504 —— 仍然沒補。**它是儀表板「未點名課堂」卡片的整條路徑**，值得單獨驗一次 |
