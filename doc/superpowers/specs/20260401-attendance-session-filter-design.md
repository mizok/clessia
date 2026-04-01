# 課堂出勤操作台 Filter 強化 — 設計文件

**日期：** 2026-04-01  
**影響頁面：** `/admin/attendance`（AttendancePage）

---

## 背景

現有出勤操作台只有單日日期選擇，無分校篩選，無學生搜尋，session 卡片也缺少課程名稱與日期。

---

## 功能範圍

### 1. Toolbar

| 控件 | 類型 | 行為 |
|------|------|------|
| 日期範圍 | `p-datepicker selectionMode="range"` | 兩端都選齊才觸發 loadSessions；預設今天～今天 |
| 分校篩選 | `p-select`（單選） | 選「全部」= null；改變即重打 API |
| 學生篩選 | `p-multiselect` + ImeFilterInputComponent filter slot | 選定後 fetch enrollments 取 classIds；client-side 過濾 sessions signal |

三個 filter 獨立，AND 關係：
- 分校 → server-side（`campusId` param）
- 學生 → client-side（enrollment classIds 篩 sessions signal）

### 2. Session 卡片佈局

```
┌──────────────────────────────────────────────────┐
│ [courseName（可選）]           MM/DD（週X）       │
│ [className]                                       │
│ 09:00–11:00  ·  台北分校                         │
│                                                   │
│  ✓ 12   🏳 2   ✗ 1          [點名 / 修改點名]   │
└──────────────────────────────────────────────────┘
```

- `courseName` 為 null 時略去該行
- `eventDate` 右上角，格式 `MM/DD（週X）`

### 3. API 變動

`GET /api/attendance/sessions` 回傳新增 `courseName: string | null`：
- 後端 query 改為 `classes(name, courses(name))`
- response schema `EventSessionSummarySchema` 新增 `courseName`

---

## 資料流

```
loadSessions(dateFrom, dateTo, campusId?)
  └─ GET /attendance/sessions → sessions signal

selectedStudentIds signal 改變
  └─ forkJoin enrollments API per student
  └─ collect classIds → studentEnrolledClassIds signal

filteredSessions = computed(() =>
  studentEnrolledClassIds.size === 0
    ? sessions()
    : sessions().filter(s => classIds.has(s.classId))
)
```

---

## 不在範圍內

- Teacher 頁面的 schedule page（不改動）
- 出勤紀錄列表頁（GET /attendance list view）
- 分頁功能
