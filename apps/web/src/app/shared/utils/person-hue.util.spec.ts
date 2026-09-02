import { personHue } from './person-hue.util';

/**
 * 這支 spec 守的是**跨頁一致性**，不是「顏色好不好看」。
 * 六份手抄的副本合而為一之後，唯一會讓它們再度分岔的是有人改這個函式 ——
 * 而使用者看到的症狀（同一個學生在兩頁不同色）不會有任何其他訊號。
 */
describe('personHue', () => {
  it('同一個 id 永遠得到同一個色相', () => {
    const id = '3f2a9c10-4b7e-4d21-9a55-0e6b8c1d2f34';
    expect(personHue(id)).toBe(personHue(id));
  });

  it('不同 id 會分開（至少在這組樣本上）', () => {
    const ids = ['stu-1', 'stu-2', 'stu-3', 'parent-1', 'staff-9'];
    const hues = ids.map(personHue);
    expect(new Set(hues).size).toBeGreaterThan(1);
  });

  it('永遠落在 [45, 320) —— 避開紅褐一帶，不跟 danger 撞色', () => {
    // 用一批夠雜的 id 逼過各種 hash 尾數
    for (let i = 0; i < 500; i++) {
      const hue = personHue(`id-${i}-${(i * 7919).toString(36)}`);
      expect(hue).toBeGreaterThanOrEqual(45);
      expect(hue).toBeLessThan(320);
    }
  });

  it('空字串不炸，回傳範圍內的值', () => {
    const hue = personHue('');
    expect(hue).toBeGreaterThanOrEqual(45);
    expect(hue).toBeLessThan(320);
  });

  // 六份副本當時的實際輸出，釘住它 —— 抽取不該改變任何一個既有頭像的顏色。
  // 這些期望值是從抽取前的實作跑出來的，不是我挑的。
  it('抽取沒有改變既有的顏色（釘住六份副本當時的輸出）', () => {
    expect(personHue('stu-1')).toBe(personHue('stu-1'));
    const golden: Record<string, number> = {
      'stu-1': legacy('stu-1'),
      'parent-abc': legacy('parent-abc'),
      '3f2a9c10-4b7e-4d21-9a55-0e6b8c1d2f34': legacy('3f2a9c10-4b7e-4d21-9a55-0e6b8c1d2f34'),
    };
    for (const [id, expected] of Object.entries(golden)) {
      expect(personHue(id)).toBe(expected);
    }
  });
});

/** 抽取前那六份副本的逐字複製，只在測試裡存在 —— 用來證明行為沒變 */
function legacy(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xfffffff;
  }
  const raw = hash % 320;
  return raw < 45 ? raw + 160 : raw;
}
