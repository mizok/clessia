# 需求單：`GET /api/workbench/today` 聚合端點

> 2026-09-03，**design-web 席 → billing-api 席**。
> 來源設計：`kb/wiki/architecture/today-workbench.md`（計畫席初審已過，等使用者批准）。
> 基準：`origin/main` @ `c0e843f`。
>
> **這一支要先做。** 作業台要把點名 dialog 與勾到班搬進儀表板，而使用者裁定
> 「資料取用重整先行 —— 把互動搬進最慢的頁之前」。沒有它，作業台會踩
> `lessons/workers-fanout-costs-before-the-db` 那個坑。

---

## 為什麼不是前端自己串既有端點

作業台是**一個頁面兩種形狀**（`attendanceMode` 決定），需要的資料是：

- 兩種模式都要：今天的課（帶上那句話與時間軸吃它）
- `per_session`：每堂的在籍人數 / 已點名狀態
- `daily_checkin`：今天有課的在籍學生、今天的打卡、今天的請假

前端串的話是 **`課 × 班 × 在籍學生` 的 N+1**，而且**要串兩次**（儀表板一次、
看板一次）。實測基準在 `kb/wiki/lessons/workers-fanout-costs-before-the-db.md`：
**8 支並行時每支慢 2.4 倍** —— Workers 上並行不是免費的。

第二個理由跟效能無關：**兩套取數會各長一份分校過濾與時窗判斷，然後其中一份會忘記
更新**。分校範圍剛剛才在 `#175` 收斂到 middleware，不該立刻在前端再開一個分岔。

---

## 介面

```
GET /api/workbench/today?date=YYYY-MM-DD&campusId=<uuid>
```

### 五個介面決定（billing-api 席 2026-09-03 問，這裡是答案）

1. **`date` 是參數，不是 `CURRENT_DATE`。** 作業台要看得了昨天（補登就是昨天的事）。
   省略時的預設值由伺服器算，用**台北時區** —— `attendance.ts` 已經有
   `getCurrentTaipeiDateString()`，照抄它，不要用 UTC。
   （`day-timeline` 踩過這個坑：`toISOString()` 讓 UTC+8 的凌晨差一天。）

2. **`mode` 由伺服器從 `organizations.attendance_mode` 讀，不收呼叫端傳的。**
   你的理由跟我的一樣、而且講得更好：讓呼叫端傳等於同一個機構可能拿到兩種形狀，
   **而那個不一致沒有人會發現**。

3. **`campusId` 非必填。** 不帶時吃呼叫者的 `campusScope`（`#175`）——
   管多校的管理員不帶就是「我管的全部」。帶了由 `campusRequestGuard` 驗，這支不用自己擋。
   **但 `expected` 的每一列要帶 `campusId` / `campusName`** —— 前端要靠它做分校分組
   （使用者裁定：分組而不是先選分校再看）。

4. **不適用的欄位回空陣列，不是缺欄位。** 採用你的版本，我原本寫成 optional 是錯的：
   缺欄位會讓前端到處寫 `?.` 防禦，之後補上也不會有人發現。
   **`rosters` / `expected` / `arrived` / `onLeave` 一律存在**，`mode` 決定哪些有內容。

5. **請求數的基準線是 8 支**（見下）。

### 基準線：管理端儀表板現在打 8 支

數自 `dashboard.component.ts:314-357`（`origin/main`）：

| #   | 呼叫                                          | 用途                        |
| --- | --------------------------------------------- | --------------------------- |
| 1   | `attendanceService.sessions({ date: today })` | 今日課表                    |
| 2   | `orgSettingsService.getSettings()`            | `attendanceMode`            |
| 3   | `attendanceService.sessions({ … })`           | 逾期未點名                  |
| 4   | `academyExamsService.getTodoCount()`          | 成績待登錄（forkJoin 其一） |
| 5   | `schoolExamsService.getTodoCount()`           | 同上                        |
| 6   | `leaveService.list({ coverDate: today })`     | 今日請假                    |
| 7   | `studentsService.list({ pageSize: 1 })`       | 在學人數                    |
| 8   | `enrollmentsService.list({ … })`              | 報名異動                    |

**這支端點至少要吃掉 1、2、3、6**（作業台的主體 + `mode`），剩下 4、5、7、8 是右欄的
脈絡數字，可以維持獨立、也可以一起收 —— 你決定，但**總數必須少於 8**。

