import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AcademyExamsService } from '@core/academy-exams.service';
import { ClassesService } from '@core/classes.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { AcademyExamFormDialogComponent } from './academy-exam-form-dialog.component';

describe('AcademyExamFormDialogComponent', () => {
  let fixture: ComponentFixture<AcademyExamFormDialogComponent>;
  let component: AcademyExamFormDialogComponent;

  const academyExamsServiceMock = {
    get: vi.fn(),
    create: vi.fn(() => of({ data: { id: 'exam-new' } })),
    update: vi.fn(() => of({ data: { id: 'exam-1' } })),
  };
  const classesServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'cls-1',
            name: 'A班',
            isActive: true,
            campusId: 'c1',
            campusName: '台北',
            courseName: '數學',
            subjectId: 's1',
          },
          {
            id: 'cls-2',
            name: 'B班',
            isActive: true,
            campusId: 'c2',
            campusName: '新竹',
            courseName: '英文',
            subjectId: 's2',
          },
        ],
        meta: { total: 2, page: 1, pageSize: 0 },
      }),
    ),
  };
  const refDataMock = {
    campuses: () => [
      { id: 'c1', name: '台北' },
      { id: 'c2', name: '新竹' },
    ],
    subjects: () => [
      { id: 's1', name: '數學' },
      { id: 's2', name: '英文' },
    ],
    loadCampuses: vi.fn(),
    loadSubjects: vi.fn(),
  };
  const messageServiceMock = { add: vi.fn() };
  const dialogRefMock = { close: vi.fn() };

  async function createComponent(config: { data?: unknown } = { data: { mode: 'create' } }) {
    await TestBed.configureTestingModule({
      imports: [AcademyExamFormDialogComponent],
      providers: [
        { provide: AcademyExamsService, useValue: academyExamsServiceMock },
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: DynamicDialogConfig, useValue: config },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AcademyExamFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    academyExamsServiceMock.get.mockClear();
    academyExamsServiceMock.create.mockClear();
    academyExamsServiceMock.update.mockClear();
    classesServiceMock.list.mockClear();
    messageServiceMock.add.mockClear();
    dialogRefMock.close.mockClear();
    TestBed.resetTestingModule();
  });

  it('creates in create mode', async () => {
    await createComponent({ data: { mode: 'create' } });
    expect(component).toBeTruthy();
    expect(component['isEditing']()).toBe(false);
    expect(component['classes']().length).toBe(2);
  });

  it('blocks save when required fields are missing', async () => {
    await createComponent({ data: { mode: 'create' } });
    expect(component['canSave']()).toBe(false);
    component['save']();
    expect(academyExamsServiceMock.create).not.toHaveBeenCalled();
  });

  it('allows save when required fields are filled', async () => {
    await createComponent({ data: { mode: 'create' } });
    (component as unknown as { formData: { set: (v: unknown) => void } }).formData.set({
      name: '模擬考',
      examType: 'mock_exam',
      subjectId: 's1',
      campusId: 'c1',
      examDate: new Date('2026-04-20'),
      totalScore: 100,
      passScore: 70,
      scopeNote: '第一章',
      classIds: ['cls-1'],
    });
    expect(component['canSave']()).toBe(true);
    component['save']();
    expect(academyExamsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '模擬考',
        examType: 'mock_exam',
        subjectId: 's1',
        campusId: 'c1',
        examDate: '2026-04-20',
        totalScore: 100,
        passScore: 70,
        classIds: ['cls-1'],
      }),
    );
  });

  it('blocks save when passScore 超過 totalScore（跟後端 CHECK 同一條界線）', async () => {
    await createComponent({ data: { mode: 'create' } });
    (component as unknown as { formData: { set: (v: unknown) => void } }).formData.set({
      name: '模擬考',
      examType: 'mock_exam',
      subjectId: 's1',
      campusId: 'c1',
      examDate: new Date('2026-04-20'),
      totalScore: 100,
      passScore: 101,
      scopeNote: '',
      classIds: ['cls-1'],
    });
    expect(component['canSave']()).toBe(false);
  });

  it('passScore 留空（null）也算合法，代表沿用退路門檻', async () => {
    await createComponent({ data: { mode: 'create' } });
    (component as unknown as { formData: { set: (v: unknown) => void } }).formData.set({
      name: '模擬考',
      examType: 'mock_exam',
      subjectId: 's1',
      campusId: 'c1',
      examDate: new Date('2026-04-20'),
      totalScore: 100,
      passScore: null,
      scopeNote: '',
      classIds: ['cls-1'],
    });
    expect(component['canSave']()).toBe(true);
  });

  it('locks identity fields whenever in edit mode (no scores)', async () => {
    academyExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 'exam-1',
          name: '尚未登錄成績',
          examType: 'quiz',
          status: 'active',
          subjectId: 's1',
          campusId: 'c1',
          examDate: '2026-03-20',
          totalScore: 100,
          passScore: null,
          scopeNote: '',
          classes: [{ classId: 'cls-1', className: 'A班' }],
          summary: { recordedCount: 0, expectedCount: 10 },
        },
      }),
    );
    await createComponent({ data: { mode: 'edit', examId: 'exam-1' } });

    expect(component['hasScores']()).toBe(false);
    // Identity fields locked in edit mode regardless of scores
    expect(component['lockExamType']()).toBe(true);
    expect(component['lockSubject']()).toBe(true);
    expect(component['lockTotalScore']()).toBe(true);
    expect(component['lockCampus']()).toBe(true);
    // Without scores, classes are still adjustable
    expect(component['lockClasses']()).toBe(false);
    // Mutable fields stay editable
    expect(component['lockName']()).toBe(false);
    expect(component['lockExamDate']()).toBe(false);
    expect(component['lockScopeNote']()).toBe(false);
    // 及格線不像滿分——改變它不會讓既有分數的意義跑掉，即使已編輯過也不鎖
    expect(component['lockPassScore']()).toBe(false);
  });

  it('also locks classes when scores already exist', async () => {
    academyExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 'exam-1',
          name: '已登錄考試',
          examType: 'quiz',
          status: 'active',
          subjectId: 's1',
          campusId: 'c1',
          examDate: '2026-03-20',
          totalScore: 100,
          passScore: null,
          scopeNote: '',
          classes: [{ classId: 'cls-1', className: 'A班' }],
          summary: { recordedCount: 5, expectedCount: 10 },
        },
      }),
    );
    await createComponent({ data: { mode: 'edit', examId: 'exam-1' } });

    expect(component['hasScores']()).toBe(true);
    expect(component['lockExamType']()).toBe(true);
    expect(component['lockSubject']()).toBe(true);
    expect(component['lockTotalScore']()).toBe(true);
    expect(component['lockCampus']()).toBe(true);
    expect(component['lockClasses']()).toBe(true);
    // Name and date should remain editable
    expect(component['lockName']()).toBe(false);
    expect(component['lockExamDate']()).toBe(false);
    // 已有分數也不鎖及格線——這是它跟滿分唯一不同的地方
    expect(component['lockPassScore']()).toBe(false);
  });

  it('locks everything when exam is closed', async () => {
    academyExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 'exam-1',
          name: '已結束',
          examType: 'quiz',
          status: 'closed',
          subjectId: 's1',
          campusId: 'c1',
          examDate: '2026-03-20',
          totalScore: 100,
          passScore: null,
          scopeNote: '',
          classes: [{ classId: 'cls-1', className: 'A班' }],
          summary: { recordedCount: 0, expectedCount: 0 },
        },
      }),
    );
    await createComponent({ data: { mode: 'edit', examId: 'exam-1' } });

    expect(component['isClosed']()).toBe(true);
    expect(component['lockName']()).toBe(true);
    expect(component['lockExamDate']()).toBe(true);
    expect(component['lockExamType']()).toBe(true);
    expect(component['canSave']()).toBe(false);
    // 考試結束後及格線也不該再改
    expect(component['lockPassScore']()).toBe(true);
  });

  it('filters classes by campus selection', async () => {
    await createComponent({ data: { mode: 'create' } });
    expect(component['classOptions']().length).toBe(2);
    component['onCampusChange']('c1');
    expect(component['classOptions']().length).toBe(1);
    expect(component['classOptions']()[0].value).toBe('cls-1');
  });

  it('filters classes by subject selection', async () => {
    await createComponent({ data: { mode: 'create' } });
    expect(component['classOptions']().length).toBe(2);
    component['onSubjectChange']('s1');
    expect(component['classOptions']().length).toBe(1);
    expect(component['classOptions']()[0].value).toBe('cls-1');
  });

  it('omits locked fields from update payload', async () => {
    academyExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 'exam-1',
          name: '已登錄考試',
          examType: 'quiz',
          status: 'active',
          subjectId: 's1',
          campusId: 'c1',
          examDate: '2026-03-20',
          totalScore: 100,
          passScore: 65,
          scopeNote: '',
          classes: [{ classId: 'cls-1', className: 'A班' }],
          summary: { recordedCount: 5, expectedCount: 10 },
        },
      }),
    );
    await createComponent({ data: { mode: 'edit', examId: 'exam-1' } });

    component['save']();

    expect(academyExamsServiceMock.update).toHaveBeenCalledWith(
      'exam-1',
      expect.objectContaining({ name: '已登錄考試', examDate: '2026-03-20', passScore: 65 }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = (academyExamsServiceMock.update as any).mock.lastCall![1] as Record<
      string,
      unknown
    >;
    expect(payload['examType']).toBeUndefined();
    expect(payload['subjectId']).toBeUndefined();
    expect(payload['totalScore']).toBeUndefined();
    expect(payload['classIds']).toBeUndefined();
  });

  it('清空及格線（改回 null）送出的是 null 不是 undefined，不然後端會當成沒改', async () => {
    academyExamsServiceMock.get.mockReturnValueOnce(
      of({
        data: {
          id: 'exam-1',
          name: '已登錄考試',
          examType: 'quiz',
          status: 'active',
          subjectId: 's1',
          campusId: 'c1',
          examDate: '2026-03-20',
          totalScore: 100,
          passScore: 65,
          scopeNote: '',
          classes: [{ classId: 'cls-1', className: 'A班' }],
          summary: { recordedCount: 5, expectedCount: 10 },
        },
      }),
    );
    await createComponent({ data: { mode: 'edit', examId: 'exam-1' } });

    (
      component as unknown as { formData: { update: (fn: (f: unknown) => unknown) => void } }
    ).formData.update((f) => ({ ...(f as object), passScore: null }));
    component['save']();

    const payload = (academyExamsServiceMock.update as unknown as { mock: { lastCall: unknown[] } })
      .mock.lastCall![1] as Record<string, unknown>;
    expect(payload['passScore']).toBeNull();
  });
});
