# 出勤作業台重設計 & Teacher 課表 MVP 技術設計

**日期**：2026-04-01（Codex review 修訂：2026-04-01）
**範疇**：Admin 出勤作業台改版、Teacher 課表頁含點名、SessionDetailDialog 角色調整、Seed 資料

---

## 背景與目標

現有的 Admin 出勤頁是以「學生個人紀錄」為主軸的清單，不符合補習班日常「今天哪班有人沒來」的操作需求。本次設計目標：

1. 把 Admin 出勤頁改為**以班級/課堂為主軸的每日作業台**
2. 建立 **Teacher 課表頁 MVP**，整合點名功能
3. 釐清 SessionDetailDialog 與出勤作業台的職責邊界
4. 補充 Seed 資料方便測試

---

## 架構決策

| 決策 | 選項 | 理由 |
|---|---|---|
| 出勤責任設定粒度 | 系統全域 | 補習班模式通常一致；現有 org_settings 已有 attendanceMode |
| 出勤紀錄建立時機 | 懶建立，但不預填狀態 | 避免 absent 與「未點名」語意混淆（詳見下方） |
| Teacher 點名入口 | 課表頁（不另開點名頁） | 老師心智模型單純，學習成本最低 |
| SessionLeaveRosterDialog | 保留，收窄為「請假預覽」 | 仍有排課視角的查詢價值，與出勤操作職責不同 |
| on_leave 在點名面板 | 顯示為 locked badge，非 toggle 選項 | batch API 不允許改 on_leave；UI 與 API 契約一致 |
| attendance_taken_at 語意 | 首次完成點名的時間，immutable | 補正操作不更新此欄位，避免語意模糊 |
| attendance_responsible 存放位置 | org_settings（與 attendanceMode 同表） | 單一 source of truth，不另起設定表 |

---

## Section 1：資料模型與 API

### 出勤紀錄懶建立策略（修訂版）

**Init API 不預填 `absent`**，改為純 roster 回傳 + 前端渲染：

1. Init API 查詢 roster（enrolled 學生 + 現有紀錄 join）後回傳
2. 前端對「無紀錄」的學生在 UI 預設選 `absent`，但不寫入 DB
3. 使用者完成點名 → 「儲存」時才批次 upsert 所有學生紀錄
4. 儲存成功 → 同一 transaction 內更新 `events.attendance_taken_at`

**好處**：`attendance_taken_at IS NULL` = 真正未點名；不會出現「init 後摘要就顯示 ✗ N」的誤導情況。

### Enrollment 快照規則

Init API 查詢 enrollment 時必須使用 **event_date 當天有效的修課學生**，而非現在的在班名單：

```sql
SELECT e.student_id
FROM enrollments e
WHERE e.class_id = :classId
  AND e.effective_from <= :eventDate
  AND (e.effective_to IS NULL OR e.effective_to >= :eventDate)
  AND e.status = 'active'
```

這確保補點名舊課堂時，拿到的是當時的班級名單，不受後來退班/入班影響。

### Events 表新增欄位

```sql
ALTER TABLE public.events ADD COLUMN attendance_taken_at timestamptz;
```

### org_settings 新增欄位

新增到現有 org_settings 表（與 `attendance_mode` 同處）：

| 欄位 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `attendance_responsible` | `text` check `in ('admin','teacher')` | `'admin'` | 點名責任方 |
| `attendance_retroactive_days` | `integer` | `0` | 補點名期限天數（0 = 無限制） |

同步更新 `GET/PATCH /api/org-settings` 的 schema 以支援這兩個欄位，前端才能讀寫。

### 新增 API Endpoints

#### `GET /api/attendance/sessions`

Admin 作業台與 Teacher 週視圖的主要資料來源。

**Query params**：
- `date` (required)：`YYYY-MM-DD`
- `campusId` (optional)
- `dateFrom` / `dateTo`：Teacher 週視圖用，取代單一 `date`

**Response**：
```json
[
  {
    "eventId": "uuid",
    "classId": "uuid",
    "className": "數學班 A",
    "teacherName": "王老師",
    "campusName": "台北校區",
    "startTime": "10:00",
    "endTime": "12:00",
    "enrolledCount": 20,
    "presentCount": 18,
    "onLeaveCount": 1,
    "absentCount": 1,
    "takenAt": "2026-04-01T02:30:00Z" // null = 未點名
  }
]
```

當 `takenAt` 為 null 時，`presentCount / onLeaveCount / absentCount` 應全為 0（不回傳 provisional 值）。

#### `GET /api/attendance/roster/:eventId`

點名面板開啟時呼叫，同時觸發懶建立邏輯。

