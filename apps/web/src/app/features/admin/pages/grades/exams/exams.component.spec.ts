import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ExamsComponent } from './exams.component';
import { environment } from '@env/environment';
import { ReferenceDataService } from '@core/reference-data.service';

describe('ExamsComponent', () => {
  let component: ExamsComponent;
  let fixture: ComponentFixture<ExamsComponent>;
  let http: HttpTestingController;

  const mockAcademyExams = [
    {
      id: 'a1',
      name: '數學小考',
      examType: 'quiz',
      status: 'active',
      examDate: '2026-04-01',
      totalScore: 100,
      scopeNote: '第一章',
      campusId: 'c1',
      subjectId: 's1',
      subjectName: '數學',
      classCount: 2,
      scoreCount: 0,
      createdAt: '2026-03-20T00:00:00Z',
      updatedAt: '2026-03-20T00:00:00Z',
    },
    {
      id: 'a2',
      name: '英文模擬考',
      examType: 'mock_exam',
      status: 'closed',
      examDate: '2026-03-15',
      totalScore: 100,
      scopeNote: '全冊',
      campusId: 'c1',
      subjectId: 's2',
      subjectName: '英文',
      classCount: 3,
      scoreCount: 25,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-16T00:00:00Z',
    },
  ];

  const mockSchoolExams = [
    {
      id: 't1',
      academicYear: 114,
      semester: 2,
      examType: 'term_exam',
      name: null,
      label: '114-2 段考',
      examDate: '2026-04-10',
      status: 'active',
      schoolId: 'sch-1',
      schoolName: '測試國中',
      scoreCount: 0,
      createdAt: '2026-03-20T00:00:00Z',
      updatedAt: '2026-03-20T00:00:00Z',
    },
  ];

  beforeEach(async () => {
    // 確保 ReferenceDataService 不會在 ngOnInit 對 campuses/subjects API 發出真實請求
    const refDataStub = {
      campuses: () => [],
      subjects: () => [],
      teachers: () => [],
      loadCampuses: () => undefined,
      loadSubjects: () => undefined,
      loadTeachers: () => undefined,
    };

    await TestBed.configureTestingModule({
      imports: [ExamsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ReferenceDataService, useValue: refDataStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExamsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);

    fixture.detectChanges(); // ngOnInit

    // 攔截並回應兩個列表請求
    const academyReq = http.expectOne((req) =>
      req.url.startsWith(`${environment.apiUrl}/api/academy-exams`),
    );
    academyReq.flush({
      data: mockAcademyExams,
      meta: { total: mockAcademyExams.length, page: 1, pageSize: 200 },
    });

    const termReq = http.expectOne((req) =>
      req.url.startsWith(`${environment.apiUrl}/api/school-exams`),
    );
    termReq.flush({
      data: mockSchoolExams,
      meta: { total: mockSchoolExams.length, page: 1, pageSize: 200 },
    });

    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('merges academy and school exams and sorts by date desc', () => {
    const merged = component['mergedExams']();
    expect(merged.length).toBe(3);
    // 2026-04-10 school 最新，然後 2026-04-01 academy，最後 2026-03-15 academy
    expect(merged[0].id).toBe('t1');
    expect(merged[1].id).toBe('a1');
    expect(merged[2].id).toBe('a2');
  });

  it('filters by exam type chip — academy only hides school', () => {
    component['onExamTypeChange']('academy');
    const merged = component['mergedExams']();
    expect(merged.every((r) => r.kind === 'academy')).toBe(true);
    expect(merged.length).toBe(2);
  });

  it('filters by exam type chip — school only hides academy', () => {
    component['onExamTypeChange']('school');
    const merged = component['mergedExams']();
    expect(merged.every((r) => r.kind === 'school')).toBe(true);
    expect(merged.length).toBe(1);
  });

  it('computes todoCount as active exams with zero score', () => {
    // a1 (active, 0), t1 (active, 0), a2 (closed, 25) → 2
    expect(component['todoCount']()).toBe(2);
  });

  it('filters by status', () => {
    component['onStatusChange']('closed');
    const merged = component['mergedExams']();
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('a2');
  });

  it('hides school exams when campus filter is set', () => {
    component['onCampusChange']('c1');
    const merged = component['mergedExams']();
    expect(merged.every((r) => r.kind === 'academy')).toBe(true);
    expect(merged.length).toBe(2);
  });

  it('builds action menu with reopen for closed exam', () => {
    const merged = component['mergedExams']();
    const closedRow = merged.find((r) => r.status === 'closed');
    expect(closedRow).toBeTruthy();
    component['selectedRow'].set(closedRow ?? null);
    const items = component['actionMenuItems']();
    const labels = items.map((i) => i.label).filter(Boolean);
    expect(labels).toContain('重新開啟');
    expect(labels).not.toContain('結束考試');
  });

  it('builds action menu with close for active exam', () => {
    const merged = component['mergedExams']();
    const activeRow = merged.find((r) => r.status === 'active');
    expect(activeRow).toBeTruthy();
    component['selectedRow'].set(activeRow ?? null);
    const items = component['actionMenuItems']();
    const labels = items.map((i) => i.label).filter(Boolean);
    expect(labels).toContain('結束考試');
    expect(labels).not.toContain('重新開啟');
  });
});
