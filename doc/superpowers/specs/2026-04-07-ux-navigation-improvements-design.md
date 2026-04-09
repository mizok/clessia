# UX 導航體驗改善設計文件

**日期**：2026-04-07  
**分支**：feat/enrollment  
**背景**：目前 admin 系統以「資料物件」切頁面（課程、學生、班級各自一頁），完成一件完整任務需跳轉多個路由，且無脈絡引導，操作員容易迷失。

---

## 問題摘要

從實際使用情境分析出三類痛點：

1. **去程問題**：不知道要去哪裡做事（缺乏任務導向入口）
2. **回程問題**：深入操作後找不到回程（缺乏導航脈絡）
3. **資訊分離**：相關資料散落不同頁面（例如課堂 ≠ 請假）

---

## 設計範圍

| 項目 | 類型 | 說明 |
|---|---|---|
| 1. Dashboard | 靜態 UI | 先定義資訊架構與視覺稿，資料串接留待後續 |
| 2. Breadcrumb + 返回按鈕 | 實作 | 所有第二層以下頁面 |
| 3. Session detail 整合請假 | 實作 | 課堂詳情對話框顯示學生請假狀態 |
| 4. 家長詳情整合報名 | 實作 | 家長詳情頁直接幫學生報班 |

---

## 1. Dashboard 靜態 UI

### 使用者角色分析

Admin 實際上涵蓋兩種操作情境，且同一人可能兼具兩者：

| 角色 | 思維模式 | 主要關注 |
|---|---|---|
| 前台/行政人員 | 今天有什麼事要做 | 今日課堂、待處理請假、待確認報名 |
| 管理主管 | 整體狀況怎麼樣 | 學生人數、各班出席率、收費狀況 |

Dashboard 需要同時服務兩種視角，根據使用者的權限範圍（單分校 vs 全組織）呈現不同側重。

### 版面結構

```
┌──────────────────────────────────────────────────────┐
│  今日  2026年4月7日 星期一              [分校篩選 ▼] │
├──────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ 今日課堂  │ │ 待處理   │ │ 在籍學生  │ │ 本月   │  │
│  │    8 堂  │ │ 請假 3   │ │  124 人  │ │ 新報名 │  │
│  │          │ │ 報名 2   │ │          │ │  7 人  │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘  │
├──────────────────────────────────────────────────────┤
│  今日課表                          [查看全部課堂 →]  │
│  ┌────────────────────────────────────────────────┐  │
│  │ 09:00  國一數學甲班  王老師  本館3F  12人報到   │  │
│  │ 10:30  國二英文乙班  李老師  本館2F  ⚠ 2人請假  │  │
│  │ 14:00  高一物理班   陳老師  分館1F  尚未開始    │  │
│  └────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│  待處理事項                                           │
│  ┌────────────────────┐  ┌────────────────────────┐  │
│  │ 請假待確認 (3)     │  │ 報名待審核 (2)         │  │
│  │ • 王小明 國一數學   │  │ • 陳家豪 高一物理班    │  │
│  │ • 李大華 國二英文   │  │ • 林美玲 國二英文乙班  │  │
│  │ [前往請假管理 →]   │  │ [前往報名管理 →]       │  │
│  └────────────────────┘  └────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 主管視角補充區塊（有全組織權限時顯示）

```
┌──────────────────────────────────────────────────────┐
│  本月概覽                                             │
│  ┌─────────────────────────┐ ┌──────────────────────┐│
│  │ 各班出席率              │ │ 學生人數趨勢          ││
│  │ [靜態佔位圖表]          │ │ [靜態佔位圖表]        ││
│  └─────────────────────────┘ └──────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### 設計規格

**統計卡片（Stat Card）**
- 尺寸：flex 1，最小寬度 160px
- 結構：數字（text-2xl font-semibold）+ 標籤（text-sm text-zinc-500）+ 子項目（可選）
- 顏色：有待處理項目時使用 sky-600 accent；警示狀態使用 amber-500
- 互動：整張卡可點擊，點擊後導向對應管理頁

**今日課表列**
- 每列顯示：時間 | 班級名稱 | 老師 | 教室 | 狀態
- 狀態標籤：已完成（綠）/ 進行中（藍）/ 尚未開始（灰）/ 有請假（琥珀 ⚠）
- 點擊列 → 開啟 session detail dialog（不跳頁）
- 最多顯示 5 筆，超過顯示「查看全部」

**待處理事項**
- 雙欄卡片：請假 + 報名
- 每卡最多列出 3 筆，超過顯示「還有 N 筆」
- 底部連結導向對應管理頁

