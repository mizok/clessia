import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { Invoice, PaymentRecord } from '@core/invoices.service';

import { InvoiceActionsComponent } from './invoice-actions.component';

const payment: PaymentRecord = {
  id: 'p1',
  kind: 'payment',
  amount: 1000,
  method: 'cash',
  paidAt: '2026-08-10',
  proofPath: null,
  receiptNo: 12,
  note: null,
  recordedBy: 'u1',
};

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'i1',
  orgId: 'o1',
  studentId: 's1',
  invoiceNo: null,
  studentName: '王小明',
  studentGrade: null,
  issuedAt: '2026-08-01',
  dueDate: '2026-08-15',
  note: null,
  status: 'unpaid',
  total: 3000,
  netPaid: 0,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  items: [],
  payments: [],
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('InvoiceActionsComponent', () => {
  let fixture: ComponentFixture<InvoiceActionsComponent>;
  let host: HTMLElement;

  const setup = async (inv: Invoice) => {
    await TestBed.configureTestingModule({
      imports: [InvoiceActionsComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(InvoiceActionsComponent);
    fixture.componentRef.setInput('invoice', inv);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  };
  const labels = () =>
    Array.from(host.querySelectorAll('button')).map((b) => b.textContent?.trim());

  it('未繳清：提醒＋收款，沒有收據', async () => {
    await setup(invoice());
    expect(labels()).toEqual(['提醒', '收款']);
  });

  it('繳清：只有收據', async () => {
    await setup(invoice({ status: 'paid', netPaid: 3000, payments: [payment] }));
    expect(labels()).toEqual(['收據']);
  });

  it('部分繳：提醒、收款、收據都在', async () => {
    await setup(invoice({ status: 'partial', netPaid: 1000, payments: [payment] }));
    expect(labels()).toEqual(['提醒', '收款', '收據']);
  });

  it('作廢：一顆都沒有', async () => {
    await setup(invoice({ status: 'void', payments: [payment] }));
    expect(labels()).toEqual([]);
  });

  it('每顆鈕的 aria-label 帶學生名（列表上有很多顆「提醒」，要分得出是誰的）', async () => {
    await setup(invoice());
    const names = Array.from(host.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual(['記錄 王小明 的催繳', '記錄 王小明 的收款']);
  });

  it('點「提醒」發 remind 且帶 MouseEvent（頁面要把選單錨在這顆鈕）；收款、收據各發自己的事件', async () => {
    await setup(invoice({ status: 'partial', netPaid: 1000, payments: [payment] }));
    const events: string[] = [];
    let target: unknown = null;
    fixture.componentInstance.remind.subscribe((e) => {
      events.push('remind');
      target = e;
    });
    fixture.componentInstance.collect.subscribe(() => events.push('collect'));
    fixture.componentInstance.receipt.subscribe(() => events.push('receipt'));

    for (const b of Array.from(host.querySelectorAll('button'))) b.click();

    expect(events).toEqual(['remind', 'collect', 'receipt']);
    expect(target).toBeInstanceOf(MouseEvent);
  });

  it('鈕高 ≥44px（A27 的 class 版）', async () => {
    await setup(invoice());
    for (const b of Array.from(host.querySelectorAll('button'))) {
      expect(b.className).toContain('h-11');
    }
  });
});
