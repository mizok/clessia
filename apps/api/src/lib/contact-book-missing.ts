/**
 * 「這一天該寫但還沒寫聯絡簿的學生」的差集邏輯。
 *
 * **每生一列，不是每班一列。** `contact_book_entries` 是
 * `UNIQUE (student_id, entry_date)` —— 一則聯絡簿屬於學生那一天，不屬於某一班
 * （contact-book-rules 規則 2：國小模式是每生每日一則）。所以同一個學生同時在兩個
 * 開了聯絡簿的班，要寫的還是**一則**；列成兩列會讓行政以為有兩件事要做，而且寫完
 * 一則之後還會有一列賴著不走。
 *
 * 班級是**脈絡**不是分組鍵 —— 要知道去哪裡找這個小孩，所以收在同一列的 `classes` 裡。
 *
 * **「今天該寫」綁的是「這個班今天有課」。** 聯絡簿跟著上課日走（小孩有來才有當天
 * 那一則），所以當日沒課、或那堂停課的班不列入。不這樣做的話週末與寒暑假的缺漏名單
 * 會是滿的，而這個端點的消費場景就是行政的當日待辦。
 */

export interface ContactBookCandidate {
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
}

export interface MissingContactBookStudent {
  studentId: string;
  studentName: string;
  classes: Array<{ classId: string; className: string }>;
}

export interface SessionOnDate {
  classId: string;
  /** `sessions.status`：scheduled / completed / cancelled */
  status: string;
}

export function missingContactBookStudents(
  candidates: ContactBookCandidate[],
  writtenStudentIds: ReadonlySet<string>,
  sessionsOnDate: ReadonlyArray<SessionOnDate>,
): MissingContactBookStudent[] {
  // 停課那天沒有人來上課，自然也沒有那一則要寫 —— 其餘狀態（scheduled / completed）都算
  const classesWithClass = new Set(
    sessionsOnDate.filter((s) => s.status !== 'cancelled').map((s) => s.classId),
  );

  const byStudent = new Map<string, MissingContactBookStudent>();

  for (const candidate of candidates) {
    if (writtenStudentIds.has(candidate.studentId)) continue;
    if (!classesWithClass.has(candidate.classId)) continue;

    const existing = byStudent.get(candidate.studentId);
    if (!existing) {
      byStudent.set(candidate.studentId, {
        studentId: candidate.studentId,
        studentName: candidate.studentName,
        classes: [{ classId: candidate.classId, className: candidate.className }],
      });
      continue;
    }

    // 同一個 (學生, 班級) 可能從不同來源進來兩次，班級欄不要重複
    if (!existing.classes.some((cls) => cls.classId === candidate.classId)) {
      existing.classes.push({ classId: candidate.classId, className: candidate.className });
    }
  }

  // 名單是給人一個個看過去的，順序不穩定的話每次重整都跳動
  return Array.from(byStudent.values()).sort((a, b) =>
    a.studentName.localeCompare(b.studentName, 'zh-Hant'),
  );
}

export interface MissingClassDetail {
  classId: string;
  className: string;
  /** 那天這班沒停課那幾堂的上課老師（`sessions.teacher_id`，代課就是代課老師），去重、依姓名排序 */
  teacherNames: string[];
  /** 這天這班該寫的人數（範圍內的候選，已寫的也算） */
  studentCount: number;
}

/**
 * 缺漏名單每班補上**上課老師**與**該寫人數**（#2080-2，A6「游佩珊 老師 · 還差 4 則／17」）。
 * 系統沒有班級層級的帶班老師（`schedules.teacher_id` 已棄用），所以用當天那堂課的老師 —— 同 `/remind`
 * （計畫席 11-02：標題寫「上課老師」）。`staffNameById` 只放本 org 的 staff，對不到的老師不列
 */
export function withClassDetails(
  missing: MissingContactBookStudent[],
  candidates: ReadonlyArray<ContactBookCandidate>,
  sessionsOnDate: ReadonlyArray<SessionOnDate & { teacherId: string | null }>,
  staffNameById: ReadonlyMap<string, string>,
): Array<Omit<MissingContactBookStudent, 'classes'> & { classes: MissingClassDetail[] }> {
  const studentsOf = new Map<string, Set<string>>();
  for (const c of candidates) {
    studentsOf.set(c.classId, (studentsOf.get(c.classId) ?? new Set()).add(c.studentId));
  }
  const teachersOf = new Map<string, Set<string>>();
  for (const s of sessionsOnDate) {
    const name = s.teacherId ? staffNameById.get(s.teacherId) : undefined;
    if (s.status === 'cancelled' || !name) continue;
    teachersOf.set(s.classId, (teachersOf.get(s.classId) ?? new Set()).add(name));
  }
  return missing.map((student) => ({
    ...student,
    classes: student.classes.map((cls) => ({
      ...cls,
      teacherNames: [...(teachersOf.get(cls.classId) ?? [])].sort((a, b) =>
        a.localeCompare(b, 'zh-Hant'),
      ),
      studentCount: studentsOf.get(cls.classId)?.size ?? 0,
    })),
  }));
}

/**
 * 區間內的每一天（含頭尾）。`from` 晚於 `to` 就是空陣列。
 *
 * 手寫是因為 `apps/api` 沒有裝 date-fns，而這件事六行就夠 —— 為了它多一個相依
 * 不划算。用 UTC 走日曆是刻意的：日期在這裡是字串上的 `YYYY-MM-DD`，
 * 拿本地時區推進會在夏令時或跨時區部署時少一天或多一天。
 */
export function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];

  for (const cursor = new Date(`${from}T00:00:00Z`); ; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (date > to) break;
    dates.push(date);
  }

  return dates;
}

export interface MissingContactBookDay {
  date: string;
  missingCount: number;
}

/**
 * 一整週（或任何區間）**每天各有幾個學生還沒寫**。
 *
 * 老師端的週檢視要在有待辦的那幾天點一個 ●，一天一支 `/missing` 就是七趟往返，
 * 而每趟都要重撈同一份在籍名單。所以這裡把候選名單撈一次，逐日只換「已寫」與
 * 「當天有課」兩個集合。
 *
 * **回傳區間內的每一天，包含 0 的那些。** 前端畫的是一列格子，缺哪天就要自己補洞，
 * 補洞的邏輯散在前端遲早會跟後端對不齊。
 */
export function missingContactBookByDate(
  candidates: ContactBookCandidate[],
  writtenByDate: ReadonlyMap<string, ReadonlySet<string>>,
  sessionsByDate: ReadonlyMap<string, ReadonlyArray<SessionOnDate>>,
  dates: ReadonlyArray<string>,
): MissingContactBookDay[] {
  return dates.map((date) => ({
    date,
    missingCount: missingContactBookStudents(
      candidates,
      writtenByDate.get(date) ?? new Set<string>(),
      sessionsByDate.get(date) ?? [],
    ).length,
  }));
}
