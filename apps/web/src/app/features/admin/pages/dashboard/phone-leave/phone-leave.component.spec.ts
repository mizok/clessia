import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { NEVER, Subject, of, throwError, type Observable } from 'rxjs';

import {
  AttendanceService,
  type AttendanceRecord,
  type StudentDay,
} from '@core/attendance.service';
import { LeaveService } from '@core/leave.service';
import { StudentsService, type Student } from '@core/students.service';
import { SystemClockService } from '@core/system-clock.service';

import { provideRouter } from '@angular/router';
import { PhoneLeaveComponent } from './phone-leave.component';

/**
 * #964「接到電話 → 不換頁請假」。設計：https://github.com/mizok/clessia/issues/964
 *
 * 守的是任務流本身：找人（學生或家長姓名）→ 預設今天 → 預覽那天的課 → 送出 →
 * **顯示伺服器實際寫入的**，不是自己預測的。寫入只呼叫既有 `POST /api/leaves`（保留類，只呼叫不改）。
 */

const TODAY = '2026-10-01';

const student = (overrides: Partial<Student> = {}): Student =>
  ({
    id: 'stu-1',
    name: '王小明',
    grade: 'junior_3',
    school: { id: 'sch', name: '建國中學', shortName: null },
    parentNames: ['王媽媽'],
    campusNames: ['文山校'],
    ...overrides,
  }) as Student;

const day = (overrides: Partial<StudentDay> = {}): StudentDay => ({
  date: TODAY,
  sessions: [
    {
      sessionId: 's1',
      eventId: 'e1',
      startTime: '14:00',
      endTime: '15:30',
      className: '國三數學 A',
      cancelled: false,
      attendance: null,
      existingLeave: null,
    },
    {
      sessionId: 's2',
      eventId: 'e2',
      startTime: '16:00',
      endTime: '17:30',
      className: '國三英文',
      cancelled: false,
      attendance: 'absent',
      existingLeave: null,
    },
  ],
  nextSession: null,
  ...overrides,
});

const record = (overrides: Partial<AttendanceRecord> = {}): AttendanceRecord =>
  ({
    id: 'r1',
    studentId: 'stu-1',
    eventId: 'e1',
    eventDate: TODAY,
    startTime: '14:00',
    endTime: '15:30',
    className: '國三數學 A',
    status: 'on_leave',
    ...overrides,
  }) as AttendanceRecord;

interface Internals {
  onQuery(q: string): void;
  pick(s: Student): void;
  submit(): void;
  reset(): void;
  canSubmit(): boolean;
}

