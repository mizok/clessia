import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BrowserStateService } from '@core/browser-state.service';
import { ClassesService } from '@core/classes.service';
import { GenerateSessionsDialogComponent } from './generate-sessions-dialog.component';

describe('GenerateSessionsDialogComponent', () => {
  let fixture: ComponentFixture<GenerateSessionsDialogComponent>;
  let component: GenerateSessionsDialogComponent;
  const dialogRefMock = {
    close: vi.fn(),
  };

  const classesServiceMock = {
    previewSessions: vi.fn(() =>
      of({
        data: [
          {
            sessionDate: '2026-03-16',
            startTime: '18:00:00',
            endTime: '20:00:00',
            teacherId: 'teacher-1',
            teacherName: '張老師',
            weekday: 1,
            exists: false,
          },
        ],
      }),
    ),
    generateSessions: vi.fn(),
  };

  beforeEach(async () => {
    classesServiceMock.previewSessions.mockClear();
    classesServiceMock.generateSessions.mockReset();
    dialogRefMock.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [GenerateSessionsDialogComponent],
      providers: [
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        {
          provide: BrowserStateService,
          useValue: {
            isMobile: () => false,
          },
        },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              cls: {
                id: 'class-1',
                campusId: 'campus-1',
                courseId: 'course-1',
                campusName: '示範分校',
                courseName: '數學課',
                name: '班級 A',
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GenerateSessionsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders responsive table in preview step', () => {
    (
      component as unknown as {
        generateFrom: { set: (value: Date) => void };
        generateTo: { set: (value: Date) => void };
        preview: () => void;
      }
    ).generateFrom.set(new Date('2026-03-16'));
    (
      component as unknown as {
        generateFrom: { set: (value: Date) => void };
        generateTo: { set: (value: Date) => void };
        preview: () => void;
      }
    ).generateTo.set(new Date('2026-03-31'));

    (component as unknown as { preview: () => void }).preview();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-responsive-table')).not.toBeNull();
  });

  // #1314 Z 批：預覽的分頁器換成 A6 精簡版；「每頁筆數」選單拿掉、固定每頁 10 堂（R5）
  it('預覽超過一頁：精簡版分頁器、沒有每頁筆數選單，按下一頁換到第 2 頁', () => {
    const c = component as unknown as {
      previewSessions: { set: (v: unknown[]) => void };
      paginatedPreviewSessions: () => unknown[];
      previewPagination: () => { rows: number };
    };
    c.previewSessions.set(
      Array.from({ length: 12 }, (_, i) => ({
        sessionDate: `2026-03-${String(i + 1).padStart(2, '0')}`,
        startTime: '18:00:00',
        endTime: '20:00:00',
        teacherId: 'teacher-1',
        teacherName: '張老師',
        weekday: 1,
        exists: false,
      })),
    );
    (component as unknown as { step: { set: (v: string) => void } }).step.set('preview');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('p-paginator')).toBeNull();
    expect(el.querySelector('app-responsive-table p-select')).toBeNull();
    expect(c.previewPagination().rows).toBe(10);
    expect(el.querySelector('app-pager [data-part="status"]')?.textContent?.trim()).toBe(
      '第 1／2 頁 · 每頁 10 堂',
    );
    Array.from(el.querySelectorAll<HTMLButtonElement>('app-pager button'))
      .find((b) => b.textContent?.includes('下一頁'))!
      .click();
    fixture.detectChanges();
    expect(c.paginatedPreviewSessions()).toHaveLength(2);
  });

  it('closes with refresh after generation result when user dismisses the dialog', () => {
    (
      component as unknown as {
        generationResult: { set: (value: unknown) => void };
        cancel: () => void;
      }
    ).generationResult.set({
      createdAssigned: 1,
      createdUnassigned: 0,
      skippedExisting: 0,
      skippedNoTeacher: 0,
      totalPlanned: 1,
    });

    (component as unknown as { cancel: () => void }).cancel();

    expect(dialogRefMock.close).toHaveBeenCalledWith('refresh');
  });
});
