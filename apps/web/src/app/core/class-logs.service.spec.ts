import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ClassLogsService } from './class-logs.service';

describe('ClassLogsService', () => {
  let service: ClassLogsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ClassLogsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('查某班某一天：classId + from + to 都帶上', () => {
    service.list({ classId: 'c1', from: '2026-09-05', to: '2026-09-05' }).subscribe();
    const req = http.expectOne(
      (r) =>
        r.url.endsWith('/class-logs') &&
        r.params.get('classId') === 'c1' &&
        r.params.get('from') === '2026-09-05' &&
        r.params.get('to') === '2026-09-05',
    );
    req.flush({ data: [], meta: { total: 0 } });
  });

  /**
   * 空參數不能變成 `?classId=&from=` —— 那會讓後端把空字串當成篩選值。
   */
  it('沒給參數就不帶 query', () => {
    service.list().subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/class-logs') && r.params.keys().length === 0);
    req.flush({ data: [], meta: { total: 0 } });
  });

  // 後端依角色收斂（老師只拿得到自己任課班），前端不該自己傳老師 id
  it('不傳任何老師身分參數', () => {
    service.list({ classId: 'c1' }).subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/class-logs'));
    expect(req.request.params.keys()).toEqual(['classId']);
    req.flush({ data: [], meta: { total: 0 } });
  });

  it('存檔用 PUT（upsert，不是 POST 新增）', () => {
    service
      .upsert({ classId: 'c1', logDate: '2026-09-05', teachingRecord: '第三章', homework: 'p.42' })
      .subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/class-logs'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      classId: 'c1',
      logDate: '2026-09-05',
      teachingRecord: '第三章',
      homework: 'p.42',
    });
    req.flush({ data: {} });
  });
});