**Response**：
```json
{
  "eventId": "uuid",
  "takenAt": null,
  "students": [
    {
      "studentId": "uuid",
      "studentName": "劉靖雯",
      "grade": "junior_2",
      "school": "台北市立中正國中",
      "recordId": "uuid",   // null = 尚無紀錄
      "status": "on_leave"  // null = 尚無紀錄，前端預設 absent
    }
  ]
}
```

**懶建立邏輯**（在此 endpoint 內執行，非獨立 init）：
- 以 enrollment 快照規則查出有效修課學生
- 查現有 `attendance_records` for this event
- **不**預先 insert；直接回傳 roster + 現有紀錄 join 結果
- 冪等，重複呼叫不產生副作用

#### `PATCH /api/attendance/batch`

批次儲存點名結果，**以 eventId + studentId 為主鍵**（不依賴 record id）。

**Request body**：
```json
{
  "eventId": "uuid",
  "updates": [
    { "studentId": "uuid", "status": "present" },
    { "studentId": "uuid", "status": "absent" }
  ]
}
```

**原子性要求**：
1. 驗證所有 studentId 屬於此 event 的有效 enrollment（snapshot 規則）
2. 使用 upsert `ON CONFLICT (event_id, student_id) DO UPDATE SET status = EXCLUDED.status`
3. 拒絕包含 `on_leave` 的 updates（400）
4. 全部成功後，在同一 transaction 內 `UPDATE events SET attendance_taken_at = now() WHERE id = :eventId AND attendance_taken_at IS NULL`
5. 任一步驟失敗，整體 rollback

**Response 200**：`{ "updated": N, "takenAt": "ISO timestamp" }`

---

## Section 2：Admin 出勤作業台

### 路由

`/admin/attendance`（維持現有路由，改版頁面內容）

### 頁面佈局

```
Toolbar：[日期選擇器（預設今天）] [分校篩選]

Body：當日課堂卡片列表，依時間排序

┌─────────────────────────────────────────────┐
│ 數學班 A　10:00–12:00　王老師　台北校區       │
│ 20人　✓ 18　🏳 1　✗ 1                       │  ← takenAt 有值才顯示分項
│                                    [點名]   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 英文班 B　14:00–16:00　李老師　台北校區       │
│ 15人　◌ 未點名                               │  ← takenAt IS NULL
│                                    [點名]   │
└─────────────────────────────────────────────┘
```

### 點名面板（右側 sidebar panel）

點擊「點名」→ 呼叫 `GET /api/attendance/roster/:eventId` → 滑出面板。

```
數學班 A｜2026-04-01                  [儲存]

劉靖雯  國二·中正國中    [出席]  [缺席]
陳宇翔  國三·大安國中    [出席]  [缺席]
林小明  國一·信義國中    🏳 請假中（不可變更）  ← badge，非 toggle
```

- 有 `on_leave` 紀錄的學生：顯示「請假中」badge，灰底，無狀態 toggle
- 無紀錄的學生：前端預設 `absent`（UI 視覺預選），未實際寫入
- 「儲存」→ `PATCH /api/attendance/batch`（含所有非 on_leave 學生）

### attendance_responsible 影響

| 設定 | 點名按鈕 | 行為 |
|---|---|---|
| `admin` | 藍色主要按鈕 | 主要操作入口 |
| `teacher` | ghost button「補正點名」 | 可操作，但視覺上非主要 CTA |

### 請假時段規則

leave_requests 有 `start_time` / `end_time` 時，判斷是否影響特定課堂：
- **無時間**：當天所有課堂一律標記 `on_leave`
- **有時間**：只影響「課堂時間與請假時間有重疊」的 events（`event.start_time < leave.end_time AND event.end_time > leave.start_time`）
- 此規則在 leave_requests 新增/刪除時同步套用到 `attendance_records`

---

## Section 3：SessionDetailDialog 角色調整

### 變更清單

1. **SessionDetailDialog**
   - 「課堂名單」按鈕改名為「**請假名單**」
   - 新增「**查看出勤**」連結 → 導向 `/admin/attendance?date=YYYY-MM-DD`

2. **SessionLeaveRosterDialog**
   - Header 文字改為「請假名單」
   - 職責定位：唯讀，回答「誰有請假」，不做出勤操作

### 職責邊界

```
Sessions 頁 → SessionDetailDialog
  ├─ 請假名單（誰請假）→ SessionLeaveRosterDialog  [排課視角，唯讀]
  └─ 查看出勤（誰到了）→ Attendance 頁             [操作視角]
```

---

## Section 4：Teacher 課表頁 MVP

### 路由

`/teacher/schedule`（現有路由，目前為空殼，本次實作）

### 頁面佈局

週視圖，今天高亮，可左右切換週次。資料來源：`GET /api/attendance/sessions?dateFrom=&dateTo=`（過濾 teacher_id = 自己）。

