import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import {
  LEAVE_DIALOG_CONTENT_STYLE,
  LeaveFormDialogComponent,
} from './leave-form-dialog.component';
import { StudentsService } from '@core/students.service';
import { LeaveService } from '@core/leave.service';
import { ReferenceDataService } from '@core/reference-data.service';
import type { Campus } from '@core/campuses.service';
import { AttendanceService } from '@core/attendance.service';
import { CampusContextService } from '@core/campus-context.service';
import { SystemClockService } from '@core/system-clock.service';

/** 勾堂模式（#2318）用到的三支；不開勾堂的測試只需要它們存在 */
const studentDayMock = vi.fn();
const campusIdMock = signal<string | null>(null);
const PICK_PROVIDERS = [
  { provide: AttendanceService, useValue: { studentDay: studentDayMock } },
  { provide: CampusContextService, useValue: { id: campusIdMock } },
  { provide: SystemClockService, useValue: { todayTaipei: signal('2027-03-15') } },
];

describe('LeaveFormDialogComponent', () => {
  let fixture: ComponentFixture<LeaveFormDialogComponent>;
  let component: LeaveFormDialogComponent;

  const dialogRefMock = {
    close: vi.fn(),
  };
  const studentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [],
        summary: { total: 0, activeCount: 0 },
        meta: { total: 0, page: 1, pageSize: 30, totalPages: 0 },
      }),
    ),
  };
  const referenceDataServiceMock = {
    campuses: signal<Campus[]>([
      {
        id: 'campus-1',
        orgId: 'org-1',
        name: '示範分校',
        address: null,
        phone: null,
        isActive: true,
        paymentInfo: null,
        attendanceMode: null,
        createdAt: '2026-04-09T00:00:00.000Z',
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
    ]),
    loadCampuses: vi.fn(),
  };
  const leaveServiceMock = {
    create: vi.fn(() =>
      of({
        id: 'leave-1',
        studentName: '出勤測試學生01',
      }),
    ),
  };

  beforeEach(async () => {
    dialogRefMock.close.mockReset();
    leaveServiceMock.create.mockClear();
    referenceDataServiceMock.loadCampuses.mockClear();

    await TestBed.configureTestingModule({
      imports: [LeaveFormDialogComponent],
      providers: [
        ...PICK_PROVIDERS,
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: ReferenceDataService, useValue: referenceDataServiceMock },
        { provide: LeaveService, useValue: leaveServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LeaveFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('blocks submit when autocomplete model is not a selected student object', () => {
    const dialog = component as any;

    dialog.selectedStudent = '出勤測試學生01';
    dialog.startDate = new Date('2026-04-02');
    dialog.endDate = new Date('2026-04-02');

    dialog.submit();

    expect(leaveServiceMock.create).not.toHaveBeenCalled();
    expect(dialog.errorMessage()).toBe('請從建議清單選擇一位學生');
  });

  it('submits separate start/end dates and times', () => {
    const dialog = component as any;

    dialog.selectedStudent = {
      id: 'student-1',
      name: '出勤測試學生01',
      grade: 'J1',
      school: '測試國中',
    };
    dialog.startDate = new Date('2026-04-02');
    dialog.endDate = new Date('2026-04-03');
    dialog.startTime = new Date('2026-04-02T09:30:00');
    dialog.endTime = new Date('2026-04-03T18:00:00');
    dialog.reason = '家庭事假';

    dialog.submit();

    expect(leaveServiceMock.create).toHaveBeenCalledWith({
      studentId: 'student-1',
      startDate: '2026-04-02',
      endDate: '2026-04-03',
      startTime: '09:30',
      endTime: '18:00',
      reason: '家庭事假',
    });
  });

  /**
   * #2396 L3（dialog-frame.md「操作量分級」）：管理端新增、要選學生時，手機分兩步 ①學生 ②請假內容；桌機單頁。
   * 送出鈕在殼的底部列：type=submit form="leave-form"，點鈕與 Enter 都只走 form 的 submit。
   */
  describe('手機分步（#2396）', () => {
    const mobile = (on: boolean) =>
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: on })),
      );
    afterEach(() => vi.unstubAllGlobals());
    const el = () => fixture.nativeElement as HTMLElement;
    const q = (id: string) => el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const step = (n: number) => el().querySelector(`[data-step="${n}"]`)!;
    const form = () => el().querySelector<HTMLFormElement>('#leave-form')!;
    const fill = () => {
      const dialog = component as any;
      dialog.startDate = new Date('2026-04-02');
      dialog.endDate = new Date('2026-04-03');
      dialog.reason = '家庭事假';
    };
    // 走元件選學生的路（onStudent）。實際是自動完成的事件觸發、整個畫面會被標成要刷新；
    // 測試直接呼叫時只有 studentId 這個 signal 變，補 markForCheck 模擬事件（不然只做局部刷新、NG0100）
    const pickStudent = () => {
      (component as any).onStudent({ id: 'student-1', name: '甲', grade: 'J1', school: 'x' });
      fixture.componentRef.changeDetectorRef.markForCheck();
    };

    it('沒選學生不前進、只列這一步缺的；選了才到第二步，上一步回來保留學生', () => {
      mobile(true);
      fixture.detectChanges();
      expect(el().textContent).toContain('第 1／2 步 · 學生');
      expect(step(1).classList).not.toContain('max-wide:hidden');
      expect(step(2).classList).toContain('max-wide:hidden');

      form().requestSubmit();
      fixture.detectChanges();
      expect((component as any).step()).toBe(1);
      expect(q('leave-hint-step')!.textContent!.trim()).toBe('還沒填：學生');

      pickStudent();
      fixture.detectChanges();
      q('leave-next')!.click();
      fixture.detectChanges();
      expect((component as any).step()).toBe(2);
      expect(el().textContent).toContain('第 2／2 步 · 請假內容');
      expect(step(1).classList).toContain('max-wide:hidden');
      expect(step(2).classList).not.toContain('max-wide:hidden');
      expect(leaveServiceMock.create).not.toHaveBeenCalled();

      q('leave-back')!.click();
      fixture.detectChanges();
      expect((component as any).step()).toBe(1);
      expect((component as any).selectedStudent.id).toBe('student-1');
    });

    it('手機兩步走完與桌機一次送出，送出內容相同（各一次）', () => {
      mobile(true);
      pickStudent();
      fill();
      fixture.detectChanges();
      form().requestSubmit(); // 手機第一步：Enter＝下一步
      fixture.detectChanges();
      expect(leaveServiceMock.create).not.toHaveBeenCalled();
      q('leave-submit')!.click();
      expect(leaveServiceMock.create).toHaveBeenCalledTimes(1);
      const mobileCall = leaveServiceMock.create.mock.calls[0];

      leaveServiceMock.create.mockClear();
      (component as any).step.set(1);
      (component as any).saving.set(false);
      mobile(false);
      fixture.detectChanges();
      form().requestSubmit(); // 桌機：Enter＝送出
      expect(leaveServiceMock.create).toHaveBeenCalledTimes(1);
      expect(leaveServiceMock.create.mock.calls[0]).toEqual(mobileCall);
    });

    it('「下一步」「送出請假」都是 type=submit form="leave-form"、在殼的底部列、不在 form 內', () => {
      mobile(true);
      fixture.detectChanges();
      for (const id of ['leave-next', 'leave-submit']) {
        const b = q(id)!;
        expect(b.getAttribute('type')).toBe('submit');
        expect(b.getAttribute('form')).toBe('leave-form');
        expect(b.closest('.form-dialog__footer')).not.toBeNull();
        expect(form().contains(b)).toBe(false);
      }
    });

    it('送出用的 form 不包住欄位（結構照 A6）；日期、原因欄帶 form="leave-form"，Enter 送到它', () => {
      expect(form().children).toHaveLength(0);
      const fields = el().querySelectorAll<HTMLInputElement>('#leave-startDate, #leave-reason');
      expect(fields.length).toBe(2);
      for (const f of fields) expect(f.form).toBe(form());
    });
  });

  // A6 form()：送出鈕不鎖死，旁邊一行寫還差什麼；填好就消失
  it('還沒填：列出缺的必填欄；送出鈕不 disabled（aria-disabled）', () => {
    const el = fixture.nativeElement as HTMLElement;
    const why = () => el.querySelector('[data-testid="leave-hint"]')!.textContent!.trim();
    expect(why()).toBe('還沒填：學生、開始日期、結束日期');
    const go = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('送出請假'))!;
    expect(go.disabled).toBe(false);
    expect(go.getAttribute('aria-disabled')).toBe('true');
    const dialog = component as any;
    dialog.selectedStudent = { id: 's1', name: '甲' };
    dialog.startDate = new Date('2026-04-02');
    dialog.endDate = new Date('2026-04-02');
    fixture.detectChanges();
    expect(why()).toBe('');
    expect(go.getAttribute('aria-disabled')).toBe('false');
  });

  // A6 `.fdlg__foot { position: sticky; bottom: 0 }`：表單一長，送出鈕不能跟著內容捲走。
  // #2290 起由共用殼的底部列（.form-dialog__footer，sticky、手機 16＋safe-area）負責，不再自刻
  it('動作列在共用殼的 sticky 底部列裡；標題是開窗端給的 header', () => {
    const el = fixture.nativeElement as HTMLElement;
    const go = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('送出請假'))!;
    expect(go.closest('.form-dialog__footer')).not.toBeNull();
    expect(el.querySelector('app-dialog-frame h2')?.textContent?.trim()).toBeTruthy();
  });

  it('DialogService 開時的 contentStyle：底部 padding 歸 0、改由動作列撐（--leave-foot-pb）', () => {
    expect(LEAVE_DIALOG_CONTENT_STYLE['padding-bottom']).toBe('0');
    expect(LEAVE_DIALOG_CONTENT_STYLE['--leave-foot-pb']).toBeTruthy();
  });

  it('renders the shared student autocomplete field', () => {
    expect(fixture.nativeElement.querySelector('app-student-autocomplete')).not.toBeNull();
  });

  it('搜尋跟儀表板「登記請假」同一組：不限學生名，家長名也比對（#2318）', () => {
    const dialog = component as any;

    dialog.searchStudents('劉');

    expect(studentsServiceMock.list).toHaveBeenLastCalledWith({
      search: '劉',
      campusId: undefined,
      grade: undefined,
      isActive: true,
      pageSize: 30,
    });
  });
});

