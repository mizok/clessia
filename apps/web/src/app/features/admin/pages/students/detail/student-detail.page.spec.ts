import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, NEVER, of, throwError, type Observable } from 'rxjs';
import { DialogService } from 'primeng/dynamicdialog';

import { StudentDetailPage } from './student-detail.page';
import { StudentsService, type StudentAttendanceDays } from '@core/students.service';
import { ScoresService } from '@core/scores.service';
import { LeaveService } from '@core/leave.service';
import {
  LEAVE_DIALOG_CONTENT_STYLE,
  LeaveFormDialogComponent,
} from '@shared/components/leave-form-dialog/leave-form-dialog.component';
import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { AuthService } from '@core/auth.service';
import { CheckinCardsService } from '@core/checkin-cards.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { HttpErrorResponse } from '@angular/common/http';

describe('StudentDetailPage', () => {
  let fixture: ComponentFixture<StudentDetailPage>;
  /** 到班卡（#1100 #42）：補發／作廢要 manage_students */
  let permissions = ['manage_students'];
  const checkinCardsMock = {
    reissue: vi.fn(),
    revoke: vi.fn(),
    get: vi.fn(() =>
      of({ active: { last4: 'CDEF', issuedAt: '2026-10-02T03:00:00Z' }, hasAnyCard: true }),
    ),
  };

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
          provide: AuthService,
          useValue: { hasPermission: (p: string) => permissions.includes(p) },
        },
        { provide: CheckinCardsService, useValue: checkinCardsMock },
        {
          provide: OrgSettingsService,
          useValue: {
            settings: () => ({ name: '示範補習班' }),
            status: () => 'ready',
            load: vi.fn(),
          },
        },
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

  // #1705：學生檔案的摺疊列（含帳單章）同一組，一次只開一個 —— 帳單章是另一個元件，名字要自己對上
  it('所有摺疊列（含帳單章）同一個 name', () => {
    const colls = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLDetailsElement>(
        'details.coll',
      ),
    ];
    expect(colls.length).toBe(5); // 成績、帳單、紀錄、家長、基本資料
    expect(new Set(colls.map((d) => d.getAttribute('name')))).toEqual(new Set(['student-folds']));
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

    describe('hero 數字列、成績摘要、副行（#1314 SD 殘差）', () => {
      const latestAcademy = {
        examId: 'e1',
        examName: '段考',
        examDate: '2026-10-01',
        score: 82,
        totalScore: 100,
        classAvg: 76,
        rank: 2,
        classSize: 20,
      };
      const withLatest = () =>
        scoresServiceMock.getStudentSummary.mockReturnValueOnce(
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
                  totalRecords: 2,
                },
                {
                  subjectName: '數學',
                  academySum: 50,
                  academyTotalSum: 100,
                  schoolAvg: null,
                  totalRecords: 3,
                },
              ],
              latestAcademy,
            },
          }) as never,
        );

      it('有最近一場校內考 → hero 多一個「82 分 最近一次考試」，成績列寫「5 次 · 最近 82 分（班平均 76）」', async () => {
        withLatest();
        const el = await renderWithEnrollment();
        const stat = el
          .querySelector('[data-testid="exam-stat"]')!
          .textContent!.replace(/\s+/g, ' ');
        expect(stat).toContain('82');
        expect(stat).toContain('最近一次考試');
        expect(stat).toContain('82分'); // 滿分 100：單位只寫「分」
        expect(el.textContent).toContain('5 次 · 最近 82 分（班平均 76）');
      });

      it('沒有校內考 → 沒有考試數字，成績列只寫次數', async () => {
        const el = await renderWithEnrollment();
        expect(el.querySelector('[data-testid="exam-stat"]')).toBeNull();
        expect(el.textContent).toContain('1 次');
        expect(el.textContent).not.toContain('最近一次考試');
      });

      it('人名標題用 72／44 的大字（nameSize）', async () => {
        const el = await renderWithEnrollment();
        const h1 = el.querySelector('h1')!;
        expect(h1.classList.contains('wide:text-[72px]')).toBe(true);
      });

      it('副行：學校用簡稱、多個班寫「班A 等 N 班」', async () => {
        let base: Record<string, unknown> = {};
        (
          studentsServiceMock['get'] as unknown as () => Observable<{
            data: Record<string, unknown>;
          }>
        )().subscribe((r) => {
          base = r.data;
        });
        studentsServiceMock['get'].mockReturnValueOnce(
          of({
            data: {
              ...base,
              school: { id: 's1', name: '臺北市立景美國民中學', shortName: '景美國中' },
            },
          }),
        );
        const one = {
          studentId: seedStudentId,
          classId: 'c',
          courseId: 'co',
          courseName: '數學',
          effectiveFrom: '2026-09-01',
          status: 'active',
          billingMode: 'monthly',
          createdAt: '2026-09-01T02:00:00Z',
          classSchedule: [],
        };
        enrollmentsServiceMock.list.mockReturnValue(
          of({
            data: [
              { ...one, id: 'e1', className: '班A' },
              { ...one, id: 'e2', className: '班B' },
            ] as unknown as Enrollment[],
            meta: { total: 2, page: 1, pageSize: 50, totalPages: 1 },
          }),
        );
        fixture = TestBed.createComponent(StudentDetailPage);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const sub = (fixture.nativeElement as HTMLElement)
          .querySelector('h1')!
          .parentElement!.querySelector('p')!.textContent!;
        expect(sub.replace(/\s+/g, ' ').trim()).toBe('國一 · 景美國中 · 班A 等 2 班');
      });
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
          // 動作列 sticky 的底部留白交給動作列（#1768）
          contentStyle: LEAVE_DIALOG_CONTENT_STYLE,
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

  // #1641 5b（使用者 10-16 裁定第 3 點）：只有第一次進頁才是骨架；之後重抓保留舊內容並變淡
  describe('這學期的課：載入（#1641 5b）', () => {
    it('第一次進頁、名單還沒回來：顯示骨架', async () => {
      enrollmentsServiceMock.list.mockReturnValueOnce(NEVER as never);
      const first = TestBed.createComponent(StudentDetailPage);
      first.detectChanges();
      await first.whenStable();
      const el = first.nativeElement as HTMLElement;
      expect(el.querySelector('app-reload-veil p-skeleton')).not.toBeNull();
      expect(el.querySelector('.reload-veil--stale')).toBeNull();
    });

    it('重抓：舊內容留著並變淡，不回到骨架', () => {
      enrollmentsServiceMock.list.mockReturnValueOnce(NEVER as never);
      (
        fixture.componentInstance as unknown as { loadEnrollments: (id: string) => void }
      ).loadEnrollments(seedStudentId);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.reload-veil--stale')).not.toBeNull();
      expect(el.querySelector('app-reload-veil p-skeleton')).toBeNull();
      // 這支 spec 的學生有一筆報名（三年級數學 A）—— 重抓期間它還在
      expect(el.querySelectorAll('[data-testid="enrollment-item"]').length).toBeGreaterThan(0);
    });
  });

  describe('到班卡補發／作廢（#1100 #42）', () => {
    type Page = {
      menuItems: () => Array<{ label?: string }>;
      reissueCard: () => void;
      revokeCard: () => void;
      notice: () => { summary: string } | null;
      cardText: () => string;
    };
    const page = (f = fixture) => f.componentInstance as unknown as Page;
    /** 確認框：按下確定、填了理由 */
    const acceptWith = (notes: string) =>
      dialogOpen.mockReturnValue({ onClose: of({ notes }) } as never);

    afterEach(() => {
      permissions = ['manage_students'];
      vi.restoreAllMocks();
    });

    const statusEl = (f = fixture) =>
      (f.nativeElement as HTMLElement).querySelector('[data-testid="checkin-card-status"]');

    it('基本資料顯示現況：有效卡只有末四碼與發卡日', () => {
      expect(checkinCardsMock.get).toHaveBeenCalledWith(seedStudentId);
      expect(statusEl()?.textContent?.trim()).toBe('末四碼 CDEF · 2026/10/02 發卡');
    });

    it.each([
      [{ active: null, hasAnyCard: true }, '已作廢，尚未補發'],
      [{ active: null, hasAnyCard: false }, '尚未發新卡（舊版卡過渡中）'],
    ])('沒有有效卡：分得出作廢過與還沒發（%o）', async (res, text) => {
      checkinCardsMock.get.mockReturnValueOnce(of(res) as never);
      const other = TestBed.createComponent(StudentDetailPage);
      other.detectChanges();
      await other.whenStable();
      expect(page(other).cardText()).toBe(text);
    });

    it('讀不到：講讀不到，不假裝沒卡', async () => {
      checkinCardsMock.get.mockReturnValueOnce(throwError(() => new Error('x')) as never);
      const other = TestBed.createComponent(StudentDetailPage);
      other.detectChanges();
      await other.whenStable();
      expect(page(other).cardText()).toBe('讀不到到班卡資料');
    });

    it('沒有 basic_operations 也沒有 manage_students：不顯示、不打 API', async () => {
      permissions = ['view_reports'];
      checkinCardsMock.get.mockClear();
      const other = TestBed.createComponent(StudentDetailPage);
      other.detectChanges();
      await other.whenStable();
      expect(checkinCardsMock.get).not.toHaveBeenCalled();
      expect(statusEl(other)).toBeNull();
    });

    it('有 manage_students 才有補發、作廢', () => {
      expect(
        page()
          .menuItems()
          .map((i) => i.label),
      ).toEqual(expect.arrayContaining(['補發到班卡', '作廢到班卡']));
      permissions = ['basic_operations'];
      const other = TestBed.createComponent(StudentDetailPage);
      const labels = page(other)
        .menuItems()
        .map((i) => i.label);
      expect(labels).not.toContain('補發到班卡');
      expect(labels).not.toContain('作廢到班卡');
    });

    it('補發：帶理由呼叫 API，新卡直接進列印', async () => {
      const doc = document.implementation.createHTMLDocument('');
      vi.spyOn(window, 'open').mockReturnValue({
        document: doc,
        setTimeout: vi.fn(),
        close: vi.fn(),
      } as never);
      checkinCardsMock.reissue.mockReturnValue(
        of({
          studentId: seedStudentId,
          studentName: '出勤測試學生01',
          code: 'CK1-0123456789ABCDEF',
        }),
      );
      acceptWith('遺失');

      page().reissueCard();
      await vi.waitFor(() => expect(page().notice()?.summary).toBe('已補發'));
      expect(checkinCardsMock.reissue).toHaveBeenCalledWith(seedStudentId, '遺失');
      expect(doc.body.textContent).toContain('CK1-0123-4567-89AB-CDEF');
    });

    it('補發時彈出視窗被擋：不呼叫 API（卡沒換），提示允許彈出視窗', async () => {
      vi.spyOn(window, 'open').mockReturnValue(null);
      checkinCardsMock.reissue.mockClear();
      acceptWith('遺失');

      page().reissueCard();
      await vi.waitFor(() => expect(page().notice()?.summary).toBe('無法開啟列印視窗'));
      expect(checkinCardsMock.reissue).not.toHaveBeenCalled();
    });

    it('作廢：成功提示；沒有有效卡（409）講清楚', async () => {
      acceptWith('退班');
      checkinCardsMock.revoke.mockReturnValueOnce(of(undefined));
      checkinCardsMock.get.mockClear();
      page().revokeCard();
      expect(checkinCardsMock.revoke).toHaveBeenCalledWith(seedStudentId, '退班');
      expect(page().notice()?.summary).toBe('已作廢');
      expect(checkinCardsMock.get).toHaveBeenCalledTimes(1); // 現況重讀

      checkinCardsMock.revoke.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409 })),
      );
      page().revokeCard();
      expect(page().notice()?.summary).toBe('沒有可作廢的卡');
    });

    it('確認框按取消：什麼都不做', () => {
      dialogOpen.mockReturnValue({ onClose: of(false) } as never);
      checkinCardsMock.revoke.mockClear();
      page().revokeCard();
      expect(checkinCardsMock.revoke).not.toHaveBeenCalled();
    });
  });
});
