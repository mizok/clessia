import { MessageService } from 'primeng/api';
import { AppVersionService } from '@core/app-version.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Popover } from 'primeng/popover';
import { format } from 'date-fns';
import { provideRouter } from '@angular/router';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { beforeAll, vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { InvoicesService, type Invoice, type InvoiceSummary } from '@core/invoices.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { CampusContextService } from '@core/campus-context.service';
import { LeaveStreaksService } from '@core/leave-streaks.service';

import { PaymentsPage } from './payments.page';

const invoice = (overrides?: Partial<Invoice>): Invoice => ({
  id: 'inv-1',
  orgId: 'org-1',
  studentId: 'stu-1',
  invoiceNo: null,
  studentName: '陳小明',
  studentGrade: null,
  issuedAt: '2026-08-01',
  dueDate: '2026-08-15',
  note: null,
  status: 'unpaid',
  total: 4500,
  netPaid: 0,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  items: [],
  payments: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

/**
 * `meta.total` 是**篩後全體**的筆數，不是當頁長度（PR #64 修正）——
 * 所以 mock 要能分開表達「這一頁回幾筆」與「總共幾筆」。
 */
const listResponse = (rows: Invoice[], total = rows.length, page = 1) => ({
  data: rows,
  meta: { total, page, pageSize: 20 },
});

const summary = (overrides?: Partial<InvoiceSummary>): InvoiceSummary => ({
  byStatus: {
    unpaid: { count: 5, outstanding: 20000 },
    partial: { count: 2, outstanding: 6000 },
    paid: { count: 16, received: 151700 },
    overrefunded: { count: 1 },
    void: { count: 3 },
  },
  overdue: { count: 4, outstanding: 15000 },
  // 三章聯集＝unpaid＋partial（7 張／26000），同後端的不變量
  dueSoon: { count: 2, outstanding: 6000, days: 7 },
  notDue: { count: 1, outstanding: 5000 },
  outstanding: 26000,
  month: { month: '2026-10', billed: 200000, received: 150000 },
  ...overrides,
});

describe('PaymentsPage', () => {
  let component: PaymentsPage;
  let fixture: ComponentFixture<PaymentsPage>;

  const invoices = {
    list: vi.fn((_params?: unknown) => of(listResponse([]))),
    summary: vi.fn((_params?: unknown) => of(summary())),
    get: vi.fn(),
    create: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    recordPayment: vi.fn(),
  };

  const enrollments = {
    list: vi.fn((_params?: unknown) => of({ data: [], meta: { total: 0 } })),
  };

  const leaveStreaks = { flags: vi.fn((_ids: readonly string[]) => of({ data: [] as unknown[] })) };

  /** 重設替身、建 TestBed 與元件、等第一次渲染完 —— beforeEach 與暖機共用 */
  async function mount() {
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    enrollments.list.mockReset().mockReturnValue(of({ data: [], meta: { total: 0 } }));
    invoices.list.mockReset().mockReturnValue(of(listResponse([])));
    invoices.summary.mockReset().mockReturnValue(of(summary()));

    await TestBed.configureTestingModule({
      imports: [PaymentsPage],
      providers: [
        MessageService,
        provideRouter([]),
        { provide: InvoicesService, useValue: invoices },
        { provide: EnrollmentsService, useValue: enrollments },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        { provide: LeaveStreaksService, useValue: leaveStreaks },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaymentsPage);
    fixture.componentRef.setInput('page', { label: '繳費紀錄' });
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  // 第一次渲染的固定成本（模板程式碼第一次執行、PrimeNG 第一次注入元件樣式）是之後的數倍，
  // 全算在第一條測試頭上，高負載時逼近 5s 逾時（不穩定測試盤點 B）。先在 beforeAll 渲染一次暖機：
  // hookTimeout 10s，不算進任何一條的 5s；渲染完就拆掉，不留狀態給測試（替身在 mount 開頭就重設）
  beforeAll(async () => {
    await mount();
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  beforeEach(mount);

  it('日常頁：頂欄沒有「全部分校」（#1607）', () => {
    const ctx = TestBed.inject(CampusContextService);
    expect(ctx.inUse()).toBe(true);
    expect(ctx.allowAll()).toBe(false);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('進頁就取第一頁帳單', () => {
    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
  });

  // 沒有篩選時是章節模式：主清單就是逾期章，所以送 overdue=true、不送 status
  it('預設（章節模式）只取逾期那一章，不送 status 與 search', () => {
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: true, status: undefined, search: undefined }),
    );
  });

  it('動了舊的篩選就回到平面表：狀態篩選不再被強加 overdue', () => {
    invoices.list.mockClear();

    component['onStatusChange']('paid');

    expect(component['chapterMode']()).toBe(false);
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paid', overdue: undefined }),
    );
  });

  it('切到只看欠繳會帶 overdue=true 重新取數', () => {
    invoices.list.mockClear();

    component['setDueFilter']('overdue');

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ overdue: true }));
  });

  /**
   * #639:舊的兩態切換鈕寫「只看欠繳」而做的是「逾期且未繳清」——
   * **照它催繳會漏掉還沒到期的未繳**(驗收:逾期 9、未繳未逾期 8、未繳清 17)。
   *
   * 這組守的是**三選一各自送出正確的參數**。為什麼要逐個斷言而不只測一個:
   * 三者長得像(都是催繳、都篩未繳清),**送錯參數的畫面看起來完全正常** ——
   * 它會給你一份合理長度的清單,只是成員是別的子集。
   */
  it.each([
    ['outstanding', { outstanding: true }],
    ['dueSoon', { dueState: 'dueSoon' }],
    ['overdue', { overdue: true }],
  ] as const)('三選一:%s 送出對應的參數', (filter, expected) => {
    invoices.list.mockClear();

    component['setDueFilter'](filter);

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  // 營收報表的「看逾期帳單」（#1314 RP3）帶 ?due= 進來
  it('?due=overdue 一進頁就是只看逾期', () => {
    const f = TestBed.createComponent(PaymentsPage);
    f.componentRef.setInput('page', { label: '繳費紀錄' });
    f.componentRef.setInput('due', 'overdue');
    invoices.list.mockClear();

    f.detectChanges();

    expect(f.componentInstance['dueFilter']()).toBe('overdue');
    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ overdue: true }));
  });

  it('?due= 不認得的值忽略，不是亂套', () => {
    const f = TestBed.createComponent(PaymentsPage);
    f.componentRef.setInput('page', { label: '繳費紀錄' });
    f.componentRef.setInput('due', 'whatever');

    f.detectChanges();

    expect(f.componentInstance['dueFilter']()).toBe('all');
  });

  it('三選一是互斥的 —— 切到別的不會把前一個留著', () => {
    component['setDueFilter']('overdue');
    invoices.list.mockClear();

    component['setDueFilter']('outstanding');

    // **前一個要真的消失,不是變成 false** —— `overdue: false` 在 toQuery 會被
    // 當成沒給,所以行為上一樣;但留著它等於讓兩個篩選同時存在於狀態裡,
    // 下一個讀這段的人會以為它們可以並用
    expect(invoices.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ outstanding: true, overdue: undefined }),
    );
  });

  describe('搜尋框（學生名、家長名、帳單編號 → 後端 search）', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('打帳單編號：節流 300ms 後以 search 打後端，回第 1 頁、離開章節模式', () => {
      invoices.list.mockClear();

      component['onSearchChange']('INV-2610-012');
      vi.advanceTimersByTime(299);
      expect(invoices.list).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(invoices.list).toHaveBeenCalledTimes(1);
      expect(invoices.list).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'INV-2610-012', page: 1, overdue: undefined }),
      );
      expect(component['chapterMode']()).toBe(false);
    });

    it('只有空白不算搜尋', () => {
      invoices.list.mockClear();
      component['onSearchChange']('   ');
      vi.advanceTimersByTime(300);
      expect(invoices.list).not.toHaveBeenCalled();
    });

    it('亂序：先發的搜尋後到，不蓋掉新的結果（switchMap）', () => {
      const first = new Subject<ReturnType<typeof listResponse>>();
      const second = new Subject<ReturnType<typeof listResponse>>();
      invoices.list.mockReset().mockReturnValueOnce(first).mockReturnValueOnce(second);

      component['onSearchChange']('陳');
      vi.advanceTimersByTime(300);
      component['onSearchChange']('陳小明');
      vi.advanceTimersByTime(300);

      second.next(listResponse([invoice({ id: 'new', studentName: '陳小明' })]));
      first.next(listResponse([invoice({ id: 'old', studentName: '陳大華' })], 9));

      expect(component['invoices']().map((i) => i.id)).toEqual(['new']);
      expect(component['totalRecords']()).toBe(1);
    });
  });

  it('換篩選條件時回到第一頁', () => {
    component['onPageChange']({ first: 20, rows: 20, page: 1, pageCount: 3 });
    expect(component['pageIndex']()).toBe(2);

    component['setDueFilter']('overdue');

    expect(component['pageIndex']()).toBe(1);
  });

  // total 是篩後全體，分頁器要拿它算總頁數 —— 拿當頁長度算會永遠只有一頁
  it('分頁總數取 meta.total，不是當頁筆數', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => invoice({ id: `inv-${i}` }));
    invoices.list.mockReturnValue(of(listResponse(rows, 137)));
    component['load']();
    await fixture.whenStable();

    expect(component['pagination']().totalRecords).toBe(137);
  });

  it('翻頁會帶新的 page 重打 API', async () => {
    invoices.list.mockClear().mockReturnValue(of(listResponse([invoice()], 137)));

    component['onPageChange']({ first: 40, rows: 20, page: 2, pageCount: 7 });
    await fixture.whenStable();

    expect(component['pageIndex']()).toBe(3);
    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));
  });

  // 狀態是推導值，前端篩只篩得到當頁 —— 一定要打後端
  it('狀態篩選打後端，不在前端篩', () => {
    invoices.list.mockClear();

    component['onStatusChange']('partial');

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'partial' }));
  });

  it('狀態清成全部時不送 status', () => {
    component['onStatusChange']('paid');
    invoices.list.mockClear();

    component['onStatusChange'](null);

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });

  // 逾期是衍生標記不是第四種狀態，兩個條件並用是常見組合（billing-rules 規則 4）
  it('狀態與欠繳可以並用', () => {
    component['onStatusChange']('partial');
    invoices.list.mockClear();

    component['setDueFilter']('overdue');

    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial', overdue: true }),
    );
  });

  it('取數失敗時把總數歸零，不留上一次的數字', async () => {
    invoices.list.mockReturnValue(of(listResponse([invoice()], 137)));
    component['load']();
    await fixture.whenStable();
    expect(component['pagination']().totalRecords).toBe(137);

    invoices.list.mockReturnValue(throwError(() => new Error('boom')));
    component['load']();
    await fixture.whenStable();

    expect(component['pagination']().totalRecords).toBe(0);
  });

  // 整頁空白比一個錯誤訊息更難查 —— 失敗要看得見
  it('取數失敗時顯示失敗狀態而不是空清單', async () => {
    invoices.list.mockReturnValue(throwError(() => new Error('boom')));
    component['load']();
    await fixture.whenStable();

    expect(component['failed']()).toBe(true);
    expect(component['loading']()).toBe(false);
  });

  it('重試會再打一次 API', async () => {
    invoices.list.mockReturnValue(throwError(() => new Error('boom')));
    component['load']();
    await fixture.whenStable();

    invoices.list.mockClear().mockReturnValue(of(listResponse([invoice()])));
    component['load']();
    await fixture.whenStable();

    expect(invoices.list).toHaveBeenCalledTimes(1);
    expect(component['failed']()).toBe(false);
  });

  it('清除篩選會同時清掉欠繳、狀態與搜尋', () => {
    component['setDueFilter']('overdue');
    component['onStatusChange']('unpaid');
    component['searchQuery'].set('陳');
    invoices.list.mockClear();

    component['clearFilters']();

    expect(component['overdueOnly']()).toBe(false);
    expect(component['statusFilter']()).toBeNull();
    expect(component['searchQuery']()).toBe('');
    // 清完回到章節模式：主清單又是逾期章
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: true, status: undefined, search: undefined }),
    );
  });

  describe('狀態顏色', () => {
    it('繳清是綠的', () => {
      expect(component['statusTone'](invoice({ status: 'paid' }))).toBe('done');
    });

    it('部分繳是黃的', () => {
      // 部分繳仍然是「還在等」—— 逾期與否由旁邊那顆獨立標記說，不塞進這裡
      expect(component['statusTone'](invoice({ status: 'partial' }))).toBe('pending');
    });

    it('未繳是紅的', () => {
      expect(component['statusTone'](invoice({ status: 'unpaid' }))).toBe('pending');
    });
  });

  // 開完帳最常見的下一步就是收錢（新生報名當場繳定金）
  it('開帳成功後直接打開那張帳單的詳情', () => {
    const opened: unknown[] = [];
    const dialogService = (component as unknown as { dialogService: { open: unknown } })
      .dialogService as { open: (c: unknown, cfg: { data?: unknown }) => unknown };
    const originalOpen = dialogService.open.bind(dialogService);
    dialogService.open = (c: unknown, cfg: { data?: unknown }) => {
      opened.push(cfg?.data);
      return { onClose: of(undefined) };
    };

    const created = invoice({ id: 'inv-new' });
    (component as unknown as { openDetail: (i: Invoice) => void }).openDetail(created);

    expect(opened).toHaveLength(1);
    expect((opened[0] as { invoice: Invoice }).invoice.id).toBe('inv-new');
    dialogService.open = originalOpen;
  });
  describe('#1314 P1／P2 逾期章、已繳清章與色面', () => {
    const text = () =>
      (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
    const render = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('色面：本月應收與已收幾成（billed=0 不除）', async () => {
      await render();
      expect(text()).toContain('10 月應收 NT$ 200,000');
      expect(text()).toContain('已收 75%');
      expect(component['stillOwed']()).toBe(50000);

      invoices.summary.mockReturnValue(
        of(summary({ month: { month: '2026-10', billed: 0, received: 0 } })),
      );
      component['loadSummary']();
      await render();
      expect(component['receivedPct']()).toBeNull();
      expect(text()).not.toContain('NaN');
    });

    it('彙總失敗時退回頁名，不擋清單', async () => {
      invoices.summary.mockReturnValue(throwError(() => new Error('boom')));
      component['loadSummary']();
      await render();
      expect(component['summary']()).toBeNull();
      expect(text()).toContain('繳費紀錄');
    });

    it('章名數字直接用彙總：逾期、7 天內到期、還沒到期各自的張數與待收，已繳清＝繳清＋多退', async () => {
      invoices.list.mockReturnValue(of(listResponse([invoice()], 4)));
      component['load']();
      await render();
      expect(text()).toContain('4 張 · 待收 NT$ 15,000');
      expect(text()).toContain('7 天內到期');
      expect(text()).toContain('2 張 · 待收 NT$ 6,000');
      expect(text()).toContain('未到期');
      expect(text()).not.toContain('還沒到期');
      expect(text()).toContain('1 張 · 待收 NT$ 5,000');
      const paid = component['chapterList']().find((c) => c.key === 'paid');
      expect(paid?.count).toBe(17);
      // 已繳清章寫「收到」（後端加總的繳清淨收），不是「待收」
      expect(text()).toContain('17 張 · 收到 NT$ 151,700');
      // 三章都是共用的摺疊摘要列（#1705）；箭頭由 .coll__sum::after 畫，不再用圖示
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '.colls > details.coll > summary.coll__sum',
        ).length,
      ).toBe(3);
      // 順序照 A6
      expect(component['chapterList']().map((c) => c.key)).toEqual(['dueSoon', 'notDue', 'paid']);
    });

    it('章名的天數讀 summary.dueSoon.days，不是前端寫死的 7', async () => {
      invoices.summary.mockReturnValue(
        of(summary({ dueSoon: { count: 2, outstanding: 6000, days: 10 } })),
      );
      component['loadSummary']();
      await render();
      expect(text()).toContain('10 天內到期');
      expect(text()).not.toContain('7 天內到期');
      expect('DUE_SOON_DAYS' in component).toBe(false);
    });

    it('張數為 0 的章不畫；沒有彙總時一章都不畫', async () => {
      invoices.summary.mockReturnValue(of(summary({ notDue: { count: 0, outstanding: 0 } })));
      component['loadSummary']();
      await render();
      expect(component['chapterList']().map((c) => c.key)).toEqual(['dueSoon', 'paid']);

      invoices.summary.mockReturnValue(throwError(() => new Error('boom')));
      component['loadSummary']();
      await render();
      expect(component['chapterList']()).toEqual([]);
    });

    it.each(['dueSoon', 'notDue'] as const)(
      '%s 章收著，展開才抓，且送 dueState（互斥章篩選）',
      async (key) => {
        await render();
        invoices.list.mockClear();
        expect(invoices.list).not.toHaveBeenCalled();

        component['onChapterToggle'](key, true);
        await render();

        expect(invoices.list).toHaveBeenCalledWith(
          expect.objectContaining({ dueState: key, page: 1, pageSize: 20 }),
        );
        expect(component['chapters']()[key].open).toBe(true);
        // 其他章不受影響
        expect(component['chapters']().paid.open).toBe(false);
      },
    );

    it('已繳清章收著：展開才抓；多退排在繳清前面', async () => {
      await render();
      invoices.list.mockClear();
      invoices.list.mockImplementation(((p: { status?: string }) =>
        of(
          p.status === 'overrefunded'
            ? listResponse([invoice({ id: 'over', status: 'overrefunded', netPaid: -300 })])
            : listResponse([invoice({ id: 'paid', status: 'paid', netPaid: 4500 })]),
        )) as never);

      component['onChapterToggle']('paid', true);
      await render();

      expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
      expect(invoices.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'overrefunded' }),
      );
      expect(component['chapters']().paid.rows.map((i) => i.id)).toEqual(['over', 'paid']);
      expect(component['dueText'](invoice({ status: 'overrefunded', netPaid: -300 }))).toBe('多退');
      expect(component['chapterAmount'](invoice({ status: 'overrefunded', netPaid: -300 }))).toBe(
        300,
      );
    });

    it('到期兩章的列文字：今天到期、N 天後到期、M/D 到期、沒有到期日', async () => {
      await render();
      const today = component['today']();
      const plus = (n: number) => {
        const d = new Date(`${today}T12:00:00`);
        d.setDate(d.getDate() + n);
        return format(d, 'yyyy-MM-dd');
      };
      const text = (dueDate: string | null) =>
        component['dueText'](invoice({ status: 'unpaid', dueDate }));
      expect(text(today)).toBe('今天到期');
      expect(text(plus(3))).toBe('3 天後到期');
      expect(text(plus(7))).toBe('7 天後到期');
      expect(text(plus(8))).toMatch(/^\d+\/\d+ 到期$/);
      expect(text(null)).toBe('未設定到期日');
    });

    it('逾期章的「逾期 N 天」用台北今天算', async () => {
      const today = component['today']();
      const y = +today.slice(0, 4);
      const due = `${y - 1}-${today.slice(5)}`;
      const days = component['dueText'](invoice({ dueDate: due }));
      expect(days).toMatch(/^逾期 36[56] 天$/);
    });

    it('已作廢那一行：點「顯示」切到 status=void 的平面表', async () => {
      await render();
      expect(text()).toContain('另有 3 張已作廢');
      invoices.list.mockClear();

      component['onStatusChange']('void');

      expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'void' }));
    });
  });
  describe('#1314 殘差 PR-1：工具列與章頭', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const rows = () => [
      invoice({ id: 'inv-1', dueDate: '2020-01-01' }),
      invoice({ id: 'inv-2', dueDate: '2020-01-01' }),
    ];

    it('搜尋框 placeholder 照稿，且不再有學生自動完成', () => {
      fixture.detectChanges();
      const input = el().querySelector('input[aria-label="搜尋帳單"]') as HTMLInputElement;
      expect(input.placeholder).toBe('找學生、家長或帳單編號');
      expect(el().querySelector('app-student-autocomplete')).toBeNull();
    });

    it('逾期章頭沒有「全部提醒」（#1625：催繳紀錄拿掉，聯絡家長改在帳單詳情）', async () => {
      invoices.list.mockReturnValue(of(listResponse(rows())));
      component['load']();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().textContent).not.toContain('全部提醒');
    });

    it('匯出預設當月（台北今天所在月），檔名與範圍寫進檔名；逾期範圍送 overdue', async () => {
      const writeFile = vi.fn();
      vi.doMock('xlsx', () => ({
        utils: {
          json_to_sheet: vi.fn(() => ({})),
          book_new: vi.fn(() => ({})),
          book_append_sheet: vi.fn(),
        },
        writeFile,
      }));
      const month = component['systemClock'].todayTaipei().slice(0, 7);
      expect(component['exportMonth']()).toBe(month);
      component['exportScope'].set('overdue');
      invoices.list.mockClear();
      invoices.list.mockReturnValue(of(listResponse(rows())));

      await component['exportInvoices']({ hide: vi.fn() } as never);

      expect(invoices.list).toHaveBeenCalledWith(
        expect.objectContaining({
          issuedMonth: month,
          overdue: true,
          outstanding: undefined,
          pageSize: 200,
        }),
      );
      expect(writeFile).toHaveBeenCalledWith(expect.anything(), `帳單_${month}_只有逾期.xlsx`);
      vi.doUnmock('xlsx');
    });

    // #1718：部署後的舊分頁按匯出，xlsx 的 chunk 已經不在 —— 顯示新版提示條，不是「匯出失敗，請稍後再試」
    it('匯出撞到舊版 chunk：亮新版提示條，不跳「匯出失敗」', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const toasts: { severity: string }[] = [];
      vi.spyOn(component['messageService'], 'add').mockImplementation((m) => {
        toasts.push(m as { severity: string });
      });
      invoices.list.mockClear();
      invoices.list.mockReturnValue(
        throwError(() => new TypeError('Failed to fetch dynamically imported module: /x.js')),
      );

      await component['exportInvoices']({ hide: vi.fn() } as never);

      expect(TestBed.inject(AppVersionService).isStale()).toBe(true);
      expect(toasts.filter((t) => t.severity === 'error')).toEqual([]);
      expect(component['exporting']()).toBe(false);
    });

    it('匯出超過一頁：用 meta.total 判斷收完', async () => {
      vi.doMock('xlsx', () => ({
        utils: {
          json_to_sheet: vi.fn(() => ({})),
          book_new: vi.fn(() => ({})),
          book_append_sheet: vi.fn(),
        },
        writeFile: vi.fn(),
      }));
      invoices.list.mockClear();
      invoices.list
        .mockReturnValueOnce(of(listResponse(rows(), 3)))
        .mockReturnValueOnce(of(listResponse([invoice({ id: 'inv-3' })], 3, 2)));

      await component['exportInvoices']({ hide: vi.fn() } as never);

      expect(invoices.list).toHaveBeenCalledTimes(2);
      expect(invoices.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
      vi.doUnmock('xlsx');
    });
  });

  describe('手機「篩選：全部」面板（#1314 ③）', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const toggle = () => el().querySelector('app-filter-toggle button') as HTMLButtonElement;
    // 面板是 Popover（A6 浮層）：沒打開時內容不在 DOM，打開後掛在 body 上
    const panel = () => document.body.querySelector('#payments-filters') as HTMLElement | null;

    it('預設收合（面板不在 DOM）、鈕寫「篩選：全部」；點開後浮層出現、aria-expanded 跟著走', () => {
      fixture.detectChanges();
      expect(toggle().textContent).toContain('篩選：全部');
      expect(panel()).toBeNull();

      toggle().click();
      fixture.detectChanges();
      expect(panel()).not.toBeNull();
      expect(el().contains(panel())).toBe(false); // 浮層，不在頁面內（不推動清單）
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
    });

    it('點浮層外面關掉後，「篩選」鈕的 aria-expanded 回到 false（onHide 回寫）', () => {
      fixture.detectChanges();
      toggle().click();
      fixture.detectChanges();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');

      // 外點擊由 Popover 自己關：直接呼叫它的 hide()，會發 onHide
      // 頁上還有匯出的 Popover，挑開著的那個
      fixture.debugElement
        .queryAll(By.directive(Popover))
        .map((d) => d.injector.get(Popover))
        .find((p) => p.overlayVisible)!
        .hide();
      fixture.detectChanges();
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('摘要＝催繳＋狀態的條件（沒有就「全部」）', () => {
      const c = component as unknown as {
        setDueFilter: (v: string) => void;
        onStatusChange: (v: string | null) => void;
      };
      c.setDueFilter('overdue');
      fixture.detectChanges();
      expect(toggle().textContent).toContain('篩選：已逾期');

      c.onStatusChange('unpaid');
      fixture.detectChanges();
      expect(toggle().textContent).toMatch(/篩選：已逾期、/);
    });
  });
  describe('#1314 列：收款／收據，整列不可點（A6；「提醒」在 #1625 拿掉）', () => {
    type Internals = {
      dialogService: { open: (c: unknown, cfg: { data?: unknown }) => unknown };
      messageService: { add: (m: { severity: string; detail?: string }) => void };
      primaryAction: { label: string };
      collect: (i: Invoice) => void;
    };
    const internals = () => component as unknown as Internals;
    const el = () => fixture.nativeElement as HTMLElement;
    const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
    const render = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const toasts: { severity: string; detail?: string }[] = [];
    let dialogData: unknown[] = [];
    let dialogResult: unknown = undefined;

    beforeEach(() => {
      toasts.length = 0;
      dialogData = [];
      dialogResult = undefined;
      internals().messageService.add = (m) => toasts.push(m);
      internals().dialogService.open = (_c, cfg) => {
        dialogData.push(cfg?.data);
        return { onClose: of(dialogResult) };
      };
    });

    const overdueRows = () => [
      invoice({ id: 'inv-1', studentId: 'stu-1', studentName: '陳小明', dueDate: '2020-01-01' }),
      invoice({ id: 'inv-2', studentId: 'stu-2', studentName: '林小美', dueDate: '2020-01-01' }),
    ];
    const loadOverdue = async (rows = overdueRows()) => {
      invoices.list.mockReturnValue(of(listResponse(rows, rows.length)));
      component['load']();
      await render();
    };

    // #1732：連續請假滿 N 個上課日還沒處理 → 名字旁「連請 N 天」，連到學生檔案的帳單章
    it('連續請假小標：只問畫面上的學生、有未處理的段才畫，連到 #billing', async () => {
      leaveStreaks.flags.mockClear();
      leaveStreaks.flags.mockReturnValue(
        of({
          data: [{ studentId: 'stu-2', firstDay: '2026-10-14', lastDay: '2026-10-16', days: 3 }],
        }),
      );
      await loadOverdue();
      await new Promise((resolve) => setTimeout(resolve, 80)); // debounce
      fixture.detectChanges();

      expect(leaveStreaks.flags).toHaveBeenLastCalledWith(['stu-1', 'stu-2']);
      const pills = el().querySelectorAll('[data-testid="streak-pill"]');
      expect(pills).toHaveLength(1);
      expect(pills[0]!.textContent).toContain('連請 3 天');
      expect(pills[0]!.getAttribute('href')).toBe('/admin/students/stu-2#billing');
    });

    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 80)); // debounce
      fixture.detectChanges();
    };
    const pills = () => [...el().querySelectorAll('[data-testid="streak-pill"]')];

    it('連續請假：API 一次最多 100 個 → 101 位學生分兩批（100＋1）', async () => {
      leaveStreaks.flags.mockClear();
      leaveStreaks.flags.mockReturnValue(of({ data: [] }));
      const rows = Array.from({ length: 101 }, (_, n) =>
        invoice({
          id: `inv-${n}`,
          studentId: `stu-${String(n).padStart(3, '0')}`,
          dueDate: '2020-01-01',
        }),
      );
      await loadOverdue(rows);
      await settle();
      const sizes = leaveStreaks.flags.mock.calls.slice(-2).map(([ids]) => ids.length);
      expect(sizes).toEqual([100, 1]);
    });

    it('同一位學生兩段（3 天、5 天）：小標寫最大的 5', async () => {
      leaveStreaks.flags.mockReturnValue(
        of({
          data: [
            { studentId: 'stu-1', firstDay: '2026-09-01', lastDay: '2026-09-03', days: 5 },
            { studentId: 'stu-1', firstDay: '2026-10-14', lastDay: '2026-10-16', days: 3 },
          ],
        }),
      );
      await loadOverdue();
      await settle();
      expect(pills().map((p) => p.textContent!.trim())).toEqual(['連請 5 天']);
    });

    it('查詢失敗一次之後，學生換了照常再抓、會畫（失敗不能讓整條訂閱斷掉）', async () => {
      leaveStreaks.flags.mockReturnValueOnce(throwError(() => new Error('x')));
      await loadOverdue();
      await settle();
      expect(pills()).toHaveLength(0);

      leaveStreaks.flags.mockReturnValue(
        of({
          data: [{ studentId: 'stu-9', firstDay: '2026-10-14', lastDay: '2026-10-16', days: 3 }],
        }),
      );
      await loadOverdue([invoice({ id: 'inv-9', studentId: 'stu-9', dueDate: '2020-01-01' })]);
      await settle();
      expect(pills()).toHaveLength(1);
    });

    it('連續請假查詢失敗：不畫小標，帳單照常', async () => {
      leaveStreaks.flags.mockReturnValue(throwError(() => new Error('x')));
      await loadOverdue();
      await new Promise((resolve) => setTimeout(resolve, 80));
      fixture.detectChanges();
      expect(el().querySelectorAll('[data-testid="streak-pill"]')).toHaveLength(0);
      expect(el().querySelector('a[href="/admin/students/stu-1"]')).not.toBeNull();
    });

    it('姓名連到學生檔案；整列不是按鈕，沒有「的帳單詳情」那顆整列可點的鈕', async () => {
      await loadOverdue();

      const link = el().querySelector('a[href="/admin/students/stu-1"]');
      expect(link?.textContent).toContain('陳小明');
      expect(el().querySelector('button[aria-label$="的帳單詳情"]')).toBeNull();
      expect(el().querySelectorAll('app-invoice-actions')).toHaveLength(2);
    });

    it('姓名旁有年級（中文標籤）；逾期是「！」圈圈圖示；金額加大加粗；列上只有一顆主要鈕＋⋯', async () => {
      await loadOverdue([invoice({ studentGrade: 'J3', dueDate: '2020-01-01' })]);

      // A6：年級在連結外（連結只有名字），14px 灰
      expect(el().querySelector('li a')?.textContent?.trim()).toBe('陳小明');
      expect(el().querySelector('li a + span')?.textContent?.trim()).toBe('· 國三');
      // 逾期：紅字加粗＋「！」圈圈圖示（A6 span 是 inline-flex gap 4，內含圖示），金額 16px 600
      expect(el().querySelector('li .pi-exclamation-circle')).not.toBeNull();
      expect(el().querySelector('li .pi-times-circle')).toBeNull();
      const due = el().querySelector('li .text-error-700.font-semibold');
      expect(due?.textContent).toContain('逾期');
      expect(el().querySelector('li .text-lg.font-semibold')?.textContent).toContain('4,500');
      const buttons = Array.from(el().querySelectorAll('li app-invoice-actions button')).map((b) =>
        b.textContent?.trim(),
      );
      expect(buttons).toEqual(['收款']);
    });

    it('年級不認得就不顯示原始代碼', async () => {
      await loadOverdue([invoice({ studentGrade: 'zzz', dueDate: '2020-01-01' })]);
      expect(el().querySelector('li a')?.textContent).not.toContain('zzz');
    });

    it('列上沒有「還沒提醒／N 天前提醒」，手機托盤只剩「開立帳單」（#1625）', async () => {
      await loadOverdue();
      expect(text()).not.toContain('提醒');
      expect(internals().primaryAction.label).toBe('開立帳單');
    });

    it('收款：直接開收款表單（kind=payment），收完重取列表', async () => {
      await loadOverdue();
      const calls = invoices.list.mock.calls.length;
      dialogResult = invoice({ id: 'inv-1' });

      internals().collect(overdueRows()[0]);

      expect((dialogData[0] as { kind: string }).kind).toBe('payment');
      expect((dialogData[0] as { invoice: Invoice }).invoice.id).toBe('inv-1');
      expect(invoices.list.mock.calls.length).toBeGreaterThan(calls);
    });

    it('收款視窗直接關掉（沒收）就不重取', async () => {
      await loadOverdue();
      const calls = invoices.list.mock.calls.length;
      dialogResult = undefined;

      internals().collect(overdueRows()[0]);

      expect(invoices.list.mock.calls.length).toBe(calls);
    });
  });

  /**
   * #1314 帳單殼層：接頂欄分校。列表、摘要、展開的章、待開帳數、匯出都帶同一個 `campusId`；
   * 換分校頁碼歸 1 並整頁重抓；**每條取數都是 `switchMap`**，快切時慢的舊分校回應不能蓋掉新的。
   */
  describe('頂欄分校（#1314）', () => {
    const pick = async (id: string | null) => {
      TestBed.inject(CampusContextService).select(id);
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const lastCall = (m: { mock: { calls: unknown[][] } }) =>
      m.mock.calls[m.mock.calls.length - 1]![0] as Record<string, unknown>;

    it('頁面接上頂欄（use）：頂欄才會出現分校下拉', () => {
      expect(TestBed.inject(CampusContextService).inUse()).toBe(true);
    });

    it('初次載入沒選分校：列表、摘要、待開帳數都不帶 campusId', () => {
      expect(
        invoices.list.mock.calls.every(
          (c) => (c[0] as { campusId?: string }).campusId === undefined,
        ),
      ).toBe(true);
      expect(invoices.summary).toHaveBeenCalledWith({ campusId: undefined });
      expect(lastCall(enrollments.list)['campusId']).toBeUndefined();
    });

    it('選分校：列表、摘要、待開帳數都帶 campusId，頁碼歸 1', async () => {
      component['pageIndex'].set(3);
      await pick('c1');
      expect(lastCall(invoices.list)).toMatchObject({ campusId: 'c1', page: 1 });
      expect(invoices.summary).toHaveBeenLastCalledWith({ campusId: 'c1' });
      expect(lastCall(enrollments.list)).toMatchObject({ campusId: 'c1', hasInvoice: false });
      expect(component['pageIndex']()).toBe(1);
    });

    it('日常頁沒有「全部分校」（#1607）：選擇被清成 null 仍帶上次那間', async () => {
      await pick('c1');
      await pick(null);
      expect(lastCall(invoices.list)['campusId']).toBe('c1');
      expect(invoices.summary).toHaveBeenLastCalledWith({ campusId: 'c1' });
      expect(lastCall(enrollments.list)['campusId']).toBe('c1');
    });

    it('展開的章跟著換分校：頁碼歸 1、含已繳清章的多退那支；沒展開的章不多打', async () => {
      component['onChapterToggle']('dueSoon', true);
      component['onChapterToggle']('paid', true);
      component['patchChapter']('dueSoon', { page: 2 });
      invoices.list.mockClear();
      await pick('c2');
      const calls = invoices.list.mock.calls.map((c) => c[0] as Record<string, unknown>);
      const dueSoon = calls.filter((c) => c['dueState'] === 'dueSoon');
      expect(dueSoon).toHaveLength(1);
      expect(dueSoon[0]).toMatchObject({ campusId: 'c2', page: 1 });
      const paid = calls.filter((c) => c['status'] === 'paid');
      expect(paid[0]).toMatchObject({ campusId: 'c2', page: 1 });
      const over = calls.filter((c) => c['status'] === 'overrefunded');
      expect(over[0]).toMatchObject({ campusId: 'c2' });
      // 沒展開的「未到期」章不多打
      expect(calls.filter((c) => c['dueState'] === 'notDue')).toHaveLength(0);
    });

    it('匯出帶畫面上的分校', async () => {
      await pick('c3');
      invoices.list.mockClear();
      await component['exportInvoices']({ hide: vi.fn() } as never);
      expect(lastCall(invoices.list)).toMatchObject({ campusId: 'c3' });
    });

    describe('亂序：快切分校時慢的舊回應不能蓋掉新的（switchMap）', () => {
      it('列表', async () => {
        const a = new Subject<ReturnType<typeof listResponse>>();
        const b = new Subject<ReturnType<typeof listResponse>>();
        invoices.list.mockReturnValueOnce(a).mockReturnValueOnce(b);
        await pick('A');
        await pick('B');
        b.next(listResponse([invoice({ id: 'B1' })], 1));
        a.next(listResponse([invoice({ id: 'A1' }), invoice({ id: 'A2' })], 2));
        expect(component['invoices']().map((i) => i.id)).toEqual(['B1']);
        expect(component['totalRecords']()).toBe(1);
      });

      it('摘要', async () => {
        const a = new Subject<InvoiceSummary>();
        const b = new Subject<InvoiceSummary>();
        invoices.summary.mockReturnValueOnce(a).mockReturnValueOnce(b);
        await pick('A');
        await pick('B');
        b.next(summary({ month: { month: '2026-10', billed: 222, received: 1 } }));
        a.next(summary({ month: { month: '2026-10', billed: 111, received: 1 } }));
        expect(component['summary']()?.month.billed).toBe(222);
      });

      it('待開帳數', async () => {
        const a = new Subject<{ data: never[]; meta: { total: number } }>();
        const b = new Subject<{ data: never[]; meta: { total: number } }>();
        enrollments.list.mockReturnValueOnce(a).mockReturnValueOnce(b);
        await pick('A');
        await pick('B');
        b.next({ data: [], meta: { total: 2 } });
        a.next({ data: [], meta: { total: 99 } });
        expect(component['uninvoicedCount']()).toBe(2);
      });

      it('展開的章', async () => {
        component['onChapterToggle']('dueSoon', true);
        const a = new Subject<ReturnType<typeof listResponse>>();
        const b = new Subject<ReturnType<typeof listResponse>>();
        const queue = [a, b];
        // 只有「7 天內到期」章的請求走 Subject（依呼叫順序 A、B）；其餘（主列表）回空
        invoices.list.mockImplementation((params?: unknown) =>
          (params as { dueState?: string }).dueState === 'dueSoon'
            ? queue.shift()!
            : of(listResponse([])),
        );
        await pick('A');
        await pick('B');
        // forkJoin 要等內層完成才會發值，所以 next 之後要 complete
        b.next(listResponse([invoice({ id: 'B1' })], 1));
        b.complete();
        a.next(listResponse([invoice({ id: 'A1' })], 1));
        a.complete();
        const rows = component['chapters']()['dueSoon'].rows.map((r: Invoice) => r.id);
        expect(rows).toEqual(['B1']);
      });
    });
  });

  /**
   * #1314 帳單對齊 A6（用 conformance 工具量）。jsdom 量不到版面，所以斷言「產生那個尺寸／結構的 class 與 DOM」；
   * 每條 `wide:`／基底 44px（A27）成對都要在。
   */
  describe('A6 結構與幾何（#1314 帳單）', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const cls = (e: Element | null) => (e as HTMLElement).className.split(/\s+/);
    const has = (e: Element | null, ...names: string[]) => {
      for (const n of names) expect(cls(e), n).toContain(n);
    };
    const render = async (
      rows: Invoice[] = [invoice({ studentGrade: 'J3', dueDate: '2020-01-01' })],
    ) => {
      invoices.list.mockReturnValue(of(listResponse(rows, rows.length)));
      component['load']();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('搜尋框是原生 search（角色 searchbox）', () => {
      expect(el().querySelector('input[aria-label="搜尋帳單"]')?.getAttribute('type')).toBe(
        'search',
      );
    });

    it('工具列：開立帳單＝橘底 13px 粗、桌機 36px、手機基底 44px；匯出／更多動作＝白底框 zinc-300、桌機 36×40', () => {
      const create = Array.from(el().querySelectorAll('button')).find((b) =>
        b.textContent?.includes('開立帳單'),
      )!;
      has(
        create,
        'bg-accent-vivid',
        'border-accent-vivid',
        'text-md',
        'font-semibold',
        'min-h-11',
        'wide:min-h-0',
        'wide:h-9',
        'wide:inline-flex',
        'hidden',
      );
      for (const label of ['匯出', '更多動作']) {
        const b = el().querySelector(`button[aria-label="${label}"]`)!;
        has(b, 'border-zinc-300', 'bg-white', 'size-11', 'wide:h-9', 'wide:w-10', 'gap-1.5');
      }
    });

    it('逾期章頭：紅色大字名（手機 32／桌機 44）→「N 張 · 待收」→「NT$ …」兩個 <p>（18px 粗）', async () => {
      await render();
      const sec = el().querySelector('section[aria-label="逾期"]')!;
      const h2 = sec.querySelector('h2')!;
      has(h2, 'text-[32px]', 'wide:text-[44px]', 'text-error-700', 'font-bold');
      const ps = Array.from(sec.querySelectorAll('p')).filter((p) =>
        p.className.includes('text-xl'),
      );
      expect(ps).toHaveLength(2);
      expect(ps[0].textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^4 張 · 待收$/);
      expect(ps[1].textContent?.replace(/\s+/g, ' ').trim()).toBe('NT$ 15,000');
      // 「張」是 p 自己的字（不是另外的 span）；「· 待收」才是 span
      expect(Array.from(ps[0].querySelectorAll('span')).map((x) => x.textContent?.trim())).toEqual([
        '· 待收',
      ]);
    });

    it('逾期章間距：手機 py-6 gap-y-3／桌機 py-8 gap-y-8、底線 1px zinc-200', async () => {
      await render();
      has(
        el().querySelector('section[aria-label="逾期"]'),
        'py-6',
        'gap-y-3',
        'wide:py-8',
        'wide:gap-y-8',
        'border-b',
        'border-zinc-200',
      );
    });

    it('列：<li> 自己是 grid（手機 2 欄／桌機 [1fr 260 120 auto]）；DOM 順序＝姓名、狀態、金額、動作', async () => {
      await render();
      const li = el().querySelector('section[aria-label="逾期"] li')!;
      has(
        li,
        'grid',
        'py-3',
        'gap-x-3',
        'wide:gap-x-4',
        'wide:gap-y-4',
        'wide:grid-cols-[minmax(0,1fr)_260px_120px_auto]',
      );
      const kids = Array.from(li.children);
      expect(kids).toHaveLength(4);
      expect(kids[0].querySelector('a')?.textContent?.trim()).toBe('陳小明');
      expect(kids[1].textContent).toContain('逾期');
      expect(kids[2].textContent).toContain('4,500');
      expect(kids[3].tagName.toLowerCase()).toBe('app-invoice-actions');
      // 年級在連結外、字重常規（不吃全站的 500）
      has(kids[0].querySelector('span.shrink-0'), 'font-normal', 'text-zinc-500');
      // 連結：手機 44、桌機行內
      has(kids[0].querySelector('a'), 'min-h-11', 'wide:min-h-0', 'wide:inline');
    });

    it('列上動作鈕：手機 44px／14px、桌機 30px／12px 粗', async () => {
      await render();
      const b = el().querySelector('li app-invoice-actions button')!;
      has(
        b,
        'h-11',
        'wide:h-[30px]',
        'text-[14px]',
        'wide:text-[12px]',
        'px-4',
        'wide:px-3',
        'font-semibold',
      );
    });

    // #1705：A6 `.colls`（區塊之間 space-2）＋ `<details name>` 同組互斥
    it('到期分組列：.colls 裡三個 details.coll，同一個 name；標題與摘要用 coll__t／coll__m；不是 region landmark', async () => {
      await render();
      const group = el().querySelector('.colls')!;
      const rows = Array.from(
        group.querySelectorAll(':scope > details.coll'),
      ) as HTMLDetailsElement[];
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((d) => d.getAttribute('name')))).toEqual(
        new Set(['payments-chapters']),
      );
      expect(el().querySelector('section[aria-label="7 天內到期"]')).toBeNull();
      const sum = rows[0].querySelector(':scope > summary.coll__sum')!;
      expect(sum.querySelector('.coll__t')?.textContent?.trim()).toBe('7 天內到期');
      expect(sum.querySelector('.coll__m')?.textContent).toContain('張');
      // 內容一直在（高度過渡才量得到），白底包在 coll__body
      expect(rows[0].querySelector(':scope > .coll__body')).not.toBeNull();
    });

    it('瀏覽器收起一章（同組互斥）：狀態跟著關、不重抓；點開才抓', async () => {
      await render();
      invoices.list.mockClear();
      component['onChapterToggle']('dueSoon', true);
      expect(component['chapters']().dueSoon.open).toBe(true);
      expect(invoices.list).toHaveBeenCalled();

      invoices.list.mockClear();
      // [open] 綁定寫回去那一次也會發 toggle：狀態一樣就不動、不重抓
      component['onChapterToggle']('dueSoon', true);
      expect(invoices.list).not.toHaveBeenCalled();

      component['onChapterToggle']('dueSoon', false);
      expect(component['chapters']().dueSoon.open).toBe(false);
      expect(invoices.list).not.toHaveBeenCalled();
    });

    // #1853：章的初始狀態若是 loading=false，reload-veil 會當成「載入過」，第一次展開就走重抓：
    // 膠囊疊在空列表上、被下一章切掉。第一次要是骨架
    it('第一次展開、資料還沒回來：顯示骨架，不是疊在空列表上的重抓膠囊', async () => {
      await render();
      invoices.list.mockReturnValue(NEVER);
      component['onChapterToggle']('dueSoon', true);
      await render();
      const body = el().querySelector('details.coll .coll__body')!;
      expect(body.querySelector('[role="status"] .skeleton')).not.toBeNull();
      expect(body.querySelector('.reload-veil__status')).toBeNull();
    });

    it('章裡最後一列不畫分隔線', async () => {
      invoices.list.mockReturnValue(
        of(listResponse([invoice({ id: 'x1' }), invoice({ id: 'x2' })])),
      );
      component['onChapterToggle']('dueSoon', true);
      await render();
      const rows = el().querySelectorAll('details.coll .coll__body li.vt-row');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[rows.length - 1].classList).toContain('last:border-b-0');
    });
  });

  // #1641 5b：同一張帳單可能同時在上方清單與展開的章裡 —— view-transition-name 全頁唯一，撞名整個 VT 會被跳過
  it('同一張帳單同時出現在上方清單與展開的章：列名不撞', async () => {
    const same = invoice({ id: 'inv-1' });
    invoices.list.mockReturnValue(of(listResponse([same])));
    (component as unknown as { load: () => void }).load();
    await fixture.whenStable();
    (
      component as unknown as { onChapterToggle: (k: string, open: boolean) => void }
    ).onChapterToggle('dueSoon', true);
    await fixture.whenStable();
    fixture.detectChanges();

    const names = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.vt-row'),
    ).map((el) => el.style.getPropertyValue('view-transition-name'));
    expect(names.length).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);
  });
});