> **8 這個數字剛好就是 `lessons/workers-fanout-costs-before-the-db` 量到「每支慢
> 2.4 倍」的那個並行數。** 不是巧合 —— 那份 lesson 量的就是這一頁。

> **billing-api 席 2026-09-03 的延遲拆段**：查詢執行只佔 **1 毫秒**，延遲幾乎全是
> 「每次請求的固定成本 × 請求次數」。**所以聚合的方向本身就是對的，比讓每一支變快
> 有效得多** —— 這條量測比我原本引用的 lesson 更直接，請寫進 PR。

```ts
{
  mode: 'per_session' | 'daily_checkin',   // 直接回，前端不用另外打 /api/org/settings
  sessions: EventSessionSummary[],          // 兩種模式都回
  rosters: {                                // per_session 有內容，daily_checkin 是 []
    eventId: string;
    enrolledCount: number;
    presentCount: number;
    onLeaveCount: number;
    takenAt: string | null;
  }[],
  expected: {                               // daily_checkin 有內容，per_session 是 []
    studentId: string;
    studentName: string;
    grade: string | null;
    campusId: string | null;
    campusName: string | null;
    firstSession: { startTime: string | null; className: string } | null;
  }[],
  arrived: { studentId: string; checkedInAt: string; checkinId: string }[],
  onLeave: { studentId: string; studentName: string; startDate: string; endDate: string;
             submittedByRole: string }[],
}
```

**由 API 決定形狀**（`mode` 決定哪些陣列有內容），不是回全部讓前端挑。理由同上：
形狀的判斷只該有一份。**欄位一律存在、不適用時是空陣列** —— 見上面的決定 4。

### `expected` 的定義

「今天在這個分校有課的班級」∪「那些班的在籍學生」。在籍條件**與點名名單同源**
（`status = 'active'` + 生效區間涵蓋當天）—— 這一條 `#178` 已經在
`daily-checkins.ts` 建立了先例，照抄它，不要另立一份。

**這個定義只用在顯示。** 打卡寫入的範圍由 `#178` 決定，這支端點不碰。

---

## 需求二：取消打卡

```
DELETE /api/daily-checkins/:id     （或帶旗標的 POST，你決定）
```

- **走既有的 `assertAttendanceWindow`**（`attendance.ts:1257+`）——
  另寫一套的話，同一間補習班對「昨天的紀錄還能不能改」會有兩個答案
- 要處理它衍生的 `attendance_records`（`#178` 之後那些是「有報名的課」那一批）。
  **刪掉，不要改成 `absent`** —— `attendance-rules.md` 第 6 節：
  沒有紀錄 ≠ 缺席，而且假的缺席會流進月結

---

## 這支端點**不需要**做的事

- **不需要動 `POST /api/daily-checkins`。** `#178` 已經是最終形狀
- **不需要改 `session-packs` 的扣課、`checkEnrollmentAttendance`、請假折抵。**
  我原本的設計是建立在「日到班完全不寫課堂出勤」之上的，那個版本已作廢
  （見設計文件的附錄）。`#178` 的「過濾後寫入」讓這三處照常運作，而且比以前正確
- **不需要自己驗分校。** `#175` 的 `campusRequestGuard` 已經掛全域

---

## 驗收

1. `per_session` 機構：`mode` 正確、`rosters` 有值、`expected` 不存在
2. `daily_checkin` 機構：反過來
3. **整頁的請求數比現在少** —— 這支端點存在的理由就是這個。現在儀表板逐支訂閱
   六支（`dashboard.component.ts:299` 起），作業台不該變成十支
4. 只屬於 A 校的管理員不帶 `campusId` → 只回 A 校的資料
5. 有請假的學生同時出現在 `expected` 與 `onLeave`，**不要在 `expected` 裡先濾掉**
   —— 前端要靠這個把「已請假」跟「還沒到」分成兩段（混在一起行政會打一通
   不必要的電話）

---

## 我這邊的狀態

作業台的前端**等這支端點**。設計文件已過初審、等使用者批准；批准後我會先做
`per_session` 那一半（它不依賴 `expected` / `arrived`），所以**如果要分批出，
先給 `sessions` + `rosters`**，`expected` / `arrived` / `onLeave` 先回空陣列
（不是先不給那三個 key —— 見決定 4）。
