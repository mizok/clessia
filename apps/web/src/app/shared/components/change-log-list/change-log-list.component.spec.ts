import { ComponentFixture, TestBed } from '@angular/core/testing';

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

  function render(entries: ChangeLogEntry[]) {
    fixture = TestBed.createComponent(ChangeLogListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('entries', entries);
    fixture.componentRef.setInput('today', '2026-08-15');
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
});