describe('PhoneLeaveComponent', () => {
  let fixture: ComponentFixture<PhoneLeaveComponent>;
  let c: Internals;
  let studentsList: ReturnType<typeof vi.fn>;
  let studentDay: ReturnType<typeof vi.fn>;
  let attendanceList: ReturnType<typeof vi.fn>;
  let leaveCreate: ReturnType<typeof vi.fn>;
  let completedCount: number;

  function setup(
    preview: StudentDay = day(),
    actual: AttendanceRecord[] = [
      record(),
      record({
        id: 'r2',
        eventId: 'e2',
        startTime: '16:00',
        endTime: '17:30',
        className: '國三英文',
      }),
    ],
    preset: { id: string; get: () => Observable<{ data: Student }> } | null = null,
  ) {
    studentsList = vi.fn(() => of({ data: [student()], meta: {}, summary: {} }));
    studentDay = vi.fn((_id: string, date: string) => of({ data: { ...preview, date } }));
    attendanceList = vi.fn(() => of({ data: actual, meta: {} }));
    leaveCreate = vi.fn(() => of({ id: 'leave-1' }));

    TestBed.configureTestingModule({
      imports: [PhoneLeaveComponent],
      providers: [
        provideRouter([]),
        { provide: StudentsService, useValue: { list: studentsList, get: preset?.get } },
        { provide: AttendanceService, useValue: { studentDay, list: attendanceList } },
        { provide: LeaveService, useValue: { create: leaveCreate } },
        { provide: SystemClockService, useValue: { todayTaipei: signal(TODAY) } },
      ],
    });
    fixture = TestBed.createComponent(PhoneLeaveComponent);
    completedCount = 0;
    fixture.componentInstance.completed.subscribe(() => completedCount++);
    c = fixture.componentInstance as unknown as Internals;
    if (preset) fixture.componentRef.setInput('presetStudentId', preset.id);
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('找人用學生**或家長**姓名（API 預設的搜尋範圍），只找在籍的', () => {
    setup();
    c.onQuery('王媽媽');

    expect(studentsList).toHaveBeenCalledWith({ search: '王媽媽', isActive: true, pageSize: 10 });
  });

  it('選了人之後，預設今天（台北日），並預覽那天的課', () => {
    setup();
    c.pick(student());
    fixture.detectChanges();

    expect(studentDay).toHaveBeenCalledWith('stu-1', TODAY);
    expect(text()).toContain('國三數學 A');
    // 已點名「缺席」的那堂要明講會被改成請假 —— 行政要知道自己改了老師點的名
    expect(text()).toContain('老師已點名：缺席');
  });

  it('送出：呼叫既有 POST /api/leaves（今天一天），再撈**實際寫入**的出勤顯示結果', () => {
    setup();
    c.pick(student());
    c.submit();
    fixture.detectChanges();

    expect(leaveCreate).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'stu-1', startDate: TODAY, endDate: TODAY }),
    );
    expect(attendanceList).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'stu-1', dateFrom: TODAY, dateTo: TODAY }),
    );
    expect(text()).toContain('已請假');
    expect(text()).toContain('國三英文');
    expect(completedCount).toBe(1);
  });

  // 預覽是另外算的 —— 不能讓預覽冒充結果
  it('預覽與實際不一致時，以實際為準並寫出差異', () => {
    setup(day(), [record()]);
    c.pick(student());
    c.submit();
    fixture.detectChanges();

    expect(text()).toContain('預覽是 2 堂，實際標了 1 堂');
  });

  it('那堂已經請過假 → 不能送（提前擋，不等 409）', () => {
    setup(
      day({
        sessions: [
          {
            ...day().sessions[0],
            existingLeave: { startDate: '2026-09-30', endDate: '2026-10-03' },
          },
        ],
      }),
    );
    c.pick(student());
    fixture.detectChanges();

    expect(c.canSubmit()).toBe(false);
    expect(text()).toContain('已請假（2026-09-30–2026-10-03）');
  });

  // #2035（使用者 10-24）：只處理今天 —— 明天、其他日期、換人、下一堂改日都不給，其他日期到請假頁
  it('只處理今天：沒有明天／其他日期／換人／下一堂改日，有「到請假頁」連結', () => {
    setup(
      day({
        sessions: [],
        nextSession: { date: '2026-10-03', startTime: '14:00', className: '國三數學 A' },
      }),
    );
    c.pick(student());
    fixture.detectChanges();

    expect(text()).toContain('今天沒有課');
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map(
      (b) => b.textContent?.trim() ?? '',
    );
    for (const gone of ['明天', '其他日期', '換人', '下一堂']) {
      expect(
        buttons.some((t) => t.includes(gone)),
        gone,
      ).toBe(false);
    }
    expect(text()).not.toContain('2026-10-03');
    expect(fixture.nativeElement.querySelector('p-datepicker')).toBeNull();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/admin/leave"]');
    expect(link?.textContent).toContain('要請其他日期');
    expect((c as unknown as { chooseDate?: unknown }).chooseDate).toBeUndefined();
  });

  it('送出失敗：錯誤留在原地，選好的人與日期不清空，可以直接重送', () => {
    setup();
    leaveCreate.mockReturnValueOnce(throwError(() => ({ error: { error: '請假時間重疊' } })));
    c.pick(student());
    c.submit();
    fixture.detectChanges();

    expect(text()).toContain('請假時間重疊');
    expect(text()).toContain('王小明');
    expect(c.canSubmit()).toBe(true);
    expect(completedCount).toBe(0);
  });

  it('「再登記一位」清回找人那一步', () => {
    setup();
    c.pick(student());
    c.submit();
    c.reset();
    fixture.detectChanges();

    expect(text()).not.toContain('已請假');
    expect(c.canSubmit()).toBe(false);
  });

  /** #2037（使用者 10-24）：彈窗打開先出骨架，不要先出可輸入的搜尋框 */
  describe('從「該到沒到」預帶學生', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const skeleton = () => el().querySelector('[data-testid="phone-leave-skeleton"]');
    const search = () => el().querySelector('app-student-autocomplete');

    it('學生還在載：只有骨架，沒有搜尋框；回來後換成學生與今天的課', () => {
      const res = new Subject<{ data: Student }>();
      setup(day(), [], { id: 'stu-1', get: () => res });

      expect(skeleton()).not.toBeNull();
      expect(search()).toBeNull();
      expect(text()).not.toContain('學生或家長姓名');

      res.next({ data: student() });
      fixture.detectChanges();

      expect(skeleton()).toBeNull();
      expect(search()).toBeNull();
      expect(text()).toContain('王小明');
      expect(text()).toContain('國三數學 A');
    });

    it('讀不到學生：退回搜尋框，不卡在骨架', () => {
      setup(day(), [], { id: 'stu-1', get: () => throwError(() => new Error('500')) });

      expect(skeleton()).toBeNull();
      expect(search()).not.toBeNull();
    });

    it('學生到了、今天的課還在載：課列畫骨架', () => {
      setup(day(), [], { id: 'stu-1', get: () => of({ data: student() }) });
      studentDay.mockReturnValue(NEVER);
      c.pick(student());
      fixture.detectChanges();

      expect(el().querySelector('[aria-label="今天的課載入中"]')).not.toBeNull();
      expect(text()).not.toContain('國三數學 A');
    });
  });
});
