import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService, ConfirmationService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { CoursesPage } from './courses.page';
import { CoursesService } from '@core/courses.service';
import { ClassesService, type Class } from '@core/classes.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SessionsService, type Session } from '@core/sessions.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { BrowserStateService } from '@core/browser-state.service';

describe('CoursesPage', () => {
  let fixture: ComponentFixture<CoursesPage>;
  let component: CoursesPage;
  let router: Router;
  const confirmationServiceMock = {
    confirm: vi.fn(),
  };

  const coursesServiceMock = {
    list: vi.fn(() => of({ data: [] })),
    delete: vi.fn(),
  };
  const classesServiceMock = {
    list: vi.fn(() => of({ data: [] })),
    batchSetActive: vi.fn(() => of({ updated: 0 })),
  };
  const refDataMock = {
    campuses: signal<unknown[]>([]),
    subjects: signal<unknown[]>([]),
    teachers: signal<unknown[]>([]),
    loadCampuses: vi.fn(),
    loadSubjects: vi.fn(),
    loadTeachers: vi.fn(),
  };
  const sessionsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'session-1',
            classId: 'class-1',
            className: '數學 A 班',
            courseId: 'course-1',
            courseName: '數學',
            campusId: 'campus-1',
            campusName: '本校',
            sessionDate: '2026-02-10',
            startTime: '09:00',
            endTime: '11:00',
            teacherId: null,
            teacherName: null,
            status: 'scheduled',
            assignmentStatus: 'unassigned',
            hasChanges: false,
          },
          {
            id: 'session-2',
            classId: 'class-1',
            className: '數學 A 班',
            courseId: 'course-1',
            courseName: '數學',
            campusId: 'campus-1',
            campusName: '本校',
            sessionDate: '2026-06-18',
            startTime: '09:00',
            endTime: '11:00',
            teacherId: null,
            teacherName: null,
            status: 'scheduled',
            assignmentStatus: 'unassigned',
            hasChanges: false,
          },
        ],
      }),
    ),
  };

  beforeEach(async () => {
    sessionsServiceMock.list.mockClear();
    confirmationServiceMock.confirm.mockClear();

    await TestBed.configureTestingModule({
      imports: [CoursesPage],
      providers: [
        provideRouter([]),
        { provide: CoursesService, useValue: coursesServiceMock },
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: SessionsService, useValue: sessionsServiceMock },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        { provide: BrowserStateService, useValue: { isMobile: () => false } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: ConfirmationService, useValue: confirmationServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CoursesPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: '課程管理',
      relativePath: 'courses',
      absolutePath: '/admin/courses',
      role: undefined,
      icon: 'pi-users',
      showInMenu: true,
    });
    router = TestBed.inject(Router);
    await fixture.whenStable();
  });

  it('navigates to sessions list with first and last session dates for the class', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const cls = {
      id: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '數學 A 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      usesContactBook: false,
      orgId: 'org-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (
      component as unknown as { navigateToSessionsList: (target: Class) => void }
    ).navigateToSessionsList(cls);

    expect(sessionsServiceMock.list).toHaveBeenCalledWith({
      classId: 'class-1',
      campusIds: ['campus-1'],
      courseIds: ['course-1'],
    });
    expect(navigateSpy).toHaveBeenCalledWith(['/admin/sessions'], {
      queryParams: {
        classId: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
        from: '2026-02-10',
        to: '2026-06-18',
      },
    });
  });

  it('falls back to navigation without date range when session lookup fails', () => {
    sessionsServiceMock.list.mockReturnValueOnce(throwError(() => new Error('lookup failed')));
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const cls = {
      id: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '數學 A 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      usesContactBook: false,
      orgId: 'org-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (
      component as unknown as { navigateToSessionsList: (target: Class) => void }
    ).navigateToSessionsList(cls);

    expect(navigateSpy).toHaveBeenCalledWith(['/admin/sessions'], {
      queryParams: {
        classId: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
      },
    });
  });

  it('navigates to unassigned sessions with first and last unassigned session dates for the class', () => {
    const unassignedSessions: Session[] = [
      {
        id: 'session-1',
        classId: 'class-1',
        className: '數學 A 班',
        courseId: 'course-1',
        courseName: '數學',
        campusId: 'campus-1',
        campusName: '本校',
        sessionDate: '2026-03-15',
        startTime: '09:00',
        endTime: '11:00',
        teacherId: null,
        teacherName: null,
        status: 'scheduled',
        assignmentStatus: 'unassigned',
        hasChanges: false,
      },
      {
        id: 'session-2',
        classId: 'class-1',
        className: '數學 A 班',
        courseId: 'course-1',
        courseName: '數學',
        campusId: 'campus-1',
        campusName: '本校',
        sessionDate: '2026-04-20',
        startTime: '09:00',
        endTime: '11:00',
        teacherId: null,
        teacherName: null,
        status: 'scheduled',
        assignmentStatus: 'unassigned',
        hasChanges: false,
      },
      {
        id: 'session-3',
        classId: 'class-1',
        className: '數學 A 班',
        courseId: 'course-1',
        courseName: '數學',
        campusId: 'campus-1',
        campusName: '本校',
        sessionDate: '2026-04-25',
        startTime: '09:00',
        endTime: '11:00',
        teacherId: 'teacher-1',
        teacherName: '王老師',
        status: 'scheduled',
        assignmentStatus: 'assigned',
        hasChanges: false,
      },
    ];
    (sessionsServiceMock.list as any).mockReturnValueOnce(
      of({
        data: unassignedSessions,
      }),
    );
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const cls = {
      id: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '數學 A 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      usesContactBook: false,
      orgId: 'org-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (
      component as unknown as { navigateToUnassignedSessions: (target: Class) => void }
    ).navigateToUnassignedSessions(cls);

    expect(navigateSpy).toHaveBeenCalledWith(['/admin/sessions'], {
      queryParams: {
        classId: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
        assignmentStatus: 'unassigned',
        from: '2026-03-15',
        to: '2026-04-20',
      },
    });
  });

  it('uses hasPastSessions instead of scheduleCount for delete warning copy', () => {
    const dialogService = fixture.debugElement.injector.get(DialogService);
    const openSpy = vi.spyOn(dialogService, 'open');
    const cls = {
      id: 'class-2',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '英文 B 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      usesContactBook: false,
      orgId: 'org-1',
      scheduleCount: 2,
      hasPastSessions: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (component as unknown as { confirmDeleteClass: (target: Class) => void }).confirmDeleteClass(
      cls,
    );

    expect(openSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          message: '確定要刪除班級「英文 B 班」嗎？此操作無法復原。',
        }),
      }),
    );
  });

  it('explains that batch deactivate keeps existing scheduled sessions', () => {
    const dialogService = fixture.debugElement.injector.get(DialogService);
    const openSpy = vi.spyOn(dialogService, 'open');

    (
      component as unknown as {
        classes: { set: (value: Class[]) => void };
        selectedClassIds: { set: (value: Set<string>) => void };
        batchDeactivate: () => void;
      }
    ).classes.set([
      {
        id: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
        name: '數學 A 班',
        maxStudents: 20,
        gradeLevels: [],
        nextClassId: null,
        isActive: true,
        usesContactBook: false,
        orgId: 'org-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as Class,
    ]);
    (
      component as unknown as {
        selectedClassIds: { set: (value: Set<string>) => void };
      }
    ).selectedClassIds.set(new Set(['class-1']));

    (component as unknown as { batchDeactivate: () => void }).batchDeactivate();

    expect(openSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          message:
            '確定要停用這 1 個班級嗎？僅會停用班級本身，已排課堂維持原樣；停用後無法新增報名與產生課堂。',
        }),
      }),
    );
  });

  it('filters teacher options by selected campus tab', () => {
    refDataMock.teachers.set([
      {
        id: 'teacher-1',
        displayName: '王老師',
        subjectNames: ['數學'],
        campusIds: ['campus-1'],
      },
      {
        id: 'teacher-2',
        displayName: '李老師',
        subjectNames: ['英文'],
        campusIds: ['campus-2'],
      },
      {
        id: 'teacher-3',
        displayName: '陳老師',
        subjectNames: ['理化'],
        campusIds: ['campus-1', 'campus-2'],
      },
    ]);

    (
      component as unknown as {
        onCampusTabChange: (value: string | number | null | undefined) => void;
        filteredStaffOptions: () => Array<{ value: string }>;
      }
    ).onCampusTabChange('campus-1');

    const options = (
      component as unknown as {
        filteredStaffOptions: () => Array<{ value: string }>;
      }
    ).filteredStaffOptions();

    expect(options.map((option) => option.value)).toEqual(['teacher-1', 'teacher-3']);
  });

  it('removes selected teachers that do not belong to the active campus tab', () => {
    refDataMock.teachers.set([
      {
        id: 'teacher-1',
        displayName: '王老師',
        subjectNames: ['數學'],
        campusIds: ['campus-1'],
      },
      {
        id: 'teacher-2',
        displayName: '李老師',
        subjectNames: ['英文'],
        campusIds: ['campus-2'],
      },
      {
        id: 'teacher-3',
        displayName: '陳老師',
        subjectNames: ['理化'],
        campusIds: ['campus-1', 'campus-2'],
      },
    ]);

    (
      component as unknown as {
        selectedTeacherIds: { set: (value: string[]) => void };
        onCampusTabChange: (value: string | number | null | undefined) => void;
      }
    ).selectedTeacherIds.set(['teacher-1', 'teacher-2', 'teacher-3']);

    (
      component as unknown as {
        onCampusTabChange: (value: string | number | null | undefined) => void;
      }
    ).onCampusTabChange('campus-1');

    const selectedTeacherIds = (
      component as unknown as {
        selectedTeacherIds: () => string[];
      }
    ).selectedTeacherIds();

    expect(selectedTeacherIds).toEqual(['teacher-1', 'teacher-3']);
  });

  /**
   * **把所有取數收進同一條 `switchMap` 會帶來一個新的失效模式：
   * 內層一 error，外層管線就終止 —— 之後這一頁永遠不會再載入任何東西。**
   *
   * 修改前每次取數是各自獨立的訂閱，錯一次只影響那一次；改成單一管線之後，
   * **一次網路錯誤會把搜尋框變成死的**，而畫面上只有一則 toast，
   * 看起來像「這次失敗了」而不是「這一頁壞了」。
   *
   * 這條釘住「錯過一次之後還能再查」。**沒有它，下一個重構的人會把
   * `catchError` 拿掉，而那個缺陷安靜到沒有人會回報。**
   *
   * 這支 spec 的其他測試用的是立即完成的 `of()` 替身，餵不出「還沒回來的請求」——
   * 所以這一區自己換上可控的 `Subject` 替身，並在收尾時換回去。
   */
  describe('搜尋管線的錯誤復原（#689）', () => {
    const pending: Array<Subject<{ data: never[] }>> = [];

    beforeEach(() => {
      // 這個 app 是 zoneless（Angular 21 + signals），沒有 `fakeAsync` ——
      // 時間用 vitest 的假計時器控制。`debounceTime` 走 asyncScheduler 的 setTimeout。
      vi.useFakeTimers();
      pending.length = 0;
      coursesServiceMock.list.mockReset();
      coursesServiceMock.list.mockImplementation(() => {
        const subject = new Subject<{ data: never[] }>();
        pending.push(subject);
        return subject.asObservable();
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      coursesServiceMock.list.mockReset();
      coursesServiceMock.list.mockImplementation(() => of({ data: [] }));
    });

    it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
      const type = (text: string) =>
        (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(text);

      type('數學');
      vi.advanceTimersByTime(300);
      expect(coursesServiceMock.list).toHaveBeenCalledTimes(1);

      pending[0].error(new Error('boom'));

      type('英文');
      vi.advanceTimersByTime(300);

      expect(coursesServiceMock.list).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * **#788：取數失敗時畫面不能渲染成「尚未有資料」。**
   * 斷言**畫面主體**而不是某個 signal —— 使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」而不是「尚未建立任何課程」', () => {
    coursesServiceMock.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    (component as unknown as { loadCourses: () => void }).loadCourses();
    if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('載入失敗');
    expect(text).not.toContain('尚未建立任何課程');
  });
});
