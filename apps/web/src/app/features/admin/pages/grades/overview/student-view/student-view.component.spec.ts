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

import { StudentViewComponent } from './student-view.component';

describe('StudentViewComponent', () => {
  let fixture: ComponentFixture<StudentViewComponent>;
  let component: StudentViewComponent;
  let http: HttpTestingController;

  const openMock = vi.fn();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: openMock } },
      ],
    })
      .overrideComponent(StudentViewComponent, {
        set: {
          providers: [
            { provide: MessageService, useValue: { add: vi.fn() } },
            { provide: DialogService, useValue: { open: openMock } },
          ],
        },
      })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudentViewComponent);
    component = fixture.componentInstance;
    openMock.mockReset();
  });

  afterEach(() => {
    const pending = http.match(() => true);
    pending.forEach((req) => {
      if (!req.cancelled) {
        req.flush({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 } });
      }
    });
    http.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads students on init with active filter by default', () => {
    fixture.detectChanges();

    const studentsReq = http.expectOne((req) => req.url.includes('/api/students'));
    expect(studentsReq.request.params.get('isActive')).toBe('true');
    studentsReq.flush({
      data: [],
      meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 },
    });

    const schoolsReq = http.expectOne((req) => req.url.includes('/api/schools'));
    schoolsReq.flush({ data: [], meta: { total: 0 } });

    const campusReq = http.expectOne((req) => req.url.includes('/api/campuses'));
    campusReq.flush({
      data: [],
      meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    });

    expect((component as any).loadingList()).toBe(false);
  });

  it('opens score detail dialog when selecting student', () => {
    const student = { id: 's1', name: '王小明', grade: 'J1' } as any;

    (component as any).selectStudent(student);

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.student.id).toBe('s1');
  });

  it('renders paged students rows', () => {
    const vm = component as any;

    fixture.detectChanges();
    http.match(() => true).forEach((req) =>
      req.flush({ data: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } }),
    );

    vm.loadingList.set(false);
    vm.rawStudents.set([
      {
        id: 's1',
        name: '王小明',
        grade: 'J1',
        campusNames: [],
        isActive: true,
        school: null,
      },
      {
        id: 's2',
        name: '李小華',
        grade: 'J2',
        campusNames: [],
        isActive: true,
        school: null,
      },
    ]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll('.student-view__row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('王小明');
    expect(rows[0].textContent).toContain('國一');
  });
});
