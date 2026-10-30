import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ParentsService } from '@core/parents.service';
import { StudentsService, type Student } from '@core/students.service';
import { ParentFormDialogComponent } from './parent-form-dialog.component';

describe('ParentFormDialogComponent', () => {
  let fixture: ComponentFixture<ParentFormDialogComponent>;
  let component: ParentFormDialogComponent;
  const closeMock = vi.fn();
  const parentsServiceMock = {
    create: vi.fn(() => of({ data: { id: 'parent-1' }, loginUrl: null })),
    update: vi.fn(() => of({ data: { id: 'parent-1' } })),
  };

  const studentsServiceMock = { list: vi.fn(() => of({ data: [] })) };

  beforeEach(async () => {
    closeMock.mockClear();
    parentsServiceMock.create.mockClear();

    await TestBed.configureTestingModule({
      imports: [ParentFormDialogComponent],
      providers: [
        { provide: ParentsService, useValue: parentsServiceMock },
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: DynamicDialogConfig, useValue: { data: { parent: null } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ParentFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // 按鈕刻意不 disable——原本的 [disabled]="!isFormValid()" 會把「為什麼不行」
  // 藏起來：使用者填完唯一標星號的姓名，按鈕仍是灰的，卻不知道還缺 Email/手機。
  it('姓名留空時按下建立會說出來，不是靜默沒反應', () => {
    (component as unknown as { save: () => void }).save();
    fixture.detectChanges();

    expect(parentsServiceMock.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('還沒填：姓名');
  });

  it('姓名填了但 Email/手機都空時，說出還缺哪個', () => {
    const c = component as unknown as {
      updateForm: (field: string, value: string) => void;
      save: () => void;
    };
    c.updateForm('name', '王小明');
    c.save();
    fixture.detectChanges();

    expect(parentsServiceMock.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Email 和手機至少填一個');
  });

  it('姓名 + 其中一項聯絡方式都有時，正常送出', () => {
    const c = component as unknown as {
      updateForm: (field: string, value: string) => void;
      save: () => void;
    };
    c.updateForm('name', '王小明');
    c.updateForm('phone', '0912345678');
    c.save();

    expect(parentsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '王小明', phone: '0912345678' }),
    );
    expect(closeMock).toHaveBeenCalled();
  });

  // #1008：驗證其實是「姓名必填、Email／手機二擇一」—— 星號只能標姓名。
  it('必填星號只標姓名；Email／手機旁寫「至少填一個」', () => {
    const el = fixture.nativeElement as HTMLElement;
    const stars = el.querySelectorAll('label .text-error-700');
    expect(stars).toHaveLength(1);
    expect(stars[0].closest('label')?.textContent).toContain('姓名');
    expect(el.textContent).toContain('至少填一個');
  });

  it('新增時有「關聯學生」欄，選了學生就把 studentIds 一起送出', () => {
    expect(fixture.nativeElement.textContent).toContain('關聯學生');
    const c = component as unknown as {
      updateForm: (field: string, value: string) => void;
      selectedStudents: Student[];
      save: () => void;
    };
    c.updateForm('name', '王媽媽');
    c.updateForm('phone', '0912345678');
    c.selectedStudents = [
      { id: 's1', name: '小明' },
      { id: 's2', name: '小華' },
    ] as Student[];
    c.save();

    expect(parentsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ studentIds: ['s1', 's2'] }),
    );
  });

  it('沒選學生時不送 studentIds', () => {
    const c = component as unknown as {
      updateForm: (field: string, value: string) => void;
      save: () => void;
    };
    c.updateForm('name', '王媽媽');
    c.updateForm('phone', '0912345678');
    c.save();

    const input = (parentsServiceMock.create.mock.calls.at(-1) as unknown as [object])[0];
    expect(input).not.toHaveProperty('studentIds', expect.anything());
  });

  /**
   * #1245：從公開申請「建立家長」—— 新增模式，但欄位先帶好申請人填的。
   * `prefill` 不是 `parent`：有 `parent` 會變成編輯模式（打 update 而不是 create）。
   */
  /**
   * #1844：Email／手機是本機構教職員的帳號 → 後端 409 STAFF_ACCOUNT_EXISTS。
   * 表單改成確認「把 ○○ 設為家長」，按下去同一份表單帶 linkExistingUserId 再送一次。
   */
  describe('Email／手機是本機構教職員的帳號（#1844）', () => {
    const staffExists = () =>
      throwError(() => ({
        error: {
          error: '這是 王老師（教職員）的帳號，要把他設為家長嗎？',
          code: 'STAFF_ACCOUNT_EXISTS',
          details: { userId: 'u-teacher', staffName: '王老師' },
        },
      }));
    const fill = () => {
      const c = component as unknown as {
        updateForm: (field: string, value: string) => void;
        save: () => void;
        confirmLink: () => void;
      };
      c.updateForm('name', '王老師家長');
      c.updateForm('email', 'wang@example.com');
      return c;
    };

    it('第一次送出 → 顯示確認（寫出會用的名字），不關閉、不顯示錯誤', () => {
      parentsServiceMock.create.mockReturnValueOnce(staffExists() as never);
      fill().save();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('這是 王老師（教職員）的帳號，要把他設為家長嗎？');
      expect(text).toContain('家長資料會用「王老師」這個名字');
      expect(text).not.toContain('請稍後再試');
      expect(closeMock).not.toHaveBeenCalled();
    });

    it('按「設為家長」→ 同一份表單帶 linkExistingUserId 再送，關閉時標記 linkedStaff', () => {
      parentsServiceMock.create.mockReturnValueOnce(staffExists() as never);
      const c = fill();
      c.save();
      c.confirmLink();

      expect(parentsServiceMock.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ email: 'wang@example.com', linkExistingUserId: 'u-teacher' }),
      );
      expect(closeMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'created', linkedStaff: true }),
      );
    });

    it('改了 Email → 確認作廢（那是另一個人了），再送出不帶 linkExistingUserId', () => {
      parentsServiceMock.create.mockReturnValueOnce(staffExists() as never);
      const c = fill();
      c.save();
      c.updateForm('email', 'other@example.com');
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('要把他設為家長嗎');

      c.save();
      expect(parentsServiceMock.create).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ linkExistingUserId: expect.anything() }),
      );
    });

    // #1844 二讀：確認區塊的「不要」—— 收起來、不送出
    it('按「不要」→ 確認收起，不會再送一次', () => {
      parentsServiceMock.create.mockReturnValueOnce(staffExists() as never);
      fill().save();
      fixture.detectChanges();
      const calls = parentsServiceMock.create.mock.calls.length;

      const no = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === '不要',
      )!;
      no.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('要把他設為家長嗎');
      expect(parentsServiceMock.create.mock.calls.length).toBe(calls);
    });

    it('出錯後送出鈕不會一直轉（loading 復原）', () => {
      parentsServiceMock.create.mockReturnValueOnce(
        throwError(() => ({ error: { error: 'x', code: 'STAFF_NOT_ACTIVE' } })) as never,
      );
      fill().save();
      expect((component as unknown as { loading: () => boolean }).loading()).toBe(false);
    });

    it('先出現確認、再遇到別的錯誤 → 舊的確認框收掉，只顯示新的錯誤', () => {
      parentsServiceMock.create.mockReturnValueOnce(staffExists() as never);
      const c = fill();
      c.save();
      parentsServiceMock.create.mockReturnValueOnce(
        throwError(() => ({
          error: { error: '王老師 的教職員帳號已停用，不能設為家長', code: 'STAFF_NOT_ACTIVE' },
        })) as never,
      );
      c.confirmLink();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).not.toContain('要把他設為家長嗎');
      expect(text).toContain('的教職員帳號已停用');
    });

    // handleError 依 code 對應訊息（原本拿訊息比對碼，這兩行永遠進不去）
    it.each([
      ['DUPLICATE_EMAIL', '此 Email 已被使用'],
      ['DUPLICATE_PHONE', '此手機號碼已被使用'],
    ])('後端回 %s → 顯示「%s」（不是後端的原始訊息）', (code, shown) => {
      parentsServiceMock.create.mockReturnValueOnce(
        throwError(() => ({ error: { error: 'raw server text', code } })) as never,
      );
      fill().save();
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain(shown);
      expect(text).not.toContain('raw server text');
    });

    it('其他擋下的情況（已經是家長、教職員停用…）→ 顯示後端的訊息', () => {
      parentsServiceMock.create.mockReturnValueOnce(
        throwError(() => ({
          error: {
            error: '已經是家長「王老師」，請到列表編輯那一筆',
            code: 'PARENT_ALREADY_EXISTS',
          },
        })) as never,
      );
      fill().save();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        '已經是家長「王老師」，請到列表編輯那一筆',
      );
    });
  });

  it('prefill：新增模式、欄位預填，送出走 create', () => {
    TestBed.inject(DynamicDialogConfig).data = {
      parent: null,
      prefill: { name: '王媽媽', email: null, phone: '0912345678' },
    };
    const other = TestBed.createComponent(ParentFormDialogComponent);
    other.detectChanges();
    const c = other.componentInstance as unknown as {
      formData: () => { name: string; email: string; phone: string };
      isEditMode: () => boolean;
      save: () => void;
    };

    expect(c.isEditMode()).toBe(false);
    expect(c.formData()).toMatchObject({ name: '王媽媽', email: '', phone: '0912345678' });
    c.save();
    expect(parentsServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '王媽媽', phone: '0912345678' }),
    );
    TestBed.inject(DynamicDialogConfig).data = { parent: null };
  });
});
