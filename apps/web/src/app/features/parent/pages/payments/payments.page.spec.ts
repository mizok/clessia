import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentBillingService,
  type ParentInvoice,
  type ParentInvoiceListResponse,
} from '@core/parent-billing.service';
import { SystemClockService } from '@core/system-clock.service';
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
    invoiceNo: 'INV-2608-001',
    issuedAt: '2026-08-01',
    dueDate: '2026-08-15',
    status: 'unpaid',
    total: 5000,
    netPaid: 0,
    voidedAt: null,
    items: [
      {
        id: 'item-1',
        type: 'tuition',
        amount: 5000,
        periodMonth: '2026-08',
        className: '國三數學',
      },
    ],
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
      meta: { total: 0, page: 1, pageSize: 20, totalDue: 0, paymentInfo: [] },
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
        provideRouter([]),
        {
          provide: ChildScopeService,
          useValue: {
            activeChildId: activeChildId.asReadonly(),
            // **不能留 `[]`**：`activeChildId` 只會從 `children[0]` 來，
            // 所以「0 個孩子卻有 activeChildId」是現實中不存在的狀態，
            // 而 `app-child-scope-gate`（#749）會把它擋掉。
            children: () => [{ id: 'child-1', name: '測試孩子' }],
            activeChild: () => null,
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: childScopeLoad,
          },
        },
        { provide: ParentBillingService, useValue: { list: listMock } },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-08-10' } },
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
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 12345, paymentInfo: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    // 千分位（#1444）：12345 讀成「一萬二千三百四十五」要停一下，12,345 不用
    expect(fixture.nativeElement.querySelector('.band-anchor__value')?.textContent?.trim()).toBe(
      '12,345',
    );
  });

  it('列：金額不折行、副行整段換行（#1444，360px 的「3,600／元」）', () => {
    createComponent({
      data: [invoice()],
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 3600, paymentInfo: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.payments__row-amount')?.classList.contains('whitespace-nowrap')).toBe(
      true,
    );
    expect(el.querySelector('.payments__row-meta')?.classList.contains('flex-wrap')).toBe(true);
  });

  // PP1
  it('開場兩個數字：待繳讀 meta.totalDue、本學期已繳讀 meta.term.paid；沒有學期就只畫待繳', () => {
    const meta = { total: 1, page: 1, pageSize: 20, totalDue: 2400, paymentInfo: [] };
    createComponent({
      data: [invoice()],
      meta: {
        ...meta,
        term: { name: '秋季', startDate: '2026-08-01', endDate: '2026-12-31', paid: 44160 },
      },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();
    const values = Array.from(fixture.nativeElement.querySelectorAll('.band-anchor__value')).map(
      (e: unknown) => (e as HTMLElement).textContent?.trim(),
    );
    expect(values).toEqual(['2,400', '44,160']);
    expect(fixture.nativeElement.textContent).toContain('本學期已繳');
    fixture.destroy();
    TestBed.resetTestingModule();

    createComponent({ data: [invoice()], meta: { ...meta, term: null } });
    activeChildId.set('child-1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.band-anchor__value')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain('本學期已繳');
  });

  // PP2
  it('列以班名為主行；部分繳寫「已收／應繳」，期限標籤與帳單編號在副行', () => {
    createComponent({
      data: [
        invoice({
          status: 'partial',
          netPaid: 2000,
          dueDate: '2026-08-15',
          items: [
            { id: 'a', type: 'tuition', amount: 4000, periodMonth: null, className: '國三數學' },
            { id: 'b', type: 'meal', amount: 1000, periodMonth: null, className: null },
          ],
        }),
      ],
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 3000, paymentInfo: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('.payments__row') as HTMLElement;
    expect(row.querySelector('.payments__row-title')?.textContent?.trim()).toBe('國三數學、餐費');
    expect(row.textContent).toContain('部分繳 · 5 天後到期');
    expect(row.textContent).toContain('#INV-2608-001');
    expect(row.querySelector('.payments__row-amount')?.textContent).toContain('3,000 元');
    expect(row.querySelector('.payments__row-amount')?.textContent).toContain(
      '已收 2,000／應繳 5,000',
    );
  });

  it('章頭「待繳／已繳清」；標題句說還要繳多少、最近的期限', () => {
    createComponent({
      data: [invoice({ id: 'a' }), invoice({ id: 'c', status: 'paid', netPaid: 5000 })],
      meta: { total: 2, page: 1, pageSize: 20, totalDue: 5000, paymentInfo: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const names = Array.from(fixture.nativeElement.querySelectorAll('.chapter-head__name')).map(
      (e: unknown) => (e as HTMLElement).textContent?.trim(),
    );
    expect(names).toEqual(['待繳', '已繳清']);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('還要繳');
    expect(text).toContain('5,000 元。');
    expect(text).toContain('最近的期限是 8/15');
  });

  it('unpaid/partial 分進待付款組，paid 分進已付款組，沒有已取消組', () => {
    createComponent({
      data: [
        invoice({ id: 'a', status: 'unpaid' }),
        invoice({ id: 'b', status: 'partial' }),
        invoice({ id: 'c', status: 'paid', netPaid: 5000 }),
      ],
      meta: { total: 3, page: 1, pageSize: 20, totalDue: 5000, paymentInfo: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const sections = fixture.nativeElement.querySelectorAll('.chapter-head__name');
    expect(
      Array.from(sections).map((el: unknown) => (el as HTMLElement).textContent?.trim()),
    ).toEqual(['待繳', '已繳清']);
    expect(fixture.nativeElement.textContent).not.toContain('已取消');
  });

  // #898 裁決 E：看得到、預設收合、不在待付款裡、點開不叫家長付款
  it('作廢單進收合的「已作廢」組，不在待付款裡，詳情不顯示付款方式', () => {
    createComponent({
      data: [
        invoice({ id: 'a', status: 'unpaid' }),
        invoice({ id: 'v0000000-void', status: 'void', voidedAt: '2026-08-20T00:00:00Z' }),
      ],
      meta: { total: 2, page: 1, pageSize: 20, totalDue: 5000, paymentInfo: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const voided = fixture.nativeElement.querySelector('.payments__voided') as HTMLDetailsElement;
    expect(voided).not.toBeNull();
    expect(voided.open).toBe(false);
    expect(voided.textContent).toContain('已作廢');

    const pending = fixture.nativeElement.querySelector('.payments__section') as HTMLElement;
    expect(pending.textContent).toContain('待繳');
    expect(pending.textContent).not.toContain('已作廢');

    (voided.querySelector('.payments__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    const detail = document.body.querySelector('.payments__detail');
    expect(detail?.textContent).toContain('已作廢');
    expect(detail?.textContent).toContain('不需要付款');
    expect(detail?.textContent).not.toContain('付款方式');
  });

  it('點一筆帳單開詳情抽屜，顯示明細但不顯示內部備註或經手人', () => {
    createComponent({
      data: [invoice()],
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 5000, paymentInfo: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.payments__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    // p-drawer 用 appendTo="body"，內容 portal 到 document.body，不在 fixture 底下
    const detail = document.body.querySelector('.payments__detail');
    expect(detail?.textContent).toContain('國三數學');
    expect(detail?.textContent).toContain('5,000');
    // API allowlist 本來就不回 note/recordedBy，這裡確認畫面沒有意外自己補一個
    expect(detail?.textContent).not.toContain('recordedBy');
  });

  // #1073：待付款列補習班帳戶資訊（孩子在籍分校的生效值）；全都沒設定才退回「請洽行政人員」
  it('待付款詳情列帳戶資訊；跨分校多筆時標分校名', () => {
    createComponent({
      data: [invoice()],
      meta: {
        total: 1,
        page: 1,
        pageSize: 20,
        totalDue: 5000,
        paymentInfo: [
          { campusName: '中正', text: '台銀 004\n帳號 111' },
          { campusName: '信義', text: '郵局 700' },
        ],
      },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.payments__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    const detail = document.body.querySelector('.payments__detail');
    expect(detail?.textContent).toContain('台銀 004');
    expect(detail?.textContent).toContain('中正');
    expect(detail?.textContent).toContain('郵局 700');
    expect(detail?.textContent).not.toContain('帳戶資訊請洽補習班行政人員');
  });

  // PP3
  it('帳戶資訊有複製鈕，整段原樣進剪貼簿', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    createComponent({
      data: [invoice()],
      meta: {
        total: 1,
        page: 1,
        pageSize: 20,
        totalDue: 5000,
        paymentInfo: [{ campusName: null, text: '台銀 004\n帳號 111' }],
      },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.payments__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    const btn = document.body.querySelector('.payments__copy') as HTMLButtonElement;
    btn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith('台銀 004\n帳號 111');
    expect(btn.textContent).toContain('已複製');
  });

  it('沒有任何帳戶資訊時照舊請家長洽行政人員', () => {
    createComponent({
      data: [invoice()],
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 5000, paymentInfo: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.payments__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(document.body.querySelector('.payments__detail')?.textContent).toContain(
      '帳戶資訊請洽補習班行政人員',
    );
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
      meta: { total: 1, page: 1, pageSize: 20, totalDue: 0, paymentInfo: [] },
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

  /**
   * #749：**接線測試。** `app-child-scope-gate` 的規則與措辭有自己的測試，
   * 但那不代表這一頁真的包了它 —— **元件寫好了不等於接上了**。
   *
   * 斷言的是「頁面內容在 gate **裡面**」而不只是「gate 存在」：
   * 放一個空的 gate 在旁邊也會讓後者通過，而那什麼都擋不住。
   */
  it('頁面內容包在 app-child-scope-gate 裡（#749）', () => {
    createComponent();
    fixture.detectChanges();

    const gate = fixture.nativeElement.querySelector('app-child-scope-gate');

    expect(gate).toBeTruthy();
    expect(gate.querySelector('.payments__content')).toBeTruthy();
  });
});
