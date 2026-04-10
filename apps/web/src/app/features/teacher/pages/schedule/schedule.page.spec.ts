import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AttendanceService } from '@core/attendance.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { SchedulePage } from './schedule.page';

describe('SchedulePage', () => {
  let component: SchedulePage;
  let fixture: ComponentFixture<SchedulePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchedulePage],
      providers: [
        {
          provide: AttendanceService,
          useValue: {
            sessions: () =>
              of({
                data: [],
                meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
              }),
          },
        },
        {
          provide: OrgSettingsService,
          useValue: {
            settings: { set: vi.fn(), update: vi.fn() },
            getSettings: () =>
              of({
                id: 'org-1',
                name: 'Clessia Demo',
                attendanceMode: 'per_session',
                attendanceResponsible: 'admin',
                attendanceRetroactiveDays: 0,
              }),
          },
        },
        {
          provide: OverlayContainerService,
          useValue: { getContainer: () => null },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SchedulePage);
    fixture.componentRef.setInput('page', {
      label: '課表',
      relativePath: 'schedule',
      absolutePath: '/teacher/schedule',
      role: 'teacher',
      icon: 'pi pi-calendar',
      showInMenu: true,
    });
    fixture.detectChanges();
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
