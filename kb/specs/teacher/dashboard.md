# 老師儀表板

**路徑**: `/teacher/dashboard`
**角色**: Teacher

## 核心目的

老師首頁，快速掌握今日課程與待處理事項。

## MVP 功能

- 今日課堂列表
- 待處理提醒（未填聯絡簿、未登錄成績）
- 近期課務異動通知
- 快速入口（課表、點名）

## 資料依賴

| 操作 | 資料表 |
|------|--------|
| 讀取 | `sessions`, `teacher_logs`, `grades`, `assessments`, `schedule_changes` |

## PRD 參考

- 7.3 老師頁面
