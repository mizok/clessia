import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { ChangeLogEntry } from '@core/sessions.service';

import { ChangeLogListComponent } from './change-log-list.component';

function entry(overrides: Partial<ChangeLogEntry> = {}): ChangeLogEntry {
  return {
    id: 'chg-1',
    sessionId: 'sess-1',
    changeType: 'cancellation',
    summary: '停課',
    sessionDate: '2026-08-15',
    className: '國二數學 A',
    reason: '颱風',
    createdByName: '王主任',
    createdAt: '2026-08-10T03:00:00Z',
    isBatch: false,
    batchId: null,
    ...overrides,
  };
}

describe('ChangeLogListComponent', () => {
  let fixture: ComponentFixture<ChangeLogListComponent>;
  let component: ChangeLogListComponent;

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  function render(entries: ChangeLogEntry[], compact = false) {
    fixture = TestBed.createComponent(ChangeLogListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('entries', entries);
    fixture.componentRef.setInput('today', '2026-08-15');
    fixture.componentRef.setInput('compact', compact);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('章名：今天、明天、M/D；沒有日期寫「未排日期」', () => {
    render([]);
    const label = (d: string) =>
      (component as unknown as { dayLabel: (d: string) => string }).dayLabel(d);
    expect(label('2026-08-15')).toBe('今天');
    expect(label('2026-08-16')).toBe('明天');
    expect(label('2026-08-20')).toBe('8/20');
    expect(label('')).toBe('未排日期');
  });

  it('單堂一列、批次收成一則並可展開看是哪幾堂', () => {
    const el = render([
      entry({ id: 'one' }),
      entry({ id: 'b1', isBatch: true, batchId: 'X', className: '國二數學 A' }),
      entry({ id: 'b2', isBatch: true, batchId: 'X', className: '國三英文 B' }),
    ]);
    expect(el.textContent).toContain('看是哪 2 堂');
    expect(el.textContent).toContain('2 個班');
    expect(el.querySelectorAll('details').length).toBe(1);
  });

  it('補課顯示「補課」，不是原始 enum 值', () => {
    const el = render([entry({ changeType: 'makeup', summary: '補課' })]);
    expect(el.textContent).toContain('補課');
    expect(el.textContent).not.toContain('makeup');
  });

  it('沒寫原因與操作者時有退路，不出現 null／undefined', () => {
    const el = render([entry({ reason: null, createdByName: null })]);
    expect(el.textContent).toContain('沒寫原因');
    expect(el.textContent).not.toMatch(/null|undefined/);
  });

  // #1314 A6：每列最左的開始時間；單堂列右側「看這堂」
  describe('時間欄與看這堂', () => {
    const timeOf = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('[data-change-time]')).map((n) => n.textContent?.trim());

    it('有 sessionStartTime 就畫（含個位數時），沒有就不畫、改占位', () => {
      const el = render([
        entry({ id: 'a', sessionStartTime: '09:05' }),
        entry({ id: 'b', sessionStartTime: null }),
        entry({ id: 'c' }),
      ]);
      expect(timeOf(el)).toEqual(['09:05']);
      expect(el.querySelectorAll('span[aria-hidden="true"].wide\\:block').length).toBe(2);
    });

    it('批次列的時間用該批第一筆', () => {
      const el = render([
        entry({ id: 'b1', isBatch: true, batchId: 'X', sessionStartTime: '17:00' }),
        entry({ id: 'b2', isBatch: true, batchId: 'X', sessionStartTime: '18:00' }),
      ]);
      expect(timeOf(el)).toEqual(['17:00']);
    });

    it('單堂有「看這堂」，連到課表並帶 focusDate／focusSession', () => {
      const el = render([entry({ id: 'one', sessionId: 'sess-9', sessionDate: '2026-08-20' })]);
      const link = el.querySelector('a') as HTMLAnchorElement;
      expect(link.textContent).toContain('看這堂');
      const href = link.getAttribute('href') ?? '';
      expect(href).toContain('/sessions');
      expect(href).toContain('focusDate=2026-08-20');
      expect(href).toContain('focusSession=sess-9');
    });

    it('批次列沒有「看這堂」（它是「看是哪 N 堂」）；沒有上課日的單堂也沒有', () => {
      const batch = render([
        entry({ id: 'b1', isBatch: true, batchId: 'X' }),
        entry({ id: 'b2', isBatch: true, batchId: 'X' }),
      ]);
      expect(batch.textContent).not.toContain('看這堂');
      const noDate = render([entry({ sessionDate: null })]);
      expect(noDate.textContent).not.toContain('看這堂');
    });

    it('窄容器（抽屜，已經在課表上）不畫「看這堂」', () => {
      const el = render([entry()], true);
      expect(el.textContent).not.toContain('看這堂');
    });

    it('寬版格位有時間欄；窄容器不套 wide 版面、占位也不會在桌機長出來', () => {
      const wide = render([entry({ sessionStartTime: '17:00' })]);
      expect(wide.innerHTML).toContain('wide:grid-cols-[3rem_');
      const narrow = render([entry()], true);
      expect(narrow.innerHTML).not.toContain('wide:grid-cols-[3rem_');
      expect(narrow.querySelector('span[aria-hidden="true"]')?.className).toBe('hidden');
    });
  });
});
