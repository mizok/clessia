import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';

import { InvoicesService, type Invoice, type InvoiceDetail } from '@core/invoices.service';
import { SystemClockService } from '@core/system-clock.service';
import { InvoiceDetailDialogComponent } from './invoice-detail-dialog.component';

/** #1625 快速聯絡家長：帳單詳情列出學生的所有家長，撥號／簡訊／email 預先帶好內文 */
const invoice: Invoice = {
  id: 'inv-1',
  orgId: 'org-1',
  studentId: 'stu-1',
  invoiceNo: null,
  studentName: '王小明',
  studentGrade: null,
  issuedAt: '2026-10-01',
  dueDate: '2026-10-15',
  note: null,
  status: 'unpaid',
  total: 4500,
  netPaid: 0,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  items: [],
  payments: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const detail: InvoiceDetail = {
  ...invoice,
  parents: [
    {
      id: 'p1',
      name: '王媽媽',
      relation: '母親',
      phone: '0912-345-678',
      email: null,
      isPrimary: true,
    },
    {
      id: 'p2',
      name: '王爸爸',
      relation: '父親',
      phone: null,
      email: 'dad@example.com',
      isPrimary: false,
    },
  ],
  paymentInfo: [{ campusName: null, text: '總校帳戶 012-3456' }],
};

function setup(get: () => unknown) {
  TestBed.configureTestingModule({
    imports: [InvoiceDetailDialogComponent],
    providers: [
      MessageService,
      { provide: InvoicesService, useValue: { get: vi.fn(get) } },
      { provide: DialogService, useValue: { open: vi.fn() } },
      { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      { provide: DynamicDialogConfig, useValue: { data: { invoice } } },
      { provide: SystemClockService, useValue: { todayTaipei: signal('2026-10-10') } },
    ],
  });
  const fixture = TestBed.createComponent(InvoiceDetailDialogComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('InvoiceDetailDialog 聯絡家長（#1625）', () => {
  it('每位家長一張：撥號、簡訊（?&body= 帶好內文）、email；沒留的寫出來而不是整列消失', () => {
    const el = setup(() => of({ data: detail }));
    const cards = Array.from(el.querySelectorAll('[data-testid="parent-contact"]'));
    expect(cards).toHaveLength(2);

    const mom = cards[0];
    expect(mom.textContent).toContain('王媽媽');
    expect(mom.textContent).toContain('主要聯絡人');
    expect(mom.querySelector('a[href^="tel:"]')?.getAttribute('href')).toBe('tel:0912345678');
    const sms = mom.querySelector('a[href^="sms:"]')?.getAttribute('href') ?? '';
    expect(sms.startsWith('sms:0912345678?&body=')).toBe(true);
    const body = decodeURIComponent(sms.split('body=')[1]);
    expect(body).toContain('王小明');
    expect(body).toContain('NT$4,500');
    expect(body).toContain('10/15');
    expect(body).toContain('總校帳戶 012-3456');
    expect(mom.textContent).toContain('沒有留 email');

    const dad = cards[1];
    expect(dad.textContent).toContain('沒有留電話');
    expect(dad.querySelector('a[href^="tel:"]')).toBeNull();
    expect(dad.querySelector('a[href^="mailto:"]')?.getAttribute('href')).toContain(
      'mailto:dad@example.com?subject=',
    );
  });

  it('沒有催繳表單與紀錄了', () => {
    const el = setup(() => of({ data: detail }));
    expect(el.textContent).not.toContain('催繳記錄');
    expect(el.textContent).not.toContain('記錄催繳');
  });

  it('讀不到聯絡方式：這一塊自己顯示失敗，帳單其餘照常', () => {
    const el = setup(() => throwError(() => new Error('boom')));
    expect(el.textContent).toContain('家長聯絡方式讀不到');
    expect(el.textContent).toContain('收款記錄');
  });

  it('學生沒有登記家長：寫出來', () => {
    const el = setup(() => of({ data: { ...detail, parents: [] } }));
    expect(el.textContent).toContain('這位學生還沒有登記家長');
  });
});
