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
    primary: { label: string; icon?: string; disabled?: boolean } | null,
    secondary: { label: string; icon?: string; disabled?: boolean } | null = null,
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
});
