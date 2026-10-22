import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ReportsService } from './reports.service';

describe('ReportsService.revenueCsv（#1100 #41）', () => {
  let service: ReportsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReportsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('帶期間、分校、課程；拿 blob（text 會把 Excel 要的 UTF-8 BOM 吃掉）', () => {
    service
      .revenueCsv({
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        campusId: 'cp1',
        courseId: 'co1',
      })
      .subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/api/reports/revenue.csv'));
    expect(req.request.responseType).toBe('blob');
    expect(req.request.params.get('dateFrom')).toBe('2026-09-01');
    expect(req.request.params.get('dateTo')).toBe('2026-09-30');
    expect(req.request.params.get('campusId')).toBe('cp1');
    expect(req.request.params.get('courseId')).toBe('co1');
    req.flush(new Blob(['csv']));
  });

  it('沒選分校、課程就不帶（空字串會被後端當成篩選值）', () => {
    service.revenueCsv({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }).subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/api/reports/revenue.csv'));
    expect(req.request.params.keys().sort()).toEqual(['dateFrom', 'dateTo']);
    req.flush(new Blob(['csv']));
  });
});
