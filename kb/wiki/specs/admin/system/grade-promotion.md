---
title: 學年升級
summary: 新學年把在讀學生的年級一次往上升（含預覽、畢業處理、可復原），設定在「一般」分頁的學年升級段。
category: spec
status: draft
updated: 2026-10-22
tags: [specs, admin, system, students, grade]
---

# 學年升級（#1820，設計稿 2026-10-22，待計畫席批）

> 這一頁是設計，**批准前不寫程式**。來源：#1314 SE2 對照（A6 `settings.html` general 的「學年升級」段：自動升級日、升級前提醒）；
> 使用者 10-22 裁定要做。**保留類**：批次改寫學生資料＋migration。

## 0. 現況（查過的）

- `students.grade` 是 enum `grade_level`：`P1–P6`、`J1–J3`、`S1–S3`；**沒有「畢業」這個值**。
- `students.is_active` 是在讀／停用的布林；列表與名冊都用它篩。
- 學校有學制（`schools.level`，#1815）；學生的學校是 `students.school_id`。
- 系統裡「學年」只出現在學校段考（`school_exams.academic_year`，民國年 smallint，例：114）。
- 系統**目前沒有任何年級自動變動**，`grade` 只能在學生資料手改。

## 1. 升級規則

| 現在   | 升級後     | 備註                    |
| ------ | ---------- | ----------------------- |
| P1–P5  | 下一個年級 |                         |
| P6     | J1         | 學校學制跟著變（見 §4） |
| J1、J2 | J2、J3     |                         |
| J3     | S1         | 學校學制跟著變（見 §4） |
| S1、S2 | S2、S3     |                         |
| S3     | **畢業**   | 見要裁 A                |

- **只升在讀的學生**（`is_active = true`）。停用的不動 —— 他們的年級停在離開那年，之後回來由行政手改。
- 報名、班級、帳單都不動：班級的年級對象是班的屬性，不是學生的。

## 2. 觸發：行政按一下，先預覽（要裁 B）

設定「一般」分頁的「學年升級」段（A6）：

- **升級日**（月／日，預設 9/1）與**升級前提醒（天）**（預設 7）：機構設定。
- 升級日前 N 天，通知有權限的管理員「學年升級日快到了，到設定預覽並執行」（站內通知，同既有的管理員提醒管道）。
- 段內一顆「**預覽並執行**」：開預覽對話框 →
  - 每一種變動的人數（「國三 → 高一 13 位」……「高三 → 畢業 1 位」）；
  - **學校要更新**的名單（新年級的學制跟學校的 `level` 不合，例：升高一但學校是國中 —— 見 §4）；
  - 確認鈕寫死後果：「把 N 位學生升一個年級；M 位高三改成停用（畢業）」。
- **不做自動執行**：批次改學生資料，無人看管跑錯的代價高（年級錯了家長端、名冊、班級篩選全錯），而且 §4 的學校更新本來就要人。升級日只用來提醒。

## 3. 防重複與復原

- 新表 `grade_promotions`：一次執行一列（`org_id`、`academic_year` 民國年、執行人、時間、`reverted_at`）；
  **同一機構同一學年只能有一筆沒復原的**（部分唯一索引）—— 重複按、兩個人同時按，第二次會被擋。
- 新表 `grade_promotion_items`：每位學生一列（`from_grade`、`to_grade`、`deactivated`）。
- **復原**（要裁 C：期限，預設 30 天內）：只還原「現在年級仍等於 `to_grade`」的學生（升級後又被手改過的不動，回報跳過幾位）；畢業停用的一併恢復在讀。
- 學年 = 台北日期，8/1 起算新學年（民國年 = 西元 − 1911）。
- **整批在一個 transaction 裡**：寫成一支 SQL 函式（migration），API 用 RPC 呼叫 —— supabase-js 沒有多語句交易，逐筆更新中途失敗會留下一半升了一半沒升。

## 4. 學校（要裁 D）

P6→J1、J3→S1 一定要換學校，但系統不知道他升哪一所。

- 預設：**不動 `school_id`**，預覽與完成畫面列出「學校要更新」的名單（學生名、原學校），點名字開學生資料改；
  名冊加一個篩選「學制跟年級不合」，之後也找得到。
- 不建議清空學校：清空會讓「原本是哪所國中」也不見了，行政還要回頭查。

## 5. 授權與稽核

- 執行、復原：`manage_students` ＋ **`all_campuses`**（要裁 E）—— 升級是整個機構一次，只管某些分校的管理員不能代表全機構按。
- 預覽：同上（預覽會列出全機構學生名）。
- 稽核：一筆 `audit_logs`（`resource_type = 'grade_promotion'`，details 帶各變動人數、畢業人數、學年）；
  逐人的前後年級在 `grade_promotion_items`，不塞進稽核 details。

## 6. 後端（保留類，批准後實作）

- migration：`grade_promotions`、`grade_promotion_items`（RLS 啟用不加 policy）、`organizations.grade_promotion_month_day`（`'09-01'`）、
  `organizations.grade_promotion_reminder_days`（smallint，預設 7）、SQL 函式 `promote_grades(org, academic_year, actor, graduate_s3)` 與 `revert_grade_promotion(id, actor)`。
- API：`GET /api/grade-promotions/preview`、`POST /api/grade-promotions`、`POST /api/grade-promotions/{id}/revert`、`GET /api/grade-promotions`（歷史）。
- org-settings 加兩個設定欄位（寫入門檻 `manage_org_settings`，同出勤模式）。

## 7. 要裁

- **A. 高三怎麼處理**：(1) 改成停用＋在升級紀錄標「畢業」（**建議**，不動 enum）；(2) `grade_level` 加 `graduated`（要改所有年級的顯示、篩選、分章，範圍大）；(3) 留在高三不動。
- **B. 觸發**：手動一鍵＋預覽、升級日只提醒（**建議**）；或到日自動執行。
- **C. 復原期限**：30 天（**建議**）／不限／不提供復原。
- **D. 學校**：不動＋列出要更新的名單（**建議**）／清空 `school_id`。
- **E. 權限**：`manage_students`＋`all_campuses`（**建議**）／`manage_org_settings`。

## 8. 拆單（批准後）

1. 後端（保留類，migration＋SQL 函式＋API）—— 開 PR 前報計畫席讀 diff。
2. 前端：設定段（升級日、提醒、預覽並執行、上次執行與復原）、預覽／完成對話框、名冊「學制跟年級不合」篩選。
3. 升級前提醒（排程，掛既有每日摘要那條管道）。
