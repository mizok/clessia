import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

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
import { By } from '@angular/platform-browser';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';

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
  };
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
    reports.revenue.mockReset().mockReturnValue(of(response()));
    courses.list.mockReset().mockReturnValue(of({ data: [], meta: {} }));

    await TestBed.configureTestingModule({
      imports: [ReportsPage],
      providers: [
        { provide: ReportsService, useValue: reports },
        { provide: CoursesService, useValue: courses },
        { provide: ReferenceDataService, useValue: refData },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportsPage);
    fixture.componentRef.setInput('page', { label: '營收報表' });
    component = fixture.componentInstance;
    await fixture.whenStable();
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
    // 窄螢幕上 responsive-table 只留得下一兩欄。留哪些不能靠 DOM 順序碰運氣：
    // 身分欄（哪一個分校）不可摺疊，而留下來的那個數字要是可行動的那個。
    it('分校欄不可摺疊，應收未收比實收優先留下', async () => {
      // 表頭在 ng-template 裡，沒有分組資料時整張表不渲染 —— 要先餵資料
      reports.revenue.mockReturnValue(
        of(response({ groups: [{ key: '示範分校01', ...figures({ billed: 1000 }) }] })),
      );
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();

      // 讀 directive 實例而不是 ng-reflect 屬性 —— 後者只有 dev 模式才有
      const cols = fixture.debugElement
        .queryAll(By.directive(RtColDefDirective))
        .map((el) => el.injector.get(RtColDefDirective));
      const col = (key: string) => cols.find((c) => c.key() === key);

      expect(col('key')?.collapsible()).toBe(false);

      const priority = (key: string) => col(key)?.priority() ?? Number.NaN;
      expect(priority('outstanding')).toBeLessThan(priority('received'));
      expect(priority('outstanding')).toBeLessThan(priority('billed'));
      expect(priority('outstanding')).toBeLessThan(priority('refunded'));
    });

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
      expect(q('billed-summary').querySelectorAll('[data-testid="pct"]')).toHaveLength(0);
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

    it('工具列：期間、課程帶標籤；分組方式在工具列（不在分組統計標題旁）', async () => {
      await load({ billed: 1000, outstanding: 500 });
      const bar = fixture.nativeElement.querySelector('[role="search"]') as HTMLElement;
      const labels = Array.from(bar.querySelectorAll('label')).map((l) => l.textContent!.trim());
      expect(labels.some((t) => t.startsWith('期間'))).toBe(true);
      expect(labels.some((t) => t.startsWith('課程'))).toBe(true);
      expect(bar.querySelector('p-selectbutton')).not.toBeNull();
      expect(bar.querySelector('p-selectbutton')!.classList).toContain('col-span-2');
      expect(bar.querySelector('p-selectbutton')!.classList).toContain('wide:ml-auto');
      expect(fixture.nativeElement.querySelectorAll('p-selectbutton')).toHaveLength(1);
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

    // #1029：說明不能只放 tooltip（手機 hover 不到）；有模糊桶才出現，沒有就不佔位
    it('有模糊桶 → 頁面上有可見說明文字；沒有 → 沒有', async () => {
      const note = () => fixture.nativeElement.querySelector('.reports__groups-note');

      reports.revenue.mockReturnValue(
        of(response({ groups: [{ key: '（跨分校）', ...figures() }] })),
      );
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(note()?.textContent).toContain('小計加起來等於總計');

      reports.revenue.mockReturnValue(of(response({ groups: [{ key: '中山校', ...figures() }] })));
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(note()).toBeNull();
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
