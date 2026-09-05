import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { SubjectsService } from '@core/subjects.service';
import type { Subject } from '@core/subjects.service';
import { SubjectManagerComponent } from './subject-manager.component';

describe('SubjectManagerComponent', () => {
  let fixture: ComponentFixture<SubjectManagerComponent>;
  let component: SubjectManagerComponent;

  const subjects: Subject[] = [
    { id: 'subject-1', name: '數學', sortOrder: 0, courseCount: 0, academyExamCount: 0 },
  ];
  const subjectsServiceMock = {
    list: vi.fn(() => of({ data: subjects })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    subjectsServiceMock.list.mockClear();
    subjectsServiceMock.create.mockReset();
    subjectsServiceMock.update.mockReset();
    subjectsServiceMock.delete.mockReset();
    subjectsServiceMock.list.mockReturnValue(of({ data: subjects }));

    await TestBed.configureTestingModule({
      imports: [SubjectManagerComponent],
      providers: [
        { provide: SubjectsService, useValue: subjectsServiceMock },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: {} } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SubjectManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // 空值送出過去完全靜默：按鈕雖 disabled，但在輸入框按 Enter 仍會呼叫 addSubject()
  it('新增科目名稱留空時顯示提示，而不是什麼都不做', () => {
    (component as unknown as { newSubjectName: { set: (v: string) => void } }).newSubjectName.set(
      '   ',
    );

    (component as unknown as { addSubject: () => void }).addSubject();
    fixture.detectChanges();

    expect(subjectsServiceMock.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('尚未輸入科目名稱');
  });

  it('新增成功後顯示成功提示，而不是靜默把新列加到清單底部', () => {
    subjectsServiceMock.create.mockReturnValue(
      of({ data: { id: 'subject-2', name: '英文', sortOrder: 1 } }),
    );
    (component as unknown as { newSubjectName: { set: (v: string) => void } }).newSubjectName.set(
      '英文',
    );

    (component as unknown as { addSubject: () => void }).addSubject();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('已新增');
    expect(fixture.nativeElement.textContent).toContain('「英文」已新增');
  });

  it('renders an inline error notice when delete fails', () => {
    subjectsServiceMock.delete.mockReturnValue(
      throwError(() => ({
        error: {
          error: '此科目有 11 門課程使用中，無法刪除',
        },
      })),
    );

    (component as unknown as { confirmDelete: (subject: Subject) => void }).confirmDelete(
      subjects[0],
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('無法刪除');
    expect(fixture.nativeElement.textContent).toContain('此科目有 11 門課程使用中，無法刪除');
  });
});
