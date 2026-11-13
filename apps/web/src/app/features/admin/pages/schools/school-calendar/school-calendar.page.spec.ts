import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';

import {
  SchoolsService,
  type School,
  type SchoolCalendarEvent,
  type SchoolCalendarPeriod,
} from '@core/schools.service';
import { CalendarEventFormDialogComponent } from './calendar-event-form-dialog.component';
import { SchoolCalendarPage, defaultPeriodId, mdw } from './school-calendar.page';

const school = (id: string, name: string): School =>
  ({ id, name, shortName: name, level: 'junior', isActive: true, studentCount: 0 }) as School;

const ev = (
  id: string,
  kind: SchoolCalendarEvent['kind'],
  startDate: string,
  endDate = startDate,
): SchoolCalendarEvent => ({
  id,
  schoolId: 's1',
  kind,
  startDate,
  endDate,
  note: null,
  createdAt: '',
  updatedAt: '',
});

const P_SPRING: SchoolCalendarPeriod = {
  id: 'p2',
  name: '115 春',
  startDate: '2027-02-01',
  endDate: '2027-07-31',
};
const P_FALL: SchoolCalendarPeriod = {
  id: 'p1',
  name: '115 秋',
  startDate: '2026-08-01',
  endDate: '2027-01-31',
};

