---
title: 分校的教室與帳戶（#1314 SE3，設計稿）
summary: 設計稿（#1314 SE3，保留類、要 migration，待裁）。照 A6 settings.html#campuses：分校 ⋮ 的「教室」對話框（列出教室、新增：名稱、容納人數、設備選填）、列上「N 間教室／還沒有教室」、分校表單加狀態與出勤模式。schema 只缺教室：新表 classrooms（分校底下，名稱分校內唯一、容量選填、設備選填）。帳戶**已存在**（campuses.payment_info，#1073 使用者裁一個多行欄位）—— A6 畫成「收款銀行＋帳號」兩欄，跟既有裁定衝突，建議維持一欄（舊有新無：多帳戶、LINE Pay、現金時段會寫不進去）。狀態、出勤模式 API 早已收，只差表單。A6 在班級時段也用教室（class.html、courses.html），建議同一支 migration 先加 schedules.classroom_id、UI 另開單。
category: spec
status: draft
updated: 2026-10-21
tags: [specs, admin, system, campuses, classrooms, migration, design, a6]
sources: [https://github.com/mizok/clessia/issues/1314]
---

# 分校的教室與帳戶（設計稿）

> **狀態：草稿，待裁（§5）。保留類（新表＋寫入路徑），migration 獨立 PR、CI 代套、使用者 Approve（[[architecture/deploying]]）。**
> 既有規格 [[specs/admin/system/campuses]] 寫了「教室管理（分校子頁籤）」與「銀行帳戶（戶名、銀行、帳號）」，但兩者都沒做；
> 列表的 A6 化（純前端）在 #1755，這份只管 SE3 剩下要 schema 的部分。

## 0. 現況（2026-10-21 查）

| 項目     | 現況                                                                                                                                              | 出處                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 教室     | **schema 沒有任何教室表或欄位**；`schedules`／`sessions` 也沒有地點欄                                                                             | `supabase/migrations/`（grep `classroom`／`room` 無）                  |
| 帳戶     | **已存在**：`campuses.payment_info`（多行自由文字，null＝沿用 `organizations.payment_info`）。分校表單已有欄位，`manage_finance` 才看得到、改得了 | `20261003071532_payment_info.sql`、`campus-form-dialog.component.html` |
| 狀態開關 | API `PUT /api/campuses/{id}` 已收 `isActive`；表單沒有欄位（列表的停用顯示在 #1755）                                                              | `routes/campuses.ts` UpdateCampusSchema                                |
| 出勤模式 | API 已收 `attendanceMode`（null＝沿用機構預設，要 `manage_org_settings`）；表單沒有欄位                                                           | `routes/campuses.ts:450-454`                                           |
| 授權     | `/api/campuses` 掛 `ADMIN_ONLY`；單筆讀寫走 `resourceCampusAllowed(campusScope, id)`，範圍外 404                                                  | `index.ts:393`、`routes/campuses.ts:438`                               |

## 1. A6 長什麼樣（全採）

`settings.html#campuses`：

- **列**第三欄：「N 間教室」或「還沒有教室」（#1755 已登記為待 SE3 的偏離）。
- **⋮ 選單**：編輯／**教室**／停用（或啟用）分校／刪除分校。
- **教室對話框**（A6 `form()`）：標題「教室：○○分校」，副標列出現有教室「A 教室（30 人）、B 教室（24 人）」或「這個分校還沒有教室」；
  欄位「新增教室」（必填，`例如：C 教室`）、「容納人數」（預設 20）、「設備（選填）」（`例如：投影機、白板`）；送出「新增教室」、toast「已在○○分校新增「C 教室」」。
- **分校表單**：名稱*、電話、狀態（啟用／停用）、地址、出勤紀錄模式（「預設跟著『一般』的設定」）、收款銀行、帳號。

A6 在別處也用教室：班級時段的「教室（選填）」（`class.html:171`、`courses.html:331`），家長端課堂詳情「地點：分校 · 教室」（`p-dashboard.html:218`、`p-attendance.html:149`）。

## 2. Schema（一支 migration）

```sql
CREATE TABLE public.classrooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campus_id  uuid NOT NULL REFERENCES public.campuses(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 50),
  capacity   integer NULL CHECK (capacity > 0),   -- null = 沒填
  equipment  text NULL CHECK (char_length(equipment) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classrooms_campus_name_uniq UNIQUE (campus_id, name)
);
CREATE INDEX classrooms_campus_idx ON public.classrooms (campus_id);
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY; -- 沒有 policy：fail-closed 後盾（AGENTS.md）
-- updated_at trigger 照既有 update_updated_at
```

- `org_id` 冗餘存一份：API 每句都帶 `org_id`（c1），不靠 join 推。
- 分校刪除 CASCADE 教室：教室沒有自己的歷史價值；**但**若 Q2 選 (a)，`schedules.classroom_id` 是 `ON DELETE SET NULL`，刪教室不會連坐刪時段。
- 純加表（＋ Q2 的加欄），「套完才部署」「部署完才套」都安全。

## 3. API（保留類）

掛在 `/api/campuses/{id}/classrooms`（同一支 route 檔，同一個 `ADMIN_ONLY`，先過 `resourceCampusAllowed`，範圍外 404）：

| 方法     | 路徑                        | 說明                                                                             |
| -------- | --------------------------- | -------------------------------------------------------------------------------- |
| `GET`    | `/{id}/classrooms`          | 該分校的教室，依名稱排序                                                         |
| `POST`   | `/{id}/classrooms`          | `{ name, capacity?, equipment? }`；同分校同名 23505 → 409 `CLASSROOM_NAME_TAKEN` |
| `PUT`    | `/{id}/classrooms/{roomId}` | 同上欄位；`roomId` 不屬於這個分校／org → 404                                     |
| `DELETE` | `/{id}/classrooms/{roomId}` | 硬刪（Q2 (a) 時時段上的教室變「不指定」，回應帶受影響時段數讓前端寫進 toast）    |

- 分校列表 `GET /api/campuses` 每列加 `classroomCount`（一次 `select campus_id` 計數，不 N+1）。
- 寫入權限跟改分校同一個門檻（目前是 admin 角色＋分校範圍，沒有另外的細部權限）；都記稽核（`classroom.create／update／delete`）。
- 單表單句寫入，不需要 `withTx`（[[architecture/pg-pool-writes]] rule 1）。

## 4. 前端（一般類）

- `campuses.page`：列第三欄、⋮ 加「教室」（#1755 的偏離登記拿掉）。
- 教室對話框照 A6：副標列現有教室；A6 只畫了新增 —— **編輯／刪除**沿用 R2（舊有新無不刪）的精神補在副標每間教室後面的小「⋯」（Q4）。
- 分校表單：加狀態（radio）、出勤模式（select，含「沿用機構預設」，`manage_org_settings` 才出現）、帳戶（見 Q1）。

## 5. 待裁（每題附建議）

**Q1　帳戶要照 A6 拆成「收款銀行＋帳號」兩欄嗎？**（既有：一個多行欄位，#1073 使用者裁）
(a) **建議**：維持一個多行欄位，表單標籤改成 A6 的語氣（「收款帳戶」、placeholder 示範「台灣銀行 景美分行（004）／帳號 …」）。不動 schema。
理由：拆欄是「舊有新無」—— 多個帳戶、LINE Pay、現金收款時段寫不進兩個欄位；家長帳單頁、簡訊預帶匯款帳戶（#1625）都直接用這段文字。
(b) 照 A6 拆兩欄（migration 加兩欄，家長端、簡訊、帳單詳情三處顯示跟著改；既有自由文字要人工搬）。

**Q2　班級時段要不要能指定教室？**（A6 class.html／courses.html 有畫，家長端顯示「分校 · 教室」）
(a) **建議**：**同一支 migration** 先加 `schedules.classroom_id uuid NULL REFERENCES classrooms ON DELETE SET NULL`，UI（時段表單、家長端顯示）另開單。
理由：migration 每支都要使用者 Approve，分兩次是兩次；欄位可空，不接 UI 也沒有任何行為改變。
(b) 這一版只做教室清單，時段那欄等真的要做時再開 migration。

**Q3　教室容量要不要擋班級人數上限？**
**建議**：**不擋**，只顯示。同一個教室不同時段放不同的班，班級上限是報名的名額（`classes.max_students`），不是教室的座位；
要做「時段的班上限 > 教室容量」提醒，等 Q2 的 UI 那張再說。

**Q4　教室能不能改名、刪除？**（A6 對話框只畫了新增）
**建議**：可以 —— 打錯字改不掉、搬走的教室刪不掉會留在每個下拉裡。改名／刪除放在對話框每間教室後的「⋯」；刪除要確認，Q2 (a) 時寫出「有 N 個時段會變成不指定教室」。

**Q5　教室要不要有停用狀態？**
**建議**：不要（YAGNI）。教室沒有歷史紀錄掛在它身上（Q2 (a) 時時段是 SET NULL），不用就刪。

## 6. 拆單

| #   | 類型      | 內容                                                             |
| --- | --------- | ---------------------------------------------------------------- |
| 1   | migration | `classrooms` 表（＋ Q2 (a) 的 `schedules.classroom_id`）         |
| 2   | 保留類    | 教室 CRUD API＋列表 `classroomCount`＋稽核＋spec                 |
| 3   | 一般類    | 分校頁：列上教室數、⋮ 教室對話框、表單加狀態／出勤模式／帳戶標籤 |
| —   | 另開單    | Q2 (a) 的時段指定教室 UI＋家長端「分校 · 教室」顯示              |

規格同步：實作合併時更新 [[specs/admin/system/campuses]] 的「銀行帳戶資訊」（依 Q1）與「教室管理」兩段。
