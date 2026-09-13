---
title: 權限變體矩陣（管理端）
summary: 九個細部權限各自改變什麼 —— 側欄、進得去哪些頁、頁內按鈕、資料範圍；以及前端只擋四條路由這件事。
category: spec
status: developing
tags: [sitemap, _shared, admin, authorization]
created: 2026-09-13
updated: 2026-09-13
---

# 權限變體矩陣（管理端）

角色只有三種，但 admin 靠 `user_roles.permissions` 分職責。這一頁記的是
**每個權限在畫面上實際改變了什麼**（#759）。

> **這一頁是現況不是規格。** 「應該擋什麼」在
> [`kb/wiki/architecture/authorization-scope.md`](../../architecture/authorization-scope.md)；
> 兩者不同時**記下差異，不要調和**。

## 量測

- **前端** `7e9da649` ／ dev server（port 4200，主 checkout）／ **1024 × 768**
  （側欄在 390 是收起來的，量選單要用桌機寬度）
- **導航**用 `ng.ɵgetRouterInstance(...)` 拿 Router 本人 `navigateByUrl()`，
  記 `router().url` 是不是還在原地（見[方法頁](../README.md)）
- **身分**每個帳號量測前後各打一次 `GET /api/me`，**十一次全部一致**
- **零寫入**：只有 `GET`，沒有按任何送出

### fixture 怎麼來的

`supabase/seed.sql` 的「權限矩陣的固定帳號」段（零 `ba_*` 寫入，只改 `user_roles`）。
**本機當時還沒套用過** —— `admin01`～`admin11` 全都是 `["*"]`，八個權限欄一欄都量不到。
本輪經計畫席核可後單獨執行了那一段 `DO $$ … $$`（`db:reset` 的真子集、冪等、不停服務），
執行前先把現況存成 15 列 `UPDATE` 的還原 SQL。

套用後（`select u.email, ur.permissions from user_roles ur join ba_user u on u.id=ur.user_id where ur.role='admin'`）：

| 帳號 | permissions |
| --- | --- |
| `admin@demo` | `["*"]` |
| `admin01` | `["basic_operations"]` |
| `admin02` | `["manage_courses"]` |
| `admin03` | `["manage_students"]` |
| `admin04` | `["manage_finance"]` |
| `admin05` | `["manage_staff"]` |
| `admin06` | `["manage_roles"]` |
| `admin07` | `["manage_org_settings"]` |
| `admin08` | `["view_reports"]` |
| `admin09` | `["all_campuses"]` |
| `admin10` | `[]` |
| `admin11` | `["*"]` |
| `admin.lin` / `admin.wang` | `["basic_operations", "manage_students"]` |
| `teacher0001` | `["view_reports"]`（多重角色，不在本輪矩陣裡） |

⚠️ **`all_campuses` 會污染其他每一欄的讀法。** 沒有它的管理員只看得到
`staff_campuses` 指派給他的分校，而 `admin01`～`admin08` **一個都沒有 `all_campuses`** ——
它們看到的清單都是**分校窄化過**的，那是 `all_campuses` 缺席造成的，
不是它們各自那個權限造成的。分辨用 `admin09`（只有 `all_campuses`）當對照。

## 矩陣

**每一格都是量到的**（`驗`）。推導出來的東西集中在下一節，**不混進這張表**。

