import { TestBed } from '@angular/core/testing';

import { PagerComponent, pageSlots } from './pager.component';

async function setup(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(PagerComponent);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  const emitted: number[] = [];
  fixture.componentInstance.pageChange.subscribe((p) => emitted.push(p));
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const buttons = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
  const byLabel = (l: string) => buttons().find((b) => b.getAttribute('aria-label') === l)!;
  return { fixture, el, emitted, buttons, byLabel };
}

describe('pageSlots（數字版的頁碼與省略號）', () => {
  it('7 頁以內全列', () => expect(pageSlots(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]));
  it('靠前：1 2 3 4 5 … 20', () => expect(pageSlots(2, 20)).toEqual([1, 2, 3, 4, 5, null, 20]));
  it('中間：1 … 9 10 11 … 20', () =>
    expect(pageSlots(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]));
  it('靠後：1 … 16 17 18 19 20', () =>
    expect(pageSlots(19, 20)).toEqual([1, null, 16, 17, 18, 19, 20]));
  it('槽數固定 7（換頁時寬度不跳）', () => {
    for (let p = 1; p <= 30; p++) expect(pageSlots(p, 30)).toHaveLength(7);
  });
});

describe('PagerComponent', () => {
  it('只有一頁：什麼都不畫（A6：pages > 1 才出）', async () => {
    const { el } = await setup({ total: 20, pageSize: 20, page: 1 });
    expect(el.querySelector('nav')).toBeNull();
  });

  describe('數字版（A6 courses）', () => {
    const numbered = (page: number, total = 100) =>
      setup({ variant: 'numbered', total, pageSize: 20, page });

    it('nav 叫「分頁」；頁碼鈕的名稱是「第 N 頁，共 M 頁」，目前頁 aria-current', async () => {
      const { el, buttons } = await numbered(3);
      expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('分頁');
      expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
        '上一頁',
        '第 1 頁，共 5 頁',
        '第 2 頁，共 5 頁',
        '第 3 頁，共 5 頁',
        '第 4 頁，共 5 頁',
        '第 5 頁，共 5 頁',
        '下一頁',
      ]);
      const current = buttons().filter((b) => b.getAttribute('aria-current') === 'true');
      expect(current.map((b) => b.textContent?.trim())).toEqual(['3']);
    });

    it('點頁碼、上一頁、下一頁 → 發出新的頁碼；點目前頁不發', async () => {
      const { byLabel, emitted } = await numbered(3);
      byLabel('第 4 頁，共 5 頁').click();
      byLabel('上一頁').click();
      byLabel('下一頁').click();
      byLabel('第 3 頁，共 5 頁').click();
      expect(emitted).toEqual([4, 2, 4]);
    });

    // 不用 disabled：disabled 鈕會把焦點丟掉（按到最後一頁時焦點正在「下一頁」上），也跳出 Tab 順序
    it('第一頁的「上一頁」、最後一頁的「下一頁」：aria-disabled、還在 Tab 順序裡、點了不發', async () => {
      const first = await numbered(1);
      expect(first.byLabel('上一頁').getAttribute('aria-disabled')).toBe('true');
      expect(first.byLabel('上一頁').disabled).toBe(false);
      first.byLabel('上一頁').click();
      expect(first.emitted).toEqual([]);

      TestBed.resetTestingModule();
      const last = await numbered(5);
      expect(last.byLabel('下一頁').getAttribute('aria-disabled')).toBe('true');
      last.byLabel('下一頁').click();
      expect(last.emitted).toEqual([]);
    });

    it('頁數多：省略號不是按鈕、報讀器不念', async () => {
      const { el, buttons } = await numbered(10, 400);
      expect(buttons()).toHaveLength(7); // ‹ 1 9 10 11 20 ›
      const gaps = el.querySelectorAll('[data-part="gap"]');
      expect(gaps).toHaveLength(2);
      gaps.forEach((g) => expect(g.getAttribute('aria-hidden')).toBe('true'));
    });

    it('觸控：頁碼鈕手機 44px、桌機 36px（A6 ≤860 是 44）', async () => {
      const { buttons } = await numbered(3);
      for (const b of buttons()) {
        expect(b.className).toContain('min-h-11');
        expect(b.className).toContain('wide:min-h-9');
      }
    });
  });

  describe('精簡版（A6 grades-student／meals）', () => {
    it('「第 x／y 頁」＋上一頁／下一頁；有單位時加「· 每頁 N 位」', async () => {
      const { el, buttons } = await setup({ total: 95, pageSize: 20, page: 2, unit: '位' });
      expect(el.querySelector('[data-part="status"]')?.textContent?.trim()).toBe(
        '第 2／5 頁 · 每頁 20 位',
      );
      expect(buttons().map((b) => b.textContent?.trim())).toEqual(['上一頁', '下一頁']);
    });

    it('沒給單位就只寫頁數；狀態句 aria-live，換頁念得到', async () => {
      const { el } = await setup({ total: 95, pageSize: 20, page: 2 });
      const status = el.querySelector('[data-part="status"]')!;
      expect(status.textContent?.trim()).toBe('第 2／5 頁');
      expect(status.getAttribute('aria-live')).toBe('polite');
    });

    it('上一頁／下一頁發出頁碼；到頭 aria-disabled、不發', async () => {
      const { buttons, emitted } = await setup({ total: 40, pageSize: 20, page: 2 });
      const [prev, next] = buttons();
      prev.click();
      next.click();
      expect(emitted).toEqual([1]);
      expect(next.getAttribute('aria-disabled')).toBe('true');
    });
  });
});
