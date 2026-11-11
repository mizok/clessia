import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ClassFormPage } from './class-form.page';
import { ClassFormDialogComponent } from '../class-form-dialog/class-form-dialog.component';
import { ClassesService } from '@core/classes.service';
import { CoursesService } from '@core/courses.service';
import { StaffService } from '@core/staff.service';
import { CampusesService } from '@core/campuses.service';
import { AuthService } from '@core/auth.service';
import { FeeTemplatesService } from '@core/fee-templates.service';

/**
 * #2396 L4：開課班表單的手機整頁宿主。表單元件同一支，這裡守的是宿主：
 * 抓到的資料跟開窗端給的一樣、存檔 body 跟對話框模式完全相同（保留類：目錄參考價）、離開保護。
 */
const course = { id: 'course-1', campusId: 'campus-1', subjectId: 'subject-1', name: '國二數學' };
const staff = [
  { id: 't-1', displayName: '王老師', campusIds: ['campus-1'], subjectIds: ['subject-1'] },
];
const campuses = [{ id: 'campus-1', name: '總校' }];
/** 全部班（下一階班級的選項來源）：同分校的一班 */
const allClasses = [{ id: 'class-7', campusId: 'campus-1', name: 'A 班', courseName: '國三數學' }];
const existing = {
  id: 'class-9',
  courseId: 'course-1',
  name: '舊班',
  maxStudents: 20,
  nextClassId: null,
  isActive: true,
  defaultFeeTemplateId: 'fee-old',
  schedules: [],
};

