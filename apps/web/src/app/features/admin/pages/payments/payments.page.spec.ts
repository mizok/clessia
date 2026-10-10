import { ComponentFixture, TestBed } from '@angular/core/testing';
import { format } from 'date-fns';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { InvoicesService, type Invoice, type InvoiceSummary } from '@core/invoices.service';
import { StudentsService, type Student } from '@core/students.service';

import { PaymentsPage } from './payments.page';

const invoice = (overrides?: Partial<Invoice>): Invoice => ({
  id: 'inv-1',
  orgId: 'org-1',
  studentId: 'stu-1',
  studentName: '陳小明',
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

const student = (overrides?: Partial<Student>): Student =>
  ({
    id: 'stu-1',
    name: '陳小明',
    grade: 'g7',
    ...overrides,
  }) as Student;

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
    paid: { count: 16 },
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
    list: vi.fn(() => of(listResponse([]))),
    summary: vi.fn(() => of(summary())),
    get: vi.fn(),
    create: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    recordPayment: vi.fn(),
    listReminders: vi.fn(() => of({ data: [] })),
    createReminder: vi.fn(),
  };
  const students = {
    list: vi.fn(() => of({ data: [student()], summary: {}, meta: {} })),
  };

  beforeEach(async () => {
    invoices.list.mockReset().mockReturnValue(of(listResponse([])));
    invoices.summary.mockReset().mockReturnValue(of(summary()));
    students.list.mockReset().mockReturnValue(of({ data: [student()], summary: {}, meta: {} }));

    await TestBed.configureTestingModule({
      imports: [PaymentsPage],
      providers: [
        { provide: InvoicesService, useValue: invoices },
        { provide: StudentsService, useValue: students },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaymentsPage);
    fixture.componentRef.setInput('page', { label: '繳費紀錄' });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('進頁就取第一頁帳單', () => {
    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
  });

  // 沒有篩選時是章節模式：主清單就是逾期章，所以送 overdue=true、不送 status
  it('預設（章節模式）只取逾期那一章，不送 status 與 studentId', () => {
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: true, status: undefined, studentId: undefined }),
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

  // 學生搜尋的 API 只吃 uuid，不吃姓名關鍵字 —— 選定之後帶的必須是 id
  it('選定學生後用 studentId 篩，不是姓名', () => {
    invoices.list.mockClear();

    component['onStudentChange'](student({ id: 'stu-9' }));

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ studentId: 'stu-9' }));
  });

  // 打字中間 autocomplete 的值是字串，那還不是一個選定的學生
  it('自動完成打字中不觸發列表查詢', () => {
    invoices.list.mockClear();

    component['onStudentChange']('陳');

    expect(invoices.list).not.toHaveBeenCalled();
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

  it('清除篩選會同時清掉欠繳、狀態與學生', () => {
    component['setDueFilter']('overdue');
    component['onStatusChange']('unpaid');
    component['onStudentChange'](student());
    invoices.list.mockClear();

    component['clearFilters']();

    expect(component['overdueOnly']()).toBe(false);
    expect(component['statusFilter']()).toBeNull();
    expect(component['selectedStudent']()).toBeNull();
    // 清完回到章節模式：主清單又是逾期章
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: true, status: undefined, studentId: undefined }),
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
      expect(text()).toContain('還沒到期');
      expect(text()).toContain('1 張 · 待收 NT$ 5,000');
      const paid = component['chapterList']().find((c) => c.key === 'paid');
      expect(paid?.count).toBe(17);
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

        component['toggleChapter'](key);
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

      component['toggleChapter']('paid');
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
  describe('手機「篩選：全部」面板（#1314 ③）', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const toggle = () => el().querySelector('app-filter-toggle button') as HTMLButtonElement;
    const panel = () => el().querySelector('#payments-filters') as HTMLElement;

    it('預設收合、鈕寫「篩選：全部」；點開後面板顯示、aria-expanded 跟著走', () => {
      fixture.detectChanges();
      expect(toggle().textContent).toContain('篩選：全部');
      expect(panel().classList.contains('hidden')).toBe(true);

      toggle().click();
      fixture.detectChanges();
      expect(panel().classList.contains('hidden')).toBe(false);
      expect(panel().classList.contains('flex')).toBe(true);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
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
});
