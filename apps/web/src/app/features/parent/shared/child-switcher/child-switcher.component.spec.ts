import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import { ChildSwitcherComponent } from './child-switcher.component';

const CHILDREN = [
  { id: 'c1', name: '王小明', grade: 'g4', school: '中山國小' },
  { id: 'c2', name: '王小美', grade: 'g6', school: '中山國小' },
];

function badge(fixture: { nativeElement: HTMLElement }): HTMLElement | null {
  return fixture.nativeElement.querySelector('.child-switcher__badge');
}

function listItems(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('.child-switcher__list-item'));
}

describe('ChildSwitcherComponent', () => {
  let fixture: ComponentFixture<ChildSwitcherComponent>;
  let setActiveChildSpy: ReturnType<typeof vi.fn>;

  async function createComponent(
    children: typeof CHILDREN,
    activeId: string | null,
    status: 'unloaded' | 'ready' | 'failed' = 'ready',
  ) {
    const childrenSignal = signal(children);
    const activeIdSignal = signal(activeId);
    setActiveChildSpy = vi.fn((id: string) => activeIdSignal.set(id));

    const childScopeMock = {
      children: childrenSignal.asReadonly(),
      activeChildId: activeIdSignal.asReadonly(),
      activeChild: () => childrenSignal().find((c) => c.id === activeIdSignal()) ?? null,
      status: () => status,
      canSwitch: () => childrenSignal().length > 1,
      setActiveChild: setActiveChildSpy,
    };

    TestBed.configureTestingModule({
      imports: [ChildSwitcherComponent],
      providers: [
        provideAnimationsAsync(),
        providePrimeNG({}),
        { provide: ChildScopeService, useValue: childScopeMock },
      ],
    });

    fixture = TestBed.createComponent(ChildSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    document.body.querySelectorAll('.p-popover').forEach((n) => n.remove());
  });

  it('沒有任何孩子時什麼都不渲染', async () => {
    await createComponent([], null);
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  /**
   * **「不給切換」和「不給顯示」是兩件事，只是碰巧共用一個元件。**
   *
   * 2026-09-06 有一版裁定寫「只有一個孩子時不渲染切換器」，依據是角色徽章
   * 「單角色不給切換」的先例。**那個先例遷移不過來**：角色徽章拿掉之後使用者仍然知道
   * 自己是誰（殼層別處有角色資訊），但孩子名字拿掉之後，**單孩子家長在出缺席／成績／繳費
   * 三頁上沒有任何東西告訴他在看誰**。裁定已改為「渲染成靜態徽章、不可互動」。
   *
   * 所以下面這支不是在測一個無關緊要的分支 —— 它守的是單孩子家長唯一的身分指示。
   */
  it('只有一個孩子時顯示姓名但不給互動——是 span 不是按鈕', async () => {
    await createComponent([CHILDREN[0]], 'c1');
    expect(badge(fixture)?.tagName).toBe('SPAN');
    expect(fixture.nativeElement.textContent).toContain('王小明');
  });

  it('多個孩子時徽章是按鈕，顯示目前孩子姓名', async () => {
    await createComponent(CHILDREN, 'c1');
    expect(badge(fixture)?.tagName).toBe('BUTTON');
    expect(badge(fixture)?.textContent).toContain('王小明');
  });

  it('點徽章開 popover，清單只列「其他」孩子（不含目前這個）', async () => {
    await createComponent(CHILDREN, 'c1');

    badge(fixture)?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listItems().map((b) => b.textContent?.trim())).toEqual(['王小美']);
  });

  it('點清單裡的孩子會呼叫 setActiveChild', async () => {
    await createComponent(CHILDREN, 'c1');

    badge(fixture)?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    listItems()[0]?.click();

    expect(setActiveChildSpy).toHaveBeenCalledWith('c2');
  });
  it('孩子清單讀不到時講出來 —— 空清單跟讀不到不能都是「什麼都不顯示」', async () => {
    await createComponent([], null, 'failed');

    expect(fixture.nativeElement.textContent).toContain('讀不到孩子資料');
  });

  it('讀到了但真的沒有孩子：不出現失敗訊息，也不出現徽章', async () => {
    await createComponent([], null, 'ready');

    expect(fixture.nativeElement.textContent).not.toContain('讀不到孩子資料');
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });
});
