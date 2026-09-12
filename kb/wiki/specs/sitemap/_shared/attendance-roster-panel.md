---
title: 點名面板（子頁面，多頁共用）
summary: AttendanceRosterPanelComponent 的 UI 地圖：三個頁面開得到（第四個引用點是死的），逐生出席／缺席與整批出席；副標的時段依呼叫端而異。
category: spec
status: developing
tags: [sitemap, _shared, admin, teacher]
created: 2026-09-12
updated: 2026-09-12
---

# 點名面板（子頁面）

**元件**：`@shared/components/attendance-roster-panel/attendance-roster-panel.component`

**`grep` 找到四個引用點，但其中一個到不了 —— 實際開得到的是三個：**

| 開啟頁面                           | 入口                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| [[specs/sitemap/admin/dashboard]]  | 今日課表裡可按的那一列                                   |
| [[specs/sitemap/admin/sessions]]   | 每列 ⋮ ›「管理出勤狀況」                                 |
| [[specs/sitemap/teacher/schedule]] | 課堂卡片的「開始點名」／「修改點名」（**labor-4 已驗**） |
| ~~`admin/pages/attendance`~~       | **接不到** —— 見下                                       |

> ⚠️ **`grep -rl` 的命中數不等於「從幾頁開得到」。**
> `features/admin/pages/attendance/attendance.page.ts` 引用了這支面板，
> 但 `/admin/attendance` 這條路由是純 `redirectTo` → `/admin/sessions`，
> **那個頁面元件全庫沒有任何地方 import**，所以它的開啟點永遠走不到。
> 詳見 [[specs/sitemap/admin/attendance]] 與 issue #698。
>
> **我第一版就是照 `grep` 的四筆寫的**，寫完才在畫 `/admin/attendance` 時發現第四筆是死的。

> 清單來源：`grep -rl AttendanceRosterPanelComponent apps/web/src/app`（排除元件自己與 spec）。
> **新增開啟點時要回來補這張表** —— 這正是「規則寫在它守護的東西旁邊」。

## 畫面區塊

### 1. 標頭

- 第一行：班級名稱（例：`國三國文 A 班`）
- 第二行：`YYYY-MM-DD`，**後面的 `· HH:MM–HH:MM` 是條件式的**（`@if (session.timeRange)`）
- 右上：`✕`

> ⚠️ **時段有沒有出現，看的是哪一頁開的它。** 呼叫端自己組 `RosterPanelSession`：
> `/admin/dashboard` 有傳 `timeRange`，**`/teacher/schedule` 沒有**
> （`schedule.page.ts:320` 只傳 `eventId / className / eventDate`），
> 所以老師端的副標只有 `2026-08-31`。兩邊都實測過。
>
> **這是「共用元件不代表兩邊長一樣」的實例** —— 差別不在元件裡，在呼叫端傳了什麼。

### 2. 學生清單

一位學生一列：姓名、第二行是年級與學校（例：`國二 · 景美國中`），右側兩顆按鈕 `出席` / `缺席`。

### 3. 頁尾

- 左側：`還有 N 人未標記`
- 右側：`全部出席`、`儲存點名`

## 互動元素

| 元素（畫面上的字） | 類型                 | 出現條件 | 按了之後                             |
| ------------------ | -------------------- | -------- | ------------------------------------ |
| ✕                  | 按鈕                 | 永遠     | 關閉面板，不儲存                     |
| 出席               | 按鈕（每位學生一顆） | 永遠     | 把該生標成出席（本地狀態，尚未送出） |
| 缺席               | 按鈕（每位學生一顆） | 永遠     | 把該生標成缺席（本地狀態，尚未送出） |
| 全部出席           | 按鈕                 | 永遠     | 把所有未標記的標成出席               |
| 儲存點名           | 按鈕（主要動作）     | 永遠     | 送出點名（**未實按** —— 會寫入資料） |

## 狀態

| 狀態                   | 畫面                       |
| ---------------------- | -------------------------- |
| 尚未標記完             | 頁尾左側 `還有 N 人未標記` |
| 載入中 / 錯誤 / 空名單 | **未驗**                   |

## ⚠️ Escape 關不掉它

開啟設定是 `closable: false`（見 `dashboard.component.ts` 的 `openAttendance`），
**按 Escape 沒有反應**，只能用它自己的 `✕`。實測確認過。

## 驗證紀錄

- **日期**：2026-09-12 ／ 帳號 `admin@demo.clessia.app` ／ 前端 `9f08061a`（port 4201）
- **開啟路徑**：`/admin/dashboard` 今日課表的「17:00 國三國文 A 班」
- **資料狀態**：該堂 8 位學生，全部未標記

### 兩向比對

面板內 DOM 互動元素 **19** 個 = `✕` 1 + 8 位學生 ×（出席 + 缺席）16 + `全部出席` + `儲存點名`。
地圖以「每位學生一顆」表示那 16 顆。**差異：0 筆。**

### 未驗到的

- `儲存點名` 與 `全部出席` 的實際結果（會寫入）
- 從 `/admin/sessions` 開啟時是否完全相同（入口已確認存在，未逐一比對面板內容）
- ~~`/teacher/schedule`~~ —— **labor-4 已比對**：19 個控制項的結構完全一致
  （✕ + 8 位學生 ×2 + 全部出席 + 儲存點名），**唯一差別是副標少了時段**（見上）
- 載入中 / 錯誤 / 空名單
