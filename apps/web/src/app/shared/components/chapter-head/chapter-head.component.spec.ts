import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChapterHeadComponent } from './chapter-head.component';

describe('ChapterHeadComponent', () => {
  let fixture: ComponentFixture<ChapterHeadComponent>;
  let host: HTMLElement;

  const setup = async (inputs: Record<string, unknown>) => {
    await TestBed.configureTestingModule({ imports: [ChapterHeadComponent] }).compileComponents();
    fixture = TestBed.createComponent(ChapterHeadComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  };

  it('章名與「張數＋單位」都渲染', async () => {
    await setup({ name: '國文', count: 6, unit: '門' });

    expect(host.querySelector('.chapter-head__name')?.textContent?.trim()).toBe('國文');
    expect(host.querySelector('.chapter-head__tally')?.textContent?.replace(/\s+/g, '')).toBe(
      '6門',
    );
  });

  it('count 是 null 就不顯示張數 —— 前端再濾過、API 數字對不上時不編數字', async () => {
    await setup({ name: '國文', count: null, unit: '門' });

    expect(host.querySelector('.chapter-head__tally')).toBeNull();
  });

  it('count 是 0 要顯示（0 是答案，不是缺值）', async () => {
    await setup({ name: '作廢', count: 0, unit: '張' });

    expect(host.querySelector('.chapter-head__tally')?.textContent).toContain('0');
  });

  it('tone=error 章名是紅字，預設是深灰', async () => {
    await setup({ name: '逾期', count: 3, unit: '張', tone: 'error' });
    expect(host.querySelector('.chapter-head__name')?.classList.contains('text-error-700')).toBe(
      true,
    );

    fixture.componentRef.setInput('tone', 'default');
    fixture.detectChanges();
    expect(host.querySelector('.chapter-head__name')?.classList.contains('text-error-700')).toBe(
      false,
    );
    expect(host.querySelector('.chapter-head__name')?.classList.contains('text-zinc-900')).toBe(
      true,
    );
  });

  it('預設手機橫排（章名與張數同一行可換行）；stacked 手機也上下堆疊', async () => {
    await setup({ name: '帳單', count: 3, unit: '張' });
    const box = () => host.querySelector('.chapter-head') as HTMLElement;
    expect(box().classList.contains('flex-wrap')).toBe(true);
    expect(box().classList.contains('flex-col')).toBe(false);

    fixture.componentRef.setInput('stacked', true);
    fixture.detectChanges();
    expect(box().classList.contains('flex-col')).toBe(true);
    expect(box().classList.contains('flex-wrap')).toBe(false);
  });

  it('章名字級真的掛上：預設 26px、stacked 34px；error 紅字（任意值 class 不能用 [class.x] 綁）', async () => {
    await setup({ name: '帳單', count: 3, unit: '張' });
    const h2 = () => host.querySelector('.chapter-head__name') as HTMLElement;
    expect(h2().classList.contains('text-[26px]')).toBe(true);
    expect(h2().classList.contains('text-[34px]')).toBe(false);

    fixture.componentRef.setInput('stacked', true);
    fixture.detectChanges();
    expect(h2().classList.contains('text-[34px]')).toBe(true);
    expect(h2().classList.contains('text-[26px]')).toBe(false);
    expect(h2().classList.contains('wide:text-[44px]')).toBe(true);
    expect(h2().classList.contains('text-zinc-900')).toBe(true);

    fixture.componentRef.setInput('tone', 'error');
    fixture.detectChanges();
    expect(h2().classList.contains('text-error-700')).toBe(true);
    expect(h2().classList.contains('text-zinc-900')).toBe(false);
  });

  it('sub 預設空：不渲染小字，別頁 DOM 不變；有值才出現', async () => {
    await setup({ name: '今天', count: 4, unit: '位' });
    expect(host.querySelector('[data-testid="chapter-sub"]')).toBeNull();

    fixture.componentRef.setInput('sub', '10/1（四）');
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="chapter-sub"]')?.textContent?.trim()).toBe(
      '10/1（四）',
    );
    // 順序：章名、小字、張數
    const order = [
      ...host.querySelectorAll('h2, [data-testid="chapter-sub"], .chapter-head__tally'),
    ].map((e) => e.tagName + (e.getAttribute('data-testid') ?? ''));
    expect(order).toEqual(['H2', 'SPANchapter-sub', 'P']);
  });
});
