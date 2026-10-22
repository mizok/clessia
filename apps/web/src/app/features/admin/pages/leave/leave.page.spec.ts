import { NEVER, Subject, of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ConfirmEventType, ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import type { Campus } from '@core/campuses.service';
import type { LeaveRequest } from '@core/leave.service';
import { LeaveService } from '@core/leave.service';
import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { StudentsService } from '@core/students.service';
import { CoursesService } from '@core/courses.service';
import { ClassesService } from '@core/classes.service';
import { SystemClockService } from '@core/system-clock.service';
import { LeavePage } from './leave.page';
import {
  LEAVE_DIALOG_CONTENT_STYLE,
  LeaveFormDialogComponent,
} from '@shared/components/leave-form-dialog/leave-form-dialog.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';

describe('LeavePage', () => {
  const leaveServiceMock = {
    list: vi.fn((_params?: unknown) =>
      of({
        data: [] as LeaveRequest[],
        meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
      }),
    ),
    delete: vi.fn(() => of(void 0)),
  };
  const studentsServiceMock = { list: vi.fn() };
  // #1100 #31：課程／開課班篩選的選項
  const coursesServiceMock = {
    list: vi.fn(() => of({ data: [{ id: 'course-1', name: '國中數學' }], meta: {} })),
  };
  const classesServiceMock = {
    list: vi.fn((_params?: unknown) =>
      of({ data: [{ id: 'class-1', name: '數學 A 班' }], meta: {} }),
    ),
  };
  const referenceDataServiceMock = {
    campuses: signal<Campus[]>([]),
    loadCampuses: vi.fn(),
  };
  const confirmationService = new ConfirmationService();
  const messageService = new MessageService();
  const dialogServiceMock = {
    open: vi.fn(),
  };

  let component: LeavePage;
  let fixture: ComponentFixture<LeavePage>;

  const activeRecord: LeaveRequest = {
    id: 'leave-1',
    orgId: 'org-1',
    studentId: 'student-1',
    studentName: '劉靖雯',
    startDate: '2000-01-01',
    endDate: '2999-12-31',
    startTime: null,
    endTime: null,
    reason: null,
    submittedBy: 'user-1',
    submittedByRole: 'admin',
    submittedByName: '管理員',
    createdAt: '2026-04-02T00:00:00Z',
  };

  beforeEach(async () => {
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    vi.useFakeTimers();
    leaveServiceMock.list.mockClear();
    leaveServiceMock.delete.mockClear();
    referenceDataServiceMock.loadCampuses.mockClear();
    vi.restoreAllMocks();
    dialogServiceMock.open.mockClear();

    await TestBed.configureTestingModule({
      imports: [LeavePage],
      providers: [
        provideRouter([]),
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: CoursesService, useValue: coursesServiceMock },
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: LeaveService, useValue: leaveServiceMock },
        { provide: ReferenceDataService, useValue: referenceDataServiceMock },
        // **這個替身不是為了控制日期，是為了不要把真的 setInterval 拉進來。**
        // `SystemClockService` 的 constructor 會起兩個 interval（每秒 tick、
        // 每 5 分鐘 resync），而這個檔案用 `vi.useFakeTimers()` + `runAllTimers()` ——
        // 真的服務進來的話 `runAllTimers()` 會永遠有下一個 timer 可跑，
        // 測試以「Aborting after running 10000 timers」失敗。
        // 固定日期同時讓 `leaveState` 的斷言不依賴牆上時鐘。
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-04-10' } },
      ],
    })
      .overrideComponent(LeavePage, {
        set: {
          providers: [
            { provide: MessageService, useValue: messageService },
            { provide: ConfirmationService, useValue: confirmationService },
            { provide: DialogService, useValue: dialogServiceMock },
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(LeavePage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', { label: '學生請假紀錄' });
    vi.spyOn(confirmationService, 'confirm');
    vi.spyOn(messageService, 'add');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('日常頁：頂欄沒有「全部分校」（#1607）', () => {
    const ctx = TestBed.inject(CampusContextService);
    expect(ctx.inUse()).toBe(true);
    expect(ctx.allowAll()).toBe(false);
  });

  it('分校跟頂欄走：頂欄換分校回第一頁、帶 campusId 重查（#1138）', () => {
    leaveServiceMock.list.mockClear();

    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();

    const calls = leaveServiceMock.list.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual(expect.objectContaining({ campusId: 'campus-1', page: 1 }));
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // #1100 #31 二讀
  it('初次載入就抓課程與開課班的選項', () => {
    expect(coursesServiceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
    );
    expect(classesServiceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
    );
  });

  it('頂欄換分校：已選的班清掉、班清單帶新分校重抓', () => {
    component['tab'].set('all');
    component['onClassChange']('class-1');
    classesServiceMock.list.mockClear();
    leaveServiceMock.list.mockClear();

    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();

    expect(component['classId']()).toBeNull();
    expect(classesServiceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({ campusId: 'campus-1' }),
    );
    const calls = leaveServiceMock.list.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls.at(-1)![0]['classId']).toBeUndefined();
  });

  /**
   * 基準日固定成 `2026-04-10`（來自上面的 `SystemClockService` 替身）——
   * **在這之前 `leaveState` 讀的是牆上時鐘，所以它只在某些日子是綠的**，
   * 而且沒有任何一條測試蓋到它的三個分支。
   */
  describe('leaveState 的三個分支（基準日 2026-04-10）', () => {
    const state = (startDate: string, endDate: string) =>
      (
        component as unknown as {
          leaveState: (r: { startDate: string; endDate: string }) => string;
        }
      ).leaveState({ startDate, endDate });

    it('開始日在今天之後 → future', () => {
      expect(state('2026-04-11', '2026-04-12')).toBe('future');
    });

    it('今天開始的假是 active，不是 future —— 邊界用 > 不是 >=', () => {
      expect(state('2026-04-10', '2026-04-12')).toBe('active');
    });

    it('今天結束的假還算 active —— 當天請假當天仍然有效', () => {
      expect(state('2026-04-08', '2026-04-10')).toBe('active');
    });

    it('昨天結束的假是 past', () => {
      expect(state('2026-04-08', '2026-04-09')).toBe('past');
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('在進行中假期選擇完全刪除時，會延後開啟第二次確認視窗', () => {
    component['confirmDelete'](activeRecord);

    expect(confirmationService.confirm).toHaveBeenCalledTimes(1);

    const firstConfirm = vi.mocked(confirmationService.confirm).mock.calls[0]?.[0] as {
      reject?: (type?: ConfirmEventType) => void;
    };

    firstConfirm.reject?.(ConfirmEventType.REJECT);
    expect(confirmationService.confirm).toHaveBeenCalledTimes(1);

    vi.runAllTimers();

    expect(confirmationService.confirm).toHaveBeenCalledTimes(2);
    expect(vi.mocked(confirmationService.confirm).mock.calls[1]?.[0]).toMatchObject({
      header: '完全刪除請假紀錄',
      acceptLabel: '確認完全刪除',
    });
  });

  it('確認完全刪除後會以 full 模式呼叫刪除 API', () => {
    component['confirmDelete'](activeRecord);

    const firstConfirm = vi.mocked(confirmationService.confirm).mock.calls[0]?.[0] as {
      reject?: (type?: ConfirmEventType) => void;
    };

    firstConfirm.reject?.(ConfirmEventType.REJECT);
    vi.runAllTimers();

    const secondConfirm = vi.mocked(confirmationService.confirm).mock.calls[1]?.[0] as {
      accept?: () => void;
    };

    secondConfirm.accept?.();

    expect(leaveServiceMock.delete).toHaveBeenCalledWith(activeRecord.id, 'full');
  });

  it('opens audit log dialog for leave records', () => {
    component['openAuditLog']();

    // 同 attendance.page.spec：`showHeader: false` 讓 `header` 永遠不渲染（#448）
    expect(dialogServiceMock.open).toHaveBeenCalledWith(AuditLogDialogComponent, {
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        resourceTypes: ['leave'],
      },
    });
  });

  it('#1005 編輯：以該筆資料開表單；儲存後提示並重新載入列表', () => {
    const onClose = { subscribe: (fn: (v: unknown) => void) => fn({ ...activeRecord }) };
    dialogServiceMock.open.mockReturnValue({ onClose });
    const listCalls = leaveServiceMock.list.mock.calls.length;

    (component as any).openEditDialog(activeRecord);

    expect(dialogServiceMock.open).toHaveBeenCalledWith(
      LeaveFormDialogComponent,
      expect.objectContaining({ data: { leave: activeRecord } }),
    );
    // 重載列表一支＋重取兩個分頁張數與今天進行中的假三支
    expect(leaveServiceMock.list.mock.calls.length).toBe(listCalls + 4);
  });

  // 動作列 sticky 會扣掉 .p-dialog-content 的底部 padding（浮在離底 20px、底下露內容）：
  // 管理端兩個入口都要把 padding 交給動作列（#1768）
  it('新增／編輯請假的彈窗都帶 LEAVE_DIALOG_CONTENT_STYLE', () => {
    dialogServiceMock.open.mockReturnValue({ onClose: { subscribe: () => undefined } });
    (component as any).openCreateDialog();
    (component as any).openEditDialog(activeRecord);
    for (const call of dialogServiceMock.open.mock.calls.filter(
      (c: unknown[]) => c[0] === LeaveFormDialogComponent,
    )) {
      expect(call[1].contentStyle).toBe(LEAVE_DIALOG_CONTENT_STYLE);
      expect(call[1].appendTo).toBeDefined(); // 掛 overlay 容器，max-height 才吃得到
    }
    expect(dialogServiceMock.open).toHaveBeenCalledTimes(2);
  });

  describe('A6 版（#1314 LV1／LV3）', () => {
    const rec = (over: Partial<LeaveRequest>): LeaveRequest => ({
      ...activeRecord,
      id: 'r-' + Math.random().toString(36).slice(2, 7),
      startDate: '2026-04-10',
      endDate: '2026-04-10',
      ...over,
    });
    const respond = (data: LeaveRequest[], total = data.length) =>
      leaveServiceMock.list.mockReturnValue(
        of({ data, meta: { total, page: 1, pageSize: 20, totalPages: Math.ceil(total / 20) } }),
      );
    const calls = () => leaveServiceMock.list.mock.calls as unknown as [Record<string, unknown>][];
    const q = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        `[data-testid="${id}"]`,
      ) as HTMLElement | null;
    const qa = (id: string) => [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        `[data-testid="${id}"]`,
      ),
    ];

    it('預設是待處理：endFrom＝台北今天、依開始日由早到晚', () => {
      leaveServiceMock.list.mockClear();
      component['loadRecords']();

      expect(calls()[0][0]).toEqual(
        expect.objectContaining({ endFrom: '2026-04-10', order: 'start_asc', pageSize: 20 }),
      );
    });

    it('載入時另取三個數字：待處理張數、全部張數、今天進行中的假', async () => {
      leaveServiceMock.list.mockClear();
      component.ngOnInit();

      const params = calls().map((c) => c[0]);
      expect(params).toContainEqual(
        expect.objectContaining({ endFrom: '2026-04-10', pageSize: 1 }),
      );
      expect(params.some((p) => p['pageSize'] === 1 && p['endFrom'] === undefined)).toBe(true);
      expect(params).toContainEqual(expect.objectContaining({ coverDate: '2026-04-10' }));
    });

    it('切到「全部」：不帶 endFrom，依開始日由新到舊，並回到第一頁', () => {
      component['currentPage'].set(3);
      leaveServiceMock.list.mockClear();

      component['setTab']('all');

      expect(calls()[0][0]).toEqual(expect.objectContaining({ order: 'start_desc', page: 1 }));
      expect(calls()[0][0]['endFrom']).toBeUndefined();
    });

    it('待處理依今天／明天／之後分章；進行中的跨日假歸今天', () => {
      respond([
        rec({ id: 'a', startDate: '2026-04-08', endDate: '2026-04-12' }),
        rec({ id: 'b', startDate: '2026-04-10' }),
        rec({ id: 'c', startDate: '2026-04-11', endDate: '2026-04-11' }),
        rec({ id: 'd', startDate: '2026-04-15', endDate: '2026-04-15' }),
      ]);
      component['loadRecords']();
      fixture.detectChanges();

      const chapters = component['chapters']();
      expect(chapters.map((g) => g.name)).toEqual(['今天', '明天', '4/15']);
      expect(chapters[0].rows.map((r) => r.id)).toEqual(['a', 'b']);
      expect(qa('chapter')).toHaveLength(3);
    });

    // #1698：A6 leave.html 在 ≤860 覆寫 `.chap`＝橫排、章名 28px（listRow）
    it('章頭用 listRow：手機章名 28px', () => {
      respond([rec({ id: 'a', startDate: '2026-04-10' })]);
      component['loadRecords']();
      fixture.detectChanges();

      const name = (fixture.nativeElement as HTMLElement).querySelector('.chapter-head__name');
      expect(name?.classList).toContain('text-[28px]');
      // #1715：A6 `.chap` 手機上內距 24px（章頭上的 pt-6），原本 pt-4 差 8px
      expect(name!.closest('app-chapter-head')!.classList).toContain('pt-6');
    });

    it('全部分頁依開始日分章，不把進行中的歸到今天', () => {
      component['tab'].set('all');
      respond([rec({ id: 'a', startDate: '2026-04-08', endDate: '2026-04-12' })]);
      component['loadRecords']();

      expect(component['chapters']().map((g) => g.name)).toEqual(['4/8']);
    });

    it('補請：建立日（台北）晚於開始日才標', () => {
      const late = rec({ startDate: '2026-04-08', createdAt: '2026-04-09T02:00:00Z' });
      const onTime = rec({ startDate: '2026-04-10', createdAt: '2026-04-09T02:00:00Z' });
      // UTC 16:30 已是台北隔天 00:30：開始日 4/9、建立在台北 4/10 → 補請
      const taipeiNext = rec({ startDate: '2026-04-09', createdAt: '2026-04-09T16:30:00Z' });

      expect(component['isLate'](late)).toBe(true);
      expect(component['isLate'](onTime)).toBe(false);
      expect(component['isLate'](taipeiNext)).toBe(true);
    });

    it('列：沒寫原因就寫「沒寫原因」；跨日寫天數；補請標記出現', () => {
      respond([
        rec({
          reason: null,
          startDate: '2026-04-10',
          endDate: '2026-04-12',
          createdAt: '2026-04-11T02:00:00Z',
        }),
      ]);
      component['loadRecords']();
      fixture.detectChanges();

      expect(q('reason')!.textContent).toContain('沒寫原因');
      expect(q('days')!.textContent).toContain('3 天');
      expect(q('range')!.textContent).toContain('4/10–4/12');
      expect(q('late')).not.toBeNull();
    });

    it('展開後才有「編輯」「取消請假」：編輯開表單、取消走確認', () => {
      const record = rec({ startDate: '2026-04-20', endDate: '2026-04-20' });
      respond([record]);
      component['loadRecords']();
      fixture.detectChanges();
      const open = { onClose: { subscribe: () => undefined } };
      dialogServiceMock.open.mockReturnValue(open);

      q('edit')!.click();
      expect(dialogServiceMock.open).toHaveBeenCalledWith(
        LeaveFormDialogComponent,
        expect.objectContaining({ data: { leave: record } }),
      );

      q('cancel')!.click();
      expect(confirmationService.confirm).toHaveBeenCalledTimes(1);
    });

    it('色面句：今天幾位（不重複學生）、之後還有幾筆', () => {
      component['pendingCount'].set(5);
      component['todayLeaves'].set([
        rec({ studentId: 's1' }),
        rec({ studentId: 's1' }),
        rec({ studentId: 's2' }),
      ]);

      expect(component['headline']()).toEqual({
        today: '今天 2 位請假，',
        later: '之後還有 2 筆。',
      });
    });

    it('色面兩行（A6）：逗號後 <br />；兩個數字都還沒到就不寫、退回頁名（不寫 0）', () => {
      const h1 = () => (fixture.nativeElement as HTMLElement).querySelector('h1')!;
      component['pendingCount'].set(null);
      component['todayLeaves'].set(null);
      fixture.detectChanges();
      expect(h1().querySelector('br')).toBeNull(); // 兩個數字都還沒到

      component['pendingCount'].set(3);
      fixture.detectChanges();
      expect(component['headline']()).toBeNull(); // 只有一個數字也不算
      expect(h1().querySelector('br')).toBeNull();

      component['todayLeaves'].set([rec({ studentId: 's1' })]);
      fixture.detectChanges();
      expect(h1().querySelector('br')).not.toBeNull();
      expect(h1().textContent!.replace(/\s+/g, '')).toBe('今天1位請假，之後還有2筆。');
    });

    it('章名下小字（A6）：今天／明天寫「4/10（五）」，其他日期寫「週二」；昨天以前的進行中假歸今天', () => {
      respond([
        rec({ id: 'y', startDate: '2026-04-09', endDate: '2026-04-11' }), // 昨天開始、進行中 → 今天章
        rec({ id: 't', startDate: '2026-04-10', endDate: '2026-04-10' }),
        rec({ id: 'm', startDate: '2026-04-11', endDate: '2026-04-11' }), // 明天（今天＋1）
        rec({ id: 'a', startDate: '2026-04-12', endDate: '2026-04-12' }), // 後天（門檻＋1）
      ]);
      component['loadRecords']();
      fixture.detectChanges();

      expect(component['chapters']().map((c) => [c.name, c.meta, c.rows.length])).toEqual([
        ['今天', '4/10（五）', 2],
        ['明天', '4/11（六）', 1],
        ['4/12', '週日', 1],
      ]);
      expect(qa('chapter-sub').map((e) => e.textContent!.trim())).toEqual([
        '4/10（五）',
        '4/11（六）',
        '週日',
      ]);
    });

    it('操作紀錄：白底框、沒有圖示（A6），點了開紀錄對話框', () => {
      fixture.detectChanges();
      const btn = q('audit-log')!;
      expect(btn.textContent!.trim()).toBe('操作紀錄');
      for (const c of ['bg-white', 'border-zinc-300', 'text-zinc-900']) {
        expect(btn.classList.contains(c)).toBe(true);
      }
      expect(btn.querySelector('i, .pi')).toBeNull();

      dialogServiceMock.open.mockClear();
      btn.click();
      expect(dialogServiceMock.open).toHaveBeenCalledTimes(1);
    });

    it('登記請假帶「＋」圖示：桌機標頭與手機托盤兩處都有', () => {
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.page-actions__header-primary .pi-plus')).not.toBeNull();
      expect(root.querySelector('.page-actions__dock .pi-plus')).not.toBeNull();
    });

    it('篩選面板（A6）：只在「全部」分頁，灰色圓角、欄位帶標籤（學生、日期範圍）', () => {
      fixture.detectChanges();
      expect(q('filters')).toBeNull(); // 待處理沒有

      component['tab'].set('all');
      fixture.detectChanges();
      const panel = q('filters')!;
      expect(panel.classList.contains('bg-zinc-100')).toBe(true);
      expect(panel.classList.contains('wide:rounded-lg')).toBe(true);
      expect(q('student-filter')!.textContent).toContain('學生');
      expect(q('date-filter')!.textContent).toContain('日期範圍');
    });

    it('選學生帶 studentId（只在全部分頁），清除篩選全清', () => {
      component['tab'].set('all');
      leaveServiceMock.list.mockClear();

      component['onStudentChange']({ id: 'stu-9', name: '王小明' } as never);
      expect(calls()[0][0]).toEqual(expect.objectContaining({ studentId: 'stu-9', page: 1 }));
      expect(component['hasFilter']()).toBe(true);

      leaveServiceMock.list.mockClear();
      component['clearFilters']();
      expect(calls()[0][0]['studentId']).toBeUndefined();
      expect(component['hasFilter']()).toBe(false);
    });

    // #1100 #31：課程／開課班篩選
    it('面板有課程、開課班兩欄；選課程帶 courseId、開課班只列那門課的班、已選的班清掉', () => {
      component['tab'].set('all');
      fixture.detectChanges();
      expect(q('course-filter')!.textContent).toContain('課程');
      expect(q('class-filter')!.textContent).toContain('開課班');

      component['onClassChange']('class-1');
      expect(calls().at(-1)![0]).toEqual(expect.objectContaining({ classId: 'class-1' }));

      leaveServiceMock.list.mockClear();
      classesServiceMock.list.mockClear();
      component['onCourseChange']('course-1');
      expect(classesServiceMock.list).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: 'course-1', isActive: true }),
      );
      expect(calls()[0][0]).toEqual(expect.objectContaining({ courseId: 'course-1', page: 1 }));
      expect(calls()[0][0]['classId']).toBeUndefined();
      expect(component['hasFilter']()).toBe(true);

      component['onClassChange']('class-1');
      leaveServiceMock.list.mockClear();
      classesServiceMock.list.mockClear();
      component['clearFilters']();
      expect(calls()[0][0]['courseId']).toBeUndefined();
      expect(calls()[0][0]['classId']).toBeUndefined();
      // 清掉課程後班清單要回到全部課程的班
      expect(classesServiceMock.list).toHaveBeenCalledWith(
        expect.not.objectContaining({ courseId: 'course-1' }),
      );
      expect(component['hasFilter']()).toBe(false);
    });

    it('只選了班也算有篩選（「清除篩選」要出現）', () => {
      component['tab'].set('all');
      component['onClassChange']('class-1');
      expect(component['hasFilter']()).toBe(true);
    });

    it('待處理分頁不帶課程／開課班', () => {
      component['tab'].set('all');
      component['onClassChange']('class-1');
      leaveServiceMock.list.mockClear();
      component['setTab']('pending');
      vi.runAllTimers();
      expect(calls().at(-1)![0]['classId']).toBeUndefined();
    });

    describe('取消請假的確認文案寫清出缺席影響（rules §6–7）', () => {
      const message = () =>
        (vi.mocked(confirmationService.confirm).mock.calls[0]?.[0] as { message: string }).message;

      it('還沒開始：不影響任何出缺席', () => {
        component['confirmDelete'](rec({ startDate: '2026-04-20', endDate: '2026-04-21' }));
        expect(message()).toContain('還沒開始');
        expect(message()).toContain('不影響任何出缺席');
      });

      it('已結束：還沒點名的回到還沒點名、已點名的不動；不再說「恢復出勤狀態」', () => {
        component['confirmDelete'](rec({ startDate: '2026-04-01', endDate: '2026-04-02' }));
        expect(message()).toContain('還沒點名的日子');
        expect(message()).toContain('已經點過名的日子不會動');
        expect(message()).not.toContain('恢復對應課堂的出勤狀態');
      });

      it('進行中：兩個選項各自寫清楚，截斷寫出保留到哪一天', () => {
        component['confirmDelete'](rec({ startDate: '2026-04-08', endDate: '2026-04-12' }));
        expect(message()).toContain('取消剩餘假期：保留到 2026-04-09');
        expect(message()).toContain('完全刪除');
        expect(message()).toContain('已經點過名的日子不會動');
      });
    });

    it('分頁：第 x／y 頁，下一頁帶 page+1', () => {
      respond([rec({})], 45);
      component['loadRecords']();
      fixture.detectChanges();
      expect(q('page-indicator')!.textContent).toContain('第 1／3 頁');

      leaveServiceMock.list.mockClear();
      q('next-page')!.click();
      expect(calls()[0][0]['page']).toBe(2);
    });
  });

  // #1641 5b（使用者 10-16 裁定第 1 點）：完整刪除是樂觀的；截斷那一列不會消失，等伺服器回來
  describe('刪除的動態（#1641 5b）', () => {
    const other = { ...activeRecord, id: 'leave-0' };
    const ids = () => component['records']().map((r: LeaveRequest) => r.id);

    it('完整刪除失敗：那一列放回原位，並跳錯誤 toast', () => {
      const add = vi.spyOn(messageService, 'add');
      component['records'].set([other, activeRecord]);
      leaveServiceMock.delete.mockReturnValueOnce(throwError(() => new Error('x')) as never);
      component['executeDelete'](activeRecord, 'full', '已刪除', '');
      expect(ids()).toEqual(['leave-0', 'leave-1']);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('完整刪除成功：維持拿掉，背景重抓不變淡', () => {
      component['records'].set([other, activeRecord]);
      component['loading'].set(false);
      leaveServiceMock.list.mockReturnValueOnce(NEVER as never);
      component['executeDelete'](activeRecord, 'full', '已刪除', '');
      expect(ids()).toEqual(['leave-0']);
      expect(component['loading']()).toBe(false);
    });

    it('截斷：伺服器還沒回時那一列不動', () => {
      component['records'].set([other, activeRecord]);
      leaveServiceMock.delete.mockReturnValueOnce(new Subject() as never);
      component['executeDelete'](activeRecord, 'truncate', '已結束', '');
      expect(ids()).toEqual(['leave-0', 'leave-1']);
    });
  });
});
