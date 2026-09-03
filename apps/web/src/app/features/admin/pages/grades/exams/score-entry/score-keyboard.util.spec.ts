import { SCORE_ROW_ATTR, focusScoreRow, scoreKeyStep } from './score-keyboard.util';

const key = (k: string) => new KeyboardEvent('keydown', { key: k });

function host(count: number, disabledIndexes: number[] = []): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = Array.from(
    { length: count },
    (_, i) =>
      `<div ${SCORE_ROW_ATTR}="${i}"><input ${disabledIndexes.includes(i) ? 'disabled' : ''} /></div>`,
  ).join('');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('scoreKeyStep', () => {
  it('↑ 是往上一列', () => {
    expect(scoreKeyStep(key('ArrowUp'))).toBe(-1);
  });

  it('↓ 是往下一列', () => {
    expect(scoreKeyStep(key('ArrowDown'))).toBe(1);
  });

  // 試算表的心智模型：打完這格就往下
  it('Enter 跟 ↓ 同向', () => {
    expect(scoreKeyStep(key('Enter'))).toBe(1);
  });

  // 不是換列鍵就要原樣放行 —— 攔下來的話連數字都打不進去
  it('其他按鍵回 0', () => {
    expect(scoreKeyStep(key('5'))).toBe(0);
    expect(scoreKeyStep(key('Tab'))).toBe(0);
    expect(scoreKeyStep(key('Backspace'))).toBe(0);
  });
});

describe('focusScoreRow', () => {
  it('聚焦到指定的那一列', () => {
    const el = host(3);

    expect(focusScoreRow(el, 1, 1, 3)).toBe(true);
    expect(document.activeElement).toBe(el.querySelector(`[${SCORE_ROW_ATTR}="1"] input`));
  });

  // focus() 打在 disabled 上是無效操作，游標會卡在原地，看起來像鍵盤壞了
  it('跳過 disabled 的格子，繼續往同一個方向找', () => {
    const el = host(4, [1, 2]);

    focusScoreRow(el, 1, 1, 4);

    expect(document.activeElement).toBe(el.querySelector(`[${SCORE_ROW_ATTR}="3"] input`));
  });

  it('往上找也會跳過 disabled', () => {
    const el = host(4, [1, 2]);

    focusScoreRow(el, 2, -1, 4);

    expect(document.activeElement).toBe(el.querySelector(`[${SCORE_ROW_ATTR}="0"] input`));
  });

  // 回捲會讓人以為自己按錯了
  it('走到底就留在原地，不回捲到第一列', () => {
    const el = host(3);

    expect(focusScoreRow(el, 3, 1, 3)).toBe(false);
    expect(document.activeElement).not.toBe(el.querySelector(`[${SCORE_ROW_ATTR}="0"] input`));
  });

  it('整份都是 disabled 時回 false，不會無限找', () => {
    const el = host(3, [0, 1, 2]);

    expect(focusScoreRow(el, 0, 1, 3)).toBe(false);
  });
});
