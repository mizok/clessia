import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * **`code: 'DB_ERROR'` 一律回 500**（#2285）。DB 讀寫失敗不是客戶端的錯：回 400 會讓前端把它當成
 * 「你填錯了」，把資料庫的錯誤訊息原樣顯示給使用者，而且不會被當成伺服器錯誤看待。
 *
 * 靜態掃 `routes/` 的原始碼：每個 `code: 'DB_ERROR'` 之後、同一個回應物件結束的那個狀態碼必須是 500。
 * ponytail: 用 regex 認回應的寫法（`c.json({...}, N)` 與 `{ status: N, ... code: 'DB_ERROR' }`），
 * 認不得的寫法會直接紅，讓人補一種認法，而不是靜默放過。
 */

const ROOT = join(__dirname);

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return /\.ts$/.test(e.name) && !/\.(spec|contract)\.ts$/.test(e.name) ? [p] : [];
  });
}

/** 每個 DB_ERROR 的位置與它的狀態碼（認不得 → null） */
function dbErrorStatuses(): Array<{ at: string; status: number | null }> {
  const out: Array<{ at: string; status: number | null }> = [];
  for (const file of routeFiles(ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/code: 'DB_ERROR'/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      const at = `${relative(ROOT, file)}:${line}`;
      const before = src.slice(Math.max(0, m.index - 200), m.index);
      const after = src.slice(m.index, m.index + 200);
      // `{ status: N, error, code: 'DB_ERROR' }`／`{ http: N, body: { ..., code: 'DB_ERROR' } }`
      const inline = /(?:status|http):\s*(\d{3})[^;]*$/.exec(before);
      // `c.json({ ..., code: 'DB_ERROR' }, N)`：同一個物件收尾後的第一個數字
      const call = /^[^;]*?\}\s*,\s*(\d{3})\s*,?\s*\)/.exec(after);
      const status = call ? Number(call[1]) : inline ? Number(inline[1]) : null;
      out.push({ at, status });
    }
  }
  return out;
}

describe('DB_ERROR 的回應碼（#2285）', () => {
  it('routes/ 裡每個 DB_ERROR 都回 500', () => {
    const all = dbErrorStatuses();
    expect(all.length).toBeGreaterThan(100); // 掃描本身有掃到東西
    expect(all.filter((e) => e.status !== 500)).toEqual([]);
  });
});
