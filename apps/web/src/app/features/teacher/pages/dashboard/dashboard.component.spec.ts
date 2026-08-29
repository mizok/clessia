import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { StudentsService } from '@core/students.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { DashboardComponent } from './dashboard.component';
import { format } from 'date-fns';

function session(overrides: Partial<EventSessionSummary> = {}): EventSessionSummary {
  return {
    eventId: 'e1',
    classId: 'c1',
    className: '數學班 A',
    courseName: '數學',
    teacherName: '王老師',
    campusId: null,
    campusName: null,
    eventDate: format(new Date(), 'yyyy-MM-dd'),
    startTime: '00:01',
    endTime: '23:59',
    enrolledCount: 8,
    presentCount: 0,
    onLeaveCount: 0,
    absentCount: 0,
    takenAt: null,
    ...overrides,
  };
}

describe('DashboardComponent（老師端）', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;

  const sessionsMock = vi.fn();
  const studentsMock = vi.fn();
  const navigateMock = vi.fn();

  async function setup(sessions: EventSessionSummary[] = [session()], studentTotal = 12) {
    sessionsMock.mockReset();
    studentsMock.mockReset();
    navigateMock.mockReset();
    sessionsMock.mockReturnValue(
      of({
        data: sessions,
        meta: { total: sessions.length, page: 1, pageSize: 100, totalPages: 1 },
      }),
    );
    studentsMock.mockReturnValue(of({ data: [], meta: { total: studentTotal } }));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: AttendanceService, useValue: { sessions: sessionsMock } },
        { provide: StudentsService, useValue: { list: studentsMock } },
        { provide: Router, useValue: { navigate: navigateMock } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.TEACHER_DASHBOARD);
    fixture.detectChanges();
  }

  it('查本週區間的課堂，並要求只算自己的學生', async () => {
    await setup();

    const sessionArgs = sessionsMock.mock.calls[0][0];
    expect(sessionArgs.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sessionArgs.dateTo >= sessionArgs.dateFrom).toBe(true);
    expect(studentsMock.mock.calls[0][0]).toMatchObject({ taughtByMe: true });
  });

  it('四個數字都算得出來', async () => {
    // 本地時區，跟元件一致（toISOString 是 UTC，凌晨會差一天）
    const today = format(new Date(), 'yyyy-MM-dd');
    await setup(
      [
        session({ eventId: 'a', takenAt: null }),
        session({ eventId: 'b', takenAt: '2026-01-01T00:00:00Z' }),
        session({ eventId: 'c', eventDate: '2020-01-01' }),
      ],
      12,
    );

    expect(component['stats']().todayTotal).toBe(2);
    expect(component['stats']().todayPending).toBe(1);
    expect(component['stats']().weekTotal).toBe(3);
    expect(component['studentCount']()).toBe(12);
    expect(today).toBe(component['today']);
  });

  it('今日課表依開始時間排序', async () => {
    await setup([
      session({ eventId: 'late', startTime: '19:00' }),
      session({ eventId: 'early', startTime: '09:00' }),
    ]);

    expect(component['todaySessions']().map((s) => s.eventId)).toEqual(['early', 'late']);
  });

  it('今天沒課時顯示空狀態', async () => {
    await setup([session({ eventDate: '2020-01-01' })]);

    expect(fixture.nativeElement.textContent).toContain('今天沒有課');
  });

  it('點名狀態顯示出來', async () => {
    await setup([session({ takenAt: '2026-01-01T00:00:00Z' })]);

    expect(fixture.nativeElement.textContent).toContain('已點名');
  });

  it('快速入口連到課表', async () => {
    await setup();

    component['goToSchedule']();

    expect(navigateMock).toHaveBeenCalledWith([RoutesCatalog.TEACHER_SCHEDULE.absolutePath]);
  });

  it('任一支查詢失敗就顯示錯誤，不顯示半套數字', async () => {
    sessionsMock.mockReset();
    studentsMock.mockReset();
    sessionsMock.mockReturnValue(throwError(() => new Error('boom')));
    studentsMock.mockReturnValue(of({ data: [], meta: { total: 0 } }));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: AttendanceService, useValue: { sessions: sessionsMock } },
        { provide: StudentsService, useValue: { list: studentsMock } },
        { provide: Router, useValue: { navigate: navigateMock } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(DashboardComponent);
    f.componentRef.setInput('page', RoutesCatalog.TEACHER_DASHBOARD);
    f.detectChanges();

    expect(f.componentInstance['loadError']()).toBe(true);
  });
});
