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

  // #1715：A6 `<p class="chap__tally">6 門</p>` —— 單位跟數字同一段字、同字級，不是另一個小字 span
  it('單位跟張數是同一段字，不拆成 span（A6 `.chap__tally`）', async () => {
    await setup({ name: '國文', count: 6, unit: '門' });
    const tally = host.querySelector('.chapter-head__tally') as HTMLElement;
    expect(tally.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(tally.firstChild?.textContent).toBe('6 門');
    expect([...tally.querySelectorAll('span')].some((s) => s.textContent?.includes('門'))).toBe(
      false,
    );
  });

  // #1715：A6 `.chap__big` 是 block —— 直排時撐滿那一欄；只有手機橫排（`.chap--row`）縮成字寬
  it('直排（桌機、stacked）子項撐滿，手機橫排才 baseline 對齊', async () => {
    await setup({ name: '帳單', count: 3, unit: '張' });
    const box = () => host.querySelector('.chapter-head') as HTMLElement;
    expect([...box().classList]).toEqual(
      expect.arrayContaining(['items-baseline', 'wide:flex-col', 'wide:items-stretch']),
    );

    fixture.componentRef.setInput('stacked', true);
    fixture.detectChanges();
    expect(box().classList.contains('items-stretch')).toBe(true);
    expect(box().classList.contains('items-baseline')).toBe(false);
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

  it('章名字級真的掛上：預設 26px、stacked 32px（A6 `.chap` 手機，#1698）；error 紅字（任意值 class 不能用 [class.x] 綁）', async () => {
    await setup({ name: '帳單', count: 3, unit: '張' });
    const h2 = () => host.querySelector('.chapter-head__name') as HTMLElement;
    expect(h2().classList.contains('text-[26px]')).toBe(true);
    expect(h2().classList.contains('text-[32px]')).toBe(false);

    fixture.componentRef.setInput('stacked', true);
    fixture.detectChanges();
    expect(h2().classList.contains('text-[32px]')).toBe(true);
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

  // A6：手機 `.chap`（上下疊）的張數跟桌機一樣是 xl（18px）；只有 `.chap--row`（橫排）縮成 lg（#1698）
  it('張數字級：預設手機 lg、桌機 xl；stacked 手機也是 xl', async () => {
    await setup({ name: '帳單', count: 3, unit: '張' });
    const tally = () => host.querySelector('.chapter-head__tally') as HTMLElement;
    expect([...tally().classList]).toEqual(expect.arrayContaining(['text-lg', 'wide:text-xl']));

    fixture.componentRef.setInput('stacked', true);
    fixture.detectChanges();
    expect(tally().classList.contains('text-xl')).toBe(true);
    expect(tally().classList.contains('text-lg')).toBe(false);
  });

  // A6 人員／價目表／請假／考試的稿在 ≤860 覆寫 `.chap`：橫排、章名 28px、張數 14px（base）、上距 0（#1698）
  it('listRow：手機橫排，章名 28px、張數 base；桌機照舊 44／xl', async () => {
    await setup({ name: '老師', count: 12, unit: '位', listRow: true });
    const box = host.querySelector('.chapter-head') as HTMLElement;
    const h2 = host.querySelector('.chapter-head__name') as HTMLElement;
    const tally = host.querySelector('.chapter-head__tally') as HTMLElement;

    expect(box.classList.contains('flex-wrap')).toBe(true);
    expect(h2.classList.contains('text-[28px]')).toBe(true);
    expect(h2.classList.contains('text-[26px]')).toBe(false);
    expect(h2.classList.contains('wide:text-[44px]')).toBe(true);
    expect(tally.classList.contains('text-base')).toBe(true);
    expect(tally.classList.contains('text-lg')).toBe(false);
    expect(tally.classList.contains('wide:text-xl')).toBe(true);
  });

  // A6 `.chap__side { position: sticky; top: 80px }`，≤860 改回 static。稿的頂欄在捲動區裡（80＝頂欄 56＋24）；
  // app 頂欄在殼層的捲動區外，所以是 top 24px 才落在同一個地方（conformance 黏住檢查量的是落點）
  it('桌機章頭黏在捲動區頂下 24px（A6 .chap__side）；手機不黏', async () => {
    for (const inputs of [{}, { stacked: true }, { listRow: true }]) {
      TestBed.resetTestingModule();
      await setup({ name: '國文', ...inputs });
      const box = host.querySelector('.chapter-head') as HTMLElement;
      expect(box.classList.contains('wide:sticky')).toBe(true);
      expect(box.classList.contains('wide:top-sticky-chapter')).toBe(true);
      expect(box.classList.contains('sticky')).toBe(false);
    }
  });

  it('pinned=false 不黏（稿上不是 .chap 的頁，例：家長帳單）', async () => {
    await setup({ name: '待繳', pinned: false });
    const box = host.querySelector('.chapter-head') as HTMLElement;
    expect(box.classList.contains('wide:sticky')).toBe(false);
  });
});
