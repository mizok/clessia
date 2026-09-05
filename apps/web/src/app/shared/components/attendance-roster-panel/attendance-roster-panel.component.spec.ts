import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { AttendanceRosterPanelComponent } from './attendance-roster-panel.component';
import { todayLocal } from '@shared/utils/session-time.util';
import { AttendanceService } from '@core/attendance.service';
import { AuthService } from '@core/auth.service';
import { signal } from '@angular/core';

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
    cancelLeave: vi.fn(() => of(cancelLeaveResponse)),
  };

  let cancelLeaveResponse: {
    leavesDeleted: number;
    leavesTruncated: number;
    attendanceRecordsRemoved: number;
    droppedAfter: string | null;
  };

  const DEFAULT_STUDENTS = [
    {
      studentId: 'student-present',
      studentName: '王小明',
      grade: 'J1',
      school: '測試國中',
      recordId: 'record-1',
      status: 'present' as const,
      hasLeaveRequest: false,
    },
    {
      studentId: 'student-leave',
      studentName: '李小華',
      grade: 'J1',
      school: '測試國中',
      recordId: 'record-2',
      status: 'on_leave' as const,
      hasLeaveRequest: true,
    },
  ];

  const dialogRefMock = {
    close: vi.fn(),
  };

  let activeRole: ReturnType<typeof signal<'teacher' | 'admin'>>;
  let panelDate: string;

  async function render(students: unknown[] = DEFAULT_STUDENTS) {
    rosterStudents = students;
    fixture = TestBed.createComponent(AttendanceRosterPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    activeRole = signal<'teacher' | 'admin'>('teacher');
    panelDate = todayLocal();
    rosterStudents = DEFAULT_STUDENTS;
    cancelLeaveResponse = {
      leavesDeleted: 1,
      leavesTruncated: 0,
      attendanceRecordsRemoved: 1,
      droppedAfter: null,
    };
    attendanceServiceMock.cancelLeave.mockClear();
    attendanceServiceMock.roster.mockClear();
    attendanceServiceMock.batchUpdate.mockClear();
    dialogRefMock.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [AttendanceRosterPanelComponent],
      providers: [
        { provide: AttendanceService, useValue: attendanceServiceMock },
        { provide: AuthService, useValue: { activeRole: activeRole } },
        {
          provide: DynamicDialogConfig,
          // data 用 getter 延遲讀 —— 寫成字面值的話，測試在 body 裡改 panelDate
          // 已經來不及，config 在 configureTestingModule 當下就定死了
          useValue: {
            get data() {
              return { eventId: 'event-1', className: '數學班 A', eventDate: panelDate };
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
    expect(text).toContain('請假');
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

    // 這個測試原本斷言的是「只送標過的那一個」—— #138 的修法。
    // 那個方向對（不再預設全班缺席），但把**錯的資料換成了缺的資料**：後端收到任何一次
    // 批次就蓋 attendance_taken_at，那堂課從此算已點名，沒標到的人不會有紀錄、
    // 也不會再出現在漏點名清單裡。所以現在半途存檔是**擋下來**，不是照送。
    it('標了一半就儲存 —— 擋下來，而且說出為什麼', async () => {
      await render(UNMARKED);
      const c = component as never as {
        setStatus(id: string, s: 'present' | 'absent'): void;
        save(): void;
        notice(): { severity: string; detail: string } | null;
      };
      c.setStatus('s2', 'present');
      c.save();

      expect(attendanceServiceMock.batchUpdate).not.toHaveBeenCalled();
      expect(c.notice()?.severity).toBe('warning');
      // 說的是後果不是規則 —— 「還有 1 人」加上「會發生什麼事」
      expect(c.notice()?.detail).toContain('1 人');
      expect(c.notice()?.detail).toContain('漏點名');
    });

    it('全部標完才送得出去', async () => {
      await render(UNMARKED);
      const c = component as never as {
        setStatus(id: string, s: 'present' | 'absent'): void;
        save(): void;
      };
      c.setStatus('s1', 'present');
      c.setStatus('s2', 'absent');
      c.save();

      expect(attendanceServiceMock.batchUpdate).toHaveBeenCalledWith({
        eventId: 'event-1',
        updates: [
          { studentId: 's1', status: 'present' },
          { studentId: 's2', status: 'absent' },
        ],
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

  /**
   * #153 之後：請假用讀取時推導的 `hasLeaveRequest`，**不覆蓋 `status`**。
   *
   * 鎖住的條件**只有 `status === 'on_leave'`**，不含推導值 —— 工單原本寫的是
   * `status === 'on_leave' || hasLeaveRequest` 全鎖，但那會跟「顯示矛盾態」互相抵消：
   * 矛盾態的定義（標了缺席 + 有請假單）本身就滿足全鎖條件，
   * 老師會看到一個他動不了的問題。而銷假出口（A1）目前還是關的，鎖越多死區越大。
   */
  describe('請假感知（#153 hasLeaveRequest）', () => {
    const UNMARKED_FOR_PROGRESS = [
      {
        studentId: 's1',
        studentName: '甲',
        grade: 'J1',
        school: '測',
        recordId: null,
        status: null,
      },
      {
        studentId: 's2',
        studentName: '乙',
        grade: 'J1',
        school: '測',
        recordId: null,
        status: null,
      },
    ];

    const LEAVE_NOT_SYNCED = [
      {
        studentId: 'not-synced',
        studentName: '丙',
        grade: 'J1',
        school: '測試國中',
        recordId: null,
        status: null,
        // 請假單蓋到這堂課，但紀錄還沒被套用（先請假、後生成 event）
        hasLeaveRequest: true,
        leaveEndDate: null,
      },
    ];

    it('紀錄already是 on_leave → 鎖住，沒有按鈕', async () => {
      await render();
      const leaveRow = fixture.nativeElement.querySelector('.roster-panel__row--on-leave');
      expect(leaveRow?.querySelector('.roster-panel__toggle')).toBeNull();
    });

    /** 這是與工單不同的地方：推導值只標註，不鎖 */
    it('只有請假單（紀錄還沒套用）→ 標註但**不鎖**，按鈕留著', async () => {
      await render(LEAVE_NOT_SYNCED);
      const row = fixture.nativeElement.querySelector('.roster-panel__row');
      expect(row.textContent).toContain('請假');
      expect(row.querySelector('.roster-panel__toggle')).not.toBeNull();
    });

    /**
     * 守衛的豁免用**寬的** `hasLeave()`，鎖定用**窄的** `isLocked()`。
     * 這個寬窄之分是 `markAllPresent` 早就在做的事（「這個人別碰」用寬的、
     * 「這一格 disable 不」用窄的），守衛屬於前者。
     *
     * 只豁免 `on_leave` 的話，這種學生會被鎖進死循環：沒有「標成請假」可點 →
     * 算未標記 → 存不了 → 被迫標缺席 → 觸發誤標旗標 → 只好標出席（說謊）才存得了檔。
     */
    it('只有請假單的人不算未標記 —— 否則他會被鎖進死循環', async () => {
      await render(LEAVE_NOT_SYNCED);
      const c = component as never as { pendingCount(): number; save(): void };

      expect(c.pendingCount()).toBe(0);
    });

    // 全班都是請假的極端：沒有人要標，也就沒有東西可送 —— 那時候擋的是「空批次」不是「未標記」
    it('全班都請假時儲存 —— 擋在空批次，而且不說成「你還沒標」', async () => {
      await render(LEAVE_NOT_SYNCED);
      const c = component as never as {
        save(): void;
        notice(): { severity: string; detail: string } | null;
      };

      c.save();

      expect(attendanceServiceMock.batchUpdate).not.toHaveBeenCalled();
      expect(c.notice()?.severity).toBe('info');
      // 中性的說法 —— 全班請假時老師沒有東西可標，不該讀成「你漏做了」
      expect(c.notice()?.detail).toContain('都在請假中');
    });

    // 標完最後一人時這一格如果消失，footer 縮 25px、儲存鈕往上跳 —— 正好是手指要按的時候
    it('全部標完之後進度不會消失，改說完成', async () => {
      await render(UNMARKED_FOR_PROGRESS);
      const c = component as never as { setStatus(id: string, s: 'present' | 'absent'): void };
      c.setStatus('s1', 'present');
      c.setStatus('s2', 'present');
      fixture.detectChanges();

      const progress = fixture.nativeElement.querySelector('.roster-panel__progress');
      expect(progress).not.toBeNull();
      expect(progress.textContent.trim()).toBe('全部標記完成');
    });

    // 全班請假時一個都沒標，那不是「完成」—— 他根本沒東西可標
    it('全班請假不說成「全部標記完成」', async () => {
      await render(LEAVE_NOT_SYNCED);

      const progress = fixture.nativeElement.querySelector('.roster-panel__progress');
      expect(progress.textContent.trim()).toContain('請假');
    });

    it('請假的人算進「不需標記」的計數裡', async () => {
      await render(LEAVE_NOT_SYNCED);
      const c = component as never as { exemptCount(): number };

      expect(c.exemptCount()).toBe(1);
    });

    it('兩種請假的 chip 文案一樣 —— 差別不是老師該學的實作細節', async () => {
      await render(LEAVE_NOT_SYNCED);
      const notSynced = fixture.nativeElement.querySelector('.data-chip')?.textContent.trim();
      await render();
      const synced = fixture.nativeElement
        .querySelector('.roster-panel__row--on-leave .data-chip')
        ?.textContent.trim();
      expect(notSynced).toBe(synced);
    });

    it('「全部出席」跳過有請假單的人，不只跳過 on_leave', async () => {
      await render(LEAVE_NOT_SYNCED);
      (component as never as { markAllPresent(): void }).markAllPresent();
      expect(
        (component as never as { getStatus(id: string): unknown }).getStatus('not-synced'),
      ).toBeNull();
    });
  });

  /**
   * 矛盾態：老師標了缺席，但這人其實有請假單。
   * 它說的是**誤操作**（點了不該點的人），不是資料矛盾 —— 所以文案要讓老師知道該怎麼辦。
   */
  describe('請假但標缺席的旗標', () => {
    const NO_LEAVE = [
      {
        studentId: 's1',
        studentName: '甲',
        grade: 'J1',
        school: '測試國中',
        recordId: null,
        status: null,
        hasLeaveRequest: false,
        leaveEndDate: null,
      },
    ];

    const HAS_LEAVE = [
      {
        studentId: 'x1',
        studentName: '丁',
        grade: 'J1',
        school: '測試國中',
        recordId: null,
        status: null,
        hasLeaveRequest: true,
        leaveEndDate: null,
      },
    ];

    it('沒標之前不出現旗標', async () => {
      await render(HAS_LEAVE);
      expect(fixture.nativeElement.querySelector('.roster-panel__mismark')).toBeNull();
    });

    it('標了缺席才出現，且說出該怎麼辦', async () => {
      await render(HAS_LEAVE);
      (component as never as { setStatus(id: string, s: 'present' | 'absent'): void }).setStatus(
        'x1',
        'absent',
      );
      fixture.detectChanges();
      const flag = fixture.nativeElement.querySelector('.roster-panel__mismark');
      expect(flag).not.toBeNull();
      expect(flag.textContent).toContain('不需點名');
    });

    /** 標成出席不算矛盾 —— 請假的人來了是正常的事，不該報警 */
    it('標出席不出現旗標', async () => {
      await render(HAS_LEAVE);
      (component as never as { setStatus(id: string, s: 'present' | 'absent'): void }).setStatus(
        'x1',
        'present',
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.roster-panel__mismark')).toBeNull();
    });

    it('沒有請假單的人標缺席不出現旗標', async () => {
      await render(NO_LEAVE);
      (component as never as { setStatus(id: string, s: 'present' | 'absent'): void }).setStatus(
        's1',
        'absent',
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.roster-panel__mismark')).toBeNull();
    });
  });

  /**
   * A1：請假的學生今天出現了。在 #177 之前這一列**沒有任何可操作元素** ——
   * 學生本人站在教室裡，系統沒有方式記錄他來了，老師只能打電話找行政。
   */
  describe('銷假（請假學生今天到了）', () => {
    const ON_LEAVE = [
      {
        studentId: 'l1',
        studentName: '請假生',
        grade: 'J1',
        school: '測試國中',
        recordId: 'r1',
        status: 'on_leave' as const,
        hasLeaveRequest: true,
        leaveEndDate: null,
      },
    ];

    it('請假列有「他來了」可以按 —— A1 之前這一列是死的', async () => {
      await render(ON_LEAVE);
      const row = fixture.nativeElement.querySelector('.roster-panel__row--on-leave');
      expect(row.textContent).toContain('他來了');
    });

    it('按下去用 eventId + studentId 呼叫銷假', async () => {
      await render(ON_LEAVE);
      (component as never as { cancelLeave(id: string): void }).cancelLeave('l1');
      expect(attendanceServiceMock.cancelLeave).toHaveBeenCalledWith('event-1', 'l1');
    });

    /** #169 閉環：成功後學生要回到可標記狀態，靠重抓 roster 而不是自己改本地狀態 */
    it('成功後重抓 roster，不自己猜新狀態', async () => {
      await render(ON_LEAVE);
      attendanceServiceMock.roster.mockClear();
      (component as never as { cancelLeave(id: string): void }).cancelLeave('l1');
      expect(attendanceServiceMock.roster).toHaveBeenCalledWith('event-1');
    });

    /**
     * `droppedAfter` 非 null = 今天卡在請假區間中間，後段被連坐取消。
     * **這件事不能默默吃掉** —— 老師以為只銷了今天。
     */
    it('連坐取消後續日期時一定要講出來', async () => {
      cancelLeaveResponse = {
        leavesDeleted: 0,
        leavesTruncated: 1,
        attendanceRecordsRemoved: 1,
        droppedAfter: '2026-04-05',
      };
      await render(ON_LEAVE);
      (component as never as { cancelLeave(id: string): void }).cancelLeave('l1');
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('後續日期的請假也一併取消');
    });

    it('沒有連坐就不要嚇人', async () => {
      await render(ON_LEAVE);
      (component as never as { cancelLeave(id: string): void }).cancelLeave('l1');
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('後續日期的請假也一併取消');
    });

    it('只有請假單、紀錄還沒套用的那種不顯示「他來了」—— 那一列本來就能標', async () => {
      await render([{ ...ON_LEAVE[0], status: null }]);
      const row = fixture.nativeElement.querySelector('.roster-panel__row');
      expect(row.textContent).not.toContain('他來了');
      expect(row.querySelector('.roster-panel__toggle')).not.toBeNull();
    });
  });

  /**
   * 端到端實測抓到的（單元測試看不到，因為 service 是 mock 的）：
   * API 對老師有 **「只能銷當天的假」** 的限制（403）——
   * 銷假的依據是「他人就在我面前」，那只有當天成立。管理員不受限（處理事後更正）。
   *
   * 所以按鈕不能無條件出現：過去的課堂上，老師按下去必然失敗。
   * 前端隱藏**不構成授權**（c1，API 仍然強制），這裡藏的是一個必然失敗的入口。
   */
  describe('只能銷當天的假', () => {
    const ON_LEAVE = [
      {
        studentId: 'l1',
        studentName: '請假生',
        grade: 'J1',
        school: '測試國中',
        recordId: 'r1',
        status: 'on_leave' as const,
        hasLeaveRequest: true,
        leaveEndDate: null,
      },
    ];

    it('老師 + 今天的課 → 有「他來了」', async () => {
      panelDate = todayLocal();
      await render(ON_LEAVE);
      expect(fixture.nativeElement.textContent).toContain('他來了');
    });

    it('老師 + 過去的課 → 不顯示（按了必然 403）', async () => {
      panelDate = '2020-01-01';
      await render(ON_LEAVE);
      expect(fixture.nativeElement.textContent).not.toContain('他來了');
    });

    /** 管理員在 API 上不受限，前端不該替他關掉 */
    it('管理員 + 過去的課 → 仍然顯示', async () => {
      panelDate = '2020-01-01';
      activeRole.set('admin');
      await render(ON_LEAVE);
      expect(fixture.nativeElement.textContent).toContain('他來了');
    });
  });

  // 「零人」跟「零個待標記」是兩件事 —— 空名單落進「全部標記完成」是空話
  describe('空名單', () => {
    it('進度說沒有學生，不是「全部標記完成」', async () => {
      await render([]);

      const progress = fixture.nativeElement.querySelector('.roster-panel__progress');
      expect(progress.textContent.trim()).toBe('這堂課沒有學生');
    });

    it('存檔說沒有學生，不是「都在請假中」', async () => {
      await render([]);
      const c = component as never as { save(): void; notice(): { detail: string } | null };

      c.save();

      expect(attendanceServiceMock.batchUpdate).not.toHaveBeenCalled();
      expect(c.notice()?.detail).toContain('沒有學生');
    });

    it('列表區說明該去哪裡加人', async () => {
      await render([]);

      expect(fixture.nativeElement.querySelector('.roster-panel__empty')).not.toBeNull();
    });
  });

  /**
   * 事前警告。#185 給 `leaveEndDate`、#222 再給 `leaveStartDate`，
   * 但那兩個都是**聚合值**，前端得自己推導連坐 —— 而推導在「兩張假接力」時
   * 跟一張真長假同形，所以文案只能說「可能」。
   *
   * #265 之後後端逐張假算好 `cancelDropsLeaveUntil`（用的是銷假自己那支
   * `cancelLeaveForDate`），前端只是顯示它。**文案因此升級成「將」。**
   */
  describe('跨日假的事前警告', () => {
    function leaveRow(cancelDropsLeaveUntil: string | null) {
      return [
        {
          studentId: 'l1',
          studentName: '請假生',
          grade: 'J1',
          school: '測試國中',
          recordId: 'r1',
          status: 'on_leave' as const,
          hasLeaveRequest: true,
          cancelDropsLeaveUntil,
        },
      ];
    }

    it('後端說會連坐 → 說死「將」，並講出取消到哪一天', async () => {
      panelDate = todayLocal();
      await render(leaveRow('2026-12-25'));
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('2026-12-25');
      expect(text).toContain('將一併取消');
    });

    /**
     * **這條是從「釘住『可能』」改寫來的，不是新加的。**
     *
     * 原本它釘的是：只要前端還分不出「一張長假」與「兩張接力」，就不准說「將」。
     * #265 之後那個限制不存在 —— 後端逐張假算，接力假各自算出零連坐、回 `null`。
     *
     * **接力假在這一層就是 `null`**，元件根本看不到「接力」這件事，
     * 所以不另外寫一條「接力假」的測試 —— 那會是同一個輸入換一個名字，
     * 看起來多守了一個 case，實際上一行程式碼都沒多守到。
     * 「接力假預測為 null」歸 API 那層測（`cancelLeaveForDate` 與 roster 的 spec）。
     *
     * 這一條守的東西沒變：**畫面說的話要跟實際行為一致。**
     * 只是這次一致的方向是「不要警告一件不會發生的事」。
     */
    it('後端說不會連坐 → 什麼都不顯示，也不留「可能」那種模糊字眼', async () => {
      panelDate = todayLocal();
      await render(leaveRow(null));
      const text = fixture.nativeElement.textContent as string;
      expect(text).not.toContain('一併取消');
      expect(text).not.toContain('可能');
    });
  });

  /**
   * P1（Tester 抓到）：改了點名沒存就關閉，零提醒靜默丟棄。這裡的「改動」
   * 特指跟載入時的快照不同的部分——已經存過的紀錄不算未儲存。
   */
  describe('關閉前的未儲存改動提醒', () => {
    function stubConfirmDialog(confirmed: boolean) {
      const dialogService = fixture.debugElement.injector.get(DialogService);
      return vi
        .spyOn(dialogService, 'open')
        .mockReturnValue({ onClose: of(confirmed) } as ReturnType<DialogService['open']>);
    }

    it('沒有任何改動時直接關閉，不跳確認', async () => {
      await render();
      const openSpy = stubConfirmDialog(true);
      (component as never as { close(): void }).close();

      expect(openSpy).not.toHaveBeenCalled();
      expect(dialogRefMock.close).toHaveBeenCalledWith();
    });

    it('有未儲存的新標記時，關閉會先跳確認，取消就不關', async () => {
      const UNMARKED = [
        {
          studentId: 's1',
          studentName: '甲',
          grade: 'J1',
          school: '測試國中',
          recordId: null,
          status: null,
        },
      ];
      await render(UNMARKED);
      const openSpy = stubConfirmDialog(false);
      (component as never as { setStatus(id: string, s: 'present' | 'absent'): void }).setStatus(
        's1',
        'present',
      );
      (component as never as { close(): void }).close();

      expect(openSpy).toHaveBeenCalled();
      expect(dialogRefMock.close).not.toHaveBeenCalled();
    });

    it('確認離開後才真的關閉', async () => {
      const UNMARKED = [
        {
          studentId: 's1',
          studentName: '甲',
          grade: 'J1',
          school: '測試國中',
          recordId: null,
          status: null,
        },
      ];
      await render(UNMARKED);
      stubConfirmDialog(true);
      (component as never as { setStatus(id: string, s: 'present' | 'absent'): void }).setStatus(
        's1',
        'present',
      );
      (component as never as { close(): void }).close();

      expect(dialogRefMock.close).toHaveBeenCalledWith();
    });

    // 已經存過的紀錄（載入時就有的 status）不算「未儲存」，不該觸發確認
    it('已有紀錄的學生不算未儲存改動', async () => {
      await render(); // DEFAULT_STUDENTS 裡 student-present 載入時就是 present
      const openSpy = stubConfirmDialog(true);
      (component as never as { close(): void }).close();

      expect(openSpy).not.toHaveBeenCalled();
      expect(dialogRefMock.close).toHaveBeenCalledWith();
    });
  });
});