function stubDialog() {
  const proto = HTMLDialogElement.prototype as any;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

describe('學校行事曆的日期與預設期（#1160）', () => {
  it('mdw 寫成 月/日（星期），不經機器時區', () => {
    expect(mdw('2027-02-11')).toBe('2/11（四）');
  });

  it('預設期：涵蓋今天 → 最近的下一期 → 最近的上一期 → 全部', () => {
    const periods = [P_SPRING, P_FALL]; // API 依開始日新到舊
    expect(defaultPeriodId(periods, '2026-11-12')).toBe('p1');
    expect(defaultPeriodId(periods, '2026-07-01')).toBe('p1');
    expect(defaultPeriodId(periods, '2027-09-01')).toBe('p2');
    expect(defaultPeriodId([], '2026-11-12')).toBe('');
  });
});

describe('SchoolCalendarPage（#1160 PR3）', () => {
  function setup(events: SchoolCalendarEvent[], periods = [P_SPRING, P_FALL], fail = false) {
    stubDialog();
    const calendarEvents = vi.fn(() =>
      fail ? throwError(() => new Error('x')) : of({ data: events, meta: { periods } }),
    );
    TestBed.configureTestingModule({
      imports: [SchoolCalendarPage],
      providers: [
        provideRouter([]),
        {
          provide: SchoolsService,
          useValue: {
            list: () => of({ data: [school('s1', '明湖國中'), school('s2', '麗山國中')] }),
            calendarEvents,
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(SchoolCalendarPage);
    fixture.componentRef.setInput('id', 's1');
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
    return {
      fixture,
      el: fixture.nativeElement as HTMLElement,
      cmp: fixture.componentInstance as any,
    };
  }

  it('只列跟選定的期重疊的事件（跨期的寒假兩期都列）、摘要寫開學與休業式', () => {
    vi.useFakeTimers({ now: new Date('2026-11-12T04:00:00Z'), toFake: ['Date'] });
    const { el, cmp, fixture } = setup([
      ev('a', 'semester_start', '2026-08-30'),
      ev('b', 'winter_break', '2027-01-20', '2027-02-10'),
      ev('c', 'semester_start', '2027-02-11'),
    ]);
    vi.useRealTimers();

    expect(cmp.periodId()).toBe('p1');
    expect(el.querySelectorAll('[data-event]').length).toBe(2);
    expect(el.querySelector('[data-part=calendar-summary]')!.textContent).toContain(
      '開學 8/30（日）',
    );
    expect(el.textContent).toContain('1/20（三）–2/10（三） · 22 天');

    cmp.periodId.set('p2');
    fixture.detectChanges();
    expect(
      [...el.querySelectorAll('[data-event]')].map((r) => r.getAttribute('data-event')),
    ).toEqual(['b', 'c']);
  });

  it('期內沒有開學／休業式 → 灰字提示；沒事件 → 空狀態', () => {
    const { el } = setup([], [P_FALL]);
    expect(el.textContent).toContain('還沒填開學／休業式');
    expect(el.textContent).toContain('這期還沒有 明湖國中 的行事曆');
  });

  it('讀取失敗 → 失敗畫面（不是空狀態）', () => {
    const { el } = setup([], [], true);
    expect(el.textContent).not.toContain('這期還沒有');
    expect(el.querySelector('app-load-failed')).not.toBeNull();
  });

  it('新增成功：只把自己這所（data[0]）插進列表', () => {
    const { el, cmp, fixture } = setup([], []);
    cmp.onFormClosed({
      mode: 'create',
      events: [
        ev('n1', 'no_class', '2026-12-01'),
        { ...ev('n2', 'no_class', '2026-12-01'), schoolId: 's2' },
      ],
    });
    fixture.detectChanges();
    expect(
      [...el.querySelectorAll('[data-event]')].map((r) => r.getAttribute('data-event')),
    ).toEqual(['n1']);
  });
});

describe('CalendarEventFormDialogComponent（#1160）', () => {
  function setup() {
    stubDialog();
    const created = ev('x', 'semester_start', '2027-02-11');
    const createCalendarEvent = vi.fn((_id: string, _input: unknown) => of({ data: [created] }));
    const updateCalendarEvent = vi.fn((_s: string, _e: string, _input: unknown) =>
      of({ data: created }),
    );
    TestBed.configureTestingModule({
      imports: [CalendarEventFormDialogComponent],
      providers: [
        { provide: SchoolsService, useValue: { createCalendarEvent, updateCalendarEvent } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(CalendarEventFormDialogComponent);
    const el = fixture.nativeElement as HTMLElement;
    const cmp = fixture.componentInstance as any;
    return { fixture, el, cmp, createCalendarEvent, updateCalendarEvent };
  }

  it('送出鈕 type=submit 指回 form、單日類型藏結束日且送出不帶 endDate', () => {
    const { fixture, el, cmp, createCalendarEvent } = setup();
    cmp.open({ id: 's1', name: '明湖國中' }, null, [school('s2', '麗山國中')]);
    cmp.kind.set('semester_start');
    cmp.startDate.set('2027-02-11');
    fixture.detectChanges();

    const submit = el.querySelector('[data-testid=calendar-submit]') as HTMLButtonElement;
    expect(submit.type).toBe('submit');
    expect(submit.getAttribute('form')).toBe('calendar-event-form');
    expect(el.querySelector('#cal-end')).toBeNull();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(createCalendarEvent.mock.calls[0]).toEqual([
      's1',
      { kind: 'semester_start', startDate: '2027-02-11', note: null },
    ]);
  });

  it('區間類型：結束日早於開始日 → 不送、寫原因；勾了其他學校就帶 alsoSchoolIds', () => {
    const { fixture, el, cmp, createCalendarEvent } = setup();
    cmp.open({ id: 's1', name: '明湖國中' }, null, [school('s2', '麗山國中')]);
    cmp.kind.set('winter_break');
    cmp.startDate.set('2027-01-20');
    cmp.endDate.set('2027-01-10');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(el.textContent).toContain('結束日不能早於開始日');

    cmp.endDate.set('2027-02-10');
    cmp.toggleAlso('s2');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(createCalendarEvent.mock.calls[0]![1]).toMatchObject({
      endDate: '2027-02-10',
      alsoSchoolIds: ['s2'],
    });
  });

  it('編輯：沒有「同時加到」，送 PATCH', () => {
    const { fixture, el, cmp, updateCalendarEvent } = setup();
    cmp.open({ id: 's1', name: '明湖國中' }, ev('e1', 'no_class', '2026-12-01'), [
      school('s2', '麗山國中'),
    ]);
    fixture.detectChanges();
    expect(el.querySelector('[data-part=also-schools]')).toBeNull();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(updateCalendarEvent).toHaveBeenCalledWith(
      's1',
      'e1',
      expect.objectContaining({ endDate: '2026-12-01' }),
    );
  });

  it('送出中按 Esc／點背景／按取消都不關，回來後照樣帶結果關窗', () => {
    const { fixture, el, cmp, createCalendarEvent } = setup();
    const pending = new Subject<{ data: SchoolCalendarEvent[] }>();
    createCalendarEvent.mockReturnValueOnce(pending as never);
    const closed = vi.fn();
    cmp.closed.subscribe(closed);
    cmp.open({ id: 's1', name: '明湖國中' }, null, []);
    cmp.kind.set('makeup_day');
    cmp.startDate.set('2026-12-05');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const dialog = el.querySelector('dialog')!;

    const esc = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    cmp.close();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(closed).not.toHaveBeenCalled();

    pending.next({ data: [ev('m', 'makeup_day', '2026-12-05')] });
    expect(closed).toHaveBeenCalledWith({
      mode: 'create',
      events: [ev('m', 'makeup_day', '2026-12-05')],
    });
  });
});