**靜態實作說明**
- 統計卡片數字：寫死示範數據（或全部顯示 `—`）
- 今日課表：空陣列 + EmptyState
- 待處理：空陣列 + EmptyState
- 圖表區：`[資料串接中]` 佔位文字 + 灰色虛線邊框
- 所有導向連結正常可點擊

### 元件

```
dashboard.component.ts / .html / .scss
├── stat-card（inline，不需獨立元件）
├── today-sessions-list（inline）
└── pending-items-panel（inline）
```

---

## 2. Breadcrumb + 返回按鈕

### 適用頁面

| 頁面 | Breadcrumb 路徑 |
|---|---|
| 學生詳情 `/admin/students/:id` | 學務管理 › 學生 › {學生姓名} |
| 班級詳情 `/admin/courses/:courseId/classes/:classId` | 課務管理 › 課程 › {課程名稱} › {班級名稱} |

### 元件設計：`PageBreadcrumbComponent`

**selector**：`app-page-breadcrumb`

**input**：
```typescript
items = input.required<BreadcrumbItem[]>();
// BreadcrumbItem = { label: string; routerLink?: string }
```

**視覺規格**：
```
課務管理  ›  課程  ›  國一數學  ›  高一甲班
```
- 字型：text-sm（14px），text-zinc-500
- 可點擊項目：hover 後 text-zinc-800，cursor-pointer
- 最後一項（當前頁）：text-zinc-800，不可點擊
- 分隔符：`›`（`pi pi-angle-right` icon，size 10px）
- 位置：page header 的 h1 標題上方，margin-bottom: var(--space-2)

**返回按鈕**：
- 在 breadcrumb 旁邊或下方加一個 `← 返回` 文字按鈕
- 點擊後導向 breadcrumb 倒數第二項的路由
- 使用 `p-button` severity="text"，icon="pi pi-arrow-left"

**路由來源保留**（for 班級詳情）：
- 班級詳情從課程頁進入時，URL 帶有 `courseId` → breadcrumb 可顯示課程名稱
- 課程名稱透過 `classesService.getClass(classId)` 的 response 中取得（已有 `courseName` 欄位）

---

## 3. Session Detail 整合請假資訊

### 目標

在現有的 `SessionDetailDialogComponent` 裡，新增「學生出缺席」區塊，讓操作員不用離開課堂詳情就能看到：
- 哪些學生已請假
- 哪些學生已出席（若點名完成）

### UI 區塊設計

加在 session detail dialog 的現有資訊下方：

```
┌─────────────────────────────────────────┐
│  學生狀態                               │
│  ┌──────────────┬──────┬──────────────┐ │
│  │ 姓名         │ 狀態 │ 備註         │ │
│  ├──────────────┼──────┼──────────────┤ │
│  │ 王小明       │ 請假 │ 家庭因素     │ │
│  │ 李大華       │ 出席 │ —            │ │
│  │ 陳美玲       │ —    │ 尚未點名     │ │
│  └──────────────┴──────┴──────────────┘ │
└─────────────────────────────────────────┘
```

**狀態標籤**：
- 請假：amber Tag（`severity="warn"`）
- 出席：green Tag（`severity="success"`）
- 缺席：red Tag（`severity="danger"`）
- 尚未點名：gray Tag（`severity="secondary"`）

### 資料來源

Session detail 已有 `sessionId`，需要：
1. `GET /api/enrollments?classId={classId}&status=active,pending_payment` → 取得該班所有學生
2. `GET /api/leaves?sessionId={sessionId}` → 取得該堂課的請假記錄
3. `GET /api/attendance?sessionId={sessionId}` → 取得該堂課的出勤記錄

前端 `computed()` 合併三份資料，產出每個學生的狀態。

**注意**：目前 session detail 已有 `classId` 欄位（透過 Session 物件），可直接使用。

### 載入行為

- Session detail 開啟時，三個 API 並行呼叫
- 各自有獨立 loading skeleton（3 列 skeleton row）
- 任一 API 失敗：顯示 inline error message，不影響其他區塊

---

## 4. 家長詳情整合報名

### 目標

目前家長列表的 action menu 只有「新增學生」和「編輯」，報名班級需要另外跳到學生詳情頁才能做。  
改善：新增一個 **ParentDetailDialogComponent**，集中顯示家長旗下學生，並提供每位學生的「報班」入口。

### 目前狀況

