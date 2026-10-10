import { of } from 'rxjs';
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
import { SystemClockService } from '@core/system-clock.service';
import { LeavePage } from './leave.page';
import { LeaveFormDialogComponent } from './leave-form-dialog.component';
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

      expect(component['headline']()).toBe('今天 2 位請假，之後還有 2 筆。');
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
});
