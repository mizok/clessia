// 逐幀跳動（#1859）：每一幀量到的各區塊頂端 y（像素量的，不是 DOM 讀的），算相鄰兩幀的最大跳動。
//
// 為什麼不用 layout-shift：它把 ResizeObserver 回呼之前那次排版也記成位移，「用 WAAPI 滑」這種修法
// 會量到一對 +X／-X（間隔 1ms、畫面上根本沒畫出來），單幀最大位移因此量不出改善。

/** 標記色：純色、頁面上不會出現；第 k 個區塊用第 k 個 */
export const MARK_COLORS = [
  [0, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 0],
  [0, 128, 255],
  [128, 0, 255],
];

/**
 * @param {Array<{ t: number, tops: Array<number | null> }>} frames  每一幀各標記色的最上緣（沒出現 = null）
 * @returns {{ maxJump: number, at: number | null, block: number | null, perBlock: Array<{ maxJump: number, at: number | null }> }}
 *   maxJump：任一區塊在相鄰兩幀之間移動的最大像素；兩幀都要有那個區塊才算（區塊剛出現、消失不算跳）
 */
export function maxJumps(frames) {
  const n = Math.max(0, ...frames.map((f) => f.tops.length));
  const perBlock = Array.from({ length: n }, () => ({ maxJump: 0, at: null }));
  for (let i = 1; i < frames.length; i++) {
    for (let k = 0; k < n; k++) {
      const a = frames[i - 1].tops[k];
      const b = frames[i].tops[k];
      if (a == null || b == null) continue;
      const d = Math.abs(b - a);
      if (d > perBlock[k].maxJump) perBlock[k] = { maxJump: d, at: frames[i].t };
    }
  }
  let best = { maxJump: 0, at: null, block: null };
  perBlock.forEach((p, k) => {
    if (p.maxJump > best.maxJump) best = { maxJump: p.maxJump, at: p.at, block: k };
  });
  return { ...best, perBlock };
}

/** 時間軸只留有變化的幀（方便貼進 PR） */
export function changes(frames) {
  return frames.filter((f, i) => i === 0 || f.tops.some((y, k) => y !== frames[i - 1].tops[k]));
}
