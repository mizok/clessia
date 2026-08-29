import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AcademyExamsService } from '@core/academy-exams.service';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { AuthService } from '@core/auth.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { LeaveService, type LeaveRequest } from '@core/leave.service';
import { OrgSettingsService, type AttendanceMode } from '@core/org-settings.service';
import { SchoolExamsService } from '@core/school-exams.service';
import { StudentsService } from '@core/students.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { DashboardComponent } from './dashboard.component';

const TODAY = new Date().toISOString().slice(0, 10);
/** 回溯窗裡「已經結束」的那一天 —— 今天的課還沒上完，不算漏點名 */
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function session(overrides: Partial<EventSessionSummary> = {}): EventSessionSummary {
  return {
    eventId: 'e1',
    classId: 'c1',
    className: '數學班 A',
    courseName: '數學',
    teacherName: '王老師',
    campusId: null,
    campusName: null,
    eventDate: TODAY,
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

function leave(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'l1',
    orgId: 'o1',
    studentId: 's1',
    studentName: '陳小明',
    startDate: TODAY,
    endDate: TODAY,
    startTime: null,
    endTime: null,
    reason: null,
    submittedBy: 'u1',
    submittedByRole: 'parent',
    submittedByName: null,
    createdAt: `${TODAY}T00:00:00Z`,
    ...overrides,
  };
}

interface SetupOptions {
  todaySessions?: EventSessionSummary[];
  recentSessions?: EventSessionSummary[];
  leaves?: LeaveRequest[];
  academyTodo?: number;
  schoolTodo?: number;
  activeCount?: number;
  enrollmentTotal?: number;
  mode?: AttendanceMode;
  permissions?: string[];
  fail?: 'sessions' | 'leaves' | 'grades' | 'students' | 'enrollments' | 'org';
}

describe('DashboardComponent（管理端）', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;

  const sessionsMock = vi.fn();
  const leavesMock = vi.fn();
  const academyTodoMock = vi.fn();
  const schoolTodoMock = vi.fn();
  const studentsMock = vi.fn();
  const enrollmentsMock = vi.fn();
  const orgSettingsMock = vi.fn();

  function sessionList(data: EventSessionSummary[]) {
    return of({
      data,
      meta: { total: data.length, page: 1, pageSize: 100, totalPages: 1 },
    });
  }

  async function setup(options: SetupOptions = {}) {
    const {
      todaySessions = [session()],
      recentSessions = [session()],
      leaves = [leave()],
      academyTodo = 2,
      schoolTodo = 3,
      activeCount = 120,
      enrollmentTotal = 7,
      mode = 'per_session',
      permissions = ['view_reports'],
      fail,
    } = options;

    const boom = throwError(() => new Error('boom'));

    for (const mock of [
      sessionsMock,
      leavesMock,
      academyTodoMock,
      schoolTodoMock,
      studentsMock,
      enrollmentsMock,
      orgSettingsMock,
    ]) {
      mock.mockReset();
    }

    // 卡 1 用 date=今天、卡 2 用 dateFrom=7 天前，是兩個不同的請求
    sessionsMock.mockImplementation((params: { date?: string }) =>
      fail === 'sessions'
        ? boom
        : sessionList(params.date ? todaySessions : recentSessions),
    );
    leavesMock.mockReturnValue(
      fail === 'leaves'
        ? boom
        : of({ data: leaves, meta: { total: leaves.length, page: 1, pageSize: 100, totalPages: 1 } }),
    );
    academyTodoMock.mockReturnValue(fail === 'grades' ? boom : of({ count: academyTodo }));
    schoolTodoMock.mockReturnValue(of({ count: schoolTodo }));
    studentsMock.mockReturnValue(
      fail === 'students'
        ? boom
        : of({ data: [], meta: { total: activeCount }, summary: { total: activeCount, activeCount } }),
    );
    enrollmentsMock.mockReturnValue(
      fail === 'enrollments'
        ? boom
        : of({ data: [], meta: { total: enrollmentTotal, page: 1, pageSize: 1, totalPages: 1 } }),
    );
    orgSettingsMock.mockReturnValue(
      fail === 'org' ? boom : of({ id: 'o1', name: '補習班', attendanceMode: mode }),
    );

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AttendanceService, useValue: { sessions: sessionsMock } },
        { provide: LeaveService, useValue: { list: leavesMock } },
        { provide: AcademyExamsService, useValue: { getTodoCount: academyTodoMock } },
        { provide: SchoolExamsService, useValue: { getTodoCount: schoolTodoMock } },
        { provide: StudentsService, useValue: { list: studentsMock } },
        { provide: EnrollmentsService, useValue: { list: enrollmentsMock } },
        { provide: OrgSettingsService, useValue: { getSettings: orgSettingsMock } },
        {
          provide: AuthService,
          useValue: { hasPermission: (p: string) => permissions.includes(p) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_DASHBOARD);
    fixture.detectChanges();
  }

  function cardLabels(): string[] {
    return component['cards']().map((c) => c.label);
  }

  function card(label: string) {
    return component['cards']().find((c) => c.label === label);
  }

  it('六張卡都拿到真實數字', async () => {
    await setup({
      todaySessions: [session(), session({ eventId: 'e2' })],
      recentSessions: [
        session({ eventId: 'r1', eventDate: YESTERDAY, takenAt: null }),
        session({ eventId: 'r2', eventDate: YESTERDAY, takenAt: `${YESTERDAY}T12:00:00Z` }),
      ],
      leaves: [leave(), leave({ id: 'l2' })],
      academyTodo: 2,
      schoolTodo: 3,
      activeCount: 120,
      enrollmentTotal: 7,
    });

    expect(card('今日課堂')?.value).toBe(2);
    expect(card('未點名課堂')?.value).toBe(1);
    expect(card('今日請假')?.value).toBe(2);
    expect(card('成績待登錄')?.value).toBe(5);
    expect(card('在籍學生')?.value).toBe(120);
    expect(card('本月報名異動')?.value).toBe(7);
  });

  it('每張卡連到功能的家', async () => {
    await setup();

    expect(card('今日課堂')?.routerLink).toBe(RoutesCatalog.ADMIN_SESSIONS.absolutePath);
    expect(card('未點名課堂')?.routerLink).toBe(RoutesCatalog.ADMIN_ATTENDANCE.absolutePath);
    expect(card('今日請假')?.routerLink).toBe(RoutesCatalog.ADMIN_LEAVE.absolutePath);
    expect(card('成績待登錄')?.routerLink).toBe(RoutesCatalog.ADMIN_GRADES_EXAMS.absolutePath);
    expect(card('在籍學生')?.routerLink).toBe(RoutesCatalog.ADMIN_STUDENTS.absolutePath);
    expect(card('本月報名異動')?.routerLink).toBe(RoutesCatalog.ADMIN_ENROLLMENTS.absolutePath);
  });

  it('今日課堂查今天，未點名查回溯 7 天', async () => {
    await setup();

    const [todayArgs, recentArgs] = sessionsMock.mock.calls.map((c) => c[0]);
    expect(todayArgs.date).toBe(TODAY);
    expect(recentArgs.dateFrom < TODAY).toBe(true);
    expect(recentArgs.dateTo).toBe(TODAY);
    expect(leavesMock.mock.calls[0][0]).toMatchObject({ coverDate: TODAY });
  });

  // meta.total 數的是「期間內有異動的報名記錄數」，不是進出人次，所以只抓 total
  it('報名異動只取 meta.total，不抓明細', async () => {
    await setup();

    expect(enrollmentsMock.mock.calls[0][0]).toMatchObject({ pageSize: 1 });
  });

  // daily-checkins 從不蓋 attendance_taken_at，這個模式下整張卡都是誤報
  it('日到班模式不渲染未點名卡', async () => {
    await setup({ mode: 'daily_checkin' });

    expect(cardLabels()).not.toContain('未點名課堂');
    expect(cardLabels()).toContain('今日課堂');
  });

  // 讀不到模式就無法確定數字有沒有意義，寧可不顯示也不要顯示可能全錯的數
  it('讀不到機構設定時不渲染未點名卡', async () => {
    await setup({ fail: 'org' });

    expect(cardLabels()).not.toContain('未點名課堂');
  });

  it('沒有 view_reports 就看不到經營區兩張卡', async () => {
    await setup({ permissions: [] });

    expect(cardLabels()).not.toContain('在籍學生');
    expect(cardLabels()).not.toContain('本月報名異動');
    expect(cardLabels()).toContain('今日課堂');
    expect(cardLabels()).toContain('今日請假');
  });

  it('單張卡失敗只讓那張卡顯示失敗，其他照常', async () => {
    await setup({ fail: 'leaves' });

    expect(card('今日請假')?.value).toBe('error');
    expect(card('今日課堂')?.value).toBe(1);
    expect(card('在籍學生')?.value).toBe(120);
    expect(fixture.nativeElement.textContent).toContain('讀取失敗');
  });

  it('兩支成績 todo 任一支失敗，成績卡就是失敗態', async () => {
    await setup({ fail: 'grades' });

    expect(card('成績待登錄')?.value).toBe('error');
    expect(card('今日課堂')?.value).toBe(1);
  });

  it('今日課表列出今天的課，依開始時間排序', async () => {
    await setup({
      todaySessions: [
        session({ eventId: 'late', startTime: '19:00' }),
        session({ eventId: 'early', startTime: '09:00' }),
      ],
    });

    expect(component['todaySessionList']().map((s) => s.eventId)).toEqual(['early', 'late']);
  });

  it('今天沒課時顯示空狀態', async () => {
    await setup({ todaySessions: [] });

    expect(fixture.nativeElement.textContent).toContain('今日尚無排課');
  });

  it('今日請假列出請假學生', async () => {
    await setup({ leaves: [leave({ studentName: '林小美' })] });

    expect(fixture.nativeElement.textContent).toContain('林小美');
  });

  it('不再有寫死的佔位卡', async () => {
    await setup();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('資料串接中');
    expect(text).not.toContain('—');
  });
});
