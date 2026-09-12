---
title: 課堂出勤紀錄（/admin/attendance）
summary: /admin/attendance 沒有畫面 —— 它是轉址到 /admin/sessions；同名的頁面元件存在但接不到。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-12
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

## ⚠️ 有一支接不到的頁面元件

`apps/web/src/app/features/admin/pages/attendance/` 底下有完整的一頁：

| 檔案                      | 大小    |
| ------------------------- | ------- |
| `attendance.page.ts`      | 15.7 KB |
| `attendance.page.html`    | 4.6 KB  |
| `attendance.page.scss`    | 4.0 KB  |
| `attendance.page.spec.ts` | 21.8 KB |

**全庫沒有任何地方 import 它**（`grep -rn "AttendancePage"` 在排除 `features/admin/pages/attendance/`
與家長端之後只剩 `app.routes.ts:430`，而那一行是**家長端**的 `@features/parent/pages/attendance/attendance.page`）。

唯一會渲染它的那條路由被改成 redirect 了，所以：

- 它的畫面**使用者到不了**
- 它的 21.8 KB 測試**還在跑、還是綠的** —— 綠燈證明的是那個元件內部一致，不是它接得上
- 它註冊為 [[specs/sitemap/_shared/audit-log-dialog]] 的開啟點之一（`resourceTypes: ['attendance']`），
  而那個開啟點**永遠不會被走到**

→ 已開 issue 給計畫席（見驗證紀錄）。**這一頁記的是現況，不做任何處置。**

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

### 兩向比對

**不適用** —— 這條路由沒有自己的畫面。轉址目的地的比對記在
[[specs/sitemap/admin/sessions]]（差異 0 筆）。

### 未驗到的

| 項目                                      | 原因                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **帶 query 參數轉址後，參數有沒有被套用** | 正要驗的時候 session 被另一席的登入踢掉（auth cookie 是 host 層級、不分 port），重登之後沒有回頭補。**這是儀表板「未點名課堂」卡片的整條路徑，值得單獨驗一次** |
| 那支接不到的 `AttendancePage` 的畫面      | 依定義到不了；要看只能暫時改路由，不在本工單範圍                                                                                                               |
