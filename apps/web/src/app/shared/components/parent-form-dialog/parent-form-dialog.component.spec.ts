import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
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
    expect(fixture.nativeElement.textContent).toContain('請先輸入姓名');
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
    expect(fixture.nativeElement.textContent).toContain('Email 與手機號碼至少要填一個');
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
    const stars = el.querySelectorAll('.form-dialog__required');
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
