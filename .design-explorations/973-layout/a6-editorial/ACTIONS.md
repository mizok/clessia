# 課堂動作對照表（2026-10-01 從程式碼盤點）

設計稿上**每一個操作都要對得上這張表的一列**；不存在的一律在畫面上標「新」，並在設計說明寫它需要什麼後端。

來源：`apps/web/src/app/features/admin/pages/sessions/sessions.page.ts:296-340`（單堂右鍵選單與出現條件）、
`apps/api/src/routes/sessions.ts`（端點與 body）、`.../sessions/dialogs/*`、`.../components/session-batch`、`.../dialogs/mobile-batch-dialog`（手機批次已存在）。

## 單堂（已存在）

| 動作（現有 UI 名稱） | 出現條件 | API | 能改什麼 |
|---|---|---|---|
| 查看異動紀錄 | 永遠 | `GET /sessions/{id}/changes` | — |
| 管理出勤狀況 | 今天以前、且不是停課 | attendance | — |
| **調課** | `scheduled` | `POST /sessions/{id}/reschedule` | **只有日期＋開始＋結束時間**（＋原因）。**不能換老師、不能換教室** |
| **代課** | `scheduled` 且已指派老師 | `POST /sessions/{id}/substitute` | 代課老師＋原因（會留代課紀錄） |
| 指派老師 | `scheduled` 且未指派 | batch-assign-teacher（單筆） | 老師 |
| **指定為補課／改指定補課** | `scheduled` | `PATCH /sessions/{id}/makeup`（＋`GET makeup-candidates`） | 把**這堂已排定的課**指定成「補某一堂停課」。**是指定，不是新增**（#592） |
| **停課** | `scheduled` | `POST /sessions/{id}/cancel` | 原因 |
| 取消停課 | `cancelled` | batch-uncancel（單筆） | — |

## 批次（已存在，全部支援 `dryRun` 預覽 → 衝突清單 → 套用）

| 動作 | API | 參數 | 衝突種類 |
|---|---|---|---|
| 批次指派老師 | `PATCH /sessions/batch-assign-teacher` | sessionIds、teacherId、`includeAssigned`（是否覆蓋已指派的） | 老師撞堂 |
| 批次調整時間 | `PATCH /sessions/batch-update-time` | sessionIds、startTime、endTime（**同一天改時段，不能改日期**） | class_conflict、teacher_conflict、狀態不可改 |
| 批次停課 | `PATCH /sessions/batch-cancel` | sessionIds、reason | 狀態不可停 |
| 批次恢復課堂 | `PATCH /sessions/batch-uncancel` | sessionIds | 狀態不可恢復 |

上限一次 1000 堂。

## 不存在（畫出來就要標「新」）

- **教室**：schema 裡**沒有教室／room**。課表若以教室分欄或顯示教室，教室是新概念（需要 rooms 表＋sessions.room_id）。
- **加開一堂課／加開補課**：沒有 `POST /sessions`，課堂只能照班級 schedules 產生。所以「停課之後補一堂」目前只能把**另一堂已排定的課**指定為補課，或用**調課**把某堂移到別的日子。真實補習班的「颱風停課 → 下週六加開補課」**做不到**，這是缺口。
- **批次代課**：批次指派老師會換老師，但**不會留代課紀錄**（代課只有單堂）。「某老師請假整週，全部找人代」= 新（或用批次指派老師＋說明語意差異）。
- **批次調課到別天**：批次只能同一天改時段。「某班整期從週三改週五」= 新。
- **單堂換老師（非代課）**：只有未指派時能指派；已指派的要換只能走代課或批次指派（includeAssigned）。