// #1005：同一個表單的編輯模式（`data.leave` 有值）
describe('LeaveFormDialogComponent 編輯模式', () => {
  const close = vi.fn();
  const leaveServiceMock = {
    create: vi.fn(),
    update: vi.fn(() => of({ id: 'leave-1', studentName: '劉靖雯' })),
  };
  const leave = {
    id: 'leave-1',
    studentId: 'student-1',
    studentName: '劉靖雯',
    startDate: '2026-04-02',
    endDate: '2026-04-03',
    startTime: '09:30:00',
    endTime: null,
    reason: '感冒',
  };

  let fixture: ComponentFixture<LeaveFormDialogComponent>;
  let dialog: any;

  beforeEach(async () => {
    close.mockReset();
    leaveServiceMock.create.mockReset();
    leaveServiceMock.update.mockClear();
    await TestBed.configureTestingModule({
      imports: [LeaveFormDialogComponent],
      providers: [
        ...PICK_PROVIDERS,
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { leave } } },
        { provide: StudentsService, useValue: { list: vi.fn() } },
        {
          provide: ReferenceDataService,
          useValue: { campuses: signal<Campus[]>([]), loadCampuses: vi.fn() },
        },
        { provide: LeaveService, useValue: leaveServiceMock },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LeaveFormDialogComponent);
    dialog = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('學生唯讀、不顯示搜尋框；表單帶入原值', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-student-autocomplete')).toBeNull();
    expect(el.textContent).toContain('劉靖雯');
    expect(dialog.reason).toBe('感冒');
    expect(dialog.startTime.getHours()).toBe(9);
    expect(dialog.endTime).toBeNull();
  });

  it('儲存 → 呼叫 update（不是 create），帶新日期與原因，並以結果關閉', () => {
    dialog.endDate = new Date(2026, 3, 5);
    dialog.reason = '改成事假';

    dialog.submit();

    expect(leaveServiceMock.create).not.toHaveBeenCalled();
    expect(leaveServiceMock.update).toHaveBeenCalledWith('leave-1', {
      startDate: '2026-04-02',
      endDate: '2026-04-05',
      startTime: '09:30',
      endTime: null,
      reason: '改成事假',
    });
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ id: 'leave-1' }));
  });

  it('409 重疊時把後端訊息顯示在表單裡，不關閉', () => {
    leaveServiceMock.update.mockReturnValueOnce(
      throwError(() => ({ error: { message: '該學生在 2026-04-04 ~ 2026-04-06 已有請假紀錄' } })),
    );

    dialog.submit();

    expect(dialog.errorMessage()).toContain('已有請假紀錄');
    expect(close).not.toHaveBeenCalled();
  });
});

