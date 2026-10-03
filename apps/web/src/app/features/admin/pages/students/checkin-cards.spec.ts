import { vi } from 'vitest';

import { fillCheckinCards } from './checkin-cards';

/**
 * #1127 B：學生到班卡。卡上**只有**補習班名、學生名、QR（內容＝學生 id）——
 * 卡會被帶來帶去，不放電話、生日等個資。名字是使用者輸入，只能進 textContent。
 */
describe('fillCheckinCards', () => {
  const toDataURL = vi.fn(async (text: string) => `data:image/png;base64,${text}`);

  async function render(cards: Array<{ studentId: string; name: string }>) {
    const doc = document.implementation.createHTMLDocument('');
    await fillCheckinCards(doc, cards, '示範補習班', toDataURL);
    return doc;
  }

  it('一位學生一張卡：補習班名、學生名、QR 裝的是學生 id', async () => {
    const doc = await render([
      { studentId: 'stu-1', name: '王小明' },
      { studentId: 'stu-2', name: '林小美' },
    ]);
    const cards = [...doc.querySelectorAll('[data-testid="checkin-card"]')];

    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('示範補習班');
    expect(cards[0]!.textContent).toContain('王小明');
    expect(cards[0]!.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,stu-1');
    expect(toDataURL).toHaveBeenCalledWith(
      'stu-1',
      expect.objectContaining({ errorCorrectionLevel: 'M' }),
    );
  });

  it('名字裡的標籤當文字印，不會變成 HTML', async () => {
    const doc = await render([{ studentId: 'stu-1', name: '<img src=x onerror=alert(1)>' }]);
    const card = doc.querySelector('[data-testid="checkin-card"]')!;

    expect(card.querySelectorAll('img')).toHaveLength(1); // 只有 QR 那張
    expect(card.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('列印版面自帶樣式（新視窗沒有 design token），一張 A4 排 10 張', async () => {
    const doc = await render([{ studentId: 'stu-1', name: '王小明' }]);
    const css = doc.head.querySelector('style')!.textContent!;

    expect(css).toContain('size: A4');
    expect(css).toContain('85.6mm');
    expect(doc.title).toContain('到班卡');
  });
});
