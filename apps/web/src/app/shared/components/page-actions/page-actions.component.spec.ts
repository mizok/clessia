import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PageActionsComponent } from './page-actions.component';

/**
 * 這支 spec 釘的是**刻意的設計約束**，不只是「有沒有渲染出來」。
 *
 * 這個元件存在的理由就是那些約束（一次宣告兩處渲染、只收一顆主要行動、
 * 沒有行動就不佔空間）。如果測試只驗渲染，下一個人可以在不弄紅任何東西的情況下
 * 把約束拆掉 —— 那正是這個元件想防的事。
 */
describe('PageActionsComponent', () => {
  let fixture: ComponentFixture<PageActionsComponent>;
  let host: HTMLElement;

  const setup = async (
    primary: { label: string; mobileLabel?: string; icon?: string; disabled?: boolean } | null,
    secondary: {
      label: string;
      mobileLabel?: string;
      icon?: string;
      disabled?: boolean;
    } | null = null,
  ) => {
    await TestBed.configureTestingModule({ imports: [PageActionsComponent] }).compileComponents();
    fixture = TestBed.createComponent(PageActionsComponent);
    fixture.componentRef.setInput('primary', primary);
    fixture.componentRef.setInput('secondary', secondary);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  };

  // ── 一次宣告，兩處渲染 ────────────────────────────────────────────────────
  // 這是元件存在的核心理由：同一個行動宣告兩次必然漂移（2026-09 的全站分析
  // 有三個實例），所以頁面只給一次，由元件決定渲染在哪。
  it('同一個行動同時渲染在標頭與停靠列 —— 頁面只宣告一次', async () => {
    await setup({ label: '新增課程', icon: 'pi pi-plus' });

    const header = host.querySelector('.page-actions__header');
    const dock = host.querySelector('.page-actions__dock');

    expect(header?.textContent).toContain('新增課程');
    expect(dock?.textContent).toContain('新增課程');
  });

  // ── 沒有行動就不佔空間 ────────────────────────────────────────────────────
  it('沒有主要行動時，停靠列與佔位塊都不存在', async () => {
    await setup(null);

    expect(host.querySelector('.page-actions__dock')).toBeNull();
    expect(host.querySelector('.page-actions__spacer')).toBeNull();
  });

  // ── 底部留白不歸這個元件管 ────────────────────────────────────────────────
  // 停靠列是 fixed，一定要有人替它保留底部空間 —— 沒有的話它會蓋住清單最後一列，
  // 而使用者不會說「被蓋住了」，只會說「**最後一個按不到**」。
  //
  // 第一版我把佔位塊放在這個元件裡。**那是錯的**：元件宣告在頁面**標頭**，
  // 佔位塊放這裡保留的是標頭下方的空間，而要保留的是**頁尾**。
  // 改由 `.shell-content:has(.page-actions__dock)` 在 styles.css 處理。
  //
  // 這條測試釘的是「元件不要自作聰明再長回一塊」——
  // 它在錯的位置，加回來只會多出一段沒有作用的留白。
  it('元件本身不放佔位塊 —— 底部留白由 shell-content 負責', async () => {
    await setup({ label: '新增人員' });

    expect(host.querySelector('.page-actions__spacer')).toBeNull();
    // 但停靠列本身要在，才有東西讓 shell-content 的 :has() 選到
    expect(host.querySelector('.page-actions__dock')).not.toBeNull();
  });

  // ── 次要行動在手機上不能消失 ────────────────────────────────────────────
  // 第一版把整個 `__header` 在手機隱藏，而次要行動（操作紀錄、匯入）投影在裡面 ——
  // 結果是它們在手機上**完全按不到**。那是無法觸及，不是「換了位置」。
  //
  // 現在只藏 `__header-primary`（主要行動在標頭裡的那一份），標頭本身保留。
  // 這條測試釘的是那個結構，不是 CSS 的可見性（jsdom 不跑 media query）。
  it('主要行動在標頭裡的那一份是獨立容器 —— 藏它時不會連累投影的次要行動', async () => {
    await setup({ label: '新增分校' });

    const header = host.querySelector('.page-actions__header');
    const headerPrimary = host.querySelector('.page-actions__header-primary');

    expect(header).not.toBeNull();
    expect(headerPrimary).not.toBeNull();
    // 主要行動必須被包在自己的容器裡，而那個容器是 __header 的子節點 ——
    // 這樣手機隱藏它才不會把兄弟節點（投影的次要行動）一起帶走
    expect(headerPrimary!.parentElement).toBe(header);
  });

  // ── 托盤（2026-10，A6 推翻 2026-10 前「單一主要行動」的決定）──────────────
  // 托盤最多兩顆：次要在左、主要在右（A6 學生檔案＝「登記請假」＋「收款」）。
  // `primary`／`secondary` 各自是單數，**型別上放不進第三顆**；投影內容（桌機標頭的
  // 其他次要行動）仍然不該漏進托盤，所以沒給 secondary 時托盤裡還是只有一顆。
  it('沒給 secondary 時托盤裡只有一顆按鈕 —— 投影內容不該漏進來', async () => {
    await setup({ label: '新增請假' });

    expect(host.querySelectorAll('.page-actions__dock button').length).toBe(1);
  });

  it('給了 secondary：托盤兩顆，次要在左、主要在右', async () => {
    await setup({ label: '收款' }, { label: '登記請假' });

    const labels = Array.from(host.querySelectorAll('.page-actions__dock button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['登記請假', '收款']);
  });

  it('托盤是浮起的（內縮＋圓角），不是貼邊的橫線', async () => {
    await setup({ label: '新增人員' });

    const dock = host.querySelector('.page-actions__dock') as HTMLElement;
    // jsdom 不跑 Tailwind，斷言 class 是意圖；實際像素由 PR 的 360 實拍證明
    expect(dock.classList.contains('rounded-lg')).toBe(true);
    expect(dock.className).toContain('inset-x-3');
    expect(dock.classList.contains('border-t')).toBe(false);
  });

  it('secondary 在桌機標頭也有一份，且在主要行動前面', async () => {
    await setup({ label: '收款' }, { label: '登記請假' });

    const header = host.querySelector('.page-actions__header') as HTMLElement;
    const text = header.textContent ?? '';
    expect(text.indexOf('登記請假')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('登記請假')).toBeLessThan(text.indexOf('收款'));
  });

  it('沒有主要行動時，secondary 也不渲染（托盤與標頭都沒有）', async () => {
    await setup(null, { label: '登記請假' });

    expect(host.querySelector('.page-actions__dock')).toBeNull();
    expect(host.querySelector('.page-actions__header-secondary')).toBeNull();
  });

  it('secondary 點下去發 secondaryClick；disabled 不發', async () => {
    await setup({ label: '收款' }, { label: '登記請假' });
    let fired = 0;
    fixture.componentInstance.secondaryClick.subscribe(() => fired++);
    const call = (fixture.componentInstance as unknown as { onSecondary: (e: MouseEvent) => void })
      .onSecondary;
    call.call(fixture.componentInstance, new MouseEvent('click'));
    expect(fired).toBe(1);

    fixture.componentRef.setInput('secondary', { label: '登記請假', disabled: true });
    call.call(fixture.componentInstance, new MouseEvent('click'));
    expect(fired).toBe(1);
  });

  // ── disabled 的行為 ───────────────────────────────────────────────────────
  it('disabled 時點下去不發事件', async () => {
    await setup({ label: '新增課程', disabled: true });

    let fired = 0;
    fixture.componentInstance.primaryClick.subscribe(() => fired++);
    (fixture.componentInstance as unknown as { onPrimary: (e: MouseEvent) => void }).onPrimary(
      new MouseEvent('click'),
    );

    expect(fired).toBe(0);
  });

  it('沒有 disabled 時點下去會發事件', async () => {
    await setup({ label: '新增課程' });

    let fired = 0;
    fixture.componentInstance.primaryClick.subscribe(() => fired++);
    (fixture.componentInstance as unknown as { onPrimary: (e: MouseEvent) => void }).onPrimary(
      new MouseEvent('click'),
    );

    expect(fired).toBe(1);
  });

  // ── secondaryOnDesktop：章頭已有同一個動作時，標頭不再放第二份 ─────────────
  it('預設桌機標頭與托盤都有次要行動', async () => {
    await setup({ label: '新增價目表' }, { label: '新增期間' });

    expect(host.querySelector('.page-actions__header-secondary')?.textContent).toContain(
      '新增期間',
    );
    expect(host.querySelector('.page-actions__dock')?.textContent).toContain('新增期間');
  });

  it('secondaryOnDesktop=false：標頭沒有次要行動，托盤照舊', async () => {
    await TestBed.configureTestingModule({ imports: [PageActionsComponent] }).compileComponents();
    fixture = TestBed.createComponent(PageActionsComponent);
    fixture.componentRef.setInput('primary', { label: '新增價目表' });
    fixture.componentRef.setInput('secondary', { label: '新增期間' });
    fixture.componentRef.setInput('secondaryOnDesktop', false);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.page-actions__header-secondary')).toBeNull();
    expect(host.querySelector('.page-actions__header-primary')?.textContent).toContain(
      '新增價目表',
    );
    expect(host.querySelector('.page-actions__dock')?.textContent).toContain('新增期間');
  });

  // ── primaryOnDesktop：手機托盤的主要行動與桌機主鈕不是同一顆時（帳單），標頭不放 primary ──
  it('預設桌機標頭有主要行動', async () => {
    await setup({ label: '全部提醒' });

    expect(host.querySelector('.page-actions__header-primary')?.textContent).toContain('全部提醒');
  });

  it('primaryOnDesktop=false：標頭沒有主要行動，托盤照舊（次要也照舊）', async () => {
    await TestBed.configureTestingModule({ imports: [PageActionsComponent] }).compileComponents();
    fixture = TestBed.createComponent(PageActionsComponent);
    fixture.componentRef.setInput('primary', { label: '全部提醒' });
    fixture.componentRef.setInput('secondary', { label: '開立帳單' });
    fixture.componentRef.setInput('primaryOnDesktop', false);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.page-actions__header-primary')).toBeNull();
    expect(host.querySelector('.page-actions__dock')?.textContent).toContain('全部提醒');
    expect(host.querySelector('.page-actions__dock')?.textContent).toContain('開立帳單');
  });

  // ── 托盤的版面：靠右、依內容寬（A6 `.dock`），不撐滿 ─────────────────────────
  // 一顆時撐滿整條是回歸（家長頁手機「新增家長」變滿版長條，PR-A／PR-B 當初就是要拿掉它）。
  // 稿的規則：「底部動作列不再兩顆對半撐滿：靠右、依內容寬」。
  describe('托盤版面（靠右、依內容寬）', () => {
    it('托盤是靠右的 flex，不是等分欄的 grid', async () => {
      await setup({ label: '新增家長' });

      const dock = host.querySelector('.page-actions__dock') as HTMLElement;
      expect(dock.classList.contains('flex')).toBe(true);
      expect(dock.classList.contains('justify-end')).toBe(true);
      expect(dock.classList.contains('grid')).toBe(false);
      expect(dock.className).not.toContain('auto-cols-fr');
    });

    it('一顆 primary：鈕不撐滿（沒有 w-full）', async () => {
      await setup({ label: '新增家長' });

      const cta = host.querySelector('.page-actions__cta') as HTMLElement;
      expect(cta).not.toBeNull();
      expect(cta.classList.contains('w-full')).toBe(false);
    });

    it('兩顆：次要在左、主要在右，兩顆都不撐滿', async () => {
      await setup({ label: '全部提醒' }, { label: '開立帳單' });

      const buttons = Array.from(host.querySelectorAll('.page-actions__dock button'));
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(['開立帳單', '全部提醒']);
      expect(host.querySelector('.page-actions__secondary')?.classList.contains('w-full')).toBe(
        false,
      );
      expect(host.querySelector('.page-actions__cta')?.classList.contains('w-full')).toBe(false);
    });
  });

  // ── 次要鈕外觀（A6：白底、zinc-300 框、近黑字）──────────────────────────────
  it('次要鈕在標頭與手機托盤兩處都是白底＋zinc-300 框，主要鈕不受影響', async () => {
    await setup({ label: '收款' }, { label: '登記請假' });

    const header = host.querySelector('.page-actions__header-secondary button')!;
    const dock = host.querySelector('.page-actions__dock .page-actions__secondary')!;
    for (const btn of [header, dock]) {
      expect(btn.textContent).toContain('登記請假');
      for (const c of ['bg-white', 'border-zinc-300', 'text-zinc-900']) {
        expect(btn.classList.contains(c)).toBe(true);
      }
    }
    const cta = host.querySelector('.page-actions__dock .page-actions__cta')!;
    expect(cta.classList.contains('bg-white')).toBe(false);
  });

  // ── 手機標籤 ────────────────────────────────────────────────────────────
  it('mobileLabel：托盤用短標籤、桌機標頭仍用 label；不給就沿用 label', async () => {
    await setup({ label: '登記請假' }, { label: '櫃台代刷到班', mobileLabel: '櫃台代刷' });
    const dock = host.querySelector('.page-actions__dock')!;
    expect(dock.textContent).toContain('櫃台代刷');
    expect(dock.textContent).not.toContain('櫃台代刷到班');
    expect(host.querySelector('.page-actions__header-secondary')!.textContent).toContain(
      '櫃台代刷到班',
    );
    // 主要鈕沒給 mobileLabel → 沿用 label
    expect(dock.querySelector('.page-actions__cta')!.textContent).toContain('登記請假');
  });

  it('主要鈕帶 mobileLabel：托盤用短標籤、標頭用 label；次要沒給的兩處都用 label（主／次、手機／桌機四個方向）', async () => {
    await setup({ label: '登記請假', mobileLabel: '請假' }, { label: '櫃台代刷到班' });

    const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, '');
    // 手機托盤
    expect(text(host.querySelector('.page-actions__dock .page-actions__cta'))).toBe('請假');
    expect(text(host.querySelector('.page-actions__dock .page-actions__secondary'))).toBe(
      '櫃台代刷到班',
    );
    // 桌機標頭
    expect(text(host.querySelector('.page-actions__header-primary'))).toBe('登記請假');
    expect(text(host.querySelector('.page-actions__header-secondary'))).toBe('櫃台代刷到班');
  });

  // ── A6 按鈕尺寸（#1591）：托盤 48 高、標頭 36 高 ─────────────────────────
  // 托盤兩顆鈕的 styleClass 是字串拼接，漏接 dockClass 不會有任何東西紅（#1813 W10 同類）
  it('托盤主／次鈕都帶 dockClass（h-12）；標頭容器把投影進來的 p-button 壓成 tbar-control（#1903）', async () => {
    await setup({ label: '新增課程' }, { label: '匯入' });

    for (const sel of ['.page-actions__cta', '.page-actions__secondary']) {
      expect(host.querySelector(`.page-actions__dock ${sel}`)!.classList).toContain('h-12');
    }
    expect(host.querySelector('.page-actions__header')!.classList).toContain(
      '[&_.p-button]:tbar-control',
    );
  });
});
