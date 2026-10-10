import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { DialogService } from 'primeng/dynamicdialog';

import { StudentDetailPage } from './student-detail.page';
import { StudentsService, type StudentAttendanceDays } from '@core/students.service';
import { ScoresService } from '@core/scores.service';
import { LeaveService } from '@core/leave.service';
import { LeaveFormDialogComponent } from '../../leave/leave-form-dialog.component';
import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';

describe('StudentDetailPage', () => {
  let fixture: ComponentFixture<StudentDetailPage>;

  const seedStudentId = '61000000-0000-0000-0000-000000000001';
  const paramMap$ = new BehaviorSubject(convertToParamMap({ id: seedStudentId }));

  const studentsServiceMock: Record<string, ReturnType<typeof vi.fn>> = {
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

  const attendance: StudentAttendanceDays = {
    days: [
      { date: '2026-09-05', state: 'came', sessions: [] },
      { date: '2026-09-12', state: 'absent', sessions: [] },
      { date: '2026-10-17', state: 'future', sessions: [] },
    ],
    summary: { due: 2, came: 1, absentDates: ['2026-09-12'] },
    today: null,
    nextSession: { date: '2026-10-17', startTime: '15:00:00', className: '數學 A' },
  };
  studentsServiceMock['attendanceDays'] = vi.fn(() => of(attendance));
  const scoresServiceMock = {
    getStudentSummary: vi.fn(() =>
      of({
        data: {
          studentId: seedStudentId,
          studentName: 'x',
          subjects: [
            {
              subjectName: '英文',
              academySum: 92,
              academyTotalSum: 100,
              schoolAvg: null,
              totalRecords: 1,
            },
          ],
        },
      }),
    ),
  };
  const leaveServiceMock = {
    list: vi.fn(() => of({ data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } })),
  };
  const dialogOpen = vi.fn();

  const enrollmentsServiceMock = {
    // `data` 標型別 —— 不標的話會被推論成 `never[]`，
    // 之後用 `mockReturnValue` 餵真的 enrollment 進去會編譯失敗
    list: vi.fn(() =>
      of({
        data: [] as Enrollment[],
        meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
      }),
    ),
    create: vi.fn(() =>
      of({
        data: {
          id: 'enrollment-1',
          classId: 'class-1',
          studentId: seedStudentId,
        },
      }),
    ),
  };

  beforeEach(async () => {
    studentsServiceMock['get'].mockClear();
    studentsServiceMock['attendanceDays'].mockClear();
    dialogOpen.mockReset();
    enrollmentsServiceMock.list.mockClear();
    enrollmentsServiceMock.create.mockClear();

    await TestBed.configureTestingModule({
      imports: [StudentDetailPage],
      providers: [
        provideRouter([]),
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: ScoresService, useValue: scoresServiceMock },
        { provide: LeaveService, useValue: leaveServiceMock },
        { provide: DialogService, useValue: { open: dialogOpen } },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: seedStudentId }) },
            paramMap: paramMap$.asObservable(),
          },
        },
      ],
    })
      // 頁面自己 `providers: [DialogService]`，只在 providers 陣列放 mock 蓋不掉
      .overrideProvider(DialogService, { useValue: { open: dialogOpen } })
      .compileComponents();

    fixture = TestBed.createComponent(StudentDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('loads student and enrollments from route params', () => {
    expect(studentsServiceMock['get']).toHaveBeenCalledWith(seedStudentId);
    expect(enrollmentsServiceMock.list).toHaveBeenCalledWith({
      studentId: seedStudentId,
      pageSize: 50,
    });
  });

  it('shows conflict prompt when enrollment API returns SCHEDULE_CONFLICT', () => {
    enrollmentsServiceMock.create.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'SCHEDULE_CONFLICT',
          warnings: [
            {
              studentId: seedStudentId,
              conflictingClassId: 'class-conflict',
              conflictingClassName: '英文 A',
              conflictingCourseName: '英文',
              weekday: 3,
              startTime: '19:00:00',
              endTime: '21:00:00',
            },
          ],
        },
      })),
    );

    (
      fixture.componentInstance as unknown as {
        addToClass: (cls: { id: string; name: string }, force?: boolean) => void;
      }
    ).addToClass({ id: 'class-1', name: '數學 B' });

    expect(fixture.componentInstance['conflictPrompt']()).toEqual({
      cls: { id: 'class-1', name: '數學 B' },
      warnings: [
        expect.objectContaining({
          conflictingClassId: 'class-conflict',
          conflictingClassName: '英文 A',
        }),
      ],
    });
    expect(fixture.componentInstance['notice']()).toBeNull();
  });

  it('shows warning notice when enrollment API returns ALREADY_ENROLLED', () => {
    enrollmentsServiceMock.create.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'ALREADY_ENROLLED',
        },
      })),
    );

    (
      fixture.componentInstance as unknown as {
        addToClass: (cls: { id: string; name: string }, force?: boolean) => void;
      }
    ).addToClass({ id: 'class-1', name: '數學 B' });

    expect(fixture.componentInstance['notice']()).toEqual({
      severity: 'warning',
      summary: '已經在此班',
      detail: '「出勤測試學生01」已經是「數學 B」的成員',
    });
  });

  it('retries with skipConflictCheck when confirming conflict enroll', () => {
    fixture.componentInstance['conflictPrompt'].set({
      cls: { id: 'class-1', name: '數學 B' } as never,
      warnings: [],
    });

    fixture.componentInstance['confirmConflictEnroll']();

    expect(enrollmentsServiceMock.create).toHaveBeenLastCalledWith({
      classId: 'class-1',
      studentId: seedStudentId,
      skipConflictCheck: true,
    });
  });

  /**
   * **#638 這支最容易做錯的地方，所以用測試釘住條件的兩側。**
   *
   * 「還沒開帳」是 `enrollment-rules` 6.2 明寫的**合法暫時狀態**；
   * 「沒有計費模式」才是一筆永遠收不到錢的報名。
   *
   * 條件抓寬的代價很具體：行政每建一筆正常的延後開帳報名都會看到警告，
   * **而每天早上紅一次的東西一週內就會被學會忽略** —— 那時真正該看的也一起沒了。
   */
  describe('needsBillingSetup 的邊界（#638）', () => {
    const check = (e: Partial<Enrollment>) =>
      (
        fixture.componentInstance as unknown as { needsBillingSetup: (x: Enrollment) => boolean }
      ).needsBillingSetup(e as Enrollment);

    it('沒有計費模式 → 要提示', () => {
      expect(check({ billingMode: null })).toBe(true);
    });

    it('有模式就不提示，即使還沒開帳 —— 延後開帳是合法的', () => {
      expect(check({ billingMode: 'monthly' })).toBe(false);
      expect(check({ billingMode: 'period' })).toBe(false);
    });

    /**
     * `session_pack` 永遠不進月結 run（買包時才開帳），看起來很像
     * 「不會被收錢」—— **但它是有模式的**。有人想補一個 session_pack 特判時，
     * 這條會擋住。
     */
    it('陷阱：session_pack 是有模式的，不算異常', () => {
      expect(check({ billingMode: 'session_pack' })).toBe(false);
    });
  });

  describe('A6 換形（#1314 SD）', () => {
    async function renderWithEnrollment() {
      enrollmentsServiceMock.list.mockReturnValue(
        of({
          data: [
            {
              id: 'enrollment-1',
              studentId: seedStudentId,
              classId: 'class-1',
              courseId: 'course-1',
              className: '三年級數學 A',
              courseName: '數學',
              effectiveFrom: '2026-09-01',
              status: 'active',
              billingMode: 'monthly',
              createdAt: '2026-09-01T02:00:00Z',
              classSchedule: [
                { weekday: 6, startTime: '15:00:00', endTime: '16:30:00', teacherName: '簡志明' },
              ],
              teacherName: '簡志明',
            } as unknown as Enrollment,
          ],
          meta: { total: 1, page: 1, pageSize: 50, totalPages: 1 },
        }),
      );
      fixture = TestBed.createComponent(StudentDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('有報名 → 以最早報名日起、到「今天＋21」查到班格；畫面寫到班數字與沒到日期', async () => {
      const el = await renderWithEnrollment();
      const [id, from, to] = studentsServiceMock['attendanceDays'].mock.calls.at(-1) as string[];
      expect(id).toBe(seedStudentId);
      expect(from).toBe('2026-09-01');
      expect(to > from).toBe(true);
      expect(el.querySelector('[data-testid="attendance-stat"]')?.textContent).toContain('1');
      expect(el.querySelector('[data-testid="absent-line"]')?.textContent).toContain('沒到 1 天');
      expect(el.querySelectorAll('[role="listitem"]').length).toBe(3);
    });

    it('沒有報名 → 不打到班 API', async () => {
      studentsServiceMock['attendanceDays'].mockClear();
      enrollmentsServiceMock.list.mockReturnValue(
        of({ data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } }),
      );
      fixture = TestBed.createComponent(StudentDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(studentsServiceMock['attendanceDays']).not.toHaveBeenCalled();
    });

    it('課程列寫時段與老師，在學不寫狀態字', async () => {
      const el = await renderWithEnrollment();
      const row = el.querySelector('[data-testid="enrollment-item"]')!.textContent!;
      expect(row).toContain('週六 15:00–16:30 · 簡志明 老師');
      expect(row).not.toContain('在學');
    });

    it('工具列情境句：沒有今天的課＋下一堂', async () => {
      const el = await renderWithEnrollment();
      const text = el.querySelector('[data-testid="situation"]')!.textContent!.replace(/\s+/g, ' ');
      expect(text).toContain('今天沒有他的課');
      expect(text).toContain('下一堂 10/17（六） 15:00');
    });

    it('成績列寫各科平均', async () => {
      const el = await renderWithEnrollment();
      expect(el.textContent).toContain('補習班考 92%');
    });

    it('登記請假：開請假對話框並預帶這位學生', async () => {
      dialogOpen.mockReturnValue({ onClose: of(null) });
      await renderWithEnrollment();
      fixture.componentInstance['openLeaveDialog']();
      expect(dialogOpen).toHaveBeenCalledWith(
        LeaveFormDialogComponent,
        expect.objectContaining({
          data: { student: { id: seedStudentId, name: '出勤測試學生01' } },
        }),
      );
    });

    it('送出請假後重抓請假紀錄與到班格', async () => {
      dialogOpen.mockReturnValue({ onClose: of({ id: 'l1' }) });
      await renderWithEnrollment();
      leaveServiceMock.list.mockClear();
      studentsServiceMock['attendanceDays'].mockClear();
      fixture.componentInstance['openLeaveDialog']();
      expect(leaveServiceMock.list).toHaveBeenCalled();
      expect(studentsServiceMock['attendanceDays']).toHaveBeenCalled();
      expect(fixture.componentInstance['notice']()?.summary).toBe('已登記請假');
    });

    it('沒有待收款 → 主要行動是「登記請假」、沒有次要', async () => {
      await renderWithEnrollment();
      const c = fixture.componentInstance as unknown as {
        primaryAction: () => { label: string };
        secondaryAction: () => unknown;
      };
      expect(c.primaryAction().label).toBe('登記請假');
      expect(c.secondaryAction()).toBeNull();
    });
  });

  /**
   * #722：在籍班級列的鍵盤操作。
   *
   * **工單寫的「沒有 `tabindex`、沒有 `role`」不成立** —— 那一列本來就有
   * `role="button"` + `tabindex="0"` + `(keydown.enter)`，比工單指為範本的
   * `/admin/enrollments`（只有 `tabindex` 與 Enter，沒有 `role`）**更完整**。
   * 下面前兩條就是把這個前提釘住，免得下次又被當成缺陷開一次。
   *
   * **真正缺的是 Space**：對 `role="button"` 來說 Enter 與 Space 都是啟動鍵，
   * 而這一列按 Space 什麼都不會發生（瀏覽器還會把頁面往下捲）。
   * repo 裡 `payments` 與 `contact-book` 的可點列都已經是 Enter + Space。
   */
  describe('#722 在籍班級列的鍵盤操作', () => {
    const enrollmentRow = () =>
      fixture.nativeElement.querySelector('[data-testid="enrollment-item"]') as HTMLElement;

    async function renderWithOneEnrollment() {
      enrollmentsServiceMock.list.mockReturnValue(
        of({
          data: [
            {
              id: 'enrollment-1',
              studentId: seedStudentId,
              classId: 'class-1',
              courseId: 'course-1',
              className: '三年級數學 A',
              courseName: '數學',
              campusName: '文山旗艦校',
              effectiveFrom: '2026-09-01',
              status: 'active',
              billingMode: 'monthly',
              createdAt: '2026-09-01T02:00:00Z',
              classSchedule: [
                { weekday: 6, startTime: '15:00:00', endTime: '16:30:00', teacherName: '簡志明' },
              ],
              teacherName: '簡志明',
            } as unknown as Enrollment,
          ],
          meta: { total: 1, page: 1, pageSize: 50, totalPages: 1 },
        }),
      );

      fixture = TestBed.createComponent(StudentDetailPage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return TestBed.inject(Router);
    }

    it('列是鍵盤觸達得到的 —— `role="button"` + `tabindex="0"`（前提確認，不是新行為）', async () => {
      await renderWithOneEnrollment();

      const row = enrollmentRow();
      expect(row).toBeTruthy();
      expect(row.getAttribute('tabindex')).toBe('0');
      expect(row.getAttribute('role')).toBe('button');
    });

    it('Enter 觸發導向（既有行為，反向對照）', async () => {
      const router = await renderWithOneEnrollment();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      enrollmentRow().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
      );

      expect(navigate).toHaveBeenCalledWith(['/admin/courses', 'course-1', 'classes', 'class-1']);
    });

    it('Space 也要觸發導向 —— `role="button"` 的標準啟動鍵有兩個', async () => {
      const router = await renderWithOneEnrollment();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      enrollmentRow().dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
      );

      expect(navigate).toHaveBeenCalledWith(['/admin/courses', 'course-1', 'classes', 'class-1']);
    });
  });
});
