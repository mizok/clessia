import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';

import { LeaveStreaksService, type LeaveStreakDetail } from '@core/leave-streaks.service';

import { StudentLeaveStreaksComponent, dayLabel } from './student-leave-streaks.component';

const streak = (over: Partial<LeaveStreakDetail> = {}): LeaveStreakDetail => ({
  firstDay: '2026-10-14',
  lastDay: '2026-10-19',
  days: ['2026-10-14', '2026-10-16', '2026-10-19'].map((date) => ({
    date,
    sessions: [
      {
        sessionId: `s-${date}`,
        classId: 'c1',
        className: '國二數學',
        startTime: '18:00',
        endTime: '20:00',
      },
    ],
  })),
  meals: [
    { date: '2026-10-14', unitPrice: 80, invoicedMonth: '2026-10' },
    { date: '2026-10-16', unitPrice: 80, invoicedMonth: null },
  ],
  enrollments: [
    {
      classId: 'c1',
      className: '國二數學',
      billingMode: 'session_pack',
      leaveDeductsSession: true,
      sessionCount: 3,
    },
    {
      classId: 'c2',
      className: '英文',
      billingMode: 'monthly',
      leaveDeductsSession: false,
      sessionCount: 1,
    },
  ],
  review: null,
  ...over,
});

describe('StudentLeaveStreaksComponent（#1732）', () => {
  const service = {
    forStudent: vi.fn(),
    markReviewed: vi.fn(),
    undoReview: vi.fn(),
  };
  const add = vi.fn();

  async function setup(data: LeaveStreakDetail[]) {
    service.forStudent.mockReset().mockReturnValue(of({ threshold: 3, data }));
    service.markReviewed.mockReset();
    service.undoReview.mockReset();
    add.mockReset();
    TestBed.configureTestingModule({
      imports: [StudentLeaveStreaksComponent],
      providers: [
        { provide: LeaveStreaksService, useValue: service },
        { provide: MessageService, useValue: { add } },
      ],
    });
    const fixture = TestBed.createComponent(StudentLeaveStreaksComponent);
    fixture.componentRef.setInput('studentId', 'stu-1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, text: () => el.textContent?.replace(/\s+/g, ' ') ?? '' };
  }

  it('沒有達標段：整塊不畫', async () => {
    const { el } = await setup([]);
    expect(el.querySelector('[data-testid="leave-streaks"]')).toBeNull();
  });

  it('未處理：天數、日期與星期、餐費單價加總與已開月份、各報名怎麼處理；不估學費金額', async () => {
    const { text } = await setup([streak()]);
    const t = text();
    expect(t).toContain('連續請假 3 個上課日');
    expect(t).toContain('10/14（三）');
    expect(t).toContain('10/19（一）');
    expect(t).toContain('訂了而且收費 2 餐，共 NT$ 160');
    expect(t).toContain('已開在 10 月帳單');
    expect(t).toContain('國二數學：堂數制，已扣 3 堂，可補回');
    expect(t).toContain('英文：月繳，這幾天的學費由你決定怎麼調');
  });

  it('不扣堂的堂數制班：寫「不用處理」', async () => {
    const { text } = await setup([
      streak({
        enrollments: [
          {
            classId: 'c1',
            className: '國二數學',
            billingMode: 'session_pack',
            leaveDeductsSession: false,
            sessionCount: 3,
          },
        ],
      }),
    ]);
    expect(text()).toContain('請假不扣堂，不用處理');
  });

  it('已處理：收成一行（誰、哪天），沒有按鈕', async () => {
    const { el, text } = await setup([
      streak({
        review: {
          id: 'r1',
          reviewedBy: 'u',
          reviewerName: '王主任',
          reviewedAt: '2026-10-20T03:00:00Z',
        },
      }),
    ]);
    expect(text()).toContain('已處理：10/14–10/19，王主任 10/20');
    expect(el.querySelector('button')).toBeNull();
  });

  it('已處理的日期用台北日：UTC 10/19 16:30＝台北 10/20 00:30 → 寫 10/20', async () => {
    const { text } = await setup([
      streak({
        review: {
          id: 'r1',
          reviewedBy: 'u',
          reviewerName: '王主任',
          reviewedAt: '2026-10-19T16:30:00Z',
        },
      }),
    ]);
    expect(text()).toContain('王主任 10/20');
  });

  it('標記失敗（非 409）：跳錯誤、按鈕可以再按', async () => {
    const { el, fixture } = await setup([streak()]);
    service.markReviewed.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    el.querySelector('button')!.click();
    fixture.detectChanges();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: '標記失敗' }),
    );
    expect(el.querySelector('button')!.disabled).toBe(false);
  });

  it('標為已處理：送這一段的起訖、重抓、toast 帶復原；按復原會刪那一列再重抓', async () => {
    const { el } = await setup([streak()]);
    service.markReviewed.mockReturnValue(
      of({ data: { id: 'r9', reviewedBy: 'u', reviewerName: null, reviewedAt: 't' } }),
    );
    service.undoReview.mockReturnValue(of(undefined));
    el.querySelector('button')!.click();

    expect(service.markReviewed).toHaveBeenCalledWith('stu-1', {
      firstDay: '2026-10-14',
      lastDay: '2026-10-19',
    });
    expect(service.forStudent).toHaveBeenCalledTimes(2);
    const toast = add.mock.calls[0]![0] as { summary: string; data: { undo: () => void } };
    expect(toast.summary).toBe('已標為已處理');
    toast.data.undo();
    expect(service.undoReview).toHaveBeenCalledWith('stu-1', 'r9');
    expect(service.forStudent).toHaveBeenCalledTimes(3);
  });

  it('409（這段已經變了）：跳錯誤並重抓現況', async () => {
    const { el } = await setup([streak()]);
    service.markReviewed.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    el.querySelector('button')!.click();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: '這段請假已經變了' }),
    );
    expect(service.forStudent).toHaveBeenCalledTimes(2);
  });

  it('dayLabel：日期配星期', () => {
    expect(dayLabel('2026-10-18')).toBe('10/18（日）');
  });
});
