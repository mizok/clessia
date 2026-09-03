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

`date` 省略時是台北的今天。`campusId` 省略時吃呼叫者的 `campusScope`
（`#175` 已落地，`campusRequestGuard` 會擋越權指名，這支不用自己驗）。

```ts
{
  mode: 'per_session' | 'daily_checkin',   // 直接回，前端不用另外打 /api/org/settings
  sessions: EventSessionSummary[],          // 兩種模式都回
  rosters?: {                               // 只在 per_session 回
    eventId: string;
    enrolledCount: number;
    presentCount: number;
    onLeaveCount: number;
    takenAt: string | null;
  }[],
  expected?: {                              // 只在 daily_checkin 回
    studentId: string;
    studentName: string;
    grade: string | null;
    campusId: string | null;
    campusName: string | null;
    firstSession: { startTime: string | null; className: string } | null;
  }[],
  arrived?: { studentId: string; checkedInAt: string; checkinId: string }[],
  onLeave?: { studentId: string; studentName: string; startDate: string; endDate: string;
              submittedByRole: string }[],
}
```

**由 API 決定形狀**（`mode` 決定哪些欄位有值），不是回全部讓前端挑。理由同上：
形狀的判斷只該有一份。

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
先給 `sessions` + `rosters`**，`daily_checkin` 那三個欄位可以晚一批。
