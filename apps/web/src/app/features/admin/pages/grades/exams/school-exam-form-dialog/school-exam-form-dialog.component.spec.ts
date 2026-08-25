import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SchoolsService } from '@core/schools.service';
import { SchoolExamsService } from '@core/school-exams.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SchoolExamFormDialogComponent } from './school-exam-form-dialog.component';

describe('SchoolExamFormDialogComponent', () => {
  let fixture: ComponentFixture<SchoolExamFormDialogComponent>;
  let component: SchoolExamFormDialogComponent;

  const schoolExamsServiceMock = {
    get: vi.fn(),
    create: vi.fn(() => of({ data: { id: 'term-new', label: '114-2 段考' } })),
    update: vi.fn(() => of({ success: true, label: '114-2 段考' })),
  };
  const schoolsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [{ id: 'sch-1', name: '測試國中', shortName: '測中', isActive: true }],
        meta: { total: 1, page: 1, pageSize: 50 },
      }),
    ),
  };
  const refDataMock = {
    subjects: () => [
      { id: 'sub-1', name: '數學' },
      { id: 'sub-2', name: '英文' },
    ],
    loadSubjects: vi.fn(),
  };
  const messageServiceMock = { add: vi.fn() };
  const dialogRefMock = { close: vi.fn() };
  const routerMock = { navigate: vi.fn() };

  async function createComponent(config: { data?: unknown } = { data: { mode: 'create' } }) {
    await TestBed.configureTestingModule({
      imports: [SchoolExamFormDialogComponent],
      providers: [
        { provide: SchoolExamsService, useValue: schoolExamsServiceMock },
        { provide: SchoolsService, useValue: schoolsServiceMock },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: DynamicDialogConfig, useValue: config },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SchoolExamFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    schoolExamsServiceMock.get.mockClear();
    schoolExamsServiceMock.create.mockClear();
    schoolExamsServiceMock.update.mockClear();
    schoolsServiceMock.list.mockClear();
    schoolsServiceMock.list.mockImplementation(() =>
      of({
        data: [{ id: 'sch-1', name: '測試國中', shortName: '測中', isActive: true }],
        meta: { total: 1, page: 1, pageSize: 50 },
      }),
    );
    refDataMock.loadSubjects.mockClear();
    messageServiceMock.add.mockClear();
    dialogRefMock.close.mockClear();
    routerMock.navigate.mockClear();
    TestBed.resetTestingModule();
  });

  it('creates in create mode and loads schools', async () => {
    await createComponent({ data: { mode: 'create' } });
    expect(component).toBeTruthy();
    expect(schoolsServiceMock.list).toHaveBeenCalled();
    expect(refDataMock.loadSubjects).toHaveBeenCalled();
    expect(component['form'].controls.academicYear.value).toBeGreaterThan(100);
  });

  it('shows subject field only when examType is other', async () => {
    await createComponent({ data: { mode: 'create' } });
    expect(component['isOtherExamType']()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('科目');

    component['form'].patchValue({ examType: 'other' });
    fixture.detectChanges();

    expect(component['isOtherExamType']()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('科目');
  });

  it('requires name when examType is other', async () => {
    await createComponent({ data: { mode: 'create' } });
    component['form'].patchValue({
      academicYear: 114,
      semester: 2,
      examType: 'other',
      schoolId: 'sch-1',
      examDate: new Date('2026-04-10'),
      name: '   ',
    });
    component['save']();

    expect(component['form'].valid).toBe(false);
    expect(component['form'].controls.name.hasError('requiredTrimmed')).toBe(true);
    expect(schoolExamsServiceMock.create).not.toHaveBeenCalled();
  });

  it('name becomes optional when examType switches from other to non-other', async () => {
    await createComponent({ data: { mode: 'create' } });
    component['form'].patchValue({
      academicYear: 114,
      semester: 2,
      examType: 'other',
      schoolId: 'sch-1',
      name: '',
    });
    expect(component['form'].valid).toBe(false);

    component['form'].patchValue({ examType: 'term_exam', name: '' });
    expect(component['form'].controls.name.hasError('requiredTrimmed')).toBe(false);
    expect(component['form'].valid).toBe(true);
  });

  it('creates school exam with examType and name payload', async () => {
    await createComponent({ data: { mode: 'create' } });
    component['form'].patchValue({
      academicYear: 114,
      semester: 2,
      examType: 'mock_exam',
      schoolId: 'sch-1',
      name: '三月模擬考',
      examDate: new Date('2026-04-10'),
    });
    component['save']();

    expect(schoolExamsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        academicYear: 114,
        semester: 2,
        examType: 'mock_exam',
        name: '三月模擬考',
        examDate: '2026-04-10',
      }),
    );
  });

  it('includes subjectId in create payload for other exam type', async () => {
    await createComponent({ data: { mode: 'create' } });
    component['form'].patchValue({
      academicYear: 114,
      semester: 2,
      examType: 'other',
      schoolId: 'sch-1',
      subjectId: 'sub-1',
      name: '校內檢定',
      examDate: new Date('2026-04-10'),
    });

    component['save']();

    expect(schoolExamsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        examType: 'other',
        subjectId: 'sub-1',
      }),
    );
  });

  it('clears subjectId when examType switches away from other', async () => {
    await createComponent({ data: { mode: 'create' } });
    component['form'].patchValue({ examType: 'other', subjectId: 'sub-1' });
    expect(component['form'].controls.subjectId.value).toBe('sub-1');

    component['form'].patchValue({ examType: 'mock_exam' });
    expect(component['form'].controls.subjectId.value).toBeNull();
  });

  it('shows empty state when no schools exist in create mode', async () => {
    schoolsServiceMock.list.mockReturnValueOnce(
      of({ data: [], meta: { total: 0, page: 1, pageSize: 50 } }),
    );

    await createComponent({ data: { mode: 'create' } });

    expect(component['hasNoSchools']()).toBe(true);
    expect(component['isInitialLoading']()).toBe(false);

    component['goToSchools']();
    expect(dialogRefMock.close).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/admin/schools']);
  });

  it('edit mode locks metadata and only updates examDate/name', async () => {
    schoolExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 't1',
          academicYear: 114,
          semester: 2,
          examType: 'term_exam',
          name: null,
          label: '114-2 段考',
          examDate: '2026-04-10',
          status: 'active',
          schoolId: 'sch-1',
          schoolName: '測試國中',
          summary: { bySubject: [], totalRecordedCount: 0 },
          createdAt: '2026-03-20T00:00:00Z',
          updatedAt: '2026-03-20T00:00:00Z',
        },
      }),
    );

    await createComponent({ data: { mode: 'edit', examId: 't1' } });
    expect(component['lockYear']()).toBe(true);
    expect(component['lockSemester']()).toBe(true);
    expect(component['lockExamType']()).toBe(true);
    expect(component['lockSchool']()).toBe(true);

    component['form'].patchValue({
      examDate: new Date('2026-05-01'),
      name: '五月補充考',
    });
    component['save']();

    expect(schoolExamsServiceMock.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ examDate: '2026-05-01', name: '五月補充考' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = (schoolExamsServiceMock.update as any).mock.lastCall![1] as Record<
      string,
      unknown
    >;
    expect(payload['academicYear']).toBeUndefined();
    expect(payload['semester']).toBeUndefined();
    expect(payload['examType']).toBeUndefined();
    expect(payload['schoolId']).toBeUndefined();
  });
});
