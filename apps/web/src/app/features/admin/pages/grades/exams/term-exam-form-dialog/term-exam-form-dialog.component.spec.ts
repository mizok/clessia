import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { TermExamsService } from '@core/term-exams.service';
import { TermExamFormDialogComponent } from './term-exam-form-dialog.component';

describe('TermExamFormDialogComponent', () => {
  let fixture: ComponentFixture<TermExamFormDialogComponent>;
  let component: TermExamFormDialogComponent;

  const termExamsServiceMock = {
    get: vi.fn(),
    create: vi.fn(() => of({ data: { id: 'term-new', label: '114-2 第一次段考' } })),
    update: vi.fn(() => of({ success: true, label: '114-2 第一次段考' })),
  };
  const messageServiceMock = { add: vi.fn() };
  const dialogRefMock = { close: vi.fn() };

  async function createComponent(config: { data?: unknown } = { data: { mode: 'create' } }) {
    await TestBed.configureTestingModule({
      imports: [TermExamFormDialogComponent],
      providers: [
        { provide: TermExamsService, useValue: termExamsServiceMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: DynamicDialogConfig, useValue: config },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TermExamFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    termExamsServiceMock.get.mockClear();
    termExamsServiceMock.create.mockClear();
    termExamsServiceMock.update.mockClear();
    messageServiceMock.add.mockClear();
    dialogRefMock.close.mockClear();
    TestBed.resetTestingModule();
  });

  it('creates in create mode with guessed year', async () => {
    await createComponent({ data: { mode: 'create' } });
    expect(component).toBeTruthy();
    expect(component['formData']().academicYear).toBeGreaterThan(100);
    expect(component['canSave']()).toBe(true);
  });

  it('creates term exam with payload', async () => {
    await createComponent({ data: { mode: 'create' } });
    (component as unknown as { formData: { set: (v: unknown) => void } }).formData.set({
      academicYear: 114,
      semester: 2,
      period: 'midterm_1',
      examDate: new Date('2026-04-10'),
    });
    component['save']();
    expect(termExamsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        academicYear: 114,
        semester: 2,
        period: 'midterm_1',
        examDate: '2026-04-10',
      }),
    );
  });

  it('locks metadata when scores exist', async () => {
    termExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 't1',
          academicYear: 114,
          semester: 2,
          period: 'midterm_1',
          label: '114-2 第一次段考',
          examDate: '2026-04-10',
          status: 'active',
          summary: { bySubject: [], totalRecordedCount: 5 },
        },
      }),
    );
    await createComponent({ data: { mode: 'edit', examId: 't1' } });
    expect(component['hasScores']()).toBe(true);
    expect(component['lockYear']()).toBe(true);
    expect(component['lockSemester']()).toBe(true);
    expect(component['lockPeriod']()).toBe(true);
    expect(component['lockExamDate']()).toBe(false);
  });

  it('locks everything when closed', async () => {
    termExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 't1',
          academicYear: 114,
          semester: 2,
          period: 'midterm_1',
          label: '114-2 第一次段考',
          examDate: '2026-04-10',
          status: 'closed',
          summary: { bySubject: [], totalRecordedCount: 0 },
        },
      }),
    );
    await createComponent({ data: { mode: 'edit', examId: 't1' } });
    expect(component['isClosed']()).toBe(true);
    expect(component['lockExamDate']()).toBe(true);
    expect(component['canSave']()).toBe(false);
  });

  it('omits locked fields from update payload', async () => {
    termExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 't1',
          academicYear: 114,
          semester: 2,
          period: 'midterm_1',
          label: '114-2 第一次段考',
          examDate: '2026-04-10',
          status: 'active',
          summary: { bySubject: [], totalRecordedCount: 5 },
        },
      }),
    );
    await createComponent({ data: { mode: 'edit', examId: 't1' } });
    component['save']();
    expect(termExamsServiceMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ examDate: '2026-04-10' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = (termExamsServiceMock.update as any).mock.lastCall![1] as Record<string, unknown>;
    expect(payload['academicYear']).toBeUndefined();
    expect(payload['semester']).toBeUndefined();
    expect(payload['period']).toBeUndefined();
  });
});
