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
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver | undefined }).ResizeObserver =
      originalResizeObserver;
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

    const headers = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('th'),
    )
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(headers).toEqual([
      '班級 / 課程 / 分校',
      '老師',
      '出勤狀態',
      '狀態',
    ]);
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

    const headers = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('th'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(headers).not.toContain('異動');
  });
});
