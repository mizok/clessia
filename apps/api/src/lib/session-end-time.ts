/**
 * 這堂課的結束時刻有沒有已經過了「現在」——**跟前端 `session-time.util.ts` 的
 * `hasSessionEnded()` 是同一份判定**，這裡是後端版本。
 *
 * 兩邊為什麼要各自存在一份、又必須逐案一致：儀表板「未點名課堂」卡片原本拆成
 * 兩段查——「昨天以前」伺服器算（`attendanceTaken=false` 天生等於逾期），
 * 「今天」前端用 `hasSessionEnded` 濾 `workbench/today` 的明細。**這不是業務上
 * 真的有兩段，是 API 表達不出「已結束」，前端被迫把查得到的那半交給查詢、
 * 剩下那半自己濾**。這支函式把後半段的語意搬進來，讓 `attendanceTaken=false`
 * 配 `endedOnly=true` 一次查出「沒點名而且已經上完」，不必再讓前端逐筆濾。
 *
 * **Workers 跑在 UTC，不是 Asia/Taipei**——跟 `taipei-date.ts` 的坑同一族，
 * 但這裡不能只挪日期字串，因為要比較的是**含時刻的瞬間**。台灣沒有日光節約
 * 時間，固定 UTC+8，所以用顯式 `+08:00` offset 建構結束時刻的 `Date` ——
 * ISO 8601 帶明確 offset 的字串，`Date` 解析出來的是絕對時刻，跟 runtime
 * 自己的時區設定無關，這樣「現在」（`new Date()`，永遠是正確的絕對時刻）
 * 才能拿來直接比較。
 */
export interface SessionEndTimeLike {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm`，可為 null */
  startTime: string | null;
  /** `HH:mm`，可為 null */
  endTime: string | null;
}

/** `date` 往後推 `days` 天，維持 `YYYY-MM-DD` 格式（用 UTC 計算避免任何時區干擾）。 */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 三個邊界，跟前端 `hasSessionEnded()` 逐案一致（見 `session-end-time.spec.ts`
 * 直接照 `session-time.util.spec.ts` 的案例抄過來）：
 *
 * 1. 今天晚上的課早上不算結束
 * 2. 沒有結束時間 → 等這一天過完才算結束
 * 3. `endTime < startTime` 是跨午夜的課，結束在隔天
 */
export function hasSessionEndedByNow(session: SessionEndTimeLike, now: Date = new Date()): boolean {
  let endDate = session.date;
  let endTime = session.endTime;

  if (!endTime) {
    endDate = addDays(session.date, 1);
    endTime = '00:00';
  } else if (session.startTime && endTime < session.startTime) {
    endDate = addDays(session.date, 1);
  }

  const endTimestamp = new Date(`${endDate}T${endTime}:00+08:00`).getTime();
  return endTimestamp <= now.getTime();
}
