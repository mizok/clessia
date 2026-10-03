import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { ClassFormDialogComponent } from './class-form-dialog.component';
import { ClassesService } from '@core/classes.service';
import { AuthService } from '@core/auth.service';
import { FeeTemplatesService } from '@core/fee-templates.service';

describe('ClassFormDialogComponent', () => {
  let fixture: ComponentFixture<ClassFormDialogComponent>;
  let component: ClassFormDialogComponent;
  let classesServiceMock: Partial<ClassesService>;
  let messageServiceMock: Pick<MessageService, 'add'>;
  const dialogRefMock = { close: vi.fn() };
  // 排課衝突警告是另一支 DynamicDialog。用一個可控的 onClose 才測得到
  // 「使用者按了什麼」對應「有沒有真的儲存」。
  let conflictClose$: Subject<boolean | undefined>;
  let dialogServiceMock: { open: ReturnType<typeof vi.fn> };
  /** #1175：目錄參考價要 `manage_finance` —— 預設沒有（大多數既有測試的情境） */
  let canManageFinance = false;
  let feeTemplatesMock: { list: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    classesServiceMock = {
      checkScheduleConflicts: vi.fn().mockReturnValue(of({ conflicts: [] })),
      create: vi.fn().mockReturnValue(of({ data: { id: 'class-1' } as any })),
      update: vi.fn().mockReturnValue(of({ data: { id: 'class-1' } as any })),
      deleteSchedule: vi.fn().mockReturnValue(of({ success: true })),
      addSchedule: vi.fn().mockReturnValue(
        of({
          data: {
            id: 'sch-1',
            classId: 'class-1',
            weekday: 1,
            startTime: '09:00:00',
            endTime: '11:00:00',
            teacherId: null,
            effectiveTo: null,
          },
        }),
      ),
    };

    messageServiceMock = {
      add: vi.fn(),
    };

    // `dialogRefMock` 是模組層的 const，`vi.fn()` 不會自己重置 ——
    // 不清的話「這條測試有沒有關閉對話框」實際上是在問
    // 「**前面所有測試加起來**有沒有關過」，而那會隨測試順序改變答案。
    dialogRefMock.close.mockClear();

    canManageFinance = false;
    feeTemplatesMock = {
      list: vi.fn().mockReturnValue(
        of({
          data: [
            { id: 'fee-1', name: '國中月繳', billingMode: 'monthly', amount: 4500, isActive: true },
          ],
        }),
      ),
    };

    conflictClose$ = new Subject<boolean | undefined>();
    dialogServiceMock = { open: vi.fn().mockReturnValue({ onClose: conflictClose$ }) };

    await TestBed.configureTestingModule({
      imports: [ClassFormDialogComponent],
      providers: [
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: DialogService, useValue: dialogServiceMock },
        {
          provide: AuthService,
          useValue: { hasPermission: (p: string) => p === 'manage_finance' && canManageFinance },
        },
        { provide: FeeTemplatesService, useValue: feeTemplatesMock },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              cls: null,
              course: {
                id: 'course-1',
                campusId: 'campus-1',
                subjectId: 'subject-1',
                name: '測試課程',
              },
              staff: [],
              campuses: [],
            },
          },
        },
      ],
    })
      // **元件層的 `providers: [DialogService]` 會遮蔽 TestBed 的 provider** ——
      // 不 override 的話元件拿到的是真的 service，mock 永遠不會被呼叫，
      // 而「沒被呼叫」在只斷言 not.toHaveBeenCalled 的測試裡看起來像通過。
      .overrideComponent(ClassFormDialogComponent, {
        set: { providers: [{ provide: DialogService, useValue: dialogServiceMock }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ClassFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should block save when schedule entries overlap in same weekday', () => {
    (component as any).formData.set({
      name: '測試班級',
      maxStudents: 20,
      nextClassId: null,
      isActive: true,
    });
    (component as any).scheduleEntries.set([
      { weekday: 1, startTime: '09:00', endTime: '11:00', teacherId: null, effectiveTo: null },
      { weekday: 1, startTime: '10:00', endTime: '12:00', teacherId: null, effectiveTo: null },
    ]);

    (component as any).save();

    expect(classesServiceMock.create as any).not.toHaveBeenCalled();
    expect((component as any).formValidationMessage()).toContain('時段重疊');
  });

  describe('排課衝突警告', () => {
    const conflict = {
      scheduleIndex: 0,
      teacherName: '王老師',
      conflictingClassId: 'c-9',
      conflictingClassName: '八年級 A 班',
      conflictingCourseName: '數學',
      conflictingWeekday: 3,
      conflictingStartTime: '17:00:00',
      conflictingEndTime: '19:00:00',
    };

    const saveWithConflict = () => {
      (classesServiceMock.checkScheduleConflicts as any).mockReturnValue(
        of({ conflicts: [conflict] }),
      );
      (component as any).formData.set({
        name: '測試班級',
        maxStudents: 20,
        nextClassId: null,
        isActive: true,
      });
      (component as any).scheduleEntries.set([
        { weekday: 3, startTime: '17:00', endTime: '19:00', teacherId: 't-1', effectiveTo: null },
      ]);
      (component as any).save();
    };

    it('有衝突時開警告對話框，而且還沒儲存', () => {
      saveWithConflict();
      expect(dialogServiceMock.open).toHaveBeenCalledTimes(1);
      // 衝突資料要真的帶進去 —— 帶不進去對話框就是空的，
      // 而空的警告跟沒有警告一樣沒用
      expect(dialogServiceMock.open.mock.calls[0][1].data).toEqual({ conflicts: [conflict] });
      expect(classesServiceMock.create as any).not.toHaveBeenCalled();
    });

    it('按「仍要儲存」才會送出', () => {
      saveWithConflict();
      conflictClose$.next(true);
      expect(classesServiceMock.create as any).toHaveBeenCalled();
    });

    it('按「返回修改」不送出', () => {
      saveWithConflict();
      conflictClose$.next(false);
      expect(classesServiceMock.create as any).not.toHaveBeenCalled();
    });

    // **這一條是重點。** 按遮罩或 Esc 關掉時 PrimeNG 回傳 undefined ——
    // 把「沒有回答」讀成「答應了」，正是這個警告要防的事。
    it('按 Esc／點遮罩關掉（undefined）不能當成同意', () => {
      saveWithConflict();
      conflictClose$.next(undefined);
      expect(classesServiceMock.create as any).not.toHaveBeenCalled();
    });
  });

  it('should not close dialog when add schedule API fails', async () => {
    (classesServiceMock.addSchedule as any).mockReturnValueOnce(
      throwError(() => ({ error: { error: '時段重疊' } })),
    );

    (component as any).formData.set({
      name: '測試班級',
      maxStudents: 20,
      nextClassId: null,
      isActive: true,
    });
    (component as any).scheduleEntries.set([
      { weekday: 1, startTime: '09:00', endTime: '11:00', teacherId: null, effectiveTo: null },
    ]);

    (component as any).save();
    await fixture.whenStable();

    expect(dialogRefMock.close).not.toHaveBeenCalled();
    expect(messageServiceMock.add).toHaveBeenCalled();
  });

  /**
   * #1175：班級的目錄參考價。沒有 `manage_finance` 時**不畫、不送這個 key** ——
   * 送了 API 會 403 整張表單（連改名都存不了）。編輯時沒改就不送：原本掛的範本可能已停用，
   * 照送會被 API 以 INVALID_FEE_TEMPLATE 擋下。
   */
  describe('目錄參考價（defaultFeeTemplateId）', () => {
    const recreate = (cls: Record<string, unknown> | null = null) => {
      TestBed.inject(DynamicDialogConfig).data.cls = cls;
      fixture = TestBed.createComponent(ClassFormDialogComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    };
    const fill = () =>
      (component as any).formData.set({
        name: '測試班級',
        maxStudents: 20,
        nextClassId: null,
        isActive: true,
      });
    const existing = {
      id: 'class-1',
      name: '舊班',
      maxStudents: 20,
      nextClassId: null,
      isActive: true,
      defaultFeeTemplateId: 'fee-old',
      schedules: [],
    };

    afterEach(() => {
      TestBed.inject(DynamicDialogConfig).data.cls = null;
    });

    it('沒有 manage_finance：不讀價目表、不畫欄位、送出不帶 key', () => {
      fill();
      (component as any).save();

      expect(feeTemplatesMock.list).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).not.toContain('目錄參考價');
      expect((classesServiceMock.create as any).mock.calls[0][0]).not.toHaveProperty(
        'defaultFeeTemplateId',
      );
    });

    it('有 manage_finance：只讀使用中的範本，選了就帶上', () => {
      canManageFinance = true;
      recreate();

      expect(feeTemplatesMock.list).toHaveBeenCalledWith({ isActive: true });
      expect(fixture.nativeElement.textContent).toContain('目錄參考價');
      fill();
      (component as any).defaultFeeTemplateId.set('fee-1');
      (component as any).save();

      expect((classesServiceMock.create as any).mock.calls[0][0].defaultFeeTemplateId).toBe(
        'fee-1',
      );
    });

    it('編輯時沒改：不送 key（原本的範本可能已停用）', () => {
      canManageFinance = true;
      recreate(existing);
      fill();
      (component as any).save();

      expect((classesServiceMock.update as any).mock.calls[0][1]).not.toHaveProperty(
        'defaultFeeTemplateId',
      );
    });

    it('編輯時清空：送 null', () => {
      canManageFinance = true;
      recreate(existing);
      fill();
      (component as any).defaultFeeTemplateId.set(null);
      (component as any).save();

      expect((classesServiceMock.update as any).mock.calls[0][1].defaultFeeTemplateId).toBeNull();
    });
  });

  /** #1118：家長端推薦加選的人工標記 —— 門檻跟班級本身一樣（manage_courses），永遠送 */
  it('推薦加選：預設關，打開後送出帶 isRecommended: true', () => {
    expect(fixture.nativeElement.textContent).toContain('家長端推薦加選');
    expect((component as any).isRecommended()).toBe(false);
    (component as any).formData.set({
      name: '測試班級',
      maxStudents: 20,
      nextClassId: null,
      isActive: true,
    });
    (component as any).isRecommended.set(true);
    (component as any).save();

    expect((classesServiceMock.create as any).mock.calls[0][0].isRecommended).toBe(true);
  });
});
