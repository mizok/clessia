import { describe, expect, it } from 'vitest';

import { fakePluck } from './fake-pluck';

describe('fakePluck —— 替身要真的套 student_id 篩選（#1501）', () => {
  const pluck = fakePluck(
    [
      { class_id: 'a', student_id: 'mine' },
      { class_id: 'b', student_id: 'other' },
      { class_id: 'c' }, // 沒寫 student_id → 屬於預設孩子
    ],
    'mine',
  );

  it('自己的孩子：拿到自己的列（含沒寫 student_id 的）', async () => {
    expect((await pluck('class_id', 'class_id', 'mine')).ids).toEqual(['a', 'c']);
  });

  it('別人孩子的 id：只拿到別人的列，不會把自己的給出去', async () => {
    expect((await pluck('class_id', 'class_id', 'other')).ids).toEqual(['b']);
  });

  it('亂值：空', async () => {
    const r = await pluck('class_id', 'class_id', 'nobody');
    expect(r.rows).toEqual([]);
    expect(r.ids).toEqual([]);
  });
});
