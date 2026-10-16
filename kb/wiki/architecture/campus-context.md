---
title: 頂欄分校：日常頁一次一間，報表才有「全部分校」
summary: 管理端頂欄的分校下拉（CampusContextService）是偏好不是權限；日常頁沒有「全部分校」、預設自己被指派的分校，儀表板／營收報表／人員管理保留全部。
category: architecture
status: active
updated: 2026-10-15
tags: [architecture, campus, admin, topbar]
---

# 頂欄分校：日常頁一次一間，報表才有「全部分校」

## 決定（使用者 2026-10-15 裁定，#1607）

- **日常頁**（課堂管理／點名、學生、報名、請假、帳單、課務異動、考試、成績總覽、課程管理）：
  頂欄只能選單一分校，下拉沒有「全部分校」。
- **報表類**（儀表板、營收報表、人員管理）：保留「全部分校」，給老闆看跨校彙總
  （`kb/raw/sources/interview-insider-2026-08-29.md` Q19）。
- 頁面在建構時宣告：日常頁 `campusCtx.use()`，報表類 `campusCtx.use({ allowAll: true })`。
  **沒有宣告的頁不出現頂欄下拉**（#1138 H2 的過渡規則照舊）。

## 這是偏好，不是權限

範圍一律由後端 `getCampusScope` 決定（c1）；API 仍接受不帶 `campusId`。
`/api/me` 回的 `assignedCampusIds` 只拿來挑預設值，它跟 `campusScope` 是 middleware 裡**同一份**
`staff_campuses`，不另外查。

## 日常頁遇到「沒選」時看哪一間

依序取第一個成立的（只算不寫，使用者自己選了才記）：

1. 上次明確選過的**單一**分校（`clessia.campusContext.single`）
2. 自己被指派的分校中，依下拉順序的第一間
3. 下拉第一間（指派 0 間但有 `all_campuses` 的總管理者；或 API 沒帶 `assignedCampusIds`）
4. 下拉是空的 → 沒有預設，後端本來就什麼都不給

## 報表 ↔ 日常頁

「最後的選擇」（`clessia.campusContext`，可能是全部）與「最後的單一分校」分開記：

- 報表選全部 → 進日常頁顯示上次那一間，**不改掉「全部」** → 回報表還是全部。
- 日常頁選 B → 兩者都變 B → 回報表看到 B（使用者最新的明確選擇）。
- 換頁瞬間兩種頁並存時算日常頁：寧可少一項，不讓日常頁看到全部。

## 拒絕的替代方案

- **日常頁進來就把選擇改寫成單一分校**：回報表時「全部」就丟了，老闆每次都得重選。
- **由 CampusContextService inject AuthService 取指派分校**：AuthService 一建構就打 `/api/me`，
  每個接上的頁（含測試）都會多一支請求；改成 AuthService 讀到 `/me` 後 `setAssigned()` 推過來。
- **頁內留分校下拉補「全部」的洞**（班級視角原本的做法）：日常頁不再有全部，頁內下拉一併拿掉。

## 不在範圍

請假表單的分校欄、通知中心的發布對象也寫「全部分校」，那是資料欄位不是檢視範圍，不受這條影響。
