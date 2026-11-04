import { describe, expect, it } from 'vitest';

import { chunkByUrlLength, inChunks, IN_CHUNK_SIZE } from './in-chunks';

describe('in-chunks（#2232）', () => {
  it('uuid 清單每 100 個一段、依序送，結果照順序接起來', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    const sizes: number[] = [];
    const out = await inChunks(ids, async (part) => {
      sizes.push(part.length);
      return { data: part, error: null };
    });
    expect(sizes).toEqual([IN_CHUNK_SIZE, IN_CHUNK_SIZE, 50]);
    expect(out).toEqual({ data: ids, error: null });
  });

  it('第一段出錯就停：回到那之前的資料與那個錯，後面不送', async () => {
    let calls = 0;
    const out = await inChunks(
      Array.from({ length: 250 }, (_, i) => String(i)),
      async (part) => {
        calls += 1;
        return calls === 2
          ? { data: null, error: { message: 'boom' } }
          : { data: part, error: null };
      },
    );
    expect(calls).toBe(2);
    expect(out.data).toHaveLength(IN_CHUNK_SIZE);
    expect(out.error).toEqual({ message: 'boom' });
  });

  it('字串照 URL 編碼後的長度分段：中文長名每段都在預算內，一個都不漏', () => {
    const names = Array.from({ length: 300 }, (_, i) => `很長的家長名字${'字'.repeat(20)}${i}`);
    const parts = chunkByUrlLength(names, 3500);
    for (const part of parts) {
      const used = part.reduce((n, v) => n + encodeURIComponent(v).length + 8, 0);
      expect(used).toBeLessThanOrEqual(3500);
    }
    expect(parts.flat()).toEqual(names);
    expect(parts.length).toBeGreaterThan(1);
  });

  it('單一個值超過預算就自己一段（不丟、不卡住）', () => {
    const huge = '長'.repeat(1000);
    expect(chunkByUrlLength(['a', huge, 'b'], 100)).toEqual([['a'], [huge], ['b']]);
  });
});
