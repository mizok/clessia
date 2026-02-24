# 課堂行事曆設計文件

**日期**: 2026-02-24
**路由**: `/admin/calendar`
**角色**: Admin
**分組**: 教務管理

---

## 核心目的

取代原本分散的三個頁面（排課管理、課堂搜尋、課務異動），提供統一的行事曆介面，讓管理員可以瀏覽課堂、查詢歷史與未來課表，並直接處理停課、代課、調課等異動操作。

---

## 路由異動

| 異動 | 說明 |
|------|------|
| `/admin/calendar` | 從 ungrouped 移入「教務管理」群組，實作完整功能 |
| `/admin/schedule` | `showInMenu: false`（保留路由不刪，sidebar 隱藏） |
| `/admin/sessions` | `showInMenu: false` |
| `/admin/changes` | `showInMenu: false` |

---

## 行事曆視圖

### 桌機（≥ 768px）：週視圖

- CSS Grid 實作
- 橫軸：Mon–Sun（7 欄）
- 縱軸：時間軸，顯示有課堂的時間範圍（例如 13:00–22:00），每格 30 分鐘
- 課堂以色塊顯示在對應格子

### 手機（< 768px）：日視圖

- 一次顯示一天
- 左右箭頭或滑動切換日期
- 縱軸同桌機的時間軸

---

## 導航列

- **上週 / 上一天** 箭頭
- **「今天」按鈕**（回到當週/當天）
- **日期選擇器**（跳至指定日期所在的週/天）
- 顯示目前週次範圍（例如「2026/02/23 – 03/01」）

---

## 課堂色塊

### 顯示內容

- 開課班名稱
- 任課老師姓名

### 顏色（依狀態）

| 狀態 | 顏色 |
|------|------|
| 正常 (scheduled) | 藍色（accent-500） |
| 停課 (cancelled) | 灰色（zinc-400），加刪除線效果 |
| 有異動（代課或調課） | 橘色（warning-600） |

---

## 篩選列

位於行事曆上方，篩選條件：

- **分校**（下拉，可清除）
- **課程**（下拉，可清除）
- **老師**（下拉，可清除）

篩選後即時更新顯示的課堂，不影響導航。

---

## 點擊課堂——Detail Popup

### 響應式

- 桌機：置中 Modal（寬度約 480px）
- 手機：全螢幕（`breakpoints="{'768px': '100vw'}"`)

### Popup 內容

**課堂資訊區塊**
- 開課班名稱、課程名稱、分校
- 日期、時間（start–end）
- 任課老師
- 狀態標籤（正常/停課/有異動）

**異動紀錄區塊**（若有）
- 依建立時間排序，顯示異動類型、說明、建立者、建立時間

**操作區塊**
- 操作按鈕依課堂狀態動態顯示：
  - 正常課堂：「停課」、「代課」、「調課」
  - 已停課：顯示停課資訊，無操作按鈕
  - 已異動：顯示異動資訊，可再次操作（視業務規則）
- 過去超過 N 天的課堂：隱藏操作按鈕（唯讀）

### 三種操作

#### 停課
- 確認 Dialog
- 輸入原因（選填）
- 確認後將 `sessions.status` 更新為 `cancelled`，並寫入 `schedule_changes`

#### 代課
- 選擇代課老師（下拉，顯示所有啟用中的老師）
- 輸入原因（選填）
- 確認後寫入 `schedule_changes`（type: substitute）

#### 調課
- 選擇新日期（日期選擇器）
- 選擇新開始/結束時間
- 輸入原因（選填）
- 確認後寫入 `schedule_changes`（type: reschedule）

---

## 資料依賴

| 操作 | 資料表 |
|------|--------|
| 讀取課堂 | `sessions`, `classes`, `courses`, `campuses`, `staff` |
| 讀取異動紀錄 | `schedule_changes` |
| 寫入停課 | `sessions` (status → cancelled), `schedule_changes` |
| 寫入代課 | `schedule_changes` (type: substitute) |
| 寫入調課 | `schedule_changes` (type: reschedule) |

---

## DB 需求

需新增 `schedule_changes` 表（尚未存在）：

```sql
CREATE TYPE public.schedule_change_type AS ENUM ('reschedule', 'substitute', 'cancellation');

CREATE TABLE public.schedule_changes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id            uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  change_type           public.schedule_change_type NOT NULL,
  new_session_date      date,
  new_start_time        time,
  new_end_time          time,
  substitute_teacher_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reason                text,
  created_by            text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
```

---

## API 需求

| 端點 | 說明 |
|------|------|
| `GET /api/sessions` | 依週次範圍 + 篩選條件查詢課堂（含 join） |
| `POST /api/sessions/:id/cancel` | 停課 |
| `POST /api/sessions/:id/substitute` | 代課 |
| `POST /api/sessions/:id/reschedule` | 調課 |
| `GET /api/sessions/:id/changes` | 查詢單一課堂的異動紀錄 |