```
< 上週    2026年3月31日 – 4月6日    下週 >

週一 3/31              週二 4/1
┌───────────────┐    ┌───────────────┐
│ 數學班 A       │    │ 英文班 B       │
│ 10:00–12:00   │    │ 14:00–16:00   │
│ 20 人          │    │ 15 人          │
│ ✓18 🏳1 ✗1    │    │ ◌ 未點名       │
│ [已點名]       │    │ [開始點名]     │
└───────────────┘    └───────────────┘
```

課堂卡片狀態：
- **未來**：只顯示人數，無點名按鈕
- **未點名**：`[開始點名]`（藍色）
- **已點名**：`[已點名]`（灰色，可點擊修改）
- **補點名截止**：顯示「點名已截止」，不顯示按鈕

### 點名面板

與 Admin 版本相同邏輯（共用元件），針對行動裝置優化：
- 狀態 toggle 採用較大按鈕
- `on_leave` 學生顯示請假 badge，不提供 toggle
- 「完成」→ 批次儲存，回到課表

### 權限規則

- Teacher 只能操作自己被指派的 sessions（`events.teacher_id = me` 或 `events.substitute_id = me`）
- 已取消（`cancelled`）的 session：不呼叫 roster API，不顯示點名按鈕
- Admin 無視 `retroactive_days` 限制；Teacher 受限

### attendance_responsible 影響

| 設定 | 點名按鈕 | 行為 |
|---|---|---|
| `teacher` | 藍色主要按鈕 | 主要操作入口 |
| `admin` | 不顯示 | 僅顯示出勤摘要（唯讀） |

### 補點名期限

```
今天 - event.event_date > attendance_retroactive_days（且值 > 0）
```

若超過，Teacher 不顯示點名按鈕，顯示「點名已截止」。Admin 不受此限制。

---

## Section 5：Seed 資料

### 檔案位置

`supabase/migrations/20260401000001_seed_attendance_test.sql`

加上 `-- SEED DATA` 標記，方便識別與日後清除。

### 資料規劃

**學生（12 名）**

| 姓名 | 年級 | 就讀學校 |
|---|---|---|
| 劉靖雯 | 國二 | 台北市立中正國中 |
| 陳宇翔 | 國三 | 台北市立大安國中 |
| 林小明 | 國一 | 台北市立信義國中 |
| 張雅婷 | 小六 | 台北市立東門國小 |
| 王志豪 | 國二 | 新北市立板橋國中 |
| 李佳穎 | 國三 | 新北市立三重國中 |
| 吳宗翰 | 小五 | 新北市立中和國小 |
| 黃思婷 | 國一 | 新北市立永和國中 |
| 蔡明哲 | 國二 | 桃園市立中壢國中 |
| 鄭雅文 | 小六 | 桃園市立桃園國小 |
| 許家豪 | 國三 | 桃園市立八德國中 |
| 周怡君 | 國一 | 桃園市立大溪國中 |

**班級（3 班）**

| 班級 | 週期 | 時間 | 學生 |
|---|---|---|---|
| 數學班 A | 週一、三、五 | 10:00–12:00 | 學生 1–8 |
| 英文班 B | 週二、四 | 14:00–16:00 | 學生 5–12 |
| 自然班 C | 週六 | 09:00–11:00 | 學生 1–4、9–12 |

**Events 範圍**：過去 2 週 + 今天 + 未來 1 週，約 21 筆

**出勤紀錄**（過去課堂，`attendance_taken_at` 有值）：
- 大多數 `present`
- 每班至少 1 筆 `absent`
- 有請假學生標 `on_leave`

**今天課堂**：
- 數學班 A：`attendance_taken_at` 有值（模擬已點名），含 1 人 on_leave
- 英文班 B：`attendance_taken_at` 為 null（模擬未點名）

**請假紀錄（3 筆）**：
- 1 筆進行中（startDate 在過去，endDate 在未來）
- 1 筆未來
- 1 筆已結束

---

## 實作順序（修訂版）

1. **DB migrations**：`events.attendance_taken_at` + org_settings 兩個新欄位
2. **擴充 org-settings API**：GET/PATCH 支援 `attendance_responsible` / `attendance_retroactive_days`
3. **新增 Read API**：`GET /api/attendance/sessions`、`GET /api/attendance/roster/:eventId`
4. **新增 Write API**：`PATCH /api/attendance/batch`
5. **Admin 出勤作業台改版**（頁面 + 點名面板）
6. **SessionDetailDialog 調整**（改名 + 新增連結）
7. **Teacher 課表頁 MVP**（週視圖 + 點名面板，共用 Admin 點名面板元件）
8. **Seed 資料**

---

## 不在本次範疇

- Parent 端出勤查詢
- 出勤報表 / 統計圖表
- 點名通知（家長簡訊/推播）
- Teacher 端學生列表、通知頁
- QR code 打卡與 attendance_records 的優先順序整合（daily-checkins 與本次設計的衝突需獨立處理）
