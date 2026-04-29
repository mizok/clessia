import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';

import { ClassViewComponent } from './class-view.component';

describe('ClassViewComponent', () => {
  let fixture: ComponentFixture<ClassViewComponent>;
  let component: ClassViewComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClassViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        MessageService,
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ClassViewComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    // Flush any pending requests (campus load triggered by ngOnInit)
    const pending = http.match(() => true);
    pending.forEach((req) => {
      if (!req.cancelled) req.flush({ data: [], summary: {}, meta: {} });
    });
    http.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start with no campus selected', () => {
    expect(component['campusId']()).toBe('');
    expect(component['selectedClassId']()).toBeNull();
  });

  it('should load grouped classes with a single classes request on campus change', () => {
    component['onCampusChange']('campus-1');
    expect(component['campusId']()).toBe('campus-1');

    const classRequests = http.match((r) => r.url.includes('/api/classes'));
    expect(classRequests).toHaveLength(1);
    expect(http.match((r) => r.url.includes('/api/courses'))).toHaveLength(0);

    classRequests[0].flush({
      data: [
        {
          id: 'class-1',
          orgId: 'org-1',
          campusId: 'campus-1',
          courseId: 'course-1',
          courseName: '數學進階',
          campusName: '台北校',
          name: 'A班',
          maxStudents: 20,
          gradeLevels: ['J1', 'J2', 'J3'],
          subjectName: '數學',
          nextClassId: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'class-2',
          orgId: 'org-1',
          campusId: 'campus-1',
          courseId: 'course-1',
          courseName: '數學進階',
          campusName: '台北校',
          name: 'B班',
          maxStudents: 25,
          gradeLevels: ['J1', 'J2', 'J3'],
          subjectName: '數學',
          nextClassId: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'class-3',
          orgId: 'org-1',
          campusId: 'campus-1',
          courseId: 'course-2',
          courseName: '英文衝刺',
          campusName: '台北校',
          name: 'C班',
          maxStudents: 18,
          gradeLevels: ['J2'],
          subjectName: '英文',
          nextClassId: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      meta: { total: 2, page: 1, pageSize: 100, totalPages: 1 },
    });

    const groups = component['courseGroups']();
    expect(groups).toHaveLength(2);
    expect(groups[0].courseName).toBe('數學進階');
    expect(groups[0].gradeRange).toBe('國一～國三');
    expect(groups[0].classes).toHaveLength(2);
    expect(groups[0].subjectName).toBe('數學');
  });

  it('should filter groups by searchText', () => {
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [
          { id: 'cl1', name: 'A班', maxStudents: 20, gradeLabels: '國一' },
          { id: 'cl2', name: 'B班', maxStudents: 20, gradeLabels: '國一' },
        ],
      },
      {
        courseId: 'c2',
        courseName: '英文',
        subjectName: '英文',
        gradeRange: '國二',
        classes: [{ id: 'cl3', name: 'C班', maxStudents: 20, gradeLabels: '國二' }],
      },
    ]);

    component['searchText'].set('數學');
    expect(component['filteredGroups']()).toHaveLength(1);
    expect(component['filteredGroups']()[0].classes).toHaveLength(2);

    component['searchText'].set('C班');
    expect(component['filteredGroups']()).toHaveLength(1);
    expect(component['filteredGroups']()[0].courseName).toBe('英文');

    component['searchText'].set('');
    expect(component['filteredGroups']()).toHaveLength(2);
  });

  it('should select a class and load its exams', () => {
    const cls = { id: 'class-1', name: 'A班', maxStudents: 20, gradeLabels: '國一' };
    component['selectClass'](cls as any);

    expect(component['selectedClassId']()).toBe('class-1');
    expect(component['selectedClassName']()).toBe('A班');

    const examsReq = http.expectOne((r) => r.url.includes('/api/academy-exams'));
    examsReq.flush({
      data: [{ id: 'e1', name: 'Quiz 1', examDate: '2026-04-01' }],
      meta: { total: 1, page: 1, pageSize: 200 },
    });

    expect(component['exams']()).toHaveLength(1);
    expect(component['examOptions']()[0].label).toContain('Quiz 1');
  });

  it('should toggle selection when same class clicked again', () => {
    const cls = { id: 'class-1', name: 'A班', maxStudents: 20, gradeLabels: '國一' };
    component['selectedClassId'].set('class-1');
    component['selectedClassName'].set('A班');
    component['exams'].set([{ id: 'e1' }] as any);

    component['selectClass'](cls as any);

    expect(component['selectedClassId']()).toBeNull();
    expect(component['exams']()).toEqual([]);
  });

  it('should load stats when exam is selected', () => {
    component['selectedClassId'].set('class-1');
    component['onExamChange']('exam-1');

    const req = http.expectOne((r) => r.url.includes('/api/scores/class/class-1/exam/exam-1'));
    req.flush({
      data: {
        examId: 'exam-1',
        examName: 'Quiz 1',
        className: 'A班',
        summary: {
          averageScore: 82.5,
          highestScore: 95,
          lowestScore: 60,
          absentCount: 1,
          recordedCount: 9,
        },
        scores: [],
      },
    });

    expect(component['stats']()).not.toBeNull();
    expect(component['stats']()!.summary.averageScore).toBe(82.5);
  });

  it('should sort scores descending with nulls last', () => {
    component['stats'].set({
      examId: 'e1',
      examName: 'Quiz 1',
      className: 'A班',
      summary: {
        averageScore: 77.5,
        highestScore: 95,
        lowestScore: 60,
        absentCount: 1,
        recordedCount: 2,
      },
      scores: [
        { studentId: 's3', studentName: '張大偉', score: 60, status: 'scored', notes: null },
        { studentId: 's2', studentName: '李小花', score: null, status: 'absent', notes: null },
        { studentId: 's1', studentName: '王小明', score: 95, status: 'scored', notes: null },
      ],
    } as any);

    const sorted = component['sortedScores']();
    expect(sorted[0].studentName).toBe('王小明');
    expect(sorted[1].studentName).toBe('張大偉');
    expect(sorted[2].studentName).toBe('李小花');
  });

  it('should return correct status labels and severities', () => {
    expect(component['getStatusLabel']('scored')).toBe('已登錄');
    expect(component['getStatusLabel']('absent')).toBe('缺考');
    expect(component['getStatusLabel']('makeup')).toBe('補考');

    expect(component['getStatusSeverity']('scored')).toBe('success');
    expect(component['getStatusSeverity']('absent')).toBe('danger');
    expect(component['getStatusSeverity']('makeup')).toBe('warn');
  });

  it('renders course groups with class rows', () => {
    component['campusId'].set('campus-1');
    component['loadingGroups'].set(false);
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學進階',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [{ id: 'cl1', name: 'A班', maxStudents: 20, gradeLabels: '國一' }],
      },
    ]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.class-view__course-group')).not.toBeNull();
    expect(host.textContent).toContain('數學進階');
    expect(host.textContent).toContain('A班');
    expect(host.textContent).toContain('上限 20 人');
  });
});
