import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { vi } from 'vitest';

import { ClassViewComponent } from './class-view.component';

describe('ClassViewComponent', () => {
  let fixture: ComponentFixture<ClassViewComponent>;
  let component: ClassViewComponent;
  let http: HttpTestingController;

  const openMock = vi.fn();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClassViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DialogService, useValue: { open: openMock } },
      ],
    })
      .overrideComponent(ClassViewComponent, {
        set: {
          providers: [
            { provide: DialogService, useValue: { open: openMock } },
            { provide: MessageService, useValue: { add: vi.fn() } },
          ],
        },
      })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ClassViewComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    const pending = http.match(() => true);
    pending.forEach((req) => {
      if (!req.cancelled) req.flush({ data: [], summary: {}, meta: {} });
    });
    http.verify();
    openMock.mockReset();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start with no campus selected', () => {
    expect(component['campusId']()).toBe('');
    expect(component['searchText']()).toBe('');
  });

  it('should load grouped classes with a single classes request on campus change', () => {
    component['onCampusChange']('campus-1');
    expect(component['campusId']()).toBe('campus-1');

    const classRequests = http.match((r) => r.url.includes('/api/classes'));
    expect(classRequests).toHaveLength(1);

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
      ],
      meta: { total: 2, page: 1, pageSize: 100, totalPages: 1 },
    });

    const groups = component['courseGroups']();
    expect(groups).toHaveLength(1);
    expect(groups[0].courseName).toBe('數學進階');
    expect(groups[0].gradeRange).toBe('國一～國三');
    expect(groups[0].classes).toHaveLength(2);
  });

  it('should filter groups by searchText', () => {
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學',
        subjectId: 'sub-1',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [
          {
            classInfo: {
              id: 'cl1',
              name: 'A班',
              maxStudents: 20,
              gradeLevels: ['J1'],
              courseId: 'c1',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國一',
            gradeLevels: ['J1'],
          },
        ],
      },
      {
        courseId: 'c2',
        courseName: '英文',
        subjectId: 'sub-2',
        subjectName: '英文',
        gradeRange: '國二',
        classes: [
          {
            classInfo: {
              id: 'cl2',
              name: 'C班',
              maxStudents: 20,
              gradeLevels: ['J2'],
              courseId: 'c2',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國二',
            gradeLevels: ['J2'],
          },
        ],
      },
    ] as any);

    component['searchText'].set('數學');
    expect(component['filteredGroups']()).toHaveLength(1);

    component['searchText'].set('C班');
    expect(component['filteredGroups']()).toHaveLength(1);
    expect(component['filteredGroups']()[0].courseName).toBe('英文');

    component['searchText'].set('');
    expect(component['filteredGroups']()).toHaveLength(2);
  });

  it('should open class scores dialog with class data', () => {
    const cls = {
      id: 'class-1',
      name: 'A班',
      maxStudents: 20,
      gradeLevels: ['J1'],
      courseId: 'course-1',
      campusId: 'campus-1',
      orgId: 'org-1',
      nextClassId: null,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    } as any;

    component['campusId'].set('campus-1');
    component['openClassScores'](cls);

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.class.id).toBe('class-1');
    expect(config.data.campusId).toBe('campus-1');
    expect(config.data.todoOnly).toBe(false);
    expect(config.showHeader).toBe(false);
  });

  it('row click 應以 todoOnly = false 開啟 dialog', () => {
    component['campusId'].set('campus-1');
    component['loadingGroups'].set(false);
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學進階',
        subjectId: 'sub-1',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [
          {
            classInfo: {
              id: 'cl1',
              name: 'A班',
              maxStudents: 20,
              gradeLevels: ['J1'],
              courseId: 'c1',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國一',
            gradeLevels: ['J1'],
          },
        ],
      },
    ] as any);
    fixture.detectChanges();

    const rowButton = fixture.nativeElement.querySelector('.class-view__class-row') as HTMLButtonElement;
    rowButton.click();

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.todoOnly).toBe(false);
  });

  it('點待登錄徽章應以 todoOnly = true 開啟 dialog，且不觸發 row click', () => {
    component['campusId'].set('campus-1');
    component['loadingGroups'].set(false);
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學進階',
        subjectId: 'sub-1',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [
          {
            classInfo: {
              id: 'cl1',
              name: 'A班',
              maxStudents: 20,
              gradeLevels: ['J1'],
              courseId: 'c1',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國一',
            gradeLevels: ['J1'],
          },
        ],
      },
    ] as any);
    component['todoExamCountMap'].set({ cl1: 2 });
    fixture.detectChanges();

    const todoButton = fixture.nativeElement.querySelector('.class-view__class-todo') as HTMLButtonElement;
    todoButton.click();

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.todoOnly).toBe(true);
  });

  it('renders course groups with class rows', () => {
    component['campusId'].set('campus-1');
    component['loadingGroups'].set(false);
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學進階',
        subjectId: 'sub-1',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [
          {
            classInfo: {
              id: 'cl1',
              name: 'A班',
              maxStudents: 20,
              gradeLevels: ['J1'],
              courseId: 'c1',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國一',
            gradeLevels: ['J1'],
          },
        ],
      },
    ] as any);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.class-view__course-group')).not.toBeNull();
    expect(host.textContent).toContain('數學進階');
    expect(host.textContent).toContain('A班');
    expect(host.textContent).toContain('上限 20 人');
  });
});
