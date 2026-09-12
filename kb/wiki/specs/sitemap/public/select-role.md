---
title: 選擇角色（/select-role）
summary: /select-role 的實際 UI 地圖：一個薄殼路由，長相在彈窗裡；單一角色會直接轉走、零角色只留一句說明。
category: spec
status: developing
tags: [sitemap, public]
created: 2026-09-12
updated: 2026-09-12
---

# 選擇角色

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/select-role`
**角色**：要登入，但不綁角色（`authGuard`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：

1. 登入後的落地點（`guest.guard` / `role.guard` / LINE OAuth 的 `callbackURL` 都指這裡）
2. `/link-line` 的「稍後再說」
3. 直接網址（要先登入）

**它不在公開頁外框的四條連結裡**（`showInMenu: false`）。

**外框**見 [[specs/sitemap/_shared/public-shell]]。

## ⚠️ 這一頁「三個角色帳號會看到三種完全不同的東西」

元件（`select-role.component.ts`）在建構時就分岔，**而分岔點是使用者有幾個角色**：

| 角色數      | 發生什麼                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------- |
| **1 個**    | **不開彈窗，直接 `navigateToRoleShell()` 導去該角色的 shell** —— 這一頁使用者根本看不到    |
| **0 個**    | **不開彈窗、也不導向**，留在這一頁顯示一句 `這個帳號目前沒有可用的身分，請聯絡補習班櫃檯開通。` |
| **≥ 2 個**  | `await import()` 進 PrimeNG 的 `DialogService` + `RolePickerComponent`，開一個**關不掉**的彈窗 |

**所以「這一頁長什麼樣」這個問題沒有單一答案**，改版時三條路都要算進去。

## 畫面區塊

### 1. 字標（唯一恆存在的東西）

`Clessia`（`select-role__wordmark`），純文字，**不是連結**。

### 2. 沒有身分的說明（條件式）

`@if (noRoles())` —— `auth.roles().length === 0` 時才渲染，純文字一段。

元件註解寫明為什麼要有它：彈窗不開的話使用者只會看到一個**只剩字標的空白頁**，
那跟「卡在載入中」長得一模一樣。

## 互動元素

**`<main>` 內沒有任何互動元素。** 字標不是連結，說明文字不是連結。
唯一的互動在子頁面（彈窗）裡。

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後 |
| ------------------ | ---- | -------- | -------- |
| （無）             | —    | —        | —        |

## 狀態

| 狀態              | 畫面                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| 1 個角色          | **看不到這一頁** —— 立刻被導去該角色的 shell（實測）                     |
| 0 個角色          | 字標 + `這個帳號目前沒有可用的身分，請聯絡補習班櫃檯開通。`（**未驗**）  |
| ≥ 2 個角色        | 字標 + 蓋在上面的角色選擇彈窗（**未驗**，見下）                          |
| 載入中            | 彈窗是 `await import()` 進來的，載入期間畫面上只有字標（**未驗**）       |
| 未登入            | **進不來** —— `authGuard` 擋下（**未驗**）                               |

## 子頁面：角色選擇彈窗（RolePicker）

**⚠️ 本輪未驗到 —— 原因見下方驗證紀錄。以下純粹是讀原始碼寫的，不是量到的。**

**開啟方式**：不是按出來的 —— 使用者有 ≥ 2 個角色時，進頁就自己開。

**它刻意關不掉**：`closable: false`、`closeOnEscape: false`、`dismissableMask: false`、
`showHeader: false`、`modal: true`。理由是**沒選角色就沒有下一步**。
寬度 `400px`，`breakpoints: { '640px': '90%' }`（憲法 c6：不用 `vw`）。

內容（`role-picker.component.html`）：

- 眉標 `選擇身分`
- 標題 `{{ displayName() }}，你好`
- 副標 `這個帳號有多個身分，請選擇要進入的介面`
- 一排角色按鈕，每個是：圖示 + 角色名 + 一行說明 + 右側 `pi-chevron-right`；
  目前的 `activeRole()` 那一顆帶 `--active`
- 按下去 → 關窗 → `auth.navigateToRoleShell(role)`

## 驗證紀錄

- **日期**：2026-09-12 ／ **前端版本**：`9f08061a`（主 checkout 的 dev server，port 4200）
- **視窗**：1504 × 695
- **角色帳號**：`admin@demo.clessia.app`（Demo Admin，**單一角色**）

### 實測到的：單一角色這條路

直接開 `http://localhost:4200/select-role`，3 秒後量：

```
url        = http://localhost:4200/admin/dashboard
.p-dialog          → null
.role-picker-dialog → null
.select-role       → null
```

`.select-role` 連 DOM 都不在 —— **元件已經導航離開，這一頁對單一角色使用者等於不存在**。
從 `/link-line` 按「稍後再說」進來也是同一個結果（見 [[specs/sitemap/public/link-line]]）。

### 兩向比對

單一角色這條路上，`<main>` 內可見互動元素 **0 個**（頁面已被換掉）。
地圖的互動元素表也是空的。

| 方向        | 結果                                             |
| ----------- | ------------------------------------------------ |
| 地圖 ⊆ 畫面 | 地圖沒有列任何 `<main>` 內元素，恆真 ✓           |
| 畫面 ⊆ 地圖 | 0 個可見互動元素 ✓                               |

**差異：0 筆**（**但只涵蓋三條路裡的一條** —— 另外兩條見下）。

### ⚠️ 為什麼彈窗沒驗到：本機根本沒有多重角色帳號

不是漏掉，是**量過了確認做不到**。對本機 DB 查：

```sql
select count(*) from (
  select user_id from public.user_roles group by user_id having count(*) > 1
) t;
-- → 0
```

`supabase/seed.sql` 對 admin / teacher / parent 各自 `INSERT INTO public.user_roles`，
**沒有任何一個 demo 使用者拿到兩個角色**。所以：

- 彈窗（`RolePicker`）在本機**用任何既有帳號都開不出來**
- 零角色的那句說明同理（每個 demo 使用者至少有一個角色）

要驗這兩條，得先往 `user_roles` 插一筆 —— **那是寫入，本輪不做**。

### 未驗到的

| 項目                       | 原因                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| ≥ 2 角色的彈窗（整個子頁面） | 本機 seed 沒有多重角色帳號（上面有 SQL 證據）；製造一個要寫 `user_roles` |
| 0 角色的說明文字           | 同上 —— 每個 demo 使用者至少有一個角色                                  |
| 彈窗「關不掉」的實際行為   | 開不出來就按不到                                                        |
| `displayName()` 實際顯示什麼 | 同上                                                                    |
| 未登入被 `authGuard` 擋掉   | 本輪全程帶著 session                                                    |
| 手機寬度（`640px` 斷點）   | 本輪只量 1504px 桌機寬度                                                |