describe('ClassFormPage（#2396 L4 手機整頁）', () => {
  let classes: Record<string, ReturnType<typeof vi.fn>>;
  let courses: { get: ReturnType<typeof vi.fn> };
  let confirmClose$: Subject<boolean | undefined>;
  let pageDialog: { open: ReturnType<typeof vi.fn> };
  let formDialog: { open: ReturnType<typeof vi.fn> };

  const setup = (params: Record<string, string>, host: 'page' | 'dialog' = 'page') => {
    classes = {
      get: vi.fn(() => of({ data: existing })),
      list: vi.fn(() => of({ data: allClasses })),
      checkScheduleConflicts: vi.fn(() => of({ conflicts: [] })),
      create: vi.fn(() => of({ data: { id: 'class-new' } })),
      update: vi.fn(() => of({ data: { id: 'class-9' } })),
      addSchedule: vi.fn(() => of({ data: {} })),
      updateSchedule: vi.fn(() => of({ data: {} })),
      deleteSchedule: vi.fn(() => of({ success: true })),
    };
    courses = { get: vi.fn(() => of({ data: course })) };
    confirmClose$ = new Subject();
    pageDialog = { open: vi.fn(() => ({ onClose: confirmClose$ })) };
    formDialog = { open: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ClassFormPage, ClassFormDialogComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(params) } },
        },
        { provide: ClassesService, useValue: classes },
        { provide: CoursesService, useValue: courses },
        { provide: StaffService, useValue: { list: vi.fn(() => of({ data: staff })) } },
        {
          provide: CampusesService,
          useValue: {
            list: vi.fn(() => of({ data: campuses })),
            listClassrooms: vi.fn(() => of({ data: [] })),
          },
        },
        { provide: AuthService, useValue: { hasPermission: () => true } },
        {
          provide: FeeTemplatesService,
          useValue: {
            list: vi.fn(() =>
              of({
                data: [
                  {
                    id: 'fee-1',
                    name: '月繳',
                    billingMode: 'monthly',
                    amount: 4500,
                    isActive: true,
                  },
                ],
              }),
            ),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        // 對話框模式（對照組）：開窗端給的 config／ref
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              ...(params['classId'] ? { cls: existing } : {}),
              course,
              staff,
              campuses,
              classes: [],
            },
          },
        },
      ],
    })
      .overrideComponent(ClassFormPage, {
        add: { providers: [{ provide: DialogService, useValue: pageDialog }] },
      })
      .overrideComponent(ClassFormDialogComponent, {
        set: { providers: [{ provide: DialogService, useValue: formDialog }] },
      });
    const fixture =
      host === 'page'
        ? TestBed.createComponent(ClassFormPage)
        : TestBed.createComponent(ClassFormDialogComponent);
    fixture.detectChanges();
    const form = (
      host === 'page'
        ? fixture.debugElement.query((d) => d.componentInstance instanceof ClassFormDialogComponent)
            .componentInstance
        : fixture.componentInstance
    ) as any;
    return {
      fixture,
      form,
      page: fixture.componentInstance as ClassFormPage,
      el: fixture.nativeElement as HTMLElement,
    };
  };

  /** 兩種宿主都照同一套動作填、按同一顆鈕 */
  const fillAndClickSave = (form: any, el: HTMLElement, fixture: { detectChanges(): void }) => {
    form.updateForm('name', 'A 班');
    form.updateForm('maxStudents', 12);
    if (!form.isEditing()) form.updateScheduleEntry(0, 'teacherId', 't-1');
    form.updateScheduleEntry(0, 'weekday', 3);
    form.updateScheduleEntry(0, 'startTime', '18:00');
    form.updateScheduleEntry(0, 'endTime', '20:00');
    form.defaultFeeTemplateId.set('fee-1');
    fixture.detectChanges();
    const save = [...el.querySelectorAll<HTMLButtonElement>('.form-dialog__footer button')].at(-1)!;
    save.click();
  };

  afterEach(() => TestBed.resetTestingModule());

  it('新增：抓課程、全部班、老師、分校，交給表單（跟開窗端給的同一組）', () => {
    const { form, el } = setup({ courseId: 'course-1' });
    expect(courses.get).toHaveBeenCalledWith('course-1');
    expect(classes['list']).toHaveBeenCalledWith({ pageSize: 0 });
    expect(classes['get']).not.toHaveBeenCalled();
    expect(form.isEditing()).toBe(false);
    // 少交一欄都要看得出來（#2414 二讀 P1～P4）：四欄都是 mock 回的那組
    expect(form.course()).toEqual(course);
    expect(form.staff()).toEqual(staff);
    expect(form.campuses()).toEqual(campuses);
    expect(form.nextClassOptions().map((o: { label: string }) => o.label)).toEqual([
      '沒有（不設升班路徑）',
      '國三數學 · A 班',
    ]);
    // 畫面上的效果：分校名進內容區第一行（campuses）
    expect(
      el.querySelector('[data-part="dialog-context"]')!.textContent!.replace(/\s+/g, ' ').trim(),
    ).toBe('總校 · 國二數學');
  });

  it('殼補白底：底部列是 background: inherit，頁面裡不給的話透明、欄位從底下透出來', () => {
    const { fixture } = setup({ courseId: 'course-1' });
    expect((fixture.nativeElement as HTMLElement).classList).toContain(
      '[&_.dialog-frame]:bg-white',
    );
  });

  it('編輯：先讀班級，課程以班級自己的 courseId 為準', () => {
    const { form } = setup({ courseId: 'seed-course', classId: 'class-9' });
    expect(classes['get']).toHaveBeenCalledWith('class-9');
    expect(courses.get).toHaveBeenCalledWith('course-1');
    expect(form.isEditing()).toBe(true);
  });

  describe('保留類：存檔 body 跟對話框模式完全相同', () => {
    const createBody = {
      courseId: 'course-1',
      name: 'A 班',
      maxStudents: 12,
      nextClassId: null,
      isActive: true,
      startDate: null,
      endDate: null,
      gradeLevels: [],
      isRecommended: false,
      isPublicEnrollment: true,
      defaultFeeTemplateId: 'fee-1',
    };

    it('新增：create body 兩種宿主一樣，且是這組實值', () => {
      const bodies = (['dialog', 'page'] as const).map((host) => {
        const { form, el, fixture } = setup({ courseId: 'course-1' }, host);
        fillAndClickSave(form, el, fixture);
        const body = classes['create'].mock.calls[0][0];
        TestBed.resetTestingModule();
        return body;
      });
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[1]).toMatchObject(createBody);
    });

    it('編輯：update body 兩種宿主一樣（含目錄參考價改成 fee-1）', () => {
      const bodies = (['dialog', 'page'] as const).map((host) => {
        const { form, el, fixture } = setup({ courseId: 'course-1', classId: 'class-9' }, host);
        fillAndClickSave(form, el, fixture);
        const call = classes['update'].mock.calls[0];
        TestBed.resetTestingModule();
        return call;
      });
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[1][0]).toBe('class-9');
      expect(bodies[1][1]).toMatchObject({
        name: 'A 班',
        maxStudents: 12,
        defaultFeeTemplateId: 'fee-1',
      });
    });
  });

  describe('離開保護', () => {
    it('沒改過：直接放行，不問', () => {
      const { page } = setup({ courseId: 'course-1' });
      expect(page.canLeave()).toBe(true);
      expect(pageDialog.open).not.toHaveBeenCalled();
    });

    it('改過：問；按「放棄」才放行，「繼續編輯」與 ✕ 都留下', async () => {
      const { page, form } = setup({ courseId: 'course-1' });
      form.updateForm('name', 'A 班');
      for (const [answer, leave] of [
        [true, true],
        [false, false],
        [undefined, false],
      ] as const) {
        const decided = page.canLeave() as Promise<boolean>;
        confirmClose$.next(answer);
        expect(await decided).toBe(leave);
      }
      expect(pageDialog.open.mock.calls[0][1].data.acceptLabel).toBe('放棄');
    });

    it('存檔成功後離開：不問', async () => {
      const { fixture, form, el, page } = setup({ courseId: 'course-1' });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fillAndClickSave(form, el, fixture);
      // 建班後時段是依序 promise 加的，close（回來源頁）在那之後
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/admin/courses']));
      expect(page.canLeave()).toBe(true);
      expect(pageDialog.open).not.toHaveBeenCalled();
    });
  });
});
