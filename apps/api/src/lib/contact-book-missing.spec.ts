import { describe, expect, it } from 'vitest';

import { missingContactBookStudents } from './contact-book-missing';

const candidate = (studentId: string, studentName: string, classId: string, className: string) => ({
  studentId,
  studentName,
  classId,
  className,
});

describe('missingContactBookStudents', () => {
  it('沒寫的學生會出現在缺漏名單', () => {
    const missing = missingContactBookStudents(
      [candidate('s1', '王小明', 'c1', '國小三年級 A 班')],
      new Set(),
    );

    expect(missing).toHaveLength(1);
    expect(missing[0]?.studentId).toBe('s1');
    expect(missing[0]?.classes).toEqual([{ classId: 'c1', className: '國小三年級 A 班' }]);
  });

  it('寫過的學生不會出現', () => {
    expect(
      missingContactBookStudents([candidate('s1', '王小明', 'c1', 'A 班')], new Set(['s1'])),
    ).toEqual([]);
  });

  /**
   * **每生一列，不是每班一列。**
   *
   * `contact_book_entries` 是 `UNIQUE (student_id, entry_date)` —— 一則聯絡簿屬於學生
   * 那一天，不屬於某一班。所以同一個學生同時在兩個開了聯絡簿的班，要寫的還是**一則**；
   * 列成兩列會讓行政以為有兩件事要做，寫完一則之後還會有一列賴著不走。
   *
   * 班級是**脈絡**（要知道去哪裡找這個小孩），所以收在同一列的 classes 欄裡。
   */
  it('同一個學生跨兩個聯絡簿班級只出現一次，班級併在同一列', () => {
    const missing = missingContactBookStudents(
      [candidate('s1', '王小明', 'c1', 'A 班'), candidate('s1', '王小明', 'c2', 'B 班')],
      new Set(),
    );

    expect(missing).toHaveLength(1);
    expect(missing[0]?.classes).toEqual([
      { classId: 'c1', className: 'A 班' },
      { classId: 'c2', className: 'B 班' },
    ]);
  });

  it('跨兩班但寫過了 —— 一則就滿足全部，整個學生消失', () => {
    expect(
      missingContactBookStudents(
        [candidate('s1', '王小明', 'c1', 'A 班'), candidate('s1', '王小明', 'c2', 'B 班')],
        new Set(['s1']),
      ),
    ).toEqual([]);
  });

  it('同一個 (學生, 班級) 出現兩次不會讓班級重複', () => {
    const missing = missingContactBookStudents(
      [candidate('s1', '王小明', 'c1', 'A 班'), candidate('s1', '王小明', 'c1', 'A 班')],
      new Set(),
    );

    expect(missing[0]?.classes).toHaveLength(1);
  });

  // 名單是給人一個個看過去的 —— 順序不穩定的話每次重整都跳動
  it('依學生姓名排序', () => {
    const missing = missingContactBookStudents(
      [candidate('s2', '陳小華', 'c1', 'A 班'), candidate('s1', '王小明', 'c1', 'A 班')],
      new Set(),
    );

    expect(missing.map((row) => row.studentName)).toEqual(['王小明', '陳小華']);
  });

  it('沒有候選人就是空名單', () => {
    expect(missingContactBookStudents([], new Set())).toEqual([]);
  });
});