describe('LeaveFormDialogComponent 預帶學生（學生檔案的「登記請假」）', () => {
  const dialogRefMock = { close: vi.fn() };
  const studentsServiceMock = { list: vi.fn() };
  const referenceDataServiceMock = { campuses: signal<Campus[]>([]), loadCampuses: vi.fn() };
  const leaveServiceMock = { create: vi.fn(() => of({ id: 'leave-1', studentName: '小九' })) };

  it('學生唯讀、不載入分校、用預帶的 id 建立', async () => {
    await TestBed.configureTestingModule({
      imports: [LeaveFormDialogComponent],
      providers: [
        ...PICK_PROVIDERS,
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        {
          provide: DynamicDialogConfig,
          useValue: { data: { student: { id: 's9', name: '小九' } } },
        },
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: ReferenceDataService, useValue: referenceDataServiceMock },
        { provide: LeaveService, useValue: leaveServiceMock },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(LeaveFormDialogComponent);
    f.detectChanges();
    const c = f.componentInstance as unknown as {
      startDate: Date;
      endDate: Date;
      canSubmit: () => boolean;
      submit: () => void;
    };
    expect(f.nativeElement.textContent).toContain('小九');
    expect(f.nativeElement.querySelector('app-student-autocomplete')).toBeNull();
    expect(referenceDataServiceMock.loadCampuses).not.toHaveBeenCalled();
    c.startDate = new Date(2026, 9, 12);
    c.endDate = new Date(2026, 9, 12);
    expect(c.canSubmit()).toBe(true);
    c.submit();
    expect(leaveServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 's9', startDate: '2026-10-12' }),
    );
  });
});

