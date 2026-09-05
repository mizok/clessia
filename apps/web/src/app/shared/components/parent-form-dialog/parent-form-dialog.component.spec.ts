import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ParentsService } from '@core/parents.service';
import { ParentFormDialogComponent } from './parent-form-dialog.component';

describe('ParentFormDialogComponent', () => {
  let fixture: ComponentFixture<ParentFormDialogComponent>;
  let component: ParentFormDialogComponent;
  const closeMock = vi.fn();
  const parentsServiceMock = {
    create: vi.fn(() => of({ data: { id: 'parent-1' }, loginUrl: null })),
    update: vi.fn(() => of({ data: { id: 'parent-1' } })),
  };

  beforeEach(async () => {
    closeMock.mockClear();
    parentsServiceMock.create.mockClear();

    await TestBed.configureTestingModule({
      imports: [ParentFormDialogComponent],
      providers: [
        { provide: ParentsService, useValue: parentsServiceMock },
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
});
