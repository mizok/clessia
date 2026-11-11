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

// #2396 拆單 4（dialog-frame.md「操作量分級」）：底部列最多 1 主＋1 次，其餘進標題旁「⋯」
describe('InvoiceDetailDialog 動作收法（#2396）', () => {
  const payment = {
    id: 'pay-1',
    kind: 'payment',
    amount: 1000,
    method: 'cash',
    paidAt: '2026-10-05',
    note: null,
    receiptNo: 'R-1',
  };
  function mount(over: Partial<Invoice> = {}) {
    const inv = { ...invoice, ...over } as Invoice;
    const voidInvoice = vi.fn(() => of({ data: { ...inv, status: 'void' } }));
    const open = vi.fn();
    TestBed.configureTestingModule({
      imports: [InvoiceDetailDialogComponent],
      providers: [
        MessageService,
        {
          provide: InvoicesService,
          useValue: { get: vi.fn(() => of({ data: detail })), voidInvoice },
        },
        { provide: DialogService, useValue: { open } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { invoice: inv } } },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-10-10') } },
      ],
    });
    const fixture = TestBed.createComponent(InvoiceDetailDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const foot = () =>
      [...el.querySelectorAll('.form-dialog__footer button')].map((b) => b.textContent!.trim());
    const item = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find((b) =>
        b.textContent!.includes(label),
      );
    return { fixture, el, foot, item, voidInvoice, open };
  }

  it('底部列只有「關閉」＋「記錄收款」；記錄收款不再放在收款記錄那一段', () => {
    const { el, foot, open } = mount();
    expect(foot()).toEqual(['關閉', '記錄收款']);
    expect(el.querySelector('.dialog-frame__body')!.textContent).not.toContain('記錄收款');
    el.querySelector<HTMLButtonElement>('[data-testid="invoice-record-payment"] button')!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        header: '記錄收款',
        data: expect.objectContaining({ kind: 'payment' }),
      }),
    );
  });

  it('標題旁「⋯」在 ✕ 左邊；選單有記錄退費、列印收費單、列印收據、作廢帳單，沒收款時退費與收據停用', () => {
    const { el, item } = mount();
    const head = el.querySelector('.dialog-header-inline')!;
    expect(
      [...head.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')),
    ).toEqual(['帳單的更多動作', '關閉']);
    expect(item('記錄退費')!.disabled).toBe(true);
    expect(item('列印收費單')!.disabled).toBe(false);
    expect(item('列印收據')!.disabled).toBe(true);
    expect(item('作廢帳單')).toBeTruthy();
  });

  it('有收款：退費與收據可按，退費開收款對話框', () => {
    const { item, open } = mount({
      payments: [payment] as never,
      netPaid: 1000,
      status: 'partial',
    });
    expect(item('記錄退費')!.disabled).toBe(false);
    expect(item('列印收據')!.disabled).toBe(false);
    item('記錄退費')!.click();
    expect(open).toHaveBeenCalledTimes(1);
    // 開的是「退費」，不是收款（#2419 二讀 V1）
    expect(open.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        header: '記錄退費',
        data: expect.objectContaining({ kind: 'refund' }),
      }),
    );
  });

  // #2419 二讀 V2／V3／V5：兩種列印各自印對的那一份（收費單、收據不互換）
  it('「⋯」的列印收費單印收費單、列印收據印收據', () => {
    const { fixture, item } = mount({
      payments: [payment] as never,
      netPaid: 1000,
      status: 'partial',
    });
    const printNode = vi
      .spyOn(fixture.componentInstance as unknown as { printNode: () => void }, 'printNode')
      .mockImplementation(() => undefined);
    item('列印收費單')!.click();
    expect(printNode).toHaveBeenLastCalledWith(expect.anything(), '收費單');
    item('列印收據')!.click();
    expect(printNode).toHaveBeenLastCalledWith(expect.anything(), '收據');
    expect(printNode).toHaveBeenCalledTimes(2);
  });

  it('已作廢：底部列只剩「關閉」，選單沒有退費與作廢', () => {
    const { foot, item } = mount({ status: 'void' });
    expect(foot()).toEqual(['關閉']);
    expect(item('記錄退費')).toBeUndefined();
    expect(item('作廢帳單')).toBeUndefined();
    expect(item('列印收費單')).toBeTruthy();
  });

  it('作廢：從「⋯」打開後底部列換成 取消＋確認作廢，填理由按一次只作廢一次', () => {
    const { fixture, el, foot, item, voidInvoice } = mount();
    item('作廢帳單')!.click();
    fixture.detectChanges();
    expect(foot()).toEqual(['取消', '確認作廢']);
    const reason = el.querySelector<HTMLTextAreaElement>('#invoice-void-reason')!;
    reason.value = '開錯月份';
    reason.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('.form-dialog__footer button')]
      .find((b) => b.textContent!.includes('確認作廢'))!
      .click();
    expect(voidInvoice).toHaveBeenCalledTimes(1);
    expect(voidInvoice).toHaveBeenCalledWith('inv-1', '開錯月份');
  });

  it('作廢但淨額沒歸零：底部列是 取消＋記錄退費（先退款），沒有確認作廢', () => {
    const { fixture, foot, item } = mount({
      payments: [payment] as never,
      netPaid: 1000,
      status: 'partial',
    });
    item('作廢帳單')!.click();
    fixture.detectChanges();
    expect(foot()).toEqual(['取消', '記錄退費']);
  });
});
