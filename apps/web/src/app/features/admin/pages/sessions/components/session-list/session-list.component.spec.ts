import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Session } from '@core/sessions.service';

import { SessionListComponent } from './session-list.component';

describe('SessionListComponent', () => {
  let component: SessionListComponent;
  let fixture: ComponentFixture<SessionListComponent>;
  let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  beforeEach(async () => {
    originalResizeObserver = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;

    await TestBed.configureTestingModule({
      imports: [SessionListComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionListComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    (
      globalThis as unknown as { ResizeObserver: typeof ResizeObserver | undefined }
    ).ResizeObserver = originalResizeObserver;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render course name and campus name for each list item', async () => {
    const session: Session = {
      id: '00000000-0000-0000-0000-000000000001',
      sessionDate: '2026-03-09',
      startTime: '09:00',
      endTime: '11:00',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      classId: '00000000-0000-0000-0000-000000000011',
      className: 'A 班',
      courseId: '00000000-0000-0000-0000-000000000021',
      courseName: '國中數學',
      campusId: '00000000-0000-0000-0000-000000000031',
      campusName: '台北校',
      teacherId: '00000000-0000-0000-0000-000000000041',
      teacherName: '王老師',
      hasChanges: false,
    };

    fixture.componentRef.setInput('sessions', [session]);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('國中數學');
    expect(text).toContain('台北校');
  });

  it('should render headers in class-first order and show attendance status summary', async () => {
    const session: Session = {
      id: '00000000-0000-0000-0000-000000000002',
      sessionDate: '2026-03-09',
      startTime: '09:00',
      endTime: '11:00',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      classId: '00000000-0000-0000-0000-000000000012',
      className: 'A 班',
      courseId: '00000000-0000-0000-0000-000000000022',
      courseName: '國中數學',
      campusId: '00000000-0000-0000-0000-000000000032',
      campusName: '台北校',
      teacherId: '00000000-0000-0000-0000-000000000042',
      teacherName: '王老師',
      hasChanges: false,
      attendanceTakenAt: '2026-03-09T11:05:00.000Z',
      attendanceEnrolledCount: 10,
      attendancePresentCount: 8,
      attendanceOnLeaveCount: 1,
      attendanceAbsentCount: 1,
    };

    fixture.componentRef.setInput('sessions', [session]);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    await fixture.whenStable();

    const headers = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('th'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(headers).toEqual(['班級 / 課程 / 分校', '老師', '出勤狀態', '狀態']);
    expect(text).toContain('已點名');
    expect(text).toContain('到 8');
    expect(text).toContain('請 1');
    expect(text).toContain('缺 1');
  });

  it('should show leave and attendance summary even before takenAt exists', async () => {
    const session: Session = {
      id: '00000000-0000-0000-0000-000000000003',
      sessionDate: '2026-03-10',
      startTime: '13:00',
      endTime: '15:00',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      classId: '00000000-0000-0000-0000-000000000013',
      className: 'B 班',
      courseId: '00000000-0000-0000-0000-000000000023',
      courseName: '國中英文',
      campusId: '00000000-0000-0000-0000-000000000033',
      campusName: '台中校',
      teacherId: '00000000-0000-0000-0000-000000000043',
      teacherName: '林老師',
      hasChanges: false,
      attendanceTakenAt: null,
      attendanceEnrolledCount: 10,
      attendancePresentCount: 1,
      attendanceOnLeaveCount: 2,
      attendanceAbsentCount: 0,
    };

    fixture.componentRef.setInput('sessions', [session]);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('未點名 10 人');
    expect(text).toContain('到 1');
    expect(text).toContain('請 2');
    expect(text).toContain('缺 0');
  });

  it('should not render adjustment column in list header', async () => {
    fixture.componentRef.setInput('sessions', []);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    await fixture.whenStable();

    const headers = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('th')).map(
      (element) => element.textContent?.trim() ?? '',
    );

    expect(headers).not.toContain('異動');
  });

  // 漏點名以前是沉默的：status === 'completed' 那條是死碼（沒有任何程式碼寫這個值），
  // 所有過去未點名的課都掉到 info —— 而藍色跟「今天稍晚要上的課」長得一樣
  describe('點名狀態的顏色', () => {
    const base: Session = {
      id: '00000000-0000-0000-0000-0000000000aa',
      sessionDate: '2026-03-09',
      startTime: '09:00',
      endTime: '11:00',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      classId: '00000000-0000-0000-0000-000000000011',
      className: 'A 班',
      courseId: '00000000-0000-0000-0000-000000000021',
      courseName: '國中數學',
      campusId: '00000000-0000-0000-0000-000000000031',
      campusName: '台北校',
      teacherId: '00000000-0000-0000-0000-000000000041',
      teacherName: '王老師',
      hasChanges: false,
    };
    /**
     * **固定的「現在」，不依賴牆鐘。**
     *
     * 原本這組日期是用 `new Date().toISOString().slice(0, 10)` 算的，那是 **UTC**
     * 日期 —— 在 UTC+8 每天 00:00–08:00 會比本地日期少一天，於是「今天 23:30 的課」
     * 其實變成「昨天 23:30 的課」（已結束）→ 這支測試每天紅 8 小時。
     *
     * 諷刺的是它測的正是時間邊界，自己卻踩到另一個時間邊界。現在把「現在」注入進去，
     * 幾點跑都一樣。
     */
    const NOW = new Date(2026, 7, 31, 12, 0); // 本地 2026-08-31 中午
    const today = '2026-08-31';
    const tomorrow = '2026-09-01';
    const yesterday = '2026-08-30';

    const tone = (overrides: Partial<Session>) =>
      component['attendanceStatusTone']({ ...base, ...overrides }, NOW);

    it('上完了卻沒點名是積欠 —— 這是這次修的東西', () => {
      expect(tone({ sessionDate: yesterday, attendanceTakenAt: null })).toBe('overdue');
    });

    it('點過名就是成功，不管多久以前', () => {
      expect(tone({ sessionDate: yesterday, attendanceTakenAt: '2026-03-09T11:05:00Z' })).toBe(
        'done',
      );
    });

    it('停課的課不催點名', () => {
      expect(tone({ sessionDate: yesterday, status: 'cancelled' })).toBe('inactive');
    });

    it('明天的課是中性的 —— 還在等，不該有色相', () => {
      expect(tone({ sessionDate: tomorrow, attendanceTakenAt: null })).toBe('pending');
    });

    // 舊版只比日期，今天晚上七點的課早上八點就被標成該點名而沒點
    it('今天稍晚才上的課是中性的，不是警示', () => {
      expect(
        tone({
          sessionDate: today,
          startTime: '23:30',
          endTime: '23:59',
          attendanceTakenAt: null,
        }),
      ).toBe('pending');
    });

    // ── 未指派：這一刀新加的時間維度 ──────────────────────────────────
    it('未指派 —— 課還沒開始只是還沒輪到', () => {
      const t = component['unassignedTone'](
        { ...base, sessionDate: tomorrow, startTime: '09:00', endTime: '11:00' },
        NOW,
      );

      expect(t).toBe('pending');
    });

    it('未指派 —— 課都開始了還沒指派才是積欠', () => {
      const t = component['unassignedTone'](
        { ...base, sessionDate: yesterday, startTime: '09:00', endTime: '11:00' },
        NOW,
      );

      expect(t).toBe('overdue');
    });

    // status 從來沒有被寫成 'completed'，所以它不該再影響顏色
    it('不再依賴 status === completed（那是死碼）', () => {
      expect(tone({ sessionDate: yesterday, status: 'completed', attendanceTakenAt: null })).toBe(
        tone({ sessionDate: yesterday, status: 'scheduled', attendanceTakenAt: null }),
      );
    });
  });
});
