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
});
