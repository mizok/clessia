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
          message: expect.stringContaining('此操作無法復原'),
        }),
      }),
    );
    expect(subjectsServiceMock.delete).not.toHaveBeenCalled();
  });

  // #392 補了 courseCount/academyExamCount 之後，用量在事先就查得到——不用再
  // 等 409 才知道，文案也能從「可能影響」升級成確定的說法
  describe('deleteBlockReason —— 用量欄位到位後的事先判斷', () => {
    function reason(subject: Subject): string | null {
      return (
        component as unknown as { deleteBlockReason: (s: Subject) => string | null }
      ).deleteBlockReason(subject);
    }

    it('課程數與校內考數都是 0 時不擋', () => {
      expect(
        reason({ id: 's', name: '國文', sortOrder: 0, courseCount: 0, academyExamCount: 0 }),
      ).toBeNull();
    });

    it('只有課程在用時，只提課程', () => {
      expect(
        reason({ id: 's', name: '國文', sortOrder: 0, courseCount: 2, academyExamCount: 0 }),
      ).toBe('已被2 個課程使用中，無法刪除');
    });

    // 這正是 M8 那個洞本身——舊版 API 只查 courses，courseCount 為 0 但
    // academyExamCount > 0 的組合會被放行。兩個數字都要顯示，缺一個就漏掉這個情境。
    it('只有校內考在用時，也要擋（不能只看課程數）', () => {
      expect(
        reason({ id: 's', name: '國文', sortOrder: 0, courseCount: 0, academyExamCount: 1 }),
      ).toBe('已被1 場校內考使用中，無法刪除');
    });

    it('兩者都在用時，兩個數字都要列出來', () => {
      expect(
        reason({ id: 's', name: '國文', sortOrder: 0, courseCount: 2, academyExamCount: 1 }),
      ).toBe('已被2 個課程、1 場校內考使用中，無法刪除');
    });
  });

  it('確認後才呼叫刪除 API', () => {
    stubConfirmDialog(true);
    subjectsServiceMock.delete.mockReturnValue(of(undefined));

    (component as unknown as { confirmDelete: (subject: Subject) => void }).confirmDelete(
      subjects[0],
    );

    expect(subjectsServiceMock.delete).toHaveBeenCalledWith('subject-1');
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
