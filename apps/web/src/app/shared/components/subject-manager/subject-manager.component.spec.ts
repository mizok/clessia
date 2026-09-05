import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { SubjectsService } from '@core/subjects.service';
import type { Subject } from '@core/subjects.service';
import { SubjectManagerComponent } from './subject-manager.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';

describe('SubjectManagerComponent', () => {
  let fixture: ComponentFixture<SubjectManagerComponent>;
  let component: SubjectManagerComponent;

  const subjects: Subject[] = [{ id: 'subject-1', name: '數學', sortOrder: 0 }];
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

  function stubConfirmDialog(confirmed: boolean) {
    const dialogService = fixture.debugElement.injector.get(DialogService);
    return vi
      .spyOn(dialogService, 'open')
      .mockReturnValue({ onClose: of(confirmed) } as ReturnType<DialogService['open']>);
  }

  // `confirmDelete` 曾經名不副實——名字說要確認，實際上直接呼叫刪除 API，
  // 一次點擊沒有反悔機會。這條釘住「一定要先走過確認對話框」。
  it('點刪除會先跳確認對話框，取消就不呼叫刪除 API', () => {
    const openSpy = stubConfirmDialog(false);

    (component as unknown as { confirmDelete: (subject: Subject) => void }).confirmDelete(
      subjects[0],
    );

    expect(openSpy).toHaveBeenCalledWith(
      ConfirmDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.stringContaining('可能影響已使用此科目的課程與考試'),
        }),
      }),
    );
    expect(subjectsServiceMock.delete).not.toHaveBeenCalled();
  });

  it('確認後才呼叫刪除 API', () => {
    stubConfirmDialog(true);
    subjectsServiceMock.delete.mockReturnValue(of(undefined));

    (component as unknown as { confirmDelete: (subject: Subject) => void }).confirmDelete(
      subjects[0],
    );

    expect(subjectsServiceMock.delete).toHaveBeenCalledWith('subject-1');
  });

  it('renders an inline error notice when delete fails', () => {
    stubConfirmDialog(true);
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
