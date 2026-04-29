import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';

import { StudentViewComponent } from './student-view.component';

describe('StudentViewComponent', () => {
  let fixture: ComponentFixture<StudentViewComponent>;
  let component: StudentViewComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        MessageService,
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudentViewComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    // Flush any pending campus list request triggered by ngOnInit
    const pending = http.match(() => true);
    pending.forEach((req) => {
      if (!req.cancelled) req.flush({ data: [], summary: {}, meta: {} });
    });
    http.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start with no selected student', () => {
    expect(component['selectedStudent']()).toBeNull();
  });

  it('should select student and load scores', () => {
    const student = { id: 's1', name: '王小明', grade: 'J1', school: '測試國中' } as any;
    component['selectStudent'](student);

    expect(component['selectedStudent']()).toEqual(student);

    const scoresReq = http.expectOne((r) => r.url.includes('/api/scores') && !r.url.includes('summary'));
    scoresReq.flush({ data: [], meta: { total: 0, page: 1, pageSize: 200 } });

    const summaryReq = http.expectOne((r) => r.url.includes('/api/scores/student/s1/summary'));
    summaryReq.flush({ data: { studentId: 's1', studentName: '王小明', subjects: [] } });
  });

  it('should clear state when dialog closes', () => {
    const student = { id: 's1', name: '王小明', grade: 'J1' } as any;
    component['selectedStudent'].set(student);
    component['scores'].set([{ id: '1' }] as any);

    component['onDialogHide']();

    expect(component['selectedStudent']()).toBeNull();
    expect(component['scores']()).toEqual([]);
  });

  it('should filter scores by type', () => {
    component['scores'].set([
      { id: '1', type: 'academy', examName: 'Quiz 1', subjectName: '數學', examDate: '2026-04-01' },
      { id: '2', type: 'school', examName: '段考一', subjectName: '英文', examDate: '2026-04-01' },
      { id: '3', type: 'academy', examName: 'Quiz 2', subjectName: '數學', examDate: '2026-04-01' },
    ] as any);

    component['typeFilter'].set('academy');
    expect(component['filteredScores']()).toHaveLength(2);

    component['typeFilter'].set('school');
    expect(component['filteredScores']()).toHaveLength(1);

    component['typeFilter'].set('all');
    expect(component['filteredScores']()).toHaveLength(3);
  });

  it('should filter scores by subject', () => {
    component['scores'].set([
      { id: '1', type: 'academy', subjectName: '數學', examDate: '2026-04-01' },
      { id: '2', type: 'academy', subjectName: '英文', examDate: '2026-04-01' },
      { id: '3', type: 'school', subjectName: '數學', examDate: '2026-04-01' },
    ] as any);

    component['subjectFilter'].set('數學');
    expect(component['filteredScores']()).toHaveLength(2);

    component['subjectFilter'].set('英文');
    expect(component['filteredScores']()).toHaveLength(1);

    component['subjectFilter'].set(null);
    expect(component['filteredScores']()).toHaveLength(3);
  });

  it('should filter scores by time range', () => {
    const now = new Date();
    const recent = now.toISOString().split('T')[0];
    const old = '2025-01-01';

    component['scores'].set([
      { id: '1', type: 'academy', subjectName: '數學', examDate: recent },
      { id: '2', type: 'academy', subjectName: '英文', examDate: old },
    ] as any);

    component['timeRange'].set('1m');
    expect(component['filteredScores']()).toHaveLength(1);
    expect(component['filteredScores']()[0].id).toBe('1');

    component['timeRange'].set('all');
    expect(component['filteredScores']()).toHaveLength(2);
  });

  it('should extract unique subject options from scores', () => {
    component['scores'].set([
      { id: '1', subjectName: '數學', examDate: '2026-04-01' },
      { id: '2', subjectName: '英文', examDate: '2026-04-01' },
      { id: '3', subjectName: '數學', examDate: '2026-04-01' },
      { id: '4', subjectName: null, examDate: '2026-04-01' },
    ] as any);

    const options = component['subjectOptions']();
    expect(options).toHaveLength(2);
    expect(options.map((o: any) => o.value)).toEqual(['英文', '數學']);
  });

  it('should format scores correctly', () => {
    expect(component['formatScore'](85, 100)).toBe('85 / 100');
    expect(component['formatScore'](90, null)).toBe('90');
    expect(component['formatScore'](null, 100)).toBe('—');
  });

  it('should format grade labels', () => {
    expect(component['formatGrade']('J1')).toBe('國一');
    expect(component['formatGrade']('P3')).toBe('小三');
  });

  it('renders student list rows when students loaded', () => {
    fixture.detectChanges();

    // Flush the list request triggered by ngOnInit
    const pending = http.match((r) => r.url.includes('/api/students'));
    pending.forEach((req) =>
      req.flush({ data: [], meta: { total: 0, page: 1, pageSize: 8, totalPages: 0 } }),
    );

    component['loadingList'].set(false);
    component['studentList'].set([
      { id: 's1', name: '王小明', grade: 'J1' },
      { id: 's2', name: '李小華', grade: 'J2' },
    ] as any);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll('.student-view__row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('王小明');
    expect(rows[0].textContent).toContain('國一');
  });
});
