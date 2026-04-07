import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { ClassDetailPage } from './class-detail.page';
import { ClassesService } from '@core/classes.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';

describe('ClassDetailPage', () => {
  let fixture: ComponentFixture<ClassDetailPage>;
  let component: ClassDetailPage;
  const seedCourseId = 'b29e3697-08da-4b50-8fc8-6834c23e954e';
  const seedClassId = '62000000-0000-0000-0000-000000000001';

  const classesServiceMock = {
    get: vi.fn(() =>
      of({
        data: {
          id: seedClassId,
          orgId: 'org-1',
          campusId: 'campus-1',
          courseId: seedCourseId,
          courseName: '英文',
          name: '英文班 B',
          maxStudents: 20,
          gradeLevels: ['J2'],
          nextClassId: null,
          isActive: true,
          createdAt: '2026-04-01T00:00:00Z',
          updatedAt: '2026-04-01T00:00:00Z',
          schedules: [],
        },
      }),
    ),
  };
  const enrollmentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [],
        meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 },
      }),
    ),
    updateStatus: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    classesServiceMock.get.mockClear();
    enrollmentsServiceMock.list.mockClear();
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as typeof ResizeObserver;

    await TestBed.configureTestingModule({
      imports: [ClassDetailPage],
      providers: [
        provideRouter([]),
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: (key: string) =>
                  key === 'classId' ? seedClassId : key === 'courseId' ? seedCourseId : null,
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('loads class and enrollments from route params even without component input binding', () => {
    expect(component).toBeTruthy();
    expect(classesServiceMock.get).toHaveBeenCalledWith(seedClassId);
    expect(enrollmentsServiceMock.list).toHaveBeenCalledWith({
      classId: seedClassId,
      pageSize: 100,
    });
  });

  it('shows grade chips in the hero summary block', () => {
    const gradeChip = fixture.nativeElement.querySelector('.class-detail__hero-grade-chip');

    expect(gradeChip?.textContent).toContain('國二');
  });
});
