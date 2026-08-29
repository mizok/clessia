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

export function missingContactBookStudents(
  candidates: ContactBookCandidate[],
  writtenStudentIds: ReadonlySet<string>,
): MissingContactBookStudent[] {
  const byStudent = new Map<string, MissingContactBookStudent>();

  for (const candidate of candidates) {
    if (writtenStudentIds.has(candidate.studentId)) continue;

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
