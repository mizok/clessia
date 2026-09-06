import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentBillingService,
  type ParentInvoice,
  type ParentInvoiceListResponse,
} from '@core/parent-billing.service';
import { PaymentsPage } from './payments.page';

const PAGE = {
  label: '繳費',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

function invoice(overrides: Partial<ParentInvoice> = {}): ParentInvoice {
  return {
    id: 'invoice-uuid-1',
    issuedAt: '2026-08-01',
    dueDate: '2026-08-15',
    status: 'unpaid',
    total: 5000,
    netPaid: 0,
    items: [{ id: 'item-1', type: 'tuition', amount: 5000, periodMonth: '2026-08' }],
    payments: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PaymentsPage', () => {
  let fixture: ComponentFixture<PaymentsPage>;
  let listMock: ReturnType<typeof vi.fn>;
  let activeChildId: ReturnType<typeof signal<string | null>>;
  let childScopeLoad: ReturnType<typeof vi.fn>;

  afterEach(() => {
    document.body.querySelectorAll('.p-drawer').forEach((n) => n.remove());
  });

  function createComponent(
    response: ParentInvoiceListResponse | 'error' = {
      data: [],
      meta: { total: 0, page: 1, pageSize: 20, totalDue: 0 },
    },
  ) {
    activeChildId = signal<string | null>(null);
    childScopeLoad = vi.fn();
    listMock = vi.fn(() =>
      response === 'error' ? throwError(() => new Error('boom')) : of(response),
    );

    TestBed.configureTestingModule({
      imports: [PaymentsPage],
      providers: [
        {
          provide: ChildScopeService,
          useValue: {
            activeChildId: activeChildId.asReadonly(),
            children: () => [],
            activeChild: () => null,
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: childScopeLoad,
          },
        },
        { provide: ParentBillingService, useValue: { list: listMock } },
      ],
    });

    fixture = TestBed.createComponent(PaymentsPage);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
  }

  it('進頁呼叫 childScope.load()', () => {
    createComponent();
    expect(childScopeLoad).toHaveBeenCalledTimes(1);
  });

  it('沒有 activeChildId 時不打 API', () => {
    createComponent();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('activeChildId 出現後打 API', () => {
    createComponent();
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(listMock).toHaveBeenCalledWith({ childId: 'child-1', page: 1, pageSize: 20 });
  });

  it('band anchor 直接用 meta.totalDue，不用前端加總（分頁截斷同型坑）', () => {
    createComponent({
      data: [invoice()],
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 12345 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.band-anchor__value')?.textContent?.trim()).toBe(
      '12345',
    );
  });

  it('unpaid/partial 分進待付款組，paid 分進已付款組，沒有已取消組', () => {
    createComponent({
      data: [
        invoice({ id: 'a', status: 'unpaid' }),
        invoice({ id: 'b', status: 'partial' }),
        invoice({ id: 'c', status: 'paid', netPaid: 5000 }),
      ],
      meta: { total: 3, page: 1, pageSize: 20, totalDue: 5000 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const sections = fixture.nativeElement.querySelectorAll('.payments__section-title');
    expect(Array.from(sections).map((el: unknown) => (el as HTMLElement).textContent)).toEqual([
      '待付款',
      '已付款',
    ]);
    expect(fixture.nativeElement.textContent).not.toContain('已取消');
  });

  it('點一筆帳單開詳情抽屜，顯示明細但不顯示內部備註或經手人', () => {
    createComponent({
      data: [invoice()],
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 5000 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.payments__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    // p-drawer 用 appendTo="body"，內容 portal 到 document.body，不在 fixture 底下
    const detail = document.body.querySelector('.payments__detail');
    expect(detail?.textContent).toContain('學費');
    expect(detail?.textContent).toContain('5,000');
    // API allowlist 本來就不回 note/recordedBy，這裡確認畫面沒有意外自己補一個
    expect(detail?.textContent).not.toContain('recordedBy');
  });

  it('已付款的帳單顯示付款記錄而不是確認人', () => {
    createComponent({
      data: [
        invoice({
          status: 'paid',
          netPaid: 5000,
          payments: [
            {
              id: 'p1',
              kind: 'payment',
              amount: 5000,
              method: 'transfer',
              paidAt: '2026-08-10',
              receiptNo: 1001,
            },
          ],
        }),
      ],
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.payments__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    const detail = document.body.querySelector('.payments__detail');
    expect(detail?.textContent).toContain('轉帳');
    expect(detail?.textContent).toContain('2026-08-10');
    expect(detail?.textContent).not.toContain('確認人');
  });

  it('載入失敗顯示失敗狀態', () => {
    createComponent('error');
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
});
