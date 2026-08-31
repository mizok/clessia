import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AttendanceService } from '@core/attendance.service';
import { ContactBookService } from '@core/contact-book.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { SchedulePage } from './schedule.page';

describe('SchedulePage', () => {
  let component: SchedulePage;
  let fixture: ComponentFixture<SchedulePage>;
  let sessionsSpy: ReturnType<typeof vi.fn>;
  let missingSummarySpy: ReturnType<typeof vi.fn>;

  async function setup(options: { missingSummaryFails?: boolean } = {}) {
    sessionsSpy = vi.fn(() =>
      of({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 } }),
    );
    missingSummarySpy = vi.fn(() =>
      options.missingSummaryFails
        ? throwError(() => new Error('boom'))
        : of({
            data: [
              { date: '2026-08-31', missingCount: 3 },
              { date: '2026-09-01', missingCount: 0 },
            ],
            meta: { total: 3 },
          }),
    );

    await TestBed.configureTestingModule({
      imports: [SchedulePage],
      providers: [
        { provide: AttendanceService, useValue: { sessions: sessionsSpy } },
        { provide: ContactBookService, useValue: { missingSummary: missingSummarySpy } },
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
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
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
  }

  it('should create', async () => {
    await setup();
    expect(component).toBeTruthy();
  });

  /**
   * 這條釘住的是一個會靜靜壞掉的東西：後端預設**不回** `cancelled`，
   * 所以少傳 `statuses` 的話停課永遠不會出現，而畫面上看起來只是「那天沒課」。
   */
  it('明式要 cancelled —— 不然停課的課堂永遠不會出現', async () => {
    await setup();
    expect(sessionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: expect.arrayContaining(['cancelled']) }),
    );
  });

  it('聯絡簿待辦跟課表查同一個區間', async () => {
    await setup();
    const [dateFrom, dateTo] = missingSummarySpy.mock.calls[0];
    const sessionArgs = sessionsSpy.mock.calls[0][0] as { dateFrom: string; dateTo: string };
    expect(dateFrom).toBe(sessionArgs.dateFrom);
    expect(dateTo).toBe(sessionArgs.dateTo);
  });

  it('待辦數字照日期對進去', async () => {
    await setup();
    expect(component['missingOn']('2026-08-31')).toBe(3);
    expect(component['missingOn']('2026-09-01')).toBe(0);
  });

  /**
   * 聯絡簿那支掛掉不該讓課表跟著空掉 —— 它們是兩件事，所以各自訂閱。
   * 徽章消失（回 0）而不是顯示錯的數字。
   */
  it('聯絡簿彙總失敗時課表照樣載入，徽章不出現', async () => {
    await setup({ missingSummaryFails: true });
    expect(sessionsSpy).toHaveBeenCalled();
    expect(component['missingOn']('2026-08-31')).toBe(0);
  });
});
