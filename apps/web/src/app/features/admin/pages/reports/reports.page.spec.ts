import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  ReportsService,
  type RevenueQueryParams,
  type RevenueResponse,
} from '@core/reports.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { CoursesService } from '@core/courses.service';

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
  };
  const courses = {
    list: vi.fn(() => of({ data: [], meta: {} })),
  };
  const refData = {
    campuses: () => [],
    loadCampuses: vi.fn(),
  };

  beforeEach(async () => {
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

    it('選分校會帶 campusId', () => {
      reports.revenue.mockClear();

      component['onCampusChange']('campus-1');

      expect(reports.revenue).toHaveBeenCalledWith(
        expect.objectContaining({ campusId: 'campus-1' }),
      );
    });

    it('清除篩選會同時清掉分校與課程', () => {
      component['onCampusChange']('campus-1');
      component['onCourseChange']('course-1');
      reports.revenue.mockClear();

      component['clearFilters']();

      expect(reports.revenue).toHaveBeenCalledWith(
        expect.objectContaining({ campusId: undefined, courseId: undefined }),
      );
    });

    // range 模式選第一個日期時 end 還是 null
    it('日期區間只選了一半時不查', () => {
      reports.revenue.mockClear();

      component['onRangeChange']([new Date('2026-08-01T00:00:00'), null as unknown as Date]);

      expect(reports.revenue).not.toHaveBeenCalled();
    });

    it('日期區間選滿才查', () => {
      reports.revenue.mockClear();

      component['onRangeChange']([
        new Date('2026-08-01T00:00:00'),
        new Date('2026-08-31T00:00:00'),
      ]);

      expect(reports.revenue).toHaveBeenCalledWith(
        expect.objectContaining({ dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
      );
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
