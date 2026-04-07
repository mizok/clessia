import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { StudentDetailPage } from './student-detail.page';
import { StudentsService } from '@core/students.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';

describe('StudentDetailPage', () => {
  let fixture: ComponentFixture<StudentDetailPage>;
  const seedStudentId = '61000000-0000-0000-0000-000000000001';
  const paramMap$ = new BehaviorSubject(convertToParamMap({ id: seedStudentId }));

  const studentsServiceMock = {
    get: vi.fn(() =>
      of({
        data: {
          id: seedStudentId,
          orgId: 'org-1',
          name: '出勤測試學生01',
          grade: 'J1',
          school: '測試國中',
          birthday: null,
          gender: null,
          phone: null,
          email: null,
          address: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          notes: null,
          isActive: true,
          parentNames: [],
          campusNames: [],
          hasEnrollments: true,
          createdAt: '2026-04-01T00:00:00Z',
          updatedAt: '2026-04-01T00:00:00Z',
          parents: [],
        },
      }),
    ),
  };
  const enrollmentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [],
        meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
      }),
    ),
    create: vi.fn(),
  };

  beforeEach(async () => {
    studentsServiceMock.get.mockClear();
    enrollmentsServiceMock.list.mockClear();

    await TestBed.configureTestingModule({
      imports: [StudentDetailPage],
      providers: [
        provideRouter([]),
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: seedStudentId }) },
            paramMap: paramMap$.asObservable(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('loads student and enrollments from route params', () => {
    expect(studentsServiceMock.get).toHaveBeenCalledWith(seedStudentId);
    expect(enrollmentsServiceMock.list).toHaveBeenCalledWith({
      studentId: seedStudentId,
      pageSize: 50,
    });
  });
});
