import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { AttendanceRosterPanelComponent } from './attendance-roster-panel.component';
import { AttendanceService } from '@core/attendance.service';

describe('AttendanceRosterPanelComponent', () => {
  let fixture: ComponentFixture<AttendanceRosterPanelComponent>;
  let component: AttendanceRosterPanelComponent;

  let rosterStudents: unknown[];

  const attendanceServiceMock = {
    roster: vi.fn(() =>
      of({
        eventId: 'event-1',
        takenAt: '2026-04-02T09:00:00Z',
        students: rosterStudents as never,
      }),
    ),
    batchUpdate: vi.fn(() =>
      of({
        updated: 1,
        takenAt: '2026-04-02T09:00:00Z',
      }),
    ),
  };

  const DEFAULT_STUDENTS = [
          {
            studentId: 'student-present',
            studentName: '王小明',
            grade: 'J1',
            school: '測試國中',
            recordId: 'record-1',
            status: 'present' as const,
          },
          {
            studentId: 'student-leave',
            studentName: '李小華',
            grade: 'J1',
            school: '測試國中',
            recordId: 'record-2',
            status: 'on_leave' as const,
          },
  ];

  const dialogRefMock = {
    close: vi.fn(),
  };

  async function render(students: unknown[] = DEFAULT_STUDENTS) {
    rosterStudents = students;
    fixture = TestBed.createComponent(AttendanceRosterPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    rosterStudents = DEFAULT_STUDENTS;
    attendanceServiceMock.roster.mockClear();
    attendanceServiceMock.batchUpdate.mockClear();
    dialogRefMock.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [AttendanceRosterPanelComponent],
      providers: [
        { provide: AttendanceService, useValue: attendanceServiceMock },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              eventId: 'event-1',
              className: '數學班 A',
              eventDate: '2026/04/02',
            },
          },
        },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AttendanceRosterPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('在修改點名時仍顯示請假學生，且不提供切換按鈕', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(attendanceServiceMock.roster).toHaveBeenCalledWith('event-1');
    expect(text).toContain('李小華');
    expect(text).toContain('請假中');
    expect(text).toContain('王小明');

    const leaveRow = fixture.nativeElement.querySelector('.roster-panel__row--on-leave');
    expect(leaveRow?.textContent).toContain('李小華');
    expect(leaveRow?.querySelector('.roster-panel__toggle')).toBeNull();
  });

  it('儲存時不會把請假學生送進 batch update', () => {
    (component as any).save();

    expect(attendanceServiceMock.batchUpdate).toHaveBeenCalledWith({
      eventId: 'event-1',
      updates: [{ studentId: 'student-present', status: 'present' }],
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith({
      eventId: 'event-1',
      takenAt: '2026-04-02T09:00:00Z',
      presentCount: 1,
      absentCount: 0,
      onLeaveCount: 1,
    });
  });


  /**
   * 2026-09-02 UX 審查（阻斷級 A2）：面板原本把沒有紀錄的學生預設成 `absent`，
   * 而「缺席」是**實心（選中態）**、「出席」是外框 —— 老師點開面板，
   * 八個學生全部看起來已經被標成缺席，直接按儲存就是全班記缺席。
   *
   * 這三條釘住的是：預設零預選、未標記不寫入、一鍵全到。
   */
  describe('零預選（不預設任何人缺席）', () => {
    const UNMARKED = [
      {
        studentId: 's1',
        studentName: '甲',
        grade: 'J1',
        school: '測試國中',
        recordId: null,
        status: null,
      },
      {
        studentId: 's2',
        studentName: '乙',
        grade: 'J1',
        school: '測試國中',
        recordId: null,
        status: null,
      },
    ];

    it('沒有出勤紀錄的學生載入後不預選任何一顆', async () => {
      await render(UNMARKED);
      expect((component as never as { getStatus(id: string): unknown }).getStatus('s1')).toBeNull();
      expect((component as never as { getStatus(id: string): unknown }).getStatus('s2')).toBeNull();
    });

    it('零預選要在畫面上成立 —— 沒有任何一顆是 aria-pressed', async () => {
      await render(UNMARKED);
      const pressed = fixture.nativeElement.querySelectorAll('[aria-pressed="true"]');
      expect(pressed.length).toBe(0);
    });

    /**
     * 上面那條在「aria-pressed 根本沒渲染」時也會通過 —— 是假綠。
     * 這條反過來釘住屬性真的存在，兩條合起來才證明零預選是畫面上的事實。
     */
    it('標了之後那一顆才是 aria-pressed=true', async () => {
      await render(UNMARKED);
      (component as never as { setStatus(id: string, s: 'present' | 'absent'): void }).setStatus(
        's1',
        'present',
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('[aria-pressed="true"]').length).toBe(1);
    });

    /** 已經點過名的課堂再打開，原本的狀態要回來 —— 零預選不能把「已存在的紀錄」也清掉 */
    it('已有紀錄的學生仍然帶出原狀態', async () => {
      await render();
      expect(
        (component as never as { getStatus(id: string): unknown }).getStatus('student-present'),
      ).toBe('present');
    });

    it('一個都沒標就按儲存 —— 不打 API，也不關面板', async () => {
      await render(UNMARKED);
      (component as never as { save(): void }).save();
      expect(attendanceServiceMock.batchUpdate).not.toHaveBeenCalled();
      expect(dialogRefMock.close).not.toHaveBeenCalled();
    });

    it('只標了一個就儲存 —— 只送那一個，未標記的不寫入', async () => {
      await render(UNMARKED);
      const c = component as never as {
        setStatus(id: string, s: 'present' | 'absent'): void;
        save(): void;
      };
      c.setStatus('s2', 'present');
      c.save();
      expect(attendanceServiceMock.batchUpdate).toHaveBeenCalledWith({
        eventId: 'event-1',
        updates: [{ studentId: 's2', status: 'present' }],
      });
    });
  });

  describe('全部出席', () => {
    it('一鍵把所有非請假學生標成出席', async () => {
      await render();
      const c = component as never as { markAllPresent(): void; save(): void };
      c.markAllPresent();
      c.save();
      expect(attendanceServiceMock.batchUpdate).toHaveBeenCalledWith({
        eventId: 'event-1',
        updates: [{ studentId: 'student-present', status: 'present' }],
      });
    });

    /** 請假的人不該被一鍵標成出席 —— 那會覆蓋掉行政登記的請假 */
    it('請假學生不受「全部出席」影響', async () => {
      await render();
      (component as never as { markAllPresent(): void }).markAllPresent();
      expect(
        (component as never as { getStatus(id: string): unknown }).getStatus('student-leave'),
      ).toBeNull();
    });
  });
});
