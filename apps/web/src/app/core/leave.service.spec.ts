import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { LeaveService } from './leave.service';

describe('LeaveService.list —— 課程／開課班（#1100 #31）', () => {
  let service: LeaveService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LeaveService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('帶 classId、courseId', () => {
    service.list({ classId: 'class-1', courseId: 'course-1' }).subscribe();
    const req = http.expectOne((r) => /\/api\/leaves$/.test(r.url));
    expect(req.request.params.get('classId')).toBe('class-1');
    expect(req.request.params.get('courseId')).toBe('course-1');
    req.flush({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } });
  });

  it('沒選就不帶', () => {
    service.list({}).subscribe();
    const req = http.expectOne((r) => /\/api\/leaves$/.test(r.url));
    expect(req.request.params.has('classId')).toBe(false);
    expect(req.request.params.has('courseId')).toBe(false);
    req.flush({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } });
  });
});