| | 側欄項目數 | 側欄多出來的 | `/admin/meals` | `/admin/payments` | `/admin/fee-templates` | `/admin/reports` | 分校清單 | 儀表板多出的卡片 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `[]`（admin10） | **14** | — | 導回 dashboard | 導回 | 導回 | 導回 | 1 | — |
| `basic_operations` | 14 | — | 導回 | 導回 | 導回 | 導回 | 1 | — |
| `manage_courses` | 14 | — | 導回 | 導回 | 導回 | 導回 | 1 | — |
| `manage_students` | 14 | — | 導回 | 導回 | 導回 | 導回 | 1 | — |
| `manage_finance` | **17** | 費用方案管理／餐費管理／繳費紀錄 | **可進** | **可進** | **可進** | 導回 | 1 | — |
| `manage_staff` | 14 | — | 導回 | 導回 | 導回 | 導回 | 1 | — |
| `manage_roles` | 14 | — | 導回 | 導回 | 導回 | 導回 | 1 | — |
| `manage_org_settings` | 14 | — | 導回 | 導回 | 導回 | 導回 | 1 | — |
| `view_reports` | **15** | 營收報表 | 導回 | 導回 | 導回 | **可進** | 1 | **在籍學生／本月報名異動** |
| `all_campuses` | 14 | — | 導回 | 導回 | 導回 | 導回 | **13** | — |
| `*`（admin11） | **18** | 全部四項 | 可進 | 可進 | 可進 | 可進 | **13** | 在籍學生／本月報名異動 |

「導回」一律是 `→ /admin/dashboard`（`permissionGuard` 的落點）。

### 其餘 15 條 admin 路由：每一種權限都進得去

`dashboard` `notifications` `courses` `sessions` `changes` `enrollments` `students`
`parents` `staff` `leave` `contact-book` `grades/exams` `grades/overview`
`grades/overview/class` `grades/overview/student` `settings`（→ `settings/campuses`）

**四個帳號走過完整的 20 條路由**（`[]` / `manage_finance` / `view_reports` / `*`），
四次都只有上面那四條會被導回。其餘七個帳號只走了那四條 —— **這是抽樣，不是全走**，
理由見下一節（前端只有四處讀 permission，第五處是儀表板卡片）。

### 頁內按鈕：**沒有任何寫入鈕會因為缺權限而消失**

`[]`（零權限）的 admin10 實測看到的按鈕：

| 頁 | 看得到的 |
| --- | --- |
| `/admin/students` | 「新增學生」（空狀態那顆也在） |
| `/admin/staff` | 「操作紀錄」「新增人員」 |
| `/admin/courses` | 「操作紀錄」「新增課程」＋每個課程的「新增班」 |
| `/admin/settings/campuses` | 「操作紀錄」「新增分校」 |

**一顆都沒有 disabled。** 按下去會被 API 擋（`mount()` 的 `write:` 權限），
所以**這是「必然 403 的按鈕」，不是漏擋** —— 但畫面沒有事先說。

> `NavigationService:27-28` 的註解自己寫著它藏選單的理由是「不要讓人點到必然 403 的按鈕」。
> **同一條理由沒有被套用到頁內的按鈕上。** 記成現況，不判斷。

## 前端到底在哪裡讀 permission —— 只有五處

這一節是**讀原始碼**得到的（`推`），而上面那張表是量到的；兩者互相對得上。

| 位置 | 讀什麼 | 效果 |
| --- | --- | --- |
| `app.routes.ts:146 / 263 / 344` | `permissionGuard('manage_finance')` | meals / payments / fee-templates |
| `app.routes.ts:270` | `permissionGuard('view_reports')` | reports |
| `core/smart-enums/routes-catalog.ts:313/323/333/343` | `RouteObj.permission` | 上面四條的**選單項** |
| `core/navigation.service.ts:28` | `!path.permission \|\| hasPermission(...)` | 依上一列過濾側欄與底欄 |
| `features/admin/pages/dashboard/dashboard.component.ts:506` | `hasPermission('view_reports')` | 兩張卡片 |

**`grep -rn "hasPermission(" apps/web/src/app`（排除 `auth.service` / `permission.guard` /
`navigation.service`）全庫只有一筆**，就是儀表板那一筆。

> **所以九個權限裡有六個（`basic_operations` `manage_courses` `manage_students`
> `manage_staff` `manage_roles` `manage_org_settings`）在前端完全不改變任何東西。**
> 它們是**API 的寫入閘**，只在你按下去之後才生效。

## 後端擋在哪（`apps/api/src/index.ts` 的 `mount()`）

