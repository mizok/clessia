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

  it('未繳清：只有收款，沒有收據（「提醒」在 #1625 拿掉）', async () => {
    await setup(invoice());
    expect(labels()).toEqual(['收款']);
  });

  it('繳清：只有收據', async () => {
    await setup(invoice({ status: 'paid', netPaid: 3000, payments: [payment] }));
    expect(labels()).toEqual(['收據']);
  });

  it('部分繳：收款、收據都在', async () => {
    await setup(invoice({ status: 'partial', netPaid: 1000, payments: [payment] }));
    expect(labels()).toEqual(['收款', '收據']);
  });

  it('作廢：一顆都沒有', async () => {
    await setup(invoice({ status: 'void', payments: [payment] }));
    expect(labels()).toEqual([]);
  });

  it('每顆鈕的 aria-label 帶學生名（列表上有很多顆「收款」，要分得出是誰的）', async () => {
    await setup(invoice());
    const names = Array.from(host.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual(['記錄 王小明 的收款']);
  });

  it('收款、收據各發自己的事件', async () => {
    await setup(invoice({ status: 'partial', netPaid: 1000, payments: [payment] }));
    const events: string[] = [];
    fixture.componentInstance.collect.subscribe(() => events.push('collect'));
    fixture.componentInstance.receipt.subscribe(() => events.push('receipt'));

    for (const b of Array.from(host.querySelectorAll('button'))) b.click();

    expect(events).toEqual(['collect', 'receipt']);
  });

  it('鈕高 ≥44px（A27 的 class 版）', async () => {
    await setup(invoice());
    for (const b of Array.from(host.querySelectorAll('button'))) {
      expect(b.className).toContain('h-11');
    }
  });

  describe('compact（A6 帳單章的列）：一顆主要鈕＋「⋯」', () => {
    const setupCompact = async (inv: Invoice) => {
      await TestBed.configureTestingModule({
        imports: [InvoiceActionsComponent],
      }).compileComponents();
      fixture = TestBed.createComponent(InvoiceActionsComponent);
      fixture.componentRef.setInput('invoice', inv);
      fixture.componentRef.setInput('compact', true);
      fixture.detectChanges();
      host = fixture.nativeElement as HTMLElement;
    };
    const overflow = () =>
      (
        fixture.componentInstance as unknown as {
          overflowItems: () => { label: string; command: () => void }[];
        }
      ).overflowItems();

    it('未繳清：主要鈕是「收款」，沒有其他動作所以沒有 ⋯', async () => {
      await setupCompact(invoice());
      expect(labels()).toEqual(['收款']);
      expect(host.querySelector('button[aria-label^="更多"]')).toBeNull();
      expect(overflow()).toEqual([]);
    });

    it('部分繳：收款為主，收據在 ⋯；選單項目發自己的事件', async () => {
      await setupCompact(invoice({ status: 'partial', netPaid: 1000, payments: [payment] }));
      expect(labels()).toEqual(['收款', '']);
      expect(overflow().map((i) => i.label)).toEqual(['收據']);
      const events: string[] = [];
      fixture.componentInstance.collect.subscribe(() => events.push('collect'));
      fixture.componentInstance.receipt.subscribe(() => events.push('receipt'));
      overflow().forEach((i) => i.command());
      expect(events).toEqual(['receipt']);
    });

    it('繳清：只有「收據」一顆，沒有 ⋯', async () => {
      await setupCompact(invoice({ status: 'paid', netPaid: 3000, payments: [payment] }));
      expect(labels()).toEqual(['收據']);
      expect(host.querySelector('button[aria-label^="更多"]')).toBeNull();
    });
  });
});