- `parents.page.ts`：列表頁 + action menu
- `ParentFormDialogComponent`（`@shared/components/parent-form-dialog/`）：編輯家長資料，無學生列表
- `openAddStudentDialog(parent)`：直接建立新學生，無法報名現有學生到班級
- `ClassPickerDialogComponent`：現有於 `student-detail.page.ts`，可複用

### 設計：新增 ParentDetailDialogComponent

在 action menu 加入「查看詳情」選項，開啟新的 `ParentDetailDialogComponent`：

```
┌───────────────────────────────────────────────────┐
│ 家長詳情                                    [×]   │
├───────────────────────────────────────────────────┤
│ 王大明  ·  0912-345-678  ·  active                │
├───────────────────────────────────────────────────┤
│ 旗下學生                         [+ 新增學生]     │
│ ┌──────────┬──────┬──────────────────────────┐    │
│ │ 王小明   │ 國一  │ 在籍 2 班  [報名班級 +]  │    │
│ │ 王小華   │ 國三  │ 在籍 1 班  [報名班級 +]  │    │
│ └──────────┴──────┴──────────────────────────┘    │
└───────────────────────────────────────────────────┘
```

點擊「報名班級 +」→ 開啟 `ClassPickerDialogComponent` → 選班後呼叫 `enrollmentsService.create()`。

**完成後**：
- 刷新學生的在籍班級數
- Toast 顯示「{學生名} 已加入 {班級名}」

### 資料流

1. ParentDetailDialog 開啟時，呼叫 `studentsService.list({ parentId })` 取得學生列表
2. 每位學生呼叫 `enrollmentsService.list({ studentId, status: 'active,pending_payment' })` 取得在籍班級數
3. 點「報名班級 +」時，傳入 `studentId`、`existingClassIds`、`studentGrade` 給 ClassPickerDialog
4. ClassPickerDialog 回傳選擇的 class → 呼叫 `enrollmentsService.create()`

### 元件位置

```
features/admin/pages/parents/
└── parent-detail-dialog/
    ├── parent-detail-dialog.component.ts
    ├── parent-detail-dialog.component.html
    └── parent-detail-dialog.component.scss
```

`ClassPickerDialogComponent` 需從 `student-detail/class-picker-dialog/` 移至 `shared/components/class-picker-dialog/` 以便複用。

---

## 元件與檔案影響範圍

| 檔案 | 變更類型 |
|---|---|
| `dashboard/dashboard.component.*` | 重寫（目前是 coming soon） |
| `shared/components/page-breadcrumb/` | 新增元件 |
| `students/detail/student-detail.page.html` | 加入 breadcrumb |
| `courses/class-detail/class-detail.page.html` | 加入 breadcrumb |
| `sessions/dialogs/session-detail-dialog/session-detail-dialog.component.*` | 新增學生狀態區塊 |
| `parents/parents.page.*` | action menu 加「查看詳情」 |
| `parents/parent-detail-dialog/` | 新增元件 |
| `shared/components/class-picker-dialog/` | 從 student-detail 移入 shared |
| `core/leaves.service.ts` | 確認是否有 `listBySession` 方法 |
| `core/attendance.service.ts` | 確認是否有 `listBySession` 方法 |

---

## 優先順序

1. **Breadcrumb + 返回按鈕**（影響範圍小、效果立竿見影）
2. **家長詳情整合報名**（補完臨櫃報名最後一哩路）
3. **Session detail 整合請假**（需要多個 API，稍複雜）
4. **Dashboard 靜態 UI**（工程量最大，但只做靜態）

---

## 驗收標準

### Breadcrumb
- [ ] 學生詳情頁顯示正確麵包屑，點擊可返回學生列表
- [ ] 班級詳情頁顯示正確麵包屑，點擊可返回課程頁
- [ ] 返回按鈕行為與麵包屑一致

### Session Detail 請假整合
- [ ] 開啟課堂詳情時，學生狀態區塊正確載入
- [ ] 請假/出席/缺席/尚未點名四種狀態顯示正確
- [ ] API 失敗時顯示錯誤訊息，不影響其他資訊顯示

### 家長詳情整合報名
- [ ] 家長旗下每位學生旁顯示「報班+」按鈕
- [ ] 點擊後開啟班級選擇 dialog，已報名的班級不可重複選
- [ ] 報名成功後 toast 顯示確認訊息，在籍班級數量更新

### Dashboard 靜態 UI
- [ ] 四個統計卡片排版正確
- [ ] 今日課表空狀態顯示正確
- [ ] 待處理事項空狀態顯示正確
- [ ] 所有導向連結可正常點擊
- [ ] 主管概覽區塊的圖表佔位顯示正確