| 權限 | 擋住的東西 |
| --- | --- |
| `manage_courses` | `courses` `schools` `subjects` `classes` `sessions` 的**寫入** |
| `manage_students` | `students` `parents` `enrollments` 的**寫入** |
| `manage_staff` | `staff` 的**寫入** |
| `basic_operations` | `attendance` `leaves` `daily-checkins` `contact-book` `class-logs` 的**寫入** |
| `manage_finance` | `billing-periods` `fee-templates` `invoices` `session-packs` `meals` `billing-runs` 的**全部**（讀也擋） |
| `view_reports` | `reports` 的**全部** |
| `manage_roles` | 不在 `mount()` 上 —— 在 `lib/role-assignment.ts:47` 與 `routes/staff.ts:875/1144` |
| `manage_org_settings` | 不在 `mount()` 上 —— 在 `routes/org-settings.ts:84` 的 `writeRequiresAdmin` |
| `all_campuses` | 不是閘，是**範圍**（`lib/campus-scope.ts:44`） |

**「全部」與「寫入」的差別解釋了矩陣**：只有 `manage_finance` 與 `view_reports` 連讀都擋，
所以只有它們兩個需要 `permissionGuard`（否則進得去也是一片 403）。
其餘六個只擋寫入，**頁面讀得到，所以前端不擋** —— 那是一致的設計，不是遺漏。

## 🔴 量到的兩個範圍缺口（不是權限缺口）

**已開 issue [#815](https://github.com/mizok/clessia/issues/815)，沒有順手修。**

1. **`/api/enrollments` 的 campusScope 靜默失效。** `admin08`（只被指派示範分校08，
   該分校 `classes` 0 筆）在 `/admin/enrollments` 看到 **12 筆別校的報名與學生姓名**，
   **班級欄位整排空白**。三個對照：不帶 `campusId` → `200 / total 12` 🔴；
   帶自己的 → `200 / total 0` ✅；帶別校的 → `403` ✅。
   成因是 `enrollments/list-query.ts:58` 的 `!inner` **只看使用者有沒有傳 `campusId`**，
   不看有沒有在套 scope；少了 `!inner`，PostgREST 對巢狀欄位走 left join。
   **同一個檔案 `:38-43` 的註解逐字預測了「班級欄位會整排空白」這個症狀。**
2. **儀表板「在籍學生」是全機構數字。** `students.ts:373-377` 的 `activeCount`
   獨立查詢只有 `org_id`，沒有 scope → **admin08 的儀表板說 69，它自己的學生頁說
   「尚未有學生資料」**。

> **這兩個都不是「權限沒擋住」** —— 擋的機制是活的（帶別校 id 會 403）。
> 漏的是**範圍**在查詢層被吃掉。這正是 #464「實際擋的層跟裁定要掛的層對不對得上」
> 要問的那件事的一個反例：**層對了，而那一層的實作被 PostgREST 的 left join 繞過。**

**順帶記錄、不判斷**：`/admin/parents` 對 `admin08` 顯示全部 18 位家長（含 email），
`routes/parents.ts` 完全沒有 import campus-scope。家長要不要被分校窄化是產品決策。

## 未驗與原因

| 項目 | 原因 |
| --- | --- |
| 七個帳號的完整 20 條路由 | 只走了四條受守衛的。四個帳號走過完整清單，四次一致；前端只有五處讀 permission（上面那張表） |
| **多重權限的組合** | fixture 是「一個帳號一個權限」。`view_reports + all_campuses` 這種組合**沒有帳號**，所以「在籍學生那張卡片會不會被分校窄化」只能用 `admin08` 與 DB 對照推得 |
| teacher / parent | 那兩個角色不讀 `permissions`（`grep` 全庫零命中） |
| 按下寫入鈕真的會 403 嗎 | **沒有按**（零寫入）。從 `mount()` 的宣告推得，留給寫入實按的窗口 |
| 390 / 768 的側欄 | 側欄在窄寬度是底欄 +「更多」面板，**項目集合相同**（見 [[specs/sitemap/_shared/shell-layout]]），本輪只量 1024 |
