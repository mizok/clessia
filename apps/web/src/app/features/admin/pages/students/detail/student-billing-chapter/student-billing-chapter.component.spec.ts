import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { StudentBillingChapterComponent } from './student-billing-chapter.component';
import { InvoicesService, type Invoice } from '@core/invoices.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { SystemClockService } from '@core/system-clock.service';
import { signal } from '@angular/core';

function invoice(over: Partial<Invoice>): Invoice {
  return {
    id: 'inv-1',
    orgId: 'o',
    studentId: 's1',
    studentName: '小明',
    issuedAt: '2026-10-01T00:00:00Z',
    dueDate: '2026-10-20',
    note: null,
    status: 'unpaid',
    total: 4050,
    netPaid: 0,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    items: [
      {
        id: 'it1',
        type: 'tuition',
        enrollmentId: null,
        amount: 4050,
        billingPeriodId: null,
        periodMonth: null,
        note: null,
      },
    ],
    payments: [],
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('StudentBillingChapterComponent', () => {
  let fixture: ComponentFixture<StudentBillingChapterComponent>;
  const open = vi.fn((..._a: unknown[]) => ({ onClose: of<Invoice | undefined>(undefined) }));
  const service = { list: vi.fn(), summary: vi.fn() };

  function setup(
    invoices: Invoice[],
    outstandingTotal: number,
    today = '2026-10-09',
    fail = false,
  ) {
    service.list.mockReturnValue(
      fail
        ? throwError(() => new Error('x'))
        : of({ data: invoices, meta: { total: invoices.length } }),
    );
    service.summary.mockReturnValue(
      fail ? throwError(() => new Error('x')) : of({ outstanding: outstandingTotal }),
    );
    TestBed.configureTestingModule({
      imports: [StudentBillingChapterComponent],
      providers: [
        provideRouter([]),
        { provide: InvoicesService, useValue: service },
        { provide: SystemClockService, useValue: { todayTaipei: signal(today) } },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    });
    TestBed.overrideComponent(StudentBillingChapterComponent, {
      add: { providers: [{ provide: DialogService, useValue: { open } }] },
    });
    fixture = TestBed.createComponent(StudentBillingChapterComponent);
    fixture.componentRef.setInput('studentId', 's1');
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const summary = () =>
    el().querySelector('[data-testid="billing-summary"]')!.textContent!.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('摘要列：待繳金額讀 API，未逾期寫到期日', () => {
    setup([invoice({})], 4050);
    expect(service.list).toHaveBeenCalledWith({ studentId: 's1', pageSize: 200 });
    expect(service.summary).toHaveBeenCalledWith({ studentId: 's1' });
    expect(summary()).toBe('NT$ 4,050 · 10/20 到期');
  });

  it('摘要列：逾期寫逾期天數', () => {
    setup([invoice({ dueDate: '2026-10-04' })], 4050);
    expect(summary()).toBe('NT$ 4,050 · 逾期 5 天');
  });

  it('摘要列：待繳為 0 寫沒有待繳；沒有帳單寫還沒有帳單', () => {
    setup([], 0);
    expect(summary()).toBe('沒有待繳');
    expect(el().textContent).toContain('還沒有帳單');
  });

  it('列表失敗：摘要寫載入失敗，不假裝沒有待繳', () => {
    setup([], 0, '2026-10-09', true);
    expect(summary()).toBe('載入失敗');
    expect(summary()).not.toContain('沒有待繳');
  });

  it('每張帳單顯示餘額與明細；按鈕開帳單詳情 dialog，有動過才重抓', () => {
    setup([invoice({})], 4050);
    expect(el().textContent).toContain('學費');
    const btn = [...el().querySelectorAll('button')].find((b) =>
      b.textContent!.includes('作廢／列印收費單'),
    )!;
    open.mockReturnValueOnce({ onClose: of(invoice({})) });
    btn.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it('章自己提供 MessageService：帳單詳情 dialog 靠它回報作廢／收款結果，學生檔案頁沒有這個 provider（實機 NG0201 抓到）', () => {
    setup([], 0);
    expect(fixture.debugElement.injector.get(MessageService)).toBeTruthy();
  });
});
