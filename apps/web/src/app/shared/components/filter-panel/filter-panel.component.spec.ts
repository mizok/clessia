import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FilterPanelComponent } from './filter-panel.component';

@Component({
  imports: [FilterPanelComponent],
  template: `
    <app-filter-panel
      #panel
      [hasFilters]="has()"
      (cleared)="cleared = cleared + 1"
      (openChange)="opens.push($event)"
    >
      <ng-template><p class="probe">條件內容</p></ng-template>
    </app-filter-panel>
    <button class="trigger" (click)="panel.toggle($event)">篩選</button>
  `,
})
class HostComponent {
  readonly has = signal(false);
  cleared = 0;
  readonly opens: boolean[] = [];
}

/** 用假的 matchMedia 決定是不是 ≤860（jsdom 沒有它） */
function mount(narrow: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: narrow && q === '(max-width: 860px)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [provideNoopAnimations()],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const trigger = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.trigger')!;
  return { fixture, host: fixture.componentInstance, trigger };
}

describe('FilterPanelComponent（#2206）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('.p-dialog-mask, .p-popover').forEach((el) => el.remove());
  });

  it('桌機：是 filter-popover 浮層，不是抽屜', () => {
    const { fixture } = mount(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('p-popover')).not.toBeNull();
    expect(el.querySelector('p-dialog')).toBeNull();
  });

  it('≤860：點「篩選」打開貼底抽屜（p-dialog），標題「篩選」、內容是投影進來的樣板', async () => {
    const { fixture, host, trigger } = mount(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('p-popover')).toBeNull();

    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = document.querySelector('.p-dialog') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('篩選');
    expect(dialog.querySelector('.probe')?.textContent).toBe('條件內容');
    expect(host.opens).toEqual([true]);
  });

  it('≤860：抽屜的可及名稱是「篩選」（aria-labelledby 指到標題），沒有右上角 ×', async () => {
    const { fixture, trigger } = mount(true);
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = document.querySelector('[role=dialog]') as HTMLElement;
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent?.trim()).toBe('篩選');
    const close = document.querySelector<HTMLElement>('.p-dialog-close-button');
    // × 在 DOM 裡（closable 才有 Esc），但被 styleClass 藏起來
    expect(close === null || dialog.className.includes('[&_.p-dialog-close-button]:hidden')).toBe(
      true,
    );
  });

  it('≤860：按 Esc 關閉抽屜，發 openChange(false)', async () => {
    const { fixture, host, trigger } = mount(true);
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.opens).toEqual([true, false]);
  });

  it('≤860：沒有條件時不出「清除」；有條件時出，點了發 cleared', async () => {
    const { fixture, host, trigger } = mount(true);
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.p-dialog button')];
    expect(buttons().some((b) => b.textContent?.trim() === '清除')).toBe(false);

    host.has.set(true);
    fixture.detectChanges();
    buttons()
      .find((b) => b.textContent?.trim() === '清除')!
      .click();
    expect(host.cleared).toBe(1);
  });

  it('≤860：「完成」只關閉抽屜（觸控 44px）', async () => {
    const { fixture, host, trigger } = mount(true);
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    const done = [...document.querySelectorAll<HTMLButtonElement>('.p-dialog button')].find(
      (b) => b.textContent?.trim() === '完成',
    )!;
    expect(done.classList.contains('min-h-11')).toBe(true);

    done.click();
    fixture.detectChanges();
    expect(host.opens).toEqual([true, false]);
    expect(host.cleared).toBe(0);
  });
});
