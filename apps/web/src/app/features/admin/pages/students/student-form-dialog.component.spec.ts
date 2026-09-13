import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SchoolsService } from '@core/schools.service';
import { StudentsService } from '@core/students.service';
import { ParentsService, type Parent } from '@core/parents.service';
import { StudentFormDialogComponent } from './student-form-dialog.component';

describe('StudentFormDialogComponent', () => {
  let fixture: ComponentFixture<StudentFormDialogComponent>;
  let component: StudentFormDialogComponent;
  const closeMock = vi.fn();
  const studentsServiceMock = {
    create: vi.fn(() => of({ data: { id: 'student-1' } })),
    update: vi.fn(() => of({ data: { id: 'student-1' } })),
  };
  const schoolsServiceMock = { list: vi.fn(() => of({ data: [] })) };
  const parentsServiceMock = { list: vi.fn(() => of({ data: [] })) };

  function setup(configData: Record<string, unknown>) {
    return TestBed.configureTestingModule({
      imports: [StudentFormDialogComponent],
      providers: [
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: SchoolsService, useValue: schoolsServiceMock },
        { provide: ParentsService, useValue: parentsServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: DynamicDialogConfig, useValue: { data: configData } },
      ],
    }).compileComponents();
  }

  beforeEach(() => {
    closeMock.mockClear();
    studentsServiceMock.create.mockClear();
  });

  /**
   * **#809：這支對話框自己 `providers: [MessageService]`，所以它拿到的是自己的實例**，
   * 而 `students.page` 的 `<p-toast>` 訂閱的是 students.page 提供的那一個 ——
   * 執行期實測過兩個實例 `!==`。對話框模板沒有出口的話，它發的每一則都沒有訂閱者：
   * 「就讀學校」讀不到時下拉**靜靜是空的**，而那是必填欄位。
   *
   * 斷言查 `document` 而不是 `fixture.nativeElement`，而且查渲染出來的訊息
   * 不是「add 有沒有被呼叫」—— 後者是意圖，前者是結果。
   */
  it('發出的 toast 有出口 —— DOM 裡真的長出訊息', async () => {
    await setup({ student: null });
    fixture = TestBed.createComponent(StudentFormDialogComponent);
    fixture.detectChanges();

    fixture.debugElement.injector
      .get(MessageService)
      .add({ severity: 'error', summary: '載入失敗', detail: '無法載入學校清單' });
    fixture.detectChanges();

    expect(document.querySelector('.p-toast-message')).not.toBeNull();
  });

  // #364 後續：學生頁「新增學生」沒有預填家長，這條路徑要能挑家長，
  // 才不會跟家長頁的同名選項能力不同。
  it('未預填 parentId 時顯示家長選擇器，並把選到的家長帶進建立請求', async () => {
    await setup({ student: null });
    fixture = TestBed.createComponent(StudentFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect((component as unknown as { showParentPicker: () => boolean }).showParentPicker()).toBe(
      true,
    );

    const parent: Parent = {
      id: 'parent-1',
      userId: 'u1',
      orgId: 'org1',
      name: '王大明',
      phone: '0912345678',
      email: null,
      loginAccount: '0912345678',
      status: 'active',
      studentCount: 1,
      studentNames: [],
      notes: null,
      createdAt: '',
      updatedAt: '',
    };
    const c = component as unknown as {
      onParentChange: (v: Parent | string | null) => void;
      formData: { set: (v: unknown) => void };
      save: () => void;
    };
    c.onParentChange(parent);
    c.formData.set({
      name: '小明',
      grade: 'P1',
      schoolId: 'school-1',
      birthday: null,
      gender: null,
      phone: '',
      email: '',
      address: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      notes: '',
    });

    c.save();

    expect(studentsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'parent-1' }),
    );
  });

  it('已預填 parentId（從家長頁開啟）時不顯示家長選擇器，直接用預填值', async () => {
    await setup({ student: null, parentId: 'parent-2' });
    fixture = TestBed.createComponent(StudentFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect((component as unknown as { showParentPicker: () => boolean }).showParentPicker()).toBe(
      false,
    );

    const c = component as unknown as {
      formData: { set: (v: unknown) => void };
      save: () => void;
    };
    c.formData.set({
      name: '小明',
      grade: 'P1',
      schoolId: 'school-1',
      birthday: null,
      gender: null,
      phone: '',
      email: '',
      address: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      notes: '',
    });

    c.save();

    expect(studentsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'parent-2' }),
    );
  });

  /**
   * #716：送出鍵原本是 `[disabled]="!isFormValid()"`。
   *
   * **方向由 #664 定了**（人員表單）：`disabled` 是把「為什麼不行」藏起來，
   * 而那正是使用者最需要知道的 —— **按不下去的按鈕不會解釋原因，按得下去的才會**。
   * 家長表單已經是新方向，學生表單是舊的那一版。
   */
  describe('#716 送出鍵改成欄位級錯誤', () => {
    async function renderEmptyForm() {
      await setup({ student: null });
      fixture = TestBed.createComponent(StudentFormDialogComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      return fixture;
    }

    const submitButton = (): HTMLButtonElement =>
      [...fixture.nativeElement.querySelectorAll('button')].find((b) =>
        (b as HTMLElement).textContent?.includes('建立學生'),
      ) as HTMLButtonElement;

    it('必填全空時送出鍵仍然可以按', async () => {
      await renderEmptyForm();

      expect(submitButton()).toBeTruthy();
      expect(submitButton().disabled).toBe(false);
    });

    it('按下去逐欄顯示錯誤，而且不送出請求', async () => {
      await renderEmptyForm();

      submitButton().click();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('請填寫姓名');
      expect(text).toContain('請選擇年級');
      expect(text).toContain('請選擇就讀學校');

      // **沒有送出** —— 驗證沒過就不會打 API，誤觸的代價只是看到錯誤訊息
      expect(studentsServiceMock.create).not.toHaveBeenCalled();
    });

    /**
     * **一次收集全部**，不是遇到第一個就停 —— 照 #664 的形狀：
     * 使用者一次看到所有要補的東西，不用「修一個、再按一次、再發現下一個」。
     */
    it('三個必填一次全部標出來，不是一次一個', async () => {
      await renderEmptyForm();

      submitButton().click();
      fixture.detectChanges();

      const errors = (component as unknown as { errors: () => Record<string, string> }).errors();
      expect(Object.keys(errors).sort()).toEqual(['grade', 'name', 'schoolId']);
    });

    it('改動一個欄位就清掉它的錯誤 —— 錯誤是「上次送出時的狀態」，不是永久標籤', async () => {
      await renderEmptyForm();
      submitButton().click();
      fixture.detectChanges();

      (
        component as unknown as {
          updateForm: (f: string, v: unknown) => void;
        }
      ).updateForm('name', '王小明');
      fixture.detectChanges();

      const errors = (component as unknown as { errors: () => Record<string, string> }).errors();
      expect(errors['name']).toBeUndefined();
      // 沒碰的那兩個要還在 —— 否則就變成「改一個欄位把全部錯誤洗掉」
      expect(errors['grade']).toBeTruthy();
      expect(errors['schoolId']).toBeTruthy();
    });

    /**
     * **反向對照**：擋住「把 `disabled` 整個拿掉」那種過頭的修法。
     *
     * `loading()` 期間必須還是 disabled —— 那顆按鈕**按下去會產生後果**
     * （重複建立學生），而 #664 的判準本來就把這種情況列為例外。
     */
    it('送出中仍然 disabled —— 這一顆按下去會產生後果', async () => {
      await renderEmptyForm();

      // **必填先填滿** —— 不填的話這條會因為「表單無效」而通過，
      // 那跟 `loading()` 沒有關係，測試就證明不了它要證明的事。
      const c = component as unknown as {
        updateForm: (f: string, v: unknown) => void;
        loading: { set: (v: boolean) => void };
      };
      c.updateForm('name', '王小明');
      c.updateForm('grade', 'P5');
      c.updateForm('schoolId', 'school-1');
      fixture.detectChanges();
      expect(submitButton().disabled).toBe(false);

      c.loading.set(true);
      fixture.detectChanges();

      expect(submitButton().disabled).toBe(true);
    });
  });
});
