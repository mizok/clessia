import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import { ParentApplicationsService } from '@core/parent-applications.service';
import { ParentAttendanceService } from '@core/parent-attendance.service';
import { ParentBillingService } from '@core/parent-billing.service';
import { ParentGradesService } from '@core/parent-grades.service';
import { ParentSessionsService, type ParentSession } from '@core/parent-sessions.service';
import { SystemClockService } from '@core/system-clock.service';
import { DashboardComponent } from './dashboard.component';

// 固定時鐘：2026-10-22（週四）台北 15:00
const NOW = Date.parse('2026-10-22T07:00:00Z');
const TODAY = '2026-10-22';

const ses = (date: string, over: Partial<ParentSession> = {}): ParentSession => ({
  sessionId: `s-${date}`,
  date,
  startTime: '17:00:00',
  endTime: '19:00:00',
  status: 'scheduled',
  classId: 'c1',
  className: '國三數學',
  courseName: null,
  campusId: 'campus-1',
  campusName: '中正校',
  classroomName: null,
  teacherName: '王',
  isSubstitute: false,
  originalTeacherName: null,
  examCount: 0,
  examNames: [],
  changes: [],
  attendance: null,
  ...over,
});

describe('DashboardComponent（A6 p-dashboard）', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let load: ReturnType<typeof vi.fn>;
  let activeChildId: ReturnType<typeof signal<string | null>>;

  function create(opts: { sessionsFail?: boolean; checkin?: string } = {}) {
    load = vi.fn();
    activeChildId = signal<string | null>(null);
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChildScopeService,
          useValue: {
            load,
            // 不能留 `[]`：「0 個孩子卻有 activeChildId」是不存在的狀態（#749 的 gate 會擋掉）
            children: () => [{ id: 'child-1', name: '林子晴' }],
            activeChildId: activeChildId.asReadonly(),
            activeChild: () => ({ id: 'child-1', name: '林子晴' }),
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
          },
        },
        { provide: SystemClockService, useValue: { nowEpochMs: () => NOW } },
        {
          provide: ParentSessionsService,
          useValue: {
            list: () =>
              opts.sessionsFail
                ? throwError(() => new Error('boom'))
                : of({
                    data: [
                      ses(TODAY, { examCount: 1, examNames: ['第四次小考'] }),
                      ses('2026-10-24', { status: 'cancelled', className: '國三英文' }),
                    ],
                  }),
            homework: () =>
              of({
                data: [
                  {
                    id: 'l1',
                    classId: 'c1',
                    className: '國三數學',
                    logDate: '2026-10-21',
                    homework: '講義 p.34',
                  },
                ],
              }),
          },
        },
        {
          provide: ParentAttendanceService,
          useValue: {
            checkins: () =>
              of({
                data: opts.checkin ? [{ date: TODAY, time: opts.checkin }] : [],
                dailyCheckinCampusIds: ['campus-1'],
              }),
          },
        },
        {
          provide: ParentBillingService,
          useValue: {
            list: () =>
              of({
                data: [
                  {
                    id: 'i1',
                    invoiceNo: null,
                    issuedAt: '2026-10-01',
                    dueDate: '2026-10-24',
                    status: 'unpaid',
                    voidedAt: null,
                    total: 4800,
                    netPaid: 0,
                    items: [{}, {}],
                    payments: [],
                    createdAt: '2026-10-01',
                  },
                ],
                meta: { total: 1, page: 1, pageSize: 50, totalDue: 4800, paymentInfo: [] },
              }),
          },
        },
        {
          provide: ParentGradesService,
          useValue: {
            list: () =>
              of({
                data: [],
                meta: { total: 0, page: 1, pageSize: 50, recentCount: 0, periods: [] },
              }),
          },
        },
        { provide: ParentApplicationsService, useValue: { catalog: () => of({ data: [] }) } },
      ],
    });
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.componentRef.setInput('page', {
      label: '首頁',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    fixture.detectChanges();
    activeChildId.set('child-1');
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('進頁觸發孩子清單載入', () => {
    create();
    expect(load).toHaveBeenCalledTimes(1);
  });

  /** #749 接線測試：斷言內容在 gate **裡面**，不只是 gate 存在 */
  it('頁面內容包在 app-child-scope-gate 裡（#749）', () => {
    create();
    expect(el().querySelector('app-child-scope-gate .dashboard__content')).toBeTruthy();
  });

  it('開場句：還沒到班時寫幾點有課；有刷卡寫幾點到', () => {
    create();
    expect(el().querySelector('h1')?.textContent).toContain('還沒到，17:00 有課。');
    TestBed.resetTestingModule();
    create({ checkin: '16:41' });
    expect(el().querySelector('h1')?.textContent).toContain('16:41 到班了。');
  });

  it('待繳條：金額、到期日、項目數、3 天內琥珀', () => {
    create();
    const pay = el().querySelector('.dashboard__pay')!;
    expect(pay.textContent).toContain('4,800');
    expect(pay.textContent).toContain('10/24（六）到期 · 2 個項目');
    expect(pay.textContent).toContain('2 天後到期');
  });

  it('今天的課帶「有小考」；考試與成績列出今天要考的考試名稱', () => {
    create();
    expect(el().textContent).toContain('今天的課');
    expect(el().querySelector('.dashboard__lesson')?.textContent).toContain('有小考');
    expect(el().querySelector('.dashboard__exam')?.textContent).toContain('國三數學 · 第四次小考');
    expect(el().querySelector('.dashboard__exam')?.textContent).toContain('今天考');
  });

  it('聯絡簿卡片：班名、日期、作業', () => {
    create();
    expect(el().querySelector('.dashboard__log')?.textContent).toContain('講義 p.34');
  });

  it('課表讀不到：那一節說讀不到，其他節照常', () => {
    create({ sessionsFail: true });
    expect(el().textContent).toContain('沒有讀到課表');
    expect(el().querySelector('.dashboard__pay')).toBeTruthy();
  });
});
