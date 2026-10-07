import { academyScope, examClassLabel } from './exam-class-label.util';

const cls = (...names: string[]) => names.map((name, i) => ({ id: `c${i}`, name }));

describe('examClassLabel（#1314 G1）', () => {
  it('沒有班回 null，呼叫端退回「N 個班」', () => {
    expect(examClassLabel([])).toBeNull();
  });

  it('1～3 個班全列、用「、」連接，title 與 label 相同', () => {
    expect(examClassLabel(cls('國三數學 A'))).toEqual({
      label: '國三數學 A',
      title: '國三數學 A',
    });
    expect(examClassLabel(cls('甲', '乙', '丙'))).toEqual({
      label: '甲、乙、丙',
      title: '甲、乙、丙',
    });
  });

  it('超過 3 個班只列前 3 個並寫總數，完整清單留在 title', () => {
    expect(examClassLabel(cls('甲', '乙', '丙', '丁', '戊'))).toEqual({
      label: '甲、乙、丙 等 5 個班',
      title: '甲、乙、丙、丁、戊',
    });
  });
});

describe('academyScope（#1314 G1）', () => {
  const base = { scopeNote: null, classCount: 2 };

  it('沒有 scopeNote：主字就是班名，小字不重複', () => {
    expect(academyScope({ ...base, classes: cls('甲', '乙') })).toEqual({
      scope: '甲、乙',
      classLabel: null,
      classTitle: '甲、乙',
    });
  });

  it('有 scopeNote：主字維持範圍說明，班名補在小字，空白 scopeNote 當沒有', () => {
    expect(academyScope({ ...base, scopeNote: '第一章', classes: cls('甲', '乙') })).toEqual({
      scope: '第一章',
      classLabel: '甲、乙',
      classTitle: '甲、乙',
    });
    expect(academyScope({ ...base, scopeNote: '  ', classes: cls('甲') }).scope).toBe('甲');
  });

  it('沒有班名資料（舊回應或 0 個班）退回「N 個班」', () => {
    expect(academyScope({ ...base })).toEqual({
      scope: '2 個班',
      classLabel: null,
      classTitle: null,
    });
    expect(academyScope({ ...base, classes: [] }).scope).toBe('2 個班');
  });
});
