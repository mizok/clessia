import { taipeiDateString } from '@core/system-clock.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, NEVER } from 'rxjs';
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

  // 新增時表單先畫出來、班級清單晚到：清單到之前送不出去，動作列寫在載入，班級下拉有自己的載入狀態
  it('新增時班級清單還沒到：不能送出，動作列寫「班級清單載入中…」', async () => {
    classesServiceMock.list.mockReturnValueOnce(NEVER as never);
    await createComponent({ data: { mode: 'create' } });
    (component as unknown as { formData: { set: (v: unknown) => void } }).formData.set({
      name: '模擬考',
      examType: 'mock_exam',
      subjectId: 's1',
      campusId: 'c1',
      examDate: '2026-04-20',
      totalScore: 100,
      passScore: 70,
      scopeNote: '',
      classIds: ['cls-1'],
    });
    fixture.detectChanges();

    expect(component['canSave']()).toBe(false);
    component['save']();
    expect(academyExamsServiceMock.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('班級清單載入中…');
    // 表單沒有被「載入中」整張蓋住：考試名稱欄已經可以填
    expect(fixture.nativeElement.querySelector('#exam-name')).not.toBeNull();
  });

  it('allows save when required fields are filled', async () => {
    await createComponent({ data: { mode: 'create' } });
    (component as unknown as { formData: { set: (v: unknown) => void } }).formData.set({
      name: '模擬考',
      examType: 'mock_exam',
      subjectId: 's1',
      campusId: 'c1',
      examDate: '2026-04-20',
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

  describe('送出只走 form 的 submit 一條路（送出鈕在殼的底部列、form 外，dialog-frame.md）', () => {
    async function filled() {
      await createComponent({ data: { mode: 'create' } });
      (component as unknown as { formData: { set: (v: unknown) => void } }).formData.set({
        name: '模擬考',
        examType: 'mock_exam',
        subjectId: 's1',
        campusId: 'c1',
        examDate: '2026-04-20',
        totalScore: 100,
        passScore: 70,
        scopeNote: '',
        classIds: ['cls-1'],
      });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      return {
        form: el.querySelector<HTMLFormElement>('form#academy-exam-form')!,
        submit: el.querySelector<HTMLButtonElement>(
          'button[type="submit"][form="academy-exam-form"]',
        )!,
      };
    }

    it('點底部的「建立考試」：送一次', async () => {
      const { submit } = await filled();
      // 數 save 而不是 create：save 進去就設 saving，第二次會被擋掉，數 create 看不出「點一次送兩次」
      const save = vi.spyOn(component as unknown as { save: () => void }, 'save');
      expect(submit).not.toBeNull();
      submit.click();
      expect(save).toHaveBeenCalledTimes(1);
      expect(academyExamsServiceMock.create).toHaveBeenCalledTimes(1);
    });

    it('欄位按 Enter（form submit）：送一次', async () => {
      const { form } = await filled();
      const save = vi.spyOn(component as unknown as { save: () => void }, 'save');
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(academyExamsServiceMock.create).toHaveBeenCalledTimes(1);
    });
  });

  it('blocks save when passScore 超過 totalScore（跟後端 CHECK 同一條界線）', async () => {
    await createComponent({ data: { mode: 'create' } });
    (component as unknown as { formData: { set: (v: unknown) => void } }).formData.set({
      name: '模擬考',
      examType: 'mock_exam',
      subjectId: 's1',
      campusId: 'c1',
      examDate: '2026-04-20',
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
      examDate: '2026-04-20',
      totalScore: 100,
      passScore: null,
      scopeNote: '',
      classIds: ['cls-1'],
    });
    expect(component['canSave']()).toBe(true);
  });

  // A6 `money` 欄：滿分／及格線是文字框（數字鍵盤），不是 p-inputnumber；考試日期是原生 date
  it('分數文字框只收數字、清空＝null；日期是原生 date，直接存 yyyy-MM-dd', async () => {
    await createComponent({ data: { mode: 'create' } });
    const el = fixture.nativeElement as HTMLElement;
    const type = (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    expect(el.querySelector<HTMLInputElement>('#exam-date')!.type).toBe('date');
    // 稿：新增時考試日期預設今天（台北）
    expect(
      (component as unknown as { formData: () => { examDate: string } }).formData().examDate,
    ).toBe(taipeiDateString(Date.now()));
    expect(el.querySelector<HTMLInputElement>('#exam-total')!.inputMode).toBe('numeric');

    type('#exam-date', '2026-05-01');
    type('#exam-total', '1a2０0');
    type('#exam-pass', '');
    const f = (component as unknown as { formData: () => Record<string, unknown> }).formData();
    expect(f['examDate']).toBe('2026-05-01');
    expect(f['totalScore']).toBe(120);
    expect(f['passScore']).toBeNull();

    type('#exam-total', '');
    fixture.detectChanges();
    expect(component['canSave']()).toBe(false);
  });

  // 二讀 #2120：打「8a」時值是 8，畫面也要是 8（model 沒變時 ngModel 不會回寫輸入框）
  it('分數框打了非數字：畫面跟送出的值一致', async () => {
    await createComponent({ data: { mode: 'create' } });
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#exam-pass',
    )!;
    for (const value of ['8', '8a']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();
    }
    expect(input.value).toBe('8');
    expect(
      (component as unknown as { formData: () => { passScore: number | null } }).formData()
        .passScore,
    ).toBe(8);
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

  // #2396 拆單 4（dialog-frame.md「操作量分級」L2）：滿分、及格分數、範圍說明收進「更多設定」
  describe('手機選填收「更多設定」', () => {
    const narrow = (matches: boolean) =>
      vi.stubGlobal(
        'matchMedia',
        vi.fn((q: string) => ({ matches: q.includes('max-width') ? matches : !matches })),
      );
    afterEach(() => vi.unstubAllGlobals());
    const more = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLDetailsElement>(
        '[data-testid="exam-more"]',
      )!;

    it('手機新增：預設收合，三個選填欄在裡面', async () => {
      narrow(true);
      await createComponent();
      const d = more();
      expect(d.open).toBe(false);
      expect(d.querySelector('summary')?.textContent).toContain('更多設定（3 項）');
      for (const id of ['exam-total', 'exam-pass', 'exam-scope']) {
        expect(d.querySelector('#' + id)).not.toBeNull();
      }
      expect(d.querySelector('#exam-name')).toBeNull();
    });

    it('桌機：一律展開（版面同原本）', async () => {
      narrow(false);
      await createComponent();
      expect(more().open).toBe(true);
    });

    // 三個條件各自守一則（#2409 二讀：只靠範圍說明觸發時，拿掉另兩個條件 spec 不會紅）
    const editExam = (over: Record<string, unknown>) => ({
      data: {
        id: 'exam-1',
        name: '月考',
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
        ...over,
      },
    });
    it.each([
      ['只改滿分', { totalScore: 50 }, true],
      ['只填及格分數', { passScore: 60 }, true],
      ['只填範圍說明', { scopeNote: '第 3 章' }, true],
      ['全是預設', {}, false],
    ])('手機編輯：%s → 更多設定 open=%s（有值就展開，不藏資料）', async (_label, over, open) => {
      narrow(true);
      academyExamsServiceMock.get.mockReturnValueOnce(of(editExam(over)));
      await createComponent({ data: { mode: 'edit', examId: 'exam-1' } });
      fixture.detectChanges();
      expect(more().open).toBe(open);
    });

    it('手機：卡在收起來的滿分時，按送出會打開「更多設定」、不送出', async () => {
      narrow(true);
      await createComponent();
      const c = component as unknown as {
        updateField: (k: string, v: unknown) => void;
        save: () => void;
      };
      c.updateField('name', '小考');
      c.updateField('subjectId', 's1');
      c.updateField('classIds', ['cls-1']);
      c.updateField('totalScore', 0);
      c.save();
      fixture.detectChanges();
      expect(more().open).toBe(true);
      expect(academyExamsServiceMock.create).not.toHaveBeenCalled();
    });
  });
});
