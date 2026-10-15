import { chapterExamRows } from './exam-chapters.util';
import type { AcademyExamRow, ExamRow } from './exams.component';

function row(id: string, scoreCount: number, expectedCount: number): ExamRow {
  return { kind: 'academy', id, scoreCount, expectedCount } as unknown as AcademyExamRow;
}
const ids = (rows: readonly ExamRow[]) => rows.map((r) => r.id);

describe('chapterExamRows（待處理分頁分章）', () => {
  it('0／1／總數−1／總數：0 進「還沒登」，其餘進「登到一半」（含滿的，不丟列）', () => {
    const chapters = chapterExamRows([
      row('zero', 0, 20),
      row('one', 1, 20),
      row('almost', 19, 20),
      row('full', 20, 20),
    ]);
    expect(chapters.map((c) => c.key)).toEqual(['none', 'partial']);
    expect(ids(chapters[0].rows)).toEqual(['zero']);
    expect(ids(chapters[1].rows)).toEqual(['one', 'almost', 'full']);
  });

  it('總數 0（沒有人要考）：0／0 算還沒登；有登 1 筆但總數 0 算登到一半', () => {
    const chapters = chapterExamRows([row('none-0-0', 0, 0), row('over', 1, 0)]);
    expect(ids(chapters.find((c) => c.key === 'none')!.rows)).toEqual(['none-0-0']);
    expect(ids(chapters.find((c) => c.key === 'partial')!.rows)).toEqual(['over']);
  });

  it('空章不回傳；全空回空陣列；章內保持原順序', () => {
    expect(chapterExamRows([])).toEqual([]);
    expect(chapterExamRows([row('a', 0, 5)]).map((c) => c.key)).toEqual(['none']);
    expect(chapterExamRows([row('b', 2, 5)]).map((c) => c.key)).toEqual(['partial']);
    expect(ids(chapterExamRows([row('x', 0, 5), row('y', 0, 5), row('z', 0, 5)])[0].rows)).toEqual([
      'x',
      'y',
      'z',
    ]);
  });
});
