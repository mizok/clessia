import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';

import {
  ReportsService,
  type RevenueQueryParams,
  type RevenueResponse,
} from '@core/reports.service';
import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { CoursesService } from '@core/courses.service';
import { AuthService } from '@core/auth.service';

import { ReportsPage } from './reports.page';

const figures = (overrides: Partial<RevenueResponse['summary']> = {}) => ({
  received: 0,
  refunded: 0,
  billed: 0,
  outstanding: 0,
  overdueOutstanding: 0,
  ...overrides,
});

const response = (overrides: Partial<RevenueResponse> = {}): RevenueResponse => ({
  summary: figures(),
  groups: [],
  ...overrides,
});

describe('ReportsPage', () => {
  let component: ReportsPage;
  let fixture: ComponentFixture<ReportsPage>;

  const reports = {
    revenue: vi.fn((_params?: RevenueQueryParams) => of(response())),
    revenueCsv: vi.fn((_params?: RevenueQueryParams) => of(new Blob(['csv']))),
  };
  const toast = { add: vi.fn() };
  const courses = {
    list: vi.fn(() => of({ data: [], meta: {} })),
  };
  const refData = {
    campuses: signal<unknown[]>([]),
    loadCampuses: vi.fn(),
  };

  beforeEach(async () => {
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    reports.revenue.mockReset().mockReturnValue(of(response()));
    courses.list.mockReset().mockReturnValue(of({ data: [], meta: {} }));

    await TestBed.configureTestingModule({
      imports: [ReportsPage],
      providers: [
        provideRouter([]),
        { provide: ReportsService, useValue: reports },
        { provide: MessageService, useValue: toast },
        { provide: CoursesService, useValue: courses },
        { provide: ReferenceDataService, useValue: refData },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportsPage);
    fixture.componentRef.setInput('page', { label: '營收報表' });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('報表類：頂欄保留「全部分校」（#1607）', () => {
    const ctx = TestBed.inject(CampusContextService);
    expect(ctx.inUse()).toBe(true);
    expect(ctx.allowAll()).toBe(true);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // dateFrom/dateTo 是後端的必填參數
  it('進頁就帶日期區間查詢', () => {
    const params = reports.revenue.mock.calls[0][0]!;

    expect(params.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('預設分組是分校', () => {
    expect(reports.revenue.mock.calls[0][0]!.groupBy).toBe('campus');
  });

  it('沒篩選時不送 campusId 與 courseId', () => {
    const params = reports.revenue.mock.calls[0][0]!;

    expect(params.campusId).toBeUndefined();
    expect(params.courseId).toBeUndefined();
  });

  // #1100 #41：spec「依篩選條件匯出 CSV」—— 打明細端點，帶跟畫面同一組篩選
  describe('匯出 CSV', () => {
    it('照目前的期間、頂欄分校、課程打 revenue.csv，下載成檔案', () => {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      URL.createObjectURL = vi.fn(() => 'blob:x');
      URL.revokeObjectURL = vi.fn();
      TestBed.inject(CampusContextService).select('campus-1');
      fixture.detectChanges();
      component['onCourseChange']('course-1');
      const { dateFrom, dateTo } = reports.revenue.mock.calls.at(-1)![0]!;

      component['exportCsv']();

      expect(reports.revenueCsv).toHaveBeenCalledWith({
        dateFrom,
        dateTo,
        campusId: 'campus-1',
        courseId: 'course-1',
      });
      expect(click).toHaveBeenCalledTimes(1);
      expect(component['exporting']()).toBe(false);
      click.mockRestore();
    });

    it('筆數超過上限（413）→ 顯示後端的「請縮小日期範圍」', async () => {
      toast.add.mockClear();
      // jsdom 的 Blob 沒有 text()（瀏覽器都有）—— 補上
      const json = JSON.stringify({ error: '筆數超過 20000 筆，請縮小日期範圍' });
      const body = Object.assign(new Blob([json]), { text: async () => json });
      reports.revenueCsv.mockReturnValueOnce(throwError(() => ({ status: 413, error: body })));

      component['exportCsv']();
      await vi.waitFor(() => expect(toast.add).toHaveBeenCalled());

      expect(toast.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: '筆數超過 20000 筆，請縮小日期範圍' }),
      );
      expect(component['exporting']()).toBe(false);
    });
  });

  describe('篩選與分組', () => {
    it('換分組方式會重打', () => {
      reports.revenue.mockClear();

      component['onGroupByChange']('month');

      expect(reports.revenue).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'month' }));
    });

    it('同一個分組再選一次不重打', () => {
      reports.revenue.mockClear();

      component['onGroupByChange']('campus');

      expect(reports.revenue).not.toHaveBeenCalled();
    });

    it('分校跟頂欄走：頂欄換分校會帶 campusId 重打（#1138）', () => {
      reports.revenue.mockClear();

      TestBed.inject(CampusContextService).select('campus-1');
      fixture.detectChanges();

      expect(reports.revenue).toHaveBeenCalledTimes(1);
      expect(reports.revenue).toHaveBeenCalledWith(
        expect.objectContaining({ campusId: 'campus-1' }),
      );
    });

    it('清除篩選只清課程，分校歸頂欄', () => {
      TestBed.inject(CampusContextService).select('campus-1');
      fixture.detectChanges();
      component['onCourseChange']('course-1');
      reports.revenue.mockClear();

      component['clearFilters']();

      expect(reports.revenue).toHaveBeenCalledWith(
        expect.objectContaining({ campusId: 'campus-1', courseId: undefined }),
      );
    });

    it('預設期間是上個完整月，換期間會用該期間的起訖重打（RP1）', () => {
      const first = reports.revenue.mock.calls[0][0]!;
      const prev1 = component['periodOptions'].find((o) => o.value === 'prev1')!;
      expect([first.dateFrom, first.dateTo]).toEqual([prev1.from, prev1.to]);

      reports.revenue.mockClear();
      component['onPeriodChange']('last3');
      const last3 = component['periodOptions'].find((o) => o.value === 'last3')!;

      expect(reports.revenue).toHaveBeenCalledWith(
        expect.objectContaining({ dateFrom: last3.from, dateTo: last3.to }),
      );
    });
  });

  describe('#1314 RP3 連結與合計', () => {
    const group = (key: string) => ({ key, ...figures({ billed: 1000 }) });

    it('課程列連到課程管理，模糊桶不連', () => {
      component['groupBy'].set('course');

      expect(component['linkOf'](group('國三數學'))).toBe('/admin/courses');
      expect(component['linkOf'](group('（跨課程）'))).toBeNull();
    });

    it('沒有 manage_finance 時，連到帳單頁的連結不出現', () => {
      expect(component['canOpenInvoices']).toBe(false);
      expect(component['linkOf'](group('示範分校01'))).toBeNull();
    });

    // 正向：只有負向那條的話，把權限改成 view_reports 也全綠（#1514 reviewer 抓到）
    it('有 manage_finance 時，分校列與「看逾期帳單」連到帳單頁；只給 view_reports 則不出現', async () => {
      const build = async (allowed: string) => {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
          imports: [ReportsPage],
          providers: [
            { provide: ReportsService, useValue: reports },
            { provide: MessageService, useValue: toast },
            { provide: CoursesService, useValue: courses },
            { provide: ReferenceDataService, useValue: refData },
            provideRouter([]),
            { provide: AuthService, useValue: { hasPermission: (p: string) => p === allowed } },
          ],
        }).compileComponents();
        reports.revenue.mockReturnValue(
          of(
            response({
              summary: figures({ billed: 1000, outstanding: 500, overdueOutstanding: 200 }),
              groups: [group('示範分校01')],
            }),
          ),
        );
        const f = TestBed.createComponent(ReportsPage);
        f.componentRef.setInput('page', { label: '營收報表' });
        await f.whenStable();
        f.detectChanges();
        return f;
      };
      const paymentLinks = (f: ComponentFixture<ReportsPage>) =>
        Array.from(
          (f.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a'),
        ).filter((a) => a.getAttribute('href')?.startsWith('/admin/payments'));

      const allowed = await build('manage_finance');
      expect(allowed.componentInstance['canOpenInvoices']).toBe(true);
      expect(allowed.componentInstance['linkOf'](group('示範分校01'))).toBe('/admin/payments');
      expect(paymentLinks(allowed).length).toBeGreaterThan(0);
      expect((allowed.nativeElement as HTMLElement).textContent).toContain('看逾期帳單');

      const denied = await build('view_reports');
      expect(paymentLinks(denied).length).toBe(0);
    });

    it('合計列顯示 API 的 summary，不是前端加各組', async () => {
      reports.revenue.mockReturnValue(
        of(
          response({
            summary: figures({ billed: 99999 }),
            groups: [group('A'), group('B')],
          }),
        ),
      );
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('合計');
      expect(text).toContain('99,999');
    });
  });

  describe('數字全部來自後端', () => {
    it('摘要照後端給的呈現，前端不重算', async () => {
      reports.revenue.mockReturnValue(
        of(
          response({
            summary: figures({
              received: 100000,
              refunded: 30000,
              billed: 150000,
              outstanding: 50000,
              overdueOutstanding: 20000,
            }),
          }),
        ),
      );
      component['load']();
      await fixture.whenStable();

      // 退款不從實收扣掉 —— 「收 10 萬退 3 萬」與「收 7 萬」是兩個訊號
      expect(component['summary']()?.received).toBe(100000);
      expect(component['summary']()?.refunded).toBe(30000);
    });

    // 舊數字配新篩選條件是最糟的騙法
    it('取數失敗時清掉摘要與分組，不留上一次的數字', async () => {
      reports.revenue.mockReturnValue(of(response({ summary: figures({ received: 999 }) })));
      component['load']();
      await fixture.whenStable();
      expect(component['summary']()?.received).toBe(999);

      reports.revenue.mockReturnValue(throwError(() => new Error('boom')));
      component['load']();
      await fixture.whenStable();

      expect(component['summary']()).toBeNull();
      expect(component['groups']()).toEqual([]);
      expect(component['failed']()).toBe(true);
    });
  });

  describe('R1 色面與開帳摘要（A6）', () => {
    const q = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const load = async (summary: Partial<RevenueResponse['summary']>) => {
      reports.revenue.mockReturnValue(of(response({ summary: figures(summary) })));
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const heroText = () =>
      fixture.nativeElement.querySelector('app-page-open')!.textContent.replace(/\s+/g, ' ');

    it('色面句兩行（一個 <br>）＋副行；期間名跟著選項', async () => {
      await load({ billed: 498600, outstanding: 323500, overdueOutstanding: 81350 });
      expect(heroText()).toContain('開帳 NT$ 498,600，');
      expect(heroText()).toContain('還有 NT$ 323,500 沒收到。');
      expect(heroText()).toContain('已收回 35%；沒收到的裡面，逾期 NT$ 81,350。');
      expect(fixture.nativeElement.querySelectorAll('app-page-open br')).toHaveLength(1);

      component['onPeriodChange']('last3');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(heroText()).toContain('近三個月開帳');
      expect(q('billed-summary').textContent).toContain('近三個月開帳（看開帳日）');
    });

    it('billed 0：色面寫「還沒有開帳」、沒有條、百分比不顯示，只留金額', async () => {
      await load({ billed: 0, outstanding: 0 });
      expect(heroText()).toContain('還沒有開帳。');
      expect(fixture.nativeElement.querySelectorAll('app-page-open br')).toHaveLength(0);
      expect(heroText()).toContain('錢進來多少、還有多少沒收到。'); // 退回預設副行
      expect(q('billed-bar')).toBeNull();
      expect(q('billed-summary').textContent).not.toContain('%');
      expect(q('block-outstanding').textContent).toContain('NT$ 0');
    });

    it('載入中／失敗：色面退回頁名，不留舊數字', async () => {
      await load({ billed: 1000, outstanding: 500 });
      reports.revenue.mockReturnValue(throwError(() => new Error('boom')));
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component['headline']()).toBeNull();
      expect(heroText()).toContain('營收報表');
    });

    it('三個數字塊：已收回／應收未收／其中逾期，帶占比與金額（金額照後端，占比 0.1 進位）', async () => {
      await load({ billed: 498600, outstanding: 323500, overdueOutstanding: 81350 });
      expect(q('block-collected').textContent!.replace(/\s+/g, ' ')).toContain(
        '已收回 · 35.1% NT$ 175,100',
      );
      expect(q('block-outstanding').textContent!.replace(/\s+/g, ' ')).toContain(
        '應收未收 · 64.9% NT$ 323,500',
      );
      expect(q('block-overdue').textContent!.replace(/\s+/g, ' ')).toContain(
        '其中逾期 · 16.3% NT$ 81,350',
      );
    });

    it('三段條：黑（已收回）從左、紅（逾期）貼右端；寬度＝占比', async () => {
      await load({ billed: 1000, outstanding: 600, overdueOutstanding: 200 });
      const collected = q('bar-collected');
      const overdue = q('bar-overdue');
      expect(collected.style.width).toBe('40%');
      expect(collected.classList).toContain('left-0');
      expect(overdue.style.width).toBe('20%');
      expect(overdue.classList).toContain('right-0');
      expect(q('billed-bar').getAttribute('aria-label')).toBe(
        '已收回 40%，應收未收 60%，其中逾期 20%',
      );
    });

    it('前端沒有加總：金額欄位是後端的 summary（outstanding 不是 billed 減出來的）', async () => {
      // billed − outstanding = 700，但 outstanding 顯示後端的 250（溢繳時兩者不等，占比用夾住的值）
      await load({ billed: 1000, outstanding: 250, overdueOutstanding: 0 });
      expect(q('block-outstanding').textContent).toContain('NT$ 250');
      expect(q('block-collected').textContent).toContain('NT$ 750');
    });

    it('連結：有 manage_finance 才有「看還沒繳清的帳單」「看逾期帳單」', async () => {
      await load({ billed: 1000, outstanding: 500, overdueOutstanding: 100 });
      const hasFinance = (component as unknown as { canOpenInvoices: boolean }).canOpenInvoices;
      expect(q('block-outstanding').querySelectorAll('a').length).toBe(hasFinance ? 1 : 0);
      expect(q('block-overdue').querySelectorAll('a').length).toBe(hasFinance ? 1 : 0);
    });

    it('實收／退款註腳：灰底塊、寫明不能相除當收款率；兩個數字照後端', async () => {
      await load({ received: 578800, refunded: 6000, billed: 1000, outstanding: 500 });
      const note = q('cash-note');
      expect(note.classList).toContain('bg-zinc-100');
      expect(note.textContent).toContain('NT$ 578,800');
      expect(note.textContent).toContain('NT$ 6,000');
      expect(note.textContent).toContain('兩個數字不能相除當收款率');
    });

    // #1881：三塊在 app-reload-veil 裡，外層的 gap 傳不進來 —— 間距要寫在區塊自己身上（A6 reports：space-6／space-12）
    it('區塊間距：說明框 mt-6、分組統計 mt-12', async () => {
      await load({ billed: 1000, outstanding: 500 });
      expect(q('cash-note').classList).toContain('mt-6');
      expect(q('group-stats').classList).toContain('mt-12');
    });

    it('工具列：期間、課程帶標籤；分組方式在工具列（不在分組統計標題旁）', async () => {
      await load({ billed: 1000, outstanding: 500 });
      const bar = fixture.nativeElement.querySelector('[role="search"]') as HTMLElement;
      const labels = Array.from(bar.querySelectorAll('label')).map((l) => l.textContent!.trim());
      expect(labels.some((t) => t.startsWith('期間'))).toBe(true);
      expect(labels.some((t) => t.startsWith('課程'))).toBe(true);
      // A6 `.seg`：分段鈕（aria-pressed），跟匯出圖示鈕同在工具列右群組
      const seg = bar.querySelector('[data-testid="group-by"]') as HTMLElement;
      expect(seg.getAttribute('role')).toBe('group');
      expect(seg.parentElement!.classList).toContain('wide:ml-auto');
      const pressed = Array.from(seg.querySelectorAll('button')).filter(
        (b) => b.getAttribute('aria-pressed') === 'true',
      );
      expect(pressed).toHaveLength(1);
      expect(bar.querySelector('button[aria-label="匯出"]')).not.toBeNull();
    });
  });

  describe('R2 分組統計列（A6 平列）', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const q = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const all = (id: string) =>
      Array.from(el().querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
    const feed = async (res: RevenueResponse) => {
      reports.revenue.mockReturnValue(of(res));
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const g = (key: string, over: Partial<RevenueResponse['summary']> = {}) => ({
      key,
      ...figures(over),
    });

    it('一組一列、一個合計列，不再是 responsive-table', async () => {
      await feed(
        response({
          summary: figures({ billed: 1000 }),
          groups: [g('中山校', { billed: 600 }), g('文山校', { billed: 400 })],
        }),
      );
      expect(all('group-row')).toHaveLength(2);
      expect(all('group-total')).toHaveLength(1);
      expect(el().querySelector('app-responsive-table')).toBeNull();
    });

    it.each([
      ['campus', '分校'],
      ['course', '課程'],
      ['month', '月份'],
    ] as const)('分組 %s：第一欄表頭寫「%s」，後面五欄固定', async (by, label) => {
      component['groupBy'].set(by);
      await feed(response({ summary: figures({ billed: 1 }), groups: [g('x', { billed: 1 })] }));
      const heads = Array.from(q('group-table').querySelectorAll('thead th')).map((t) =>
        t.textContent!.trim(),
      );
      expect(heads).toEqual([label, '實收', '退款', '已開帳', '應收未收', '其中逾期']);
    });

    it('退款欄不上色：退款大於 0 也沒有任何文字色 class', async () => {
      await feed(
        response({
          summary: figures({ billed: 100, refunded: 50 }),
          groups: [g('中山校', { billed: 100, refunded: 50 })],
        }),
      );
      expect(q('cell-refunded').className).not.toMatch(/text-(warning|error|accent|success)/);
      expect(q('cell-refunded').textContent).toContain('50');
    });

    it.each([
      [0, false],
      [1, true],
    ])('其中逾期 %s → 紅字加粗：%s（門檻 0／1）', async (overdue, red) => {
      await feed(
        response({
          summary: figures({ billed: 100, outstanding: 50, overdueOutstanding: overdue }),
          groups: [g('中山校', { billed: 100, outstanding: 50, overdueOutstanding: overdue })],
        }),
      );
      expect(q('cell-overdue').classList.contains('text-error-700')).toBe(red);
      expect(q('cell-overdue').classList.contains('font-semibold')).toBe(red);
      expect(q('group-total').lastElementChild!.classList.contains('text-error-700')).toBe(red);
    });

    /**
     * 合計列每一格的數值（取自 API `summary`，不是前端加各組）。
     * 五個數字互質、各組數字刻意跟 summary 不同：任何一格被拿掉、換位置、或改成「各組加總」都會紅。
     * 每格斷言「標籤＋千分位數字」，手機的小標籤（`wide:hidden`）也在同一個 td 裡。
     */
    describe('合計列每一格', () => {
      const cells = () =>
        Array.from(q('group-total').children).map((c) => c.textContent!.replace(/\s+/g, ''));

      it.each([
        [
          '五格都有值',
          figures({
            received: 120001,
            refunded: 3002,
            billed: 250003,
            outstanding: 70004,
            overdueOutstanding: 9005,
          }),
          ['合計', '實收120,001', '退款3,002', '已開帳250,003', '應收未收70,004', '其中逾期9,005'],
        ],
        [
          '全 0 也要印 0（不是空白）',
          figures(),
          ['合計', '實收0', '退款0', '已開帳0', '應收未收0', '其中逾期0'],
        ],
        [
          '千分位邊界 999／1,000',
          figures({
            received: 999,
            refunded: 1000,
            billed: 1001,
            outstanding: 9999,
            overdueOutstanding: 10000,
          }),
          ['合計', '實收999', '退款1,000', '已開帳1,001', '應收未收9,999', '其中逾期10,000'],
        ],
      ] as const)('%s', async (_name, summary, expected) => {
        await feed(
          response({
            summary,
            // 各組數字跟 summary 不同：合計若改成前端加總就對不上
            groups: [
              g('中山校', {
                received: 11,
                refunded: 22,
                billed: 33,
                outstanding: 44,
                overdueOutstanding: 55,
              }),
              g('文山校', {
                received: 66,
                refunded: 77,
                billed: 88,
                outstanding: 99,
                overdueOutstanding: 111,
              }),
            ],
          }),
        );
        expect(cells()).toEqual([...expected]);
      });

      it('合計列的欄序與表頭一致（實收、退款、已開帳、應收未收、其中逾期），逾期格 >0 才紅', async () => {
        await feed(
          response({
            summary: figures({
              received: 5,
              refunded: 4,
              billed: 3,
              outstanding: 2,
              overdueOutstanding: 1,
            }),
            groups: [g('中山校', { billed: 3 })],
          }),
        );
        const heads = Array.from(q('group-table').querySelectorAll('thead th')).map((t) =>
          t.textContent!.trim(),
        );
        const tdLabels = Array.from(q('group-total').children)
          .slice(1)
          .map((c) => c.querySelector('small')!.textContent!.trim());
        expect(tdLabels).toEqual(heads.slice(1));
        expect(q('group-total').lastElementChild!.classList.contains('text-error-700')).toBe(true);
        // 其他四格不紅
        for (const c of Array.from(q('group-total').children).slice(0, -1)) {
          expect(c.classList.contains('text-error-700')).toBe(false);
        }
      });
    });

    it('畫面上的列序：已開帳大到小、模糊桶最後（只換順序）', async () => {
      await feed(
        response({
          summary: figures({ billed: 600 }),
          groups: [
            g('（未分類）', { billed: 400 }),
            g('甲', { billed: 100 }),
            g('乙', { billed: 200 }),
          ],
        }),
      );
      const names = all('group-row').map((r) =>
        r.querySelector('td')!.textContent!.trim().slice(0, 4),
      );
      expect(names).toEqual(['乙', '甲', '（未分類'].map((n) => n.slice(0, 4)));
    });

    it('比例條＝這組已開帳佔整體已開帳（取後端 summary），已開帳 0 的組沒有條', async () => {
      await feed(
        response({
          summary: figures({ billed: 1000 }),
          groups: [g('A', { billed: 500 }), g('B', { billed: 250 }), g('C', { billed: 0 })],
        }),
      );
      expect(all('group-bar').map((b) => b.style.width)).toEqual(['50%', '25%']);
      expect(all('group-row')[2].querySelector('[data-testid="group-bar"]')).toBeNull();
    });

    it('整體已開帳 0 → 條寬 0，不出現 NaN／Infinity', async () => {
      await feed(response({ summary: figures({ billed: 0 }), groups: [g('A', { billed: 5 })] }));
      expect(all('group-bar').map((b) => b.style.width)).toEqual(['0%']);
    });

    it('手機堆疊：每列是 grid、五個數字格各帶只在手機顯示的標籤', async () => {
      await feed(response({ summary: figures({ billed: 1 }), groups: [g('A', { billed: 1 })] }));
      const row = all('group-row')[0];
      expect(row.classList.contains('grid')).toBe(true);
      expect(row.classList.contains('wide:table-row')).toBe(true);
      const labels = Array.from(row.querySelectorAll('td small')).map((s) => s.textContent);
      expect(labels).toEqual(['實收', '退款', '已開帳', '應收未收', '其中逾期']);
      expect(
        Array.from(row.querySelectorAll('td small')).every((s) =>
          s.classList.contains('wide:hidden'),
        ),
      ).toBe(true);
    });

    it('名稱連結有 44px 高度下限（鍵盤與觸控）', async () => {
      component['groupBy'].set('course'); // 課程列的連結不需要 manage_finance
      await feed(
        response({ summary: figures({ billed: 1 }), groups: [g('中山校', { billed: 1 })] }),
      );
      const link = all('group-row')[0].querySelector('a')!;
      expect(link.classList.contains('min-h-11')).toBe(true);
    });
  });

  describe('明標的模糊桶', () => {
    // 這幾個桶是刻意的：不藏、不合併、不重新命名
    it('認得跨分校與未分類，一般分校名不是', async () => {
      reports.revenue.mockReturnValue(
        of(
          response({
            groups: [
              { key: '中山校', ...figures() },
              { key: '（跨分校）', ...figures() },
              { key: '（未分類）', ...figures() },
            ],
          }),
        ),
      );
      component['load']();
      await fixture.whenStable();

      const [normal, cross, unclassified] = component['groups']();
      expect(component['isAmbiguous'](normal)).toBe(false);
      expect(component['isAmbiguous'](cross)).toBe(true);
      expect(component['isAmbiguous'](unclassified)).toBe(true);
    });

    // #1029：說明不能只放 tooltip（手機 hover 不到）；A6：直接寫在那一列名稱底下，一般列不佔位
    it('模糊桶那一列底下有可見說明；一般列沒有；不再有 tooltip 與獨立說明段', async () => {
      const reasons = () =>
        Array.from(fixture.nativeElement.querySelectorAll('[data-testid="group-reason"]')).map(
          (n) => (n as HTMLElement).textContent!.trim(),
        );

      reports.revenue.mockReturnValue(
        of(
          response({
            groups: [
              { key: '中山校', ...figures() },
              { key: '（跨分校）', ...figures() },
              { key: '（跨課程）', ...figures() },
              { key: '（未分類）', ...figures() },
            ],
          }),
        ),
      );
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();

      const rows = Array.from(
        fixture.nativeElement.querySelectorAll('[data-testid="group-row"]'),
      ) as HTMLElement[];
      expect(rows.map((r) => r.querySelector('[data-testid="group-reason"]') !== null)).toEqual([
        false,
        true,
        true,
        true,
      ]);
      expect(reasons()).toHaveLength(3);
      expect(reasons()[0]).toContain('小計才加得回總計');
      expect(reasons()[2]).toContain('沒有任何課');
      expect(fixture.nativeElement.querySelector('.reports__groups-note')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="group-table"] i.pi')).toBeNull();
    });

    it('模糊桶照原樣顯示，不改名', async () => {
      reports.revenue.mockReturnValue(
        of(response({ groups: [{ key: '（跨分校）', ...figures() }] })),
      );
      component['load']();
      await fixture.whenStable();

      expect(component['labelOf'](component['groups']()[0])).toBe('（跨分校）');
    });

    it('月份分組把鍵轉成人看的樣子', async () => {
      reports.revenue.mockReturnValue(of(response({ groups: [{ key: '2026-08', ...figures() }] })));
      component['onGroupByChange']('month');
      await fixture.whenStable();

      expect(component['labelOf'](component['groups']()[0])).toBe('2026 年 8 月');
    });
  });
});
