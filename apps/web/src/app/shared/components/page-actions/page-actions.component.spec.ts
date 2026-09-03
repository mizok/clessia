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

  const setup = async (primary: { label: string; icon?: string; disabled?: boolean } | null) => {
    await TestBed.configureTestingModule({ imports: [PageActionsComponent] }).compileComponents();
    fixture = TestBed.createComponent(PageActionsComponent);
    fixture.componentRef.setInput('primary', primary);
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
  // 改由 `.shell-content:has(.page-actions__dock)` 在 styles.scss 處理。
  //
  // 這條測試釘的是「元件不要自作聰明再長回一塊」——
  // 它在錯的位置，加回來只會多出一段沒有作用的留白。
  it('元件本身不放佔位塊 —— 底部留白由 shell-content 負責', async () => {
    await setup({ label: '新增人員' });

    expect(host.querySelector('.page-actions__spacer')).toBeNull();
    // 但停靠列本身要在，才有東西讓 shell-content 的 :has() 選到
    expect(host.querySelector('.page-actions__dock')).not.toBeNull();
  });

  // ── 只收一顆 ──────────────────────────────────────────────────────────────
  // `primary` 是單數，型別上就放不進第二顆。這條測試釘的是「停靠列裡只有一顆按鈕」，
  // 因為投影內容（次要行動）不該漏進停靠列。
  it('停靠列裡只有一顆按鈕 —— 次要行動不該漏進來', async () => {
    await setup({ label: '新增請假' });

    const dockButtons = host.querySelectorAll('.page-actions__dock button');
    expect(dockButtons.length).toBe(1);
  });

  // ── disabled 的行為 ───────────────────────────────────────────────────────
  it('disabled 時點下去不發事件', async () => {
    await setup({ label: '新增課程', disabled: true });

    let fired = 0;
    fixture.componentInstance.primaryClick.subscribe(() => fired++);
    (fixture.componentInstance as unknown as { onPrimary: () => void }).onPrimary();

    expect(fired).toBe(0);
  });

  it('沒有 disabled 時點下去會發事件', async () => {
    await setup({ label: '新增課程' });

    let fired = 0;
    fixture.componentInstance.primaryClick.subscribe(() => fired++);
    (fixture.componentInstance as unknown as { onPrimary: () => void }).onPrimary();

    expect(fired).toBe(1);
  });
});
