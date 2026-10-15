// 純函式：part key 的文案模板、比對容差。瀏覽器端（extract.mjs）也會用到 normText，
// 所以這裡不能 import 任何東西、不能用到 node API。

/**
 * 文案模板：讓 key 不靠假資料。數字（含千分位、小數、時間 16:42、日期 9/29、2026/10/14、
 * 區間 16:00–17:30）一律變 `#`；`names` 裡的專有名詞（稿的假人名）變 `{名}`；空白收成一格。
 */
export function normText(s, names = []) {
  let t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  for (const n of names) if (n && n.length >= 2) t = t.split(n).join('{名}');
  t = t.replace(/\d[\d,.:/]*(?:\s*[–~-]\s*\d[\d,.:/]*)?/g, '#');
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

/**
 * 容差（#1314 工具第二層）。位置 ±4px；尺寸 ±4px 或 ±3%（取大）；字級 ±0.5px。
 * 其餘樣式逐字比對（顏色已由瀏覽器正規化成 rgb()）。
 */
export const TOL = { pos: 4, size: 4, sizeRatio: 0.03, font: 0.5 };

export function sizeOk(a, b, tol = TOL) {
  return Math.abs(a - b) <= Math.max(tol.size, Math.max(a, b) * tol.sizeRatio);
}

export function posOk(a, b, tol = TOL) {
  return Math.abs(a - b) <= tol.pos;
}

export function styleEq(prop, a, b, tol = TOL) {
  if (a === b) return true;
  if (prop === 'fontSize' || prop === 'lineHeight') {
    const x = parseFloat(a),
      y = parseFloat(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol.font;
  }
  return false;
}
