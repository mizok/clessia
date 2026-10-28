import { vi } from 'vitest';

import { fillCheckinCards } from './checkin-cards';

/**
 * #1127 B：學生到班卡。卡上**只有**補習班名、學生名、QR、代碼（#1100 #42：QR 裝卡的代碼，不再是學生 id）——
 * 卡會被帶來帶去，不放電話、生日等個資。名字是使用者輸入，只能進 textContent。
 */
describe('fillCheckinCards', () => {
  const toDataURL = vi.fn(async (text: string) => `data:image/png;base64,${text}`);

  async function render(cards: Array<{ code: string; name: string }>) {
    const doc = document.implementation.createHTMLDocument('');
    await fillCheckinCards(doc, cards, '示範補習班', toDataURL);
    return doc;
  }

  it('一位學生一張卡：補習班名、學生名、QR 裝卡的代碼、卡面印分組代碼（可手打）', async () => {
    const doc = await render([
      { code: 'CK1-0123456789ABCDEF', name: '王小明' },
      { code: 'CK1-GHJKMNPQRSTVWXYZ', name: '林小美' },
    ]);
    const cards = [...doc.querySelectorAll('[data-testid="checkin-card"]')];

    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('示範補習班');
    expect(cards[0]!.textContent).toContain('王小明');
    expect(cards[0]!.textContent).toContain('CK1-0123-4567-89AB-CDEF');
    expect(cards[0]!.querySelector('img')!.getAttribute('src')).toBe(
      'data:image/png;base64,CK1-0123456789ABCDEF',
    );
    expect(toDataURL).toHaveBeenCalledWith(
      'CK1-0123456789ABCDEF',
      expect.objectContaining({ errorCorrectionLevel: 'M' }),
    );
  });

  it('名字裡的標籤當文字印，不會變成 HTML', async () => {
    const doc = await render([
      { code: 'CK1-0123456789ABCDEF', name: '<img src=x onerror=alert(1)>' },
    ]);
    const card = doc.querySelector('[data-testid="checkin-card"]')!;

    expect(card.querySelectorAll('img')).toHaveLength(1); // 只有 QR 那張
    expect(card.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('列印版面自帶樣式（新視窗沒有 design token），一張 A4 排 10 張', async () => {
    const doc = await render([{ code: 'CK1-0123456789ABCDEF', name: '王小明' }]);
    const css = doc.head.querySelector('style')!.textContent!;

    expect(css).toContain('size: A4');
    expect(css).toContain('85.6mm');
    expect(doc.title).toContain('到班卡');
  });
});
