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
 * ⚠️ `routes/leaves.ts` 的 `buildLeaveAttendanceUpserts` 實作同一條規則的另一份。
 * 目前**刻意不合併**：那份綁著請假自己的輸入型別，而且已經有測試在守。
 * 出現第三份的時候再收斂。
 */
export interface EnrolledEventInput {
  id: string;
  /** PostgREST 的巢狀關聯可能回物件也可能回陣列 */
  sessions?: { class_id?: string | null } | Array<{ class_id?: string | null }> | null;
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
      const sessionRows = Array.isArray(event.sessions)
        ? event.sessions
        : event.sessions
          ? [event.sessions]
          : [];

      // 沒有 session 的 event（活動、公告之類）不是課堂 —— 掃碼不該替它寫出勤
      return sessionRows.some(
        (session) => session.class_id && enrolledClassIds.has(session.class_id),
      );
    })
    .map((event) => event.id);
}
