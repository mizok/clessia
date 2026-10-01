import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  AttendanceService,
  type AttendanceRecord,
  type StudentDay,
} from '@core/attendance.service';
import { LeaveService } from '@core/leave.service';
import { StudentsService, type Student } from '@core/students.service';
import { SystemClockService } from '@core/system-clock.service';

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
  chooseDate(d: string): void;
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
  ) {
    studentsList = vi.fn(() => of({ data: [student()], meta: {}, summary: {} }));
    studentDay = vi.fn((_id: string, date: string) => of({ data: { ...preview, date } }));
    attendanceList = vi.fn(() => of({ data: actual, meta: {} }));
    leaveCreate = vi.fn(() => of({ id: 'leave-1' }));

    TestBed.configureTestingModule({
      imports: [PhoneLeaveComponent],
      providers: [
        { provide: StudentsService, useValue: { list: studentsList } },
        { provide: AttendanceService, useValue: { studentDay, list: attendanceList } },
        { provide: LeaveService, useValue: { create: leaveCreate } },
        { provide: SystemClockService, useValue: { todayTaipei: signal(TODAY) } },
      ],
    });
    fixture = TestBed.createComponent(PhoneLeaveComponent);
    completedCount = 0;
    fixture.componentInstance.completed.subscribe(() => completedCount++);
    c = fixture.componentInstance as unknown as Internals;
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

  it('那天沒課 → 給下一堂的一鍵改日', () => {
    setup(
      day({
        sessions: [],
        nextSession: { date: '2026-10-03', startTime: '14:00', className: '國三數學 A' },
      }),
    );
    c.pick(student());
    fixture.detectChanges();

    expect(text()).toContain('沒有課');
    expect(text()).toContain('2026-10-03');

    c.chooseDate('2026-10-03');
    expect(studentDay).toHaveBeenLastCalledWith('stu-1', '2026-10-03');
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
});
