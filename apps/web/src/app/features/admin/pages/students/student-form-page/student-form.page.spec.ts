import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { StudentFormPage } from './student-form.page';
import { StudentFormDialogComponent } from '../student-form-dialog.component';
import { StudentsService } from '@core/students.service';
import { SchoolsService } from '@core/schools.service';
import { ParentsService } from '@core/parents.service';

/**
 * #2396 L4：學生表單的手機整頁宿主。守：抓到的資料、存檔 body 跟對話框模式相同、
 * 存檔後由宿主發 toast（含從家長頁來的家長名）、離開保護。
 */
const existing = {
  id: 'stu-9',
  name: '林小明',
  grade: 'junior_2',
  school: { id: 'sch-1', name: '大安國中' },
};

describe('StudentFormPage（#2396 L4 手機整頁）', () => {
  let students: Record<string, ReturnType<typeof vi.fn>>;
  let messages: { add: ReturnType<typeof vi.fn> };
  let confirmClose$: Subject<boolean | undefined>;
  let pageDialog: { open: ReturnType<typeof vi.fn> };

  const setup = (
    params: Record<string, string>,
    query: Record<string, string> = {},
    host: 'page' | 'dialog' = 'page',
  ) => {
    students = {
      get: vi.fn(() => of({ data: existing })),
      create: vi.fn(() => of({ data: { id: 'stu-new', name: '王小華' } })),
      update: vi.fn(() => of({ data: { id: 'stu-9', name: '王小華' } })),
    };
    messages = { add: vi.fn() };
    confirmClose$ = new Subject();
    pageDialog = { open: vi.fn(() => ({ onClose: confirmClose$ })) };
    TestBed.configureTestingModule({
      imports: [StudentFormPage, StudentFormDialogComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(params),
              queryParamMap: convertToParamMap(query),
            },
          },
        },
        { provide: StudentsService, useValue: students },
        {
          provide: SchoolsService,
          useValue: { list: vi.fn(() => of({ data: [{ id: 'sch-1', name: '大安國中' }] })) },
        },
        { provide: ParentsService, useValue: { list: vi.fn(() => of({ data: [] })) } },
        { provide: MessageService, useValue: messages },
        // 對話框模式（對照組）：開窗端給的 config／ref
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: { student: params['id'] ? existing : null, ...(query['parentId'] ? query : {}) },
          },
        },
      ],
    }).overrideComponent(StudentFormPage, {
      add: { providers: [{ provide: DialogService, useValue: pageDialog }] },
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture =
      host === 'page'
        ? TestBed.createComponent(StudentFormPage)
        : TestBed.createComponent(StudentFormDialogComponent);
    fixture.detectChanges();
    const form = (
      host === 'page'
        ? fixture.debugElement.query(
            (d) => d.componentInstance instanceof StudentFormDialogComponent,
          ).componentInstance
        : fixture.componentInstance
    ) as any;
    return { fixture, form, page: fixture.componentInstance as StudentFormPage };
  };

  /** 兩種宿主照同一套動作填、按同一顆鈕 */
  const fillAndClickSave = (
    form: any,
    fixture: { detectChanges(): void; nativeElement: HTMLElement },
  ) => {
    form.updateForm('name', '王小華');
    form.updateForm('grade', 'junior_1');
    form.updateForm('schoolId', 'sch-1');
    form.updateForm('phone', ' 0911222333 ');
    fixture.detectChanges();
    const save = [
      ...fixture.nativeElement.querySelectorAll<HTMLButtonElement>('.form-dialog__footer button'),
    ].at(-1)!;
    save.click();
  };

  afterEach(() => {
    TestBed.resetTestingModule();
    history.replaceState(null, '');
  });

  it('編輯：讀學生後交給表單；新增：不讀、query 的 parentId 帶進表單', () => {
    const edit = setup({ id: 'stu-9' });
    expect(students['get']).toHaveBeenCalledWith('stu-9');
    expect(edit.form.isCreateMode()).toBe(false);
    TestBed.resetTestingModule();
    const create = setup({}, { parentId: 'par-1' });
    expect(students['get']).not.toHaveBeenCalled();
    expect(create.form.showParentPicker()).toBe(false);
  });

  it('殼補白底：底部列是 background: inherit，頁面裡不給的話透明', () => {
    const { fixture } = setup({});
    expect((fixture.nativeElement as HTMLElement).classList).toContain(
      '[&_.dialog-frame]:bg-white',
    );
  });

  it('存檔 body 跟對話框模式完全相同（新增帶預填家長、編輯）', () => {
    const run = (params: Record<string, string>, query: Record<string, string>, method: string) =>
      (['dialog', 'page'] as const).map((host) => {
        const { form, fixture } = setup(params, query, host);
        fillAndClickSave(form, fixture);
        const call = students[method].mock.calls[0];
        TestBed.resetTestingModule();
        return call;
      });
    const created = run({}, { parentId: 'par-1' }, 'create');
    expect(created[1]).toEqual(created[0]);
    expect(created[1][0]).toMatchObject({
      name: '王小華',
      grade: 'junior_1',
      schoolId: 'sch-1',
      phone: '0911222333',
      parentId: 'par-1',
    });
    const updated = run({ id: 'stu-9' }, {}, 'update');
    expect(updated[1]).toEqual(updated[0]);
    expect(updated[1][0]).toBe('stu-9');
  });

  describe('存檔後由宿主發 toast', () => {
    it('從家長頁來（navigation state 有家長名）：「X」已建立並關聯至「家長」', () => {
      history.replaceState({ parentName: '王大明' }, '');
      const { form, fixture } = setup({}, { parentId: 'par-1' });
      fillAndClickSave(form, fixture);
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: '已建立',
          detail: '「王小華」已建立並關聯至「王大明」',
        }),
      );
    });

    it('學生列表新增：「X」已建立；編輯：「X」已更新', () => {
      const created = setup({});
      fillAndClickSave(created.form, created.fixture);
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({ detail: '「王小華」已建立' }),
      );
      TestBed.resetTestingModule();
      const edited = setup({ id: 'stu-9' });
      fillAndClickSave(edited.form, edited.fixture);
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({ summary: '已更新', detail: '「王小華」已更新' }),
      );
    });

    it('取消：不發', () => {
      const { form } = setup({});
      form.cancel();
      expect(messages.add).not.toHaveBeenCalled();
    });
  });

  describe('離開保護', () => {
    it('沒改過放行；改過問，按「放棄」才放行', async () => {
      const { page, form } = setup({});
      expect(page.canLeave()).toBe(true);
      form.updateForm('name', '王小華');
      for (const [answer, leave] of [
        [true, true],
        [false, false],
        [undefined, false],
      ] as const) {
        const decided = page.canLeave() as Promise<boolean>;
        confirmClose$.next(answer);
        expect(await decided).toBe(leave);
      }
    });

    it('存檔成功後離開：不問', () => {
      const { page, form, fixture } = setup({});
      fillAndClickSave(form, fixture);
      expect(page.canLeave()).toBe(true);
      expect(pageDialog.open).not.toHaveBeenCalled();
    });
  });
});
