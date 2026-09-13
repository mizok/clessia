---
title: 細部權限詞彙表的單一來源
summary: manage_org_settings 授不出來的根因是詞彙表有四份、三份在前端手抄；比較三種收斂做法，選出「前端自己有編譯期保證 + gate 守跨 app 一致」這條。
category: architecture
status: accepted
tags: [permissions, authorization, c11]
created: 2026-09-13
updated: 2026-09-13
---

# 細部權限詞彙表的單一來源（#772）

> **狀態：計畫席已裁定走 C 案（2026-09-13），已實作。**
> A 案不走的理由見下（探針證實 `apps/api` 的 tsconfig paths 是壞的 → issue #782）；
> `packages/shared-types` 檔頭那句「不要往這裡加新的手寫型別」**計畫席明示不豁免**。

## 問題

`manage_org_settings` **是真的在擋寫入的權限，但畫面上沒有任何人給得出來**。

逐項驗過（#772）：

| 事實                   | 證據                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| 詞彙表有它             | `apps/api/src/lib/permissions.ts:19`                                |
| API 真的用它擋寫入     | `apps/api/src/routes/org-settings.ts:84`                            |
| 前端型別沒有它         | `apps/web/src/app/core/staff.service.ts:9-17`（8 個）               |
| 人員表單沒有它的勾選框 | `staff-form-dialog.component.ts:25` 的 `PERMISSION_OPTIONS`（8 筆） |
| 單獨持有它的人數       | **0**（靠 `*` 通吃的 12）                                           |

使用者看到的：**任何管理員都進得去 `/admin/settings`、改得動欄位、按儲存才吃 403。**

## 根因：同一份詞彙表有四份，三份在前端手抄

| #   | 位置                                                          | 內容                                                                  |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `apps/api/src/lib/permissions.ts`                             | **權威**，9 個                                                        |
| 2   | `apps/web/src/app/core/staff.service.ts` 的 `Permission` 型別 | 8 個（缺 `manage_org_settings`）                                      |
| 3   | `staff-form-dialog.component.ts` 的 `PERMISSION_OPTIONS`      | 8 筆（同上）                                                          |
| 4   | `staff.page.ts` 的 `PERMISSION_OPTIONS`                       | **6 筆**（再缺 `manage_roles`、`all_campuses`）；**死碼，模板未引用** |

**補上 `manage_org_settings` 只修掉今天這一個症狀。** 下一個新增的權限會再走一次同一條路，
而且症狀一樣安靜 —— 漏掉的權限在畫面上跟「這個權限不擋任何東西」長得一模一樣。

## 三個做法

### A. 詞彙表搬到 `packages/shared-types`，前後端都 import

真正的單一來源。**但有兩個阻力**：

1. **`packages/shared-types/src/index.ts` 的檔頭明寫「不要往這裡加新的手寫型別」** ——
   理由是「一個為了避免分岔而建的東西，因為沒人用而正在分岔」。
   本案**方向相反**（是去重不是加一份），而且會讓那個 package 第一次真的被用到；
   但那句話是既有的明文指示，**要不要豁免是計畫席的決定，不是我的**。
2. 🔴 **`apps/api` 現在根本 import 不到 `packages/` —— 別名是壞的。已用拋棄式探針證實。**

   探針：在 `packages/shared-types` 加一個 `PROBE_VOCAB`，讓 `apps/api` import 它。
   結果 `tsc` 與 `wrangler deploy --dry-run` **都報「找不到這個 export」**，
   而那個 export 明明就在檔案裡。

   成因：**`apps/api/tsconfig.json` 沒有自己的 `baseUrl`**，繼承 `tsconfig.base.json` 的
   `"baseUrl": "."`（＝ **repo 根目錄**），而它的 paths 寫成 `../../packages/...` ——
   那是「相對於 `apps/api`」的寫法。兩者一組合，路徑就跳出 repo：

   | 在哪            | `apps/api` 的別名解析到                    | 存在？      |
   | --------------- | ------------------------------------------ | ----------- |
   | **worktree**    | `clessia/packages/…`（**主 checkout 的**） | ✅ **存在** |
   | **主 checkout** | `Desktop/packages/…`（repo 外）            | ❌ 不存在   |

   `apps/web` **是對的** —— 它自己宣告了 `"baseUrl": "."`（＝ `apps/web`），兩邊都解析正確。

   > ⚠️ **worktree 那一列是最毒的形狀**：它**解析得到一個真的存在的檔案**，
   > 只是那個檔案屬於另一個 checkout。改了自己 worktree 裡的 `packages/` 卻看不到效果，
   > 而錯誤訊息是「找不到 export」—— **指向的是「你沒加」，不是「你加錯地方」。**

   **所以 A 案的前置是先修 `apps/api/tsconfig.json`（補一行 `"baseUrl": "."`）** ——
   那是另一個缺陷、另一支 PR，不屬於 #772 的範圍。

