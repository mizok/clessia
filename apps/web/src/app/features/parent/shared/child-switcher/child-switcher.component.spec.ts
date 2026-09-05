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

  async function createComponent(children: typeof CHILDREN, activeId: string | null) {
    const childrenSignal = signal(children);
    const activeIdSignal = signal(activeId);
    setActiveChildSpy = vi.fn((id: string) => activeIdSignal.set(id));

    const childScopeMock = {
      children: childrenSignal.asReadonly(),
      activeChildId: activeIdSignal.asReadonly(),
      activeChild: () => childrenSignal().find((c) => c.id === activeIdSignal()) ?? null,
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
});
