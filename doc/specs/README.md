# Clessia 頁面規格文件

本目錄包含 Clessia（學程管家）系統所有頁面的功能規格摘要。

## 目錄結構

```text
doc/specs/
├── README.md                         # 本文件
│
├── public/                           # 公開頁面（無需登入）
│   ├── login.md
│   ├── trial.md                      # 試聽申請表單
│   ├── enrollment.md                 # 新生報名表單
│   └── qr-checkin.md
│
├── admin/                            # 管理員頁面
│   ├── dashboard.md                  # 儀表板
│   ├── tasks.md                      # 待處理工作
│   ├── calendar.md                   # 課程日曆
│   ├── notifications.md              # 通知中心
│   │
│   ├── academic/                     # 教務管理
│   │   ├── courses.md                # 課程列表
│   │   ├── classes.md                # 開課班管理
│   │   ├── schedule.md               # 排課管理
│   │   ├── sessions.md               # 課堂搜尋
│   │   └── changes.md                # 課務異動
│   │
│   ├── student-affairs/              # 學務管理
│   │   ├── students.md               # 學生資料
│   │   ├── parents.md                # 家長資料
│   │   ├── attendance.md             # 出勤紀錄
│   │   ├── leave.md                  # 請假管理
│   │   └── grades.md                 # 成績查閱
│   │
│   ├── enrollment/                   # 報名管理
│   │   ├── trials.md                 # 試聽管理
│   │   ├── enrollment-requests.md    # 報名審核
│   │   ├── enrollment.md             # 學生報名（直接報名）
│   │   └── renewals.md               # 續課管理
│   │
│   ├── finance/                      # 財務管理
│   │   ├── fee-templates.md          # 費用方案管理
│   │   ├── meals.md                  # 餐費管理
│   │   ├── payments.md               # 繳費紀錄
│   │   └── reports.md                # 營收報表
│   │
│   └── system/                       # 系統設定
│       ├── staff.md                  # 人員管理
│       ├── campuses.md               # 分校設定
│       └── settings.md               # 系統設定
│
├── teacher/                          # 老師頁面
│   ├── dashboard.md
│   ├── notifications.md
│   ├── schedule.md                   # 課表
│   ├── attendance.md                 # 點名
│   ├── students.md                   # 學生
│   └── assessments.md                # 考試管理
│
└── parent/                           # 家長頁面
    ├── dashboard.md
    ├── notifications.md
    ├── schedule.md                   # 課表查看
    ├── attendance.md                 # 到班紀錄
    ├── grades.md                     # 成績查閱
    ├── trial.md                      # 試聽申請
    ├── enrollment.md                 # 報名申請
    ├── add-course.md                 # 加選課程
    ├── renewal.md                    # 續課資訊
    ├── meals.md                      # 餐費紀錄
    └── payments.md                   # 繳費紀錄
```

## 頁面統計

| 分類 | 頁面數 |
|------|--------|
| Public | 4 |
| Admin | 20 |
| Teacher | 6 |
| Parent | 11 |
| **總計** | **41** |

## 規格格式說明

每個頁面規格包含以下項目：

| 項目 | 說明 |
|------|------|
| **核心目的** | 頁面的主要功能，1 句話描述 |
| **MVP 功能** | 必須具備的功能點列表 |
| **資料依賴** | 讀取/寫入的資料表 |
| **PRD 參考** | 對應的 PRD 章節編號 |
| **實作註記** | 複雜度警告或特殊注意事項（若有） |

## RoutesCatalog 對應

本規格目錄與 `src/app/core/smart-enums/routes-catalog.ts` 的 group 分組對應：

| RoutesCatalog Group | Spec 目錄 |
|---------------------|-----------|
| （無分組） | `admin/` 根目錄 |
| 教務管理 | `admin/academic/` |
| 學務管理 | `admin/student-affairs/` |
| （新增）報名管理 | `admin/enrollment/` |
| 行政財務 → 財務管理 | `admin/finance/` |
| 系統設定 | `admin/system/` |
| 教學課務 | `teacher/` |
| 學習狀況 | `parent/` |
| 行政服務 | `parent/` |
| 生活與繳費 | `parent/` |

## 版本紀錄

| 日期 | 版本 | 說明 |
|------|------|------|
| 2026-02-13 | 1.0 | 初版：建立完整頁面規格摘要結構 |
