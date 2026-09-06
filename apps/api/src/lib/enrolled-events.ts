import { isCancelledSession, toSessionRows } from './cancelled-session';

/**
 * 這個學生當天**實際有報名**的課堂事件。
 *
 * 到班掃碼原本替「當天這個分校的**所有**課堂」寫 `present` —— 包含這個學生根本沒報名
 * 的班。症狀是出勤紀錄裡冒出他從來沒上過的課，而那些紀錄會流進扣課與月結。
 *
 * **判準跟 roster 一致：掃碼寫得出來的紀錄，必須是那堂課點名時看得到的人。**
 * 所以在籍條件照抄 roster —— `status = 'active'` 且 `effective_from/to` 蓋到那一天。
 * 兩邊用不同條件的話，會出現「有出勤紀錄但名單上沒有這個人」的鬼影。
 *
 * **停課的課堂不算**（使用者 2026-09-06 裁定 1(a)，issue #485）：停課只改
 * `sessions.status`，**那筆 event 留著、`sessions.event_id` 還指著它**，所以掃碼
 * 撈當天 event 時它照樣會出現。寫成 `present` 之後扣堂數那側會把它算進去 ——
 * **一堂停掉的課會扣掉學生一堂已付費的堂數**（`routes/session-packs.ts` 另有一道）。
 *
 * ⚠️ 停課那條規則已經收斂到 `lib/cancelled-session.ts`（#568 是第三個寫入點，
 * 觸發了這裡原本寫的「出現第三份的時候再收斂」）。**在籍條件**仍然各寫一份。
 */
export interface EnrolledEventSession {
  class_id?: string | null;
  /**
   * `sessions.status`。**沒帶就視為要寫** —— 見下方過濾處的理由。
   * 呼叫端要 `select('id, sessions(class_id, status)')` 才拿得到。
   */
  status?: string | null;
}

export interface EnrolledEventInput {
  id: string;
  /** PostgREST 的巢狀關聯可能回物件也可能回陣列 */
  sessions?: EnrolledEventSession | EnrolledEventSession[] | null;
}

export interface EnrollmentRangeRow {
  class_id: string;
  effective_from: string;
  effective_to: string | null;
}

export function enrolledEventIds(
  events: ReadonlyArray<EnrolledEventInput>,
  enrollments: ReadonlyArray<EnrollmentRangeRow>,
  date: string,
): string[] {
  const enrolledClassIds = new Set(
    enrollments
      .filter(
        (enrollment) =>
          enrollment.effective_from <= date &&
          (!enrollment.effective_to || enrollment.effective_to >= date),
      )
      .map((enrollment) => enrollment.class_id),
  );

  return events
    .filter((event) => {
      const sessionRows = toSessionRows(event.sessions);

      // 沒有 session 的 event（活動、公告之類）不是課堂 —— 掃碼不該替它寫出勤
      return sessionRows.some(
        (session) =>
          session.class_id &&
          enrolledClassIds.has(session.class_id) &&
          !isCancelledSession(session),
      );
    })
    .map((event) => event.id);
}
