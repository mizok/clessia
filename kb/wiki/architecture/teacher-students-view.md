---
title: 老師端學生名單的設計
summary: 老師看自己任課班級的學生。同時處理 teacher/attendance 空殼——點名的家是課表，不是另一個選單項目。
category: architecture
status: active
updated: 2026-08-18
---

# 老師端學生名單的設計

## 先處理一個假的選單項目

`/teacher/attendance` 在選單上叫「點名」，`showInMenu` 是 true，點進去是：

```
Teacher attendance content coming soon...
```

而**真正的點名早就在 `teacher/schedule`**：那頁有「已點名」「點名已截止」的狀態、有共用的
`AttendanceRosterPanelComponent`、還照 org 設定判斷該不該讓老師點、能不能補點。

這跟 `/admin/changes` 是同一類缺陷（選單承諾了頁面不做的事），也跟報名總覽是同一個結論：
**一個功能一個家**。點名的家是課表——老師打開課表，看到今天的課，點進去點名，這是一條動線；
另外開一個「點名」選單項目，等於要老師先想「我要點哪一堂」才能開始。

**決定：刪掉 `teacher/attendance` 頁面與路由，選單項目一併移除。** 不是隱藏
（`showInMenu = false` 會留下一個沒人走的路由和一個沒人維護的元件），是刪掉。

## 範圍：什麼叫「我的學生」

老師 → 學生的鏈路有兩條：

| 來源                   | 意思                   | 採用 |
| ---------------------- | ---------------------- | ---- |
| `schedules.teacher_id` | 固定任課的班           | ✅   |
| `sessions.teacher_id`  | 實際上過的課（含代課） | ❌   |

**用固定任課，不用實際上過的課。** 代課老師臨時代一堂，不該從此在他的學生名單裡多出
30 個他不認識的學生；而他代課當下需要的名單，課表那頁點進去就有。

「我的學生」= `schedules.teacher_id = 我` 的班級 → 那些班的**在籍** enrollment
（`status in (active, pending_payment)`）→ 學生。

退班的學生不出現。要看歷史得去管理端——老師端不是稽核工具。

## API：開 `students` 給 teacher，同時鎖範圍

照 [`角色授權的設計`](role-authorization.md) 講好的做法：**做到哪一頁才開哪一支，
而且開的同時就把範圍限制做完**。先開路、之後才補範圍的話，中間那段時間就是個洞。

- `mount('/api/students', studentsRoute, ['admin', 'teacher'])`
- `GET /api/students` 增加 `taughtByMe` 旗標
- **角色是 teacher（且非 admin）時強制套用**，不管請求有沒有帶 —— 跟
  `attendance/teacher-scope.ts` 同一個模式：只擋 UI 不擋 API 等於沒擋

範圍解析抽成純函式（`students/teacher-scope.ts`），理由跟上次一樣：錯的方式很安靜，
而且無法從畫面上看出來。

## 畫面

依開課班分組，每組顯示班名與人數，組內列學生姓名與年級。加一個班級篩選與姓名搜尋
（`students` API 已經有 `search`）。

**MVP 不做出勤與成績統計。** 規格列了「出席率、遲到次數、平均分」，但那需要跨
`attendance_records` 與 `scores` 的彙總，是另一個切片的份量；而且在老師真的用起來之前，
我不確定他要的是「這個學生的出席率」還是「這個班今天誰沒來」——後者課表已經回答了。
先把名單交出去，統計等他開口。

## 需要的改動

| 層          | 改動                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| DB          | 無                                                                               |
| API         | `students` 開給 teacher；`taughtByMe` 參數 + 強制範圍；純函式 + 測試             |
| Web service | `StudentQueryParams` 加 `taughtByMe`                                             |
| Web UI      | 填掉 `teacher/students` 空殼；**刪掉** `teacher/attendance` 頁面、路由、選單項目 |
| 現況表      | 老師端「學生」從 🚧 變 ✅；「出勤與到班」的老師端欄位從 🚧 變 —（頁面刪了）      |

## 刻意不做

- **出勤／成績統計** —— 見上
- **學生詳情頁** —— 老師端規格沒有；要看個別學生的完整資料是管理端的事
- **代課老師的學生** —— 見上方範圍段落
- **把 `teacher/attendance` 做成「今日課堂快捷」** —— 那只是課表的子集合，多一個入口不多一個功能
