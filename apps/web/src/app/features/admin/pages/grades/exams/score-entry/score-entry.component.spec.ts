import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ScoreEntryComponent } from './score-entry.component';
import { environment } from '@env/environment';
import { ReferenceDataService } from '@core/reference-data.service';

describe('ScoreEntryComponent', () => {
  let component: ScoreEntryComponent;
  let fixture: ComponentFixture<ScoreEntryComponent>;
  let http: HttpTestingController;

  const mockAcademyDetail = {
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
    classes: [
      { classId: 'cls-1', className: '數學A班' },
      { classId: 'cls-2', className: '數學B班' },
    ],
    summary: {
      averageScore: 72.3,
      highestScore: 98,
      lowestScore: 35,
      absentCount: 2,
      recordedCount: 28,
    },
    createdBy: null,
    createdAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
  };

  const mockScores = [
    {
      studentId: 'stu-1',
      studentName: '王小明',
      studentGrade: '國一',
      score: 85,
      status: 'scored',
      notes: null,
      updatedAt: '2026-04-01T00:00:00Z',
    },
  ];

  const refDataStub = {
    campuses: () => [],
    subjects: () => [],
    teachers: () => [],
    loadCampuses: () => undefined,
    loadSubjects: () => undefined,
    loadTeachers: () => undefined,
  };

  /** Flush both the exam detail and the child editor's getScores request */
  function flushAcademyRequests(examData = mockAcademyDetail): void {
    const examReq = http.expectOne(`${environment.apiUrl}/api/academy-exams/a1`);
    examReq.flush({ data: examData });

    // Child AcademyScoreEditorComponent fires getScores after exam loads
    fixture.detectChanges();
    const scoresReq = http.match(`${environment.apiUrl}/api/academy-exams/a1/scores`);
    scoresReq.forEach((r) => r.flush({ data: mockScores }));
  }

  async function setup(type: string, id: string) {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [ScoreEntryComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ReferenceDataService, useValue: refDataStub },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { params: { type, id } },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScoreEntryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);

    fixture.detectChanges(); // ngOnInit
  }

  afterEach(() => {
    http.verify();
  });

  it('should create and load academy exam', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component['type']()).toBe('academy');
    expect(component['examInfo']()?.name).toBe('數學小考');
  });

  it('computes summary stats for academy', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    fixture.detectChanges();

    const stats = component['summaryStats']();
    expect(stats?.recordedCount).toBe(28);
    expect(stats?.average).toBe(72.3);
    expect(stats?.highest).toBe(98);
    expect(stats?.lowest).toBe(35);
  });

  it('builds meta line with type, subject, date, classes', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    fixture.detectChanges();

    const info = component['examInfo']();
    expect(info?.metaLine).toContain('小考');
    expect(info?.metaLine).toContain('數學');
    expect(info?.metaLine).toContain('數學A班');
  });

  it('loads school exam', async () => {
    await setup('school', 't1');

    const req = http.expectOne(`${environment.apiUrl}/api/school-exams/t1`);
    req.flush({
      data: {
        id: 't1',
        academicYear: 114,
        semester: 2,
        examType: 'term_exam',
        subjectId: 's1',
        subjectName: '國文',
        name: null,
        label: '114-2 段考',
        examDate: '2026-04-10',
        status: 'active',
        schoolId: 'sch-1',
        schoolName: '測試國中',
        summary: { bySubject: [], totalRecordedCount: 15 },
        createdAt: '2026-03-20T00:00:00Z',
        updatedAt: '2026-03-20T00:00:00Z',
      },
    });

    fixture.detectChanges();
    // Term editor fires getRecentStudents
    const recentReq = http.match(`${environment.apiUrl}/api/school-exams/t1/recent-students`);
    recentReq.forEach((r) => r.flush({ data: [] }));

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['type']()).toBe('school');
    expect(component['examInfo']()?.name).toBe('114-2 段考');
    expect(component['examInfo']()?.metaLine).toContain('科目：國文');
    expect(component['summaryStats']()?.recordedCount).toBe(15);
  });

  it('detects closed status', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests({ ...mockAcademyDetail, status: 'closed' as const });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['isClosed']()).toBe(true);
    expect(component['canSave']()).toBe(false);
  });

  it('canDeactivate returns true when not dirty', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    expect(component.canDeactivate()).toBe(true);
  });

  it('canSave is false when not dirty', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['canSave']()).toBe(false);
    component['dirty'].set(true);
    expect(component['canSave']()).toBe(true);
  });

  it('renders the mobile-ready shell structure', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests({ ...mockAcademyDetail, status: 'closed' as const });

    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.score-entry__header-card')).not.toBeNull();
    expect(host.querySelector('.score-entry__editor')).not.toBeNull();
    expect(host.querySelector('.score-entry__closed-hint')).not.toBeNull();
    // FAB is hidden when exam is closed
    expect(host.querySelector('.score-entry__fab')).toBeNull();
  });

  it('shows FAB save button when editor has unsaved changes', async () => {
    await setup('academy', 'a1');
    flushAcademyRequests();

    await fixture.whenStable();
    component['dirty'].set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const fab = host.querySelector('.score-entry__fab');

    expect(fab).not.toBeNull();
    expect(fab?.textContent).toContain('儲存成績');
  });
});
