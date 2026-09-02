import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AttendanceService } from '@core/attendance.service';
import type { Session } from '@core/sessions.service';

import { SessionAttendanceDialogComponent } from './session-attendance-dialog.component';

describe('SessionAttendanceDialogComponent', () => {
  let fixture: ComponentFixture<SessionAttendanceDialogComponent>;
  let component: SessionAttendanceDialogComponent;
  const sessionsSpy = vi.fn(() =>
    of({
      data: [
        {
          eventId: 'event-1',
          classId: 'class-1',
          className: '國文 A',
          courseName: '國文班',
          teacherName: '李老師',
          campusId: 'campus-1',
          campusName: '示範分校',
          eventDate: '2099-03-10',
          startTime: '09:00',
          endTime: '11:00',
          enrolledCount: 3,
          presentCount: 1,
          onLeaveCount: 1,
          absentCount: 1,
          takenAt: null,
        },
      ],
      meta: { total: 1, page: 1, pageSize: 100, totalPages: 1 },
    }),
  );
  const rosterSpy = vi.fn(() =>
    of({
      eventId: 'event-1',
      takenAt: null,
      students: [
        {
          studentId: 'student-1',
          studentName: '王小明',
          grade: 'P5',
          school: '和平國小',
          recordId: 'record-1',
          status: 'present',
        },
        {
          studentId: 'student-2',
          studentName: '李小華',
          grade: 'P6',
          school: '和平國小',
          recordId: 'record-2',
          status: 'on_leave',
        },
        {
          studentId: 'student-3',
          studentName: '陳小安',
          grade: 'P6',
          school: '和平國小',
          recordId: null,
          status: null,
        },
      ],
    }),
  );
  const batchUpdateSpy = vi.fn(() =>
    of({
      updated: 2,
      takenAt: '2099-03-10T09:30:00.000Z',
    }),
  );
  const dialogCloseSpy = vi.fn();

  const session: Session = {
    id: 'session-1',
    classId: 'class-1',
    className: '國文 A',
    courseId: 'course-1',
    courseName: '國文班',
    campusId: 'campus-1',
    campusName: '示範分校',
    sessionDate: '2099-03-10',
    startTime: '09:00',
    endTime: '11:00',
    teacherId: 'teacher-2',
    teacherName: '李老師',
    status: 'scheduled',
    assignmentStatus: 'assigned',
    hasChanges: true,
  };

  beforeEach(async () => {
    sessionsSpy.mockClear();
    rosterSpy.mockClear();
    batchUpdateSpy.mockClear();
    dialogCloseSpy.mockClear();

    await TestBed.configureTestingModule({
      imports: [SessionAttendanceDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              session,
            },
          },
        },
        {
          provide: DynamicDialogRef,
          useValue: { close: dialogCloseSpy },
        },
        {
          provide: AttendanceService,
          useValue: {
            sessions: sessionsSpy,
            roster: rosterSpy,
            batchUpdate: batchUpdateSpy,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionAttendanceDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders attendance management dialog with summary and roster actions', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('國文 A');
    expect(text).toContain('未點名 3 人');
    expect(text).toContain('儲存點名');
    expect(text).toContain('王小明');
    expect(text).toContain('出席');
    expect(text).toContain('李小華');
    expect(text).toContain('請假中');
    expect(text).toContain('陳小安');
    expect(text).toContain('缺席');
  });

  it('resolves eventId from attendance sessions before loading roster', () => {
    expect(sessionsSpy).toHaveBeenCalledWith({
      date: '2099-03-10',
      classIds: ['class-1'],
      pageSize: 100,
    });
    expect(rosterSpy).toHaveBeenCalledWith('event-1');
  });

  it('does not render status toggle for on-leave students', () => {
    const leaveRow = fixture.nativeElement.querySelector('.session-attendance__item--on-leave');

    expect(leaveRow?.textContent).toContain('李小華');
    expect(leaveRow?.querySelector('.session-attendance__toggle')).toBeNull();
  });

  it('saves attendance using batch update and excludes on-leave students', () => {
    (
      component as unknown as {
        setStatus: (studentId: string, status: 'present' | 'absent') => void;
        save: () => void;
      }
    ).setStatus('student-3', 'absent');
    (
      component as unknown as {
        save: () => void;
      }
    ).save();

    expect(batchUpdateSpy).toHaveBeenCalledWith({
      eventId: 'event-1',
      updates: [
        { studentId: 'student-1', status: 'present' },
        { studentId: 'student-3', status: 'absent' },
      ],
    });
    expect(dialogCloseSpy).toHaveBeenCalledWith({
      eventId: 'event-1',
      takenAt: '2099-03-10T09:30:00.000Z',
      presentCount: 1,
      absentCount: 1,
      onLeaveCount: 1,
    });
  });

  // ── 「不知道」不等於「缺席」 ────────────────────────────────────────────
  //
  // 舊版 syncLocalStatus 把 status === null（還沒點名）壓成 'absent'，於是打開 dialog
  // 就全班預選缺席，一鍵儲存入庫 —— 而缺席會通知家長。UI 把「還不知道」編成了一個
  // 具體的壞消息。fixture 裡 student-3 的 status 正是 null。

  it('未點名的學生不預選任何狀態', () => {
    const getStatus = (id: string) =>
      (component as unknown as { getStatus: (i: string) => unknown }).getStatus(id);

    expect(getStatus('student-3')).toBeNull();
  });

  it('已經有紀錄的學生照原值帶出來', () => {
    const getStatus = (id: string) =>
      (component as unknown as { getStatus: (i: string) => unknown }).getStatus(id);

    expect(getStatus('student-1')).toBe('present');
  });

  it('未點的人數不算請假的', () => {
    // student-1 已點、student-2 請假（不需要點）、student-3 未點
    expect((component as unknown as { pendingCount: () => number }).pendingCount()).toBe(1);
  });

  /**
   * 後端只要收到任何一次 batch 就會蓋上 attendance_taken_at，那堂課從此算「已點名」。
   * 半途存下去的話，沒點到的人不會有紀錄、**也不會再出現在漏點名清單裡** ——
   * 那是比預選缺席更難發現的沉默。
   */
  it('還有人沒點時不送出，並說明為什麼', () => {
    batchUpdateSpy.mockClear();

    (component as unknown as { save: () => void }).save();

    expect(batchUpdateSpy).not.toHaveBeenCalled();
    const notice = (component as unknown as { notice: () => { detail: string } | null }).notice();
    expect(notice?.detail).toContain('1 位');
  });

  it('「全部出席」把未點的補上，但不動請假的', () => {
    const c = component as unknown as {
      markAllPresent: () => void;
      getStatus: (i: string) => unknown;
      pendingCount: () => number;
    };

    c.markAllPresent();

    expect(c.getStatus('student-3')).toBe('present');
    expect(c.getStatus('student-2')).toBeNull(); // 請假的沒有狀態可點
    expect(c.pendingCount()).toBe(0);
  });

  it('全部點完之後才送得出去', () => {
    batchUpdateSpy.mockClear();
    const c = component as unknown as { markAllPresent: () => void; save: () => void };

    c.markAllPresent();
    c.save();

    expect(batchUpdateSpy).toHaveBeenCalledWith({
      eventId: 'event-1',
      updates: [
        { studentId: 'student-1', status: 'present' },
        { studentId: 'student-3', status: 'present' },
      ],
    });
  });
});