// #1695：家長端嵌在頁面的 <dialog> 裡（沒有 DynamicDialogRef），學生固定、送出走家長端 API
describe('LeaveFormDialogComponent 嵌入（家長端）', () => {
  const leaveServiceMock = { create: vi.fn() };
  const referenceDataServiceMock = { campuses: signal<Campus[]>([]), loadCampuses: vi.fn() };

  async function setup(create: ReturnType<typeof vi.fn>) {
    leaveServiceMock.create.mockClear();
    referenceDataServiceMock.loadCampuses.mockClear();
    await TestBed.configureTestingModule({
      imports: [LeaveFormDialogComponent],
      providers: [
        ...PICK_PROVIDERS,
        { provide: StudentsService, useValue: { list: vi.fn() } },
        { provide: ReferenceDataService, useValue: referenceDataServiceMock },
        { provide: LeaveService, useValue: leaveServiceMock },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(LeaveFormDialogComponent);
    f.componentRef.setInput('student', { id: 'kid-1', name: '林子晴' });
    f.componentRef.setInput('create', create);
    const closed = vi.fn();
    f.componentInstance.closed.subscribe(closed);
    f.detectChanges();
    const c = f.componentInstance as unknown as {
      startDate: Date;
      endDate: Date;
      startTime: Date;
      endTime: Date;
      reason: string;
      submit: () => void;
      errorMessage: () => string | null;
    };
    return { f, c, closed };
  }

  // #2290：嵌在家長端原生 <dialog> 裡 —— 標題「登記請假」、副標寫孩子，✕ 等同取消（closed 送 null）
  it('嵌入：標題登記請假、副標寫孩子，按關閉＝取消', async () => {
    const { f, closed } = await setup(vi.fn());
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('app-dialog-frame h2')?.textContent?.trim()).toBe('登記請假');
    expect(el.querySelector('.dialog-header-inline__sub')?.textContent).toContain('林子晴');
    el.querySelector<HTMLButtonElement>('.dialog-header-inline__close')!.click();
    expect(closed).toHaveBeenCalledWith(null);
  });
  it('不出學生欄、不載入分校；預設今天 17:00–21:00（A6 forms.leave）', async () => {
    const { f, c } = await setup(vi.fn());
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('app-student-autocomplete')).toBeNull();
    expect(el.textContent).not.toContain('學生');
    expect(referenceDataServiceMock.loadCampuses).not.toHaveBeenCalled();
    const today = new Date();
    expect(c.startDate.toDateString()).toBe(today.toDateString());
    expect(c.endDate.toDateString()).toBe(today.toDateString());
    expect([c.startTime.getHours(), c.startTime.getMinutes()]).toEqual([17, 0]);
    expect([c.endTime.getHours(), c.endTime.getMinutes()]).toEqual([21, 0]);
  });

  it('日期、時間是原生 date／time 欄（A6 forms.leave）：顯示 yyyy-MM-dd／HH:mm，改了寫回表單', async () => {
    const create = vi.fn(() => of({}));
    const { f, c } = await setup(create);
    const el = f.nativeElement as HTMLElement;
    const start = el.querySelector('#leave-startTime') as HTMLInputElement;
    expect(start.type).toBe('time');
    expect(start.value).toBe('17:00');
    const end = el.querySelector('#leave-endDate') as HTMLInputElement;
    expect(end.type).toBe('date');
    end.value = '2099-10-20';
    end.dispatchEvent(new Event('input'));
    start.value = '';
    start.dispatchEvent(new Event('input'));
    c.submit();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: '2099-10-20', startTime: null, endTime: '21:00' }),
    );
  });

  it('送出走給的 create（不走管理端 API），成功由 closed 帶回', async () => {
    const create = vi.fn(() => of({ data: { id: 'leave-9' } }));
    const { c, closed } = await setup(create);
    c.reason = '看牙醫';
    c.submit();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'kid-1',
        startTime: '17:00',
        endTime: '21:00',
        reason: '看牙醫',
      }),
    );
    expect(leaveServiceMock.create).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith({ data: { id: 'leave-9' } });
  });

  it.each([
    [400, 'NO_SESSIONS', '這段時間沒有課', '這段時間 林子晴 沒有課'],
    [409, 'LEAVE_OVERLAP', '這段時間已經請過假了', '這段時間已經請過假了'],
    [400, 'ALL_ATTENDED', '這段時間的課都已經點成出席了', '這段時間的課都已經點成出席了'],
  ])('%s %s：錯誤留在表單、填的不清、不關', async (status, code, error, shown) => {
    const create = vi.fn(() => throwError(() => ({ status, error: { error, code } })));
    const { f, c, closed } = await setup(create);
    c.reason = '家裡有事';
    c.submit();
    f.detectChanges();
    expect(c.errorMessage()).toBe(shown);
    expect((f.nativeElement as HTMLElement).textContent).toContain(shown);
    expect(c.reason).toBe('家裡有事');
    expect(closed).not.toHaveBeenCalled();
  });

  // 審核席突變：失敗後沒有把 saving 放掉，按鈕會卡在「送出中…」、submit() 開頭也擋掉重送
  it('送出失敗 → 錯誤留在表單、按鈕回到「送出請假」、再按一次會再送', async () => {
    const create = vi
      .fn()
      .mockReturnValueOnce(
        throwError(() => ({
          status: 409,
          error: { error: '這段時間已經請過假了', code: 'LEAVE_OVERLAP' },
        })),
      )
      .mockReturnValueOnce(of({ data: { id: 'leave-2' } }));
    const { f, c, closed } = await setup(create);
    const go = () =>
      [...(f.nativeElement as HTMLElement).querySelectorAll('button')].find((b) =>
        /送出/.test(b.textContent ?? ''),
      )!;

    go().click();
    f.detectChanges();
    expect(c.errorMessage()).toBe('這段時間已經請過假了');
    expect(go().textContent!.trim()).toBe('送出請假');
    expect(go().getAttribute('aria-disabled')).toBe('false');

    go().click();
    f.detectChanges();
    expect(create).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledWith({ data: { id: 'leave-2' } });
  });

  it('網路失敗：通用訊息、不關', async () => {
    const create = vi.fn(() =>
      throwError(() => ({ status: 0, error: new ProgressEvent('error') })),
    );
    const { c, closed } = await setup(create);
    c.submit();
    expect(c.errorMessage()).toBe('新增請假失敗，請稍後再試');
    expect(closed).not.toHaveBeenCalled();
  });

  it('取消：closed 帶 null', async () => {
    const { f, closed } = await setup(vi.fn());
    const cancel = [...(f.nativeElement as HTMLElement).querySelectorAll('button')].find((b) =>
      b.textContent?.includes('取消'),
    )!;
    cancel.click();
    expect(closed).toHaveBeenCalledWith(null);
  });
});

