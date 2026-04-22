import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SchoolsService } from './schools.service';

describe('SchoolsService', () => {
  let service: SchoolsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SchoolsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GET /schools returns list', () => {
    service.list({ search: '中' }).subscribe((r) => expect(r.data.length).toBe(1));
    const req = http.expectOne(
      (r) => r.url.endsWith('/schools') && r.params.get('search') === '中',
    );
    req.flush({
      data: [
        {
          id: '1',
          name: '中正國中',
          shortName: null,
          isActive: true,
          studentCount: 0,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
      meta: { total: 1 },
    });
  });
});