### B. 詞彙表搬到 `packages/validators`

`z.enum(PERMISSIONS)` 已經在用它，語義上合。**但 web 會因此把 `zod` 拉進 bundle**
（那支檔案第一行就 `import { z } from 'zod'`），為了一個字串陣列付這個代價不划算。**否決。**

### C. 前端自己收斂成一份 + gate 守跨 app 一致（**建議**）

不動 `apps/api`，也不動 `packages/`：

1. **web 端只留一份清單**，型別從它長出來：

   ```ts
   export const PERMISSIONS = [...] as const;
   export type Permission = (typeof PERMISSIONS)[number];
   ```

2. **選項清單改成從詞彙表生成**，中文標籤放在一張 `Record` 上：

   ```ts
   const PERMISSION_META: Record<Permission, { label: string; description: string }> = { ... };
   export const PERMISSION_OPTIONS = PERMISSIONS.map((value) => ({ value, ...PERMISSION_META[value] }));
   ```

   **`Record<Permission, …>` 少一個鍵就編譯失敗** —— 編譯器變成 gate，不必靠人記得。

3. **刪掉 `staff.page.ts` 那份 6 筆的死碼。**

4. **新增 harness gate（A7d）**：`permissions.ts` 的清單與 web 的清單**逐項相同**，
   否則紅燈。形狀跟 #771 剛加的 A7c 一樣（同一段程式碼已經在解析 `PERMISSIONS`）。

**代價**：原始碼裡仍然是兩份。**但它們不會漂** —— 一份由編譯器守（web 內部），
跨 app 那一層由 gate 守。而**現在是四份、零個機制**。

### 為什麼建議 C 而不是 A

**探針跑完之後這已經不是偏好問題**：A 現在**做不到**，除非先修 `apps/api/tsconfig.json`。

那一行修法本身不難，但它是**建置設定**的改動、影響整個 api 的模組解析，
而且會讓 `apps/api` 第一次真的跨 package 取值 —— **兩件事綁在同一支 PR 裡，
出事的時候分不出是哪一件造成的**。

C 的每一塊都有既有先例（`as const` 推型別、`Record` 完整性、A7b/A7c 的 gate 形狀），
而且**不碰任何建置設定**。

> **如果計畫席要 A**：拆成兩支 —— 先修 tsconfig（附探針證明它修好了），再搬詞彙表。
> 我照做，但**建議 C 先上**，因為 #772 是 P1 而 tsconfig 那件目前沒有人被它擋住。

## 影響到的既有元件

| 元件                             | 影響                                                   |
| -------------------------------- | ------------------------------------------------------ |
| `staff-form-dialog.component.ts` | 選項清單改生成；**表單會多一個勾選框**                 |
| `staff.page.ts`                  | 刪掉死碼（`PERMISSION_OPTIONS` + `permissionOptions`） |
| `staff.service.ts`               | `Permission` 改成從 `PERMISSIONS` 推導                 |
| `check-harness.mjs`              | 新增 A7d；A7b / A7c **不動**                           |
| `apps/api`                       | **不動**（C 案）                                       |
| `supabase/seed.sql`              | **不動** —— #771 的矩陣帳號已經有 9 個權限             |

## 明確不做什麼

- **不動 API 的授權位置。** `org-settings.ts:84` 的 `writeRequiresAdmin` 是對的層（c1）。
- **不動 `packages/`**（C 案）。
- **不在這一支順手做「設定頁依權限停用儲存」** —— 那是另一個行為
  （純畫面、不是授權），#772 裡列為第 2 項。要做的話另開一支，
  理由：這一支會標【保留類】等使用者親合，把純畫面的改動綁在它後面沒有好處。

## 驗證計畫（計畫席要求「修前紅」）

| 順序 | 動作                                                                                 | 預期                               |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| 1    | 在 `staff-form-dialog.component.spec.ts` 加一條：選項清單涵蓋 `PERMISSIONS` 每一個值 | **紅**（缺 `manage_org_settings`） |
| 2    | 塞陷阱驗 A7d 是活的：把 web 清單拿掉一個值 → `npm run harness` 退出碼 1              | 退出碼 1                           |
| 3    | 實作                                                                                 | 1 與 2 轉綠                        |
| 4    | `npx nx affected -t typecheck,test`                                                  | 綠                                 |

## 風險

- **表單會多一個可勾的權限，而那個權限真的有效力** —— 勾了就能改組織設定。
  **這是本案的目的**，但它改變了「誰拿得到權限」，**所以 PR 標【保留類】**（合併授權 v2）。
- `Record<Permission, …>` 會強迫每個權限都有中文標籤與說明。
  `manage_org_settings` 的文案我會擬一版，**文案由計畫席定稿**。
