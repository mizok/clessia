import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Session } from '@core/sessions.service';
import { vi } from 'vitest';

import { SessionsBodyComponent } from './sessions-body.component';

describe('SessionsBodyComponent', () => {
  let component: SessionsBodyComponent;
  let fixture: ComponentFixture<SessionsBodyComponent>;
  let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  const buildSession = (index: number): Session => ({
    id: `session-${index}`,
    sessionDate: '2026-03-11',
    startTime: '09:00',
    endTime: '11:00',
    status: 'scheduled',
    assignmentStatus: 'assigned',
    classId: `class-${index}`,
    className: `班級 ${index}`,
    courseId: `course-${index}`,
    courseName: `課程 ${index}`,
    campusId: `campus-${index}`,
    campusName: `校區 ${index}`,
    teacherId: `teacher-${index}`,
    teacherName: `老師 ${index}`,
    hasChanges: false,
  });

  beforeEach(async () => {
    originalResizeObserver = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;

    await TestBed.configureTestingModule({
      imports: [SessionsBodyComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionsBodyComponent);
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

  it('should emit the next server page when the list paginator changes page', async () => {
    const sessions = Array.from({ length: 50 }, (_, index) => buildSession(index + 1));
    const emitSpy = vi.spyOn(component.pageChange, 'emit');

    fixture.componentRef.setInput('sessions', sessions);
    fixture.componentRef.setInput('pageSize', 50);
    fixture.componentRef.setInput('total', 120);
    fixture.componentRef.setInput('currentPage', 1);
    fixture.detectChanges();
    await fixture.whenStable();

    const nextButton = (fixture.nativeElement as HTMLElement).querySelector(
      '.session-list .p-paginator-next',
    ) as HTMLButtonElement | null;

    expect(nextButton).toBeTruthy();

    nextButton?.click();
    fixture.detectChanges();

    expect(emitSpy).toHaveBeenCalledWith(2);
  });
});