// #2318：管理端勾當天的課（A6 leave.html newLeave）
describe('LeaveFormDialogComponent 勾堂（管理端，#2318）', () => {
  const close = vi.fn();
  const create = vi.fn((_body: unknown) => of({ id: 'leave-9' }));
  const update = vi.fn((_id: string, _body: unknown) => of({ id: 'leave-9' }));
  const session = (id: string, o: object = {}) => ({
    sessionId: id,
    eventId: null,
    startTime: '14:00:00',
    endTime: '16:00:00',
    className: `班 ${id}`,
    cancelled: false,
    attendance: null,
    existingLeave: null,
    ...o,
  });
  const STUDENT = { id: 'stu-1', name: '陳大同' };

  async function setup(data: object) {
    close.mockReset();
    create.mockClear();
    update.mockClear();
    studentDayMock.mockReset();
    studentDayMock.mockReturnValue(
      of({
        data: {
          date: '2027-03-15',
          sessions: [
            session('s1'),
            session('s2', { cancelled: true }),
            session('s3', { existingLeave: { startDate: '2027-03-15', endDate: '2027-03-15' } }),
            session('s4'),
          ],
          nextSession: null,
        },
      }),
    );
    campusIdMock.set('campus-1');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LeaveFormDialogComponent],
      providers: [
        ...PICK_PROVIDERS,
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { header: '登記請假', data } },
        { provide: StudentsService, useValue: { list: vi.fn() } },
        {
          provide: ReferenceDataService,
          useValue: { campuses: signal<Campus[]>([]), loadCampuses: vi.fn() },
        },
        { provide: LeaveService, useValue: { create, update } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LeaveFormDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, dialog: fixture.componentInstance as any };
  }

  it('選學生 → 列那天的課、預設全勾能勾的；停課與已請假的不能勾；送 sessionIds（三步、不手打時間）', async () => {
    const { fixture, dialog } = await setup({ pickSessions: true });
    expect(dialog.missingHint()).toBe('還沒選學生');
    dialog.onStudent(STUDENT);
    fixture.detectChanges();
    expect(studentDayMock).toHaveBeenCalledWith('stu-1', '2027-03-15');
    expect([...dialog.picked()]).toEqual(['s1', 's4']);
    const el = fixture.nativeElement as HTMLElement;
    const boxes = [...el.querySelectorAll<HTMLInputElement>('[data-testid="leave-pick"] input')];
    expect(boxes.map((b) => b.disabled)).toEqual([false, true, true, false]);
    expect(el.textContent).toContain('停課');
    expect(el.textContent).toContain('已請假');
    expect(el.textContent).toContain('送出後，勾的課出缺席會標成請假');

    dialog.toggle('s4');
    dialog.submit();
    expect(create).toHaveBeenCalledWith({
      studentId: 'stu-1',
      startDate: '2027-03-15',
      endDate: '2027-03-15',
      reason: null,
      sessionIds: ['s1'],
    });
    expect(close).toHaveBeenCalledWith({ id: 'leave-9' });
  });

  it('一堂都沒勾：寫原因、不送', async () => {
    const { dialog } = await setup({ pickSessions: true });
    dialog.onStudent(STUDENT);
    dialog.toggle('s1');
    dialog.toggle('s4');
    expect(dialog.missingHint()).toBe('至少勾一堂課');
    dialog.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('分校預設帶頂列', async () => {
    const { dialog } = await setup({ pickSessions: true });
    expect(dialog.selectedCampusId).toBe('campus-1');
  });

  it('改用日期區間：結束日跟開始日；送出走原本的區間（不帶 sessionIds）', async () => {
    const { fixture, dialog } = await setup({ pickSessions: true });
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="leave-mode-toggle"]')!
      .click();
    expect(dialog.mode()).toBe('range');
    dialog.onStudent(STUDENT);
    dialog.setField('startDate', new Date('2027-03-20'));
    expect(dialog.endDate).toEqual(new Date('2027-03-20'));
    dialog.submit();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2027-03-20', endDate: '2027-03-20' }),
    );
    expect(create.mock.calls[0][0]).not.toHaveProperty('sessionIds');
  });

  it('編輯綁堂的假：勾選模式帶回原本那幾堂，自己蓋到的不算「已請假」；儲存整組替換', async () => {
    studentDayMock.mockReset();
    const leave = {
      id: 'leave-9',
      studentId: 'stu-1',
      studentName: '陳大同',
      startDate: '2027-03-15',
      endDate: '2027-03-15',
      startTime: null,
      endTime: null,
      reason: '感冒',
      sessionIds: ['s3'],
    };
    const { dialog } = await setup({ leave, pickSessions: true });
    expect(dialog.mode()).toBe('sessions');
    expect([...dialog.picked()]).toEqual(['s3']);
    dialog.toggle('s1');
    dialog.submit();
    expect(update).toHaveBeenCalledWith('leave-9', { reason: '感冒', sessionIds: ['s3', 's1'] });
  });

  it('編輯沒綁堂的假：維持區間模式，也不給切換', async () => {
    const leave = {
      id: 'leave-8',
      studentId: 'stu-1',
      studentName: '陳大同',
      startDate: '2027-03-15',
      endDate: '2027-03-16',
      startTime: null,
      endTime: null,
      reason: null,
      sessionIds: [],
    };
    const { fixture, dialog } = await setup({ leave, pickSessions: true });
    expect(dialog.mode()).toBe('range');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="leave-mode-toggle"]'),
    ).toBeNull();
  });

  it('學生固定（編輯）：不分步、沒有步驟標示與下一步', async () => {
    const leave = {
      id: 'leave-8',
      studentId: 'stu-1',
      studentName: '陳大同',
      startDate: '2027-03-15',
      endDate: '2027-03-16',
      startTime: null,
      endTime: null,
      reason: null,
      sessionIds: [],
    };
    const { fixture } = await setup({ leave, pickSessions: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-dialog-steps')).toBeNull();
    expect(el.querySelector('[data-testid="leave-next"]')).toBeNull();
    expect(el.querySelector('[data-step="2"]')!.classList).not.toContain('max-wide:hidden');
  });

  // 審核席 #2405 突變 N8：勾課模式的請假日期、原因也要歸到送出用的 form（Enter 才送得出）
  it('勾課模式：請假日期、原因欄的 form owner 是 #leave-form', async () => {
    const { fixture, dialog } = await setup({ pickSessions: true });
    expect(dialog.mode()).toBe('sessions');
    const el = fixture.nativeElement as HTMLElement;
    const form = el.querySelector('#leave-form');
    expect(form).not.toBeNull();
    for (const id of ['#leave-day', '#leave-reason']) {
      expect(el.querySelector<HTMLInputElement>(id)!.form).toBe(form);
    }
  });

  it('沒給 pickSessions（家長端）：維持日期區間', async () => {
    const { dialog } = await setup({});
    expect(dialog.mode()).toBe('range');
    expect(studentDayMock).not.toHaveBeenCalled();
  });
});
