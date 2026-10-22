import { describe, expect, it } from 'vitest';
import { placePopover } from './fit-popover.directive';

/** #1873：篩選浮層依可用空間放。視窗 700 高，按鈕在 y=200–244 */
const base = { anchorTop: 200, anchorBottom: 244, viewportHeight: 700, chrome: 30 };

describe('placePopover（#1873）', () => {
  it('下方放得下：放下方、不翻', () => {
    const p = placePopover({ ...base, naturalHeight: 300 });
    expect(p).toEqual({ up: false, top: 244, contentMax: 700 - 244 - 18 - 30 });
  });

  it('下方放不下、下方仍比上方大：留在下方，最大高度＝下方空間（內部捲動）', () => {
    const p = placePopover({ ...base, naturalHeight: 900 });
    expect(p.up).toBe(false);
    expect(p.contentMax).toBe(700 - 244 - 18 - 30);
  });

  it('按鈕在下半部、下方放不下：翻到上方，貼著按鈕往上長', () => {
    const p = placePopover({ ...base, anchorTop: 560, anchorBottom: 604, naturalHeight: 300 });
    expect(p.up).toBe(true);
    expect(p.top).toBe(560 - 300);
  });

  it('翻上去也放不下：頂到上方可用空間為止、不超出視窗頂（切掉上面的那個 bug）', () => {
    const p = placePopover({ ...base, anchorTop: 560, anchorBottom: 604, naturalHeight: 900 });
    expect(p.up).toBe(true);
    expect(p.top).toBe(560 - (560 - 18));
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.contentMax).toBe(560 - 18 - 30);
  });
});
