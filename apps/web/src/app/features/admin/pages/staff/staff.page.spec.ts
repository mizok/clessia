import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService } from '@core/campuses.service';
import { StaffService } from '@core/staff.service';
import { SubjectsService } from '@core/subjects.service';
import type { Staff } from '@core/staff.service';
import { vi } from 'vitest';

import { StaffPage } from './staff.page';

describe('StaffPage', () => {
  let component: StaffPage;
  let fixture: ComponentFixture<StaffPage>;
  const buildStaffResponse = (overrides?: Partial<{
    data: Staff[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
    summary: { total: number; adminCount: number; teacherCount: number; activeCount: number };
  }>) => ({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    summary: { total: 0, adminCount: 0, teacherCount: 0, activeCount: 0 },
    ...overrides,
  });
  const staffServiceMock = {
    list: vi.fn(() => of(buildStaffResponse())),
  };

  beforeEach(async () => {
    staffServiceMock.list.mockReset();
    staffServiceMock.list.mockReturnValue(of(buildStaffResponse()));

    await TestBed.configureTestingModule({
      imports: [StaffPage],
      providers: [
        {
          provide: StaffService,
          useValue: staffServiceMock,
        },
        {
          provide: CampusesService,
          useValue: {
            list: () => of({ data: [] }),
          },
        },
        {
          provide: SubjectsService,
          useValue: {
            list: () => of({ data: [] }),
          },
        },
        {
          provide: OverlayContainerService,
          useValue: {
            getContainer: () => null,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StaffPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('uses 20 records per page', () => {
    expect((component as unknown as { PAGE_SIZE: number }).PAGE_SIZE).toBe(20);
  });

  it('shows the total staff count in the summary card', () => {
    const staff = [
      {
        id: 'staff-1',
        userId: 'user-1',
        orgId: 'org-1',
        displayName: '王老師',
        phone: null,
        email: 'wang@example.com',
        birthday: null,
        notes: null,
        subjectIds: [],
        subjectNames: [],
        isActive: true,
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
        campusIds: [],
        roles: ['teacher'],
        permissions: [],
      },
    ] satisfies Staff[];

    (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
    (component as unknown as { staffList: { set: (value: Staff[]) => void } }).staffList.set(staff);
    (component as unknown as { total: { set: (value: number) => void } }).total.set(128);
    (
      component as unknown as {
        summary: {
          set: (value: { total: number; adminCount: number; teacherCount: number; activeCount: number }) => void;
        };
      }
    ).summary.set({
      total: 128,
      adminCount: 0,
      teacherCount: 1,
      activeCount: 1,
    });
    fixture.detectChanges();

    const statValues = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.staff__stat-value'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(statValues[0]).toBe('128');
  });

  it('shows summary counts returned by the API', () => {
    const staff = [
      {
        id: 'staff-1',
        userId: 'user-1',
        orgId: 'org-1',
        displayName: '王老師',
        phone: null,
        email: 'wang@example.com',
        birthday: null,
        notes: null,
        subjectIds: [],
        subjectNames: [],
        isActive: true,
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
        campusIds: [],
        roles: ['teacher'],
        permissions: [],
      },
    ] satisfies Staff[];

    (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
    (component as unknown as { staffList: { set: (value: Staff[]) => void } }).staffList.set(staff);
    (
      component as unknown as {
        summary: {
          set: (value: { total: number; adminCount: number; teacherCount: number; activeCount: number }) => void;
        };
      }
    ).summary.set({
      total: 128,
      adminCount: 7,
      teacherCount: 121,
      activeCount: 119,
    });
    fixture.detectChanges();

    const statValues = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.staff__stat-value'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(statValues).toEqual(['128', '7', '121', '119']);
  });
});
