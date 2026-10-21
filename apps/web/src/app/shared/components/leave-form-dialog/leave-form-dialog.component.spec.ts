import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { LeaveFormDialogComponent } from './leave-form-dialog.component';
import { StudentsService } from '@core/students.service';
import { LeaveService } from '@core/leave.service';
import { ReferenceDataService } from '@core/reference-data.service';
import type { Campus } from '@core/campuses.service';

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

  // A6 form()：送出鈕不鎖死，旁邊一行寫還差什麼；填好就消失
  it('還沒填：列出缺的必填欄；送出鈕不 disabled（aria-disabled）', () => {
    const el = fixture.nativeElement as HTMLElement;
    const why = () => el.querySelector('[aria-live="polite"]')!.textContent!.trim();
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

  // A6 `.fdlg__foot { position: sticky; bottom: 0; background: inherit }`：表單一長（手機、選了好幾天），
  // 送出鈕不能跟著內容捲走（#166 的同一個坑，這支沒用 .form-dialog__footer）
  it('動作列黏在捲動區底、底色不透明', () => {
    const el = fixture.nativeElement as HTMLElement;
    const go = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('送出請假'))!;
    const bar = go.parentElement!;
    for (const c of ['sticky', 'bottom-0', 'bg-white']) expect(bar.classList).toContain(c);
  });

  it('renders the shared student autocomplete field', () => {
    expect(fixture.nativeElement.querySelector('app-student-autocomplete')).not.toBeNull();
  });

  it('searches students by name only in the leave dialog', () => {
    const dialog = component as any;

    dialog.searchStudents('劉');

    expect(studentsServiceMock.list).toHaveBeenLastCalledWith({
      search: '劉',
      campusId: undefined,
      grade: undefined,
      isActive: true,
      pageSize: 30,
      searchScope: 'student_name',
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
