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
});
