import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';

import { StudentPickerDialogComponent } from './student-picker-dialog.component';
import { StudentsService } from '@core/students.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { FeeTemplatesService } from '@core/fee-templates.service';
import { InvoicesService } from '@core/invoices.service';

describe('StudentPickerDialogComponent', () => {
  let fixture: ComponentFixture<StudentPickerDialogComponent>;

  const studentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'student-1',
            orgId: 'org-1',
            name: '王小明',
            grade: 'J1',
            school: '測試國中',
            birthday: null,
            gender: null,
            phone: null,
            email: null,
            address: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            notes: null,
            isActive: true,
            parentNames: [],
            campusNames: [],
            hasEnrollments: false,
            createdAt: '2026-04-01T00:00:00Z',
            updatedAt: '2026-04-01T00:00:00Z',
          },
          {
            id: 'student-2',
            orgId: 'org-1',
            name: '李小華',
            grade: 'J2',
            school: '示範國中',
            birthday: null,
            gender: null,
            phone: null,
            email: null,
            address: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            notes: null,
            isActive: true,
            parentNames: [],
            campusNames: [],
            hasEnrollments: false,
            createdAt: '2026-04-01T00:00:00Z',
            updatedAt: '2026-04-01T00:00:00Z',
          },
        ],
        meta: { total: 2, page: 1, pageSize: 8, totalPages: 1 },
        summary: { total: 2, activeCount: 2 },
      }),
    ),
  };

  const enrollmentsServiceMock = {
    batchCreate: vi.fn(() =>
      of({
        results: [{ studentId: 'student-1', status: 'enrolled', enrollmentId: 'enrollment-1' }],
      }),
    ),
  };

  const feeTemplatesServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          { id: 'ft-1', name: '國中月繳', billingMode: 'monthly', amount: 4500, isActive: true },
        ],
      }),
    ),
  };

  const invoicesServiceMock = {
    create: vi.fn(() => of({ data: { id: 'inv-1' } })),
  };

  const dialogRefMock = {
    close: vi.fn(),
  };

  /** 走完「選人 → 進確認頁」，因為開帳的預設值是在那個轉場決定的 */
  function pick(...ids: string[]): StudentPickerDialogComponent {
    const c = fixture.componentInstance;
    c['selectedIds'].set(new Set(ids));
    c['goToReview']();
    return c;
  }

  beforeEach(async () => {
    studentsServiceMock.list.mockClear();
    enrollmentsServiceMock.batchCreate.mockClear();
    dialogRefMock.close.mockClear();
    feeTemplatesServiceMock.list.mockClear();
    invoicesServiceMock.create.mockReset().mockReturnValue(of({ data: { id: 'inv-1' } }));
    enrollmentsServiceMock.batchCreate.mockReturnValue(
      of({
        results: [{ studentId: 'student-1', status: 'enrolled', enrollmentId: 'enrollment-1' }],
      }),
    );

    await TestBed.configureTestingModule({
      imports: [StudentPickerDialogComponent],
      providers: [
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: FeeTemplatesService, useValue: feeTemplatesServiceMock },
        { provide: InvoicesService, useValue: invoicesServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              classId: 'class-1',
              existingStudentIds: [],
              maxStudents: 10,
              currentActiveCount: 2,
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentPickerDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows conflict warnings when batchCreate returns SCHEDULE_CONFLICT', () => {
    fixture.componentInstance['selectedIds'].set(new Set(['student-1']));
    enrollmentsServiceMock.batchCreate.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'SCHEDULE_CONFLICT',
          warnings: [
            {
              studentId: 'student-1',
              conflictingClassId: 'class-conflict',
              conflictingClassName: '英文 A',
              conflictingCourseName: '英文',
              weekday: 2,
              startTime: '18:00:00',
              endTime: '20:00:00',
            },
          ],
        },
      })),
    );

    fixture.componentInstance['confirm']();

    expect(fixture.componentInstance['conflictWarnings']()).toEqual([
      expect.objectContaining({
        studentId: 'student-1',
        conflictingClassId: 'class-conflict',
      }),
    ]);
    expect(fixture.componentInstance['confirmError']()).toBeNull();
  });

  it('retries batchCreate with skipConflictCheck when forcing confirm', () => {
    fixture.componentInstance['selectedIds'].set(new Set(['student-1', 'student-2']));

    fixture.componentInstance['confirmForce']();

    expect(enrollmentsServiceMock.batchCreate).toHaveBeenLastCalledWith({
      classId: 'class-1',
      studentIds: ['student-1', 'student-2'],
      skipConflictCheck: true,
    });
  });

  it('shows quota message when batchCreate returns OVER_QUOTA', () => {
    fixture.componentInstance['selectedIds'].set(new Set(['student-1']));
    enrollmentsServiceMock.batchCreate.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'OVER_QUOTA',
        },
      })),
    );

    fixture.componentInstance['confirm']();

    expect(fixture.componentInstance['confirmError']()).toBe('超過班級人數上限，請減少加入人數');
  });

  describe('立即開帳的預設值 —— 看選了幾個人', () => {
    // 選一個是櫃檯現場（那個人就站在前面，接下來就是收錢）
    it('選一個人預設要開帳', () => {
      expect(pick('student-1')['issueInvoice']()).toBe(true);
    });

    // 選一批是灌名單，金額多半還要逐筆議 —— 三十張開錯了要逐張作廢
    it('選多個人預設不開帳', () => {
      expect(pick('student-1', 'student-2')['issueInvoice']()).toBe(false);
    });

    // 他明確關掉之後又因為刪掉一個人自動打開，是最惱人的那種「聰明」
    it('手動關掉之後不會因為人數變成 1 又自己打開', () => {
      const c = pick('student-1', 'student-2');
      c['onIssueInvoiceChange'](false);

      c['removeFromReview']('student-2');
      c['goToReview']();

      expect(c['issueInvoice']()).toBe(false);
    });
  });

  describe('計費設定跟著報名一起送', () => {
    it('批次建立帶上計費欄位', () => {
      const c = pick('student-1');
      c['onIssueInvoiceChange'](false);
      c['updateBilling']('billingMode', 'monthly');
      c['updateBilling']('feeTemplateId', 'ft-1');

      c['confirm']();

      expect(enrollmentsServiceMock.batchCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({ billingMode: 'monthly', feeTemplateId: 'ft-1' }),
      );
    });

    // 規則 5.3：折數看老闆當下心情，所以系統不猜原因，只要求寫下來
    it('議價沒填原因就擋住，連 API 都不打', () => {
      const c = pick('student-1');
      c['updateBilling']('feeTemplateId', 'ft-1');
      c['updateBilling']('agreedAmount', 3800);

      c['confirm']();

      expect(enrollmentsServiceMock.batchCreate).not.toHaveBeenCalled();
      expect(c['confirmError']()).toContain('調整原因');
    });

    it('填了原因就送得出去', () => {
      const c = pick('student-1');
      c['updateBilling']('feeTemplateId', 'ft-1');
      c['updateBilling']('agreedAmount', 3800);
      c['updateBilling']('adjustmentNote', '舊生續報');

      c['confirm']();

      expect(enrollmentsServiceMock.batchCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({ agreedAmount: 3800, adjustmentNote: '舊生續報' }),
      );
    });

    // 與其開一張金額是猜的帳單，不如當場說清楚
    it('要開帳卻沒有金額可用時擋住', () => {
      const c = pick('student-1');

      c['confirm']();

      expect(enrollmentsServiceMock.batchCreate).not.toHaveBeenCalled();
      expect(c['confirmError']()).toContain('價目表');
    });
  });

  describe('開帳：跟報名不同一個事務', () => {
    function pickWithBilling(...ids: string[]) {
      const c = pick(...ids);
      c['updateBilling']('feeTemplateId', 'ft-1');
      c['onIssueInvoiceChange'](true);
      return c;
    }

    it('報名成功後逐筆開帳，金額照價目表', () => {
      pickWithBilling('student-1')['confirm']();

      expect(invoicesServiceMock.create).toHaveBeenCalledWith({
        studentId: 'student-1',
        items: [{ type: 'tuition', enrollmentId: 'enrollment-1', amount: 4500 }],
      });
    });

    it('堂數制開的是 session_pack 不是 tuition', () => {
      const c = pickWithBilling('student-1');
      c['updateBilling']('billingMode', 'session_pack');

      c['confirm']();

      expect(invoicesServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ items: [expect.objectContaining({ type: 'session_pack' })] }),
      );
    });

    it('全都開成功就關閉，並回報開了幾張', () => {
      pickWithBilling('student-1')['confirm']();

      expect(dialogRefMock.close).toHaveBeenCalledWith(
        expect.objectContaining({ invoicesCreated: 1 }),
      );
    });

    // 報名是既成事實 —— 人已經在教室裡了，不能因為帳單開不出來就退掉
    it('帳單失敗時報名仍然成立，而且不關閉對話框', () => {
      invoicesServiceMock.create.mockReturnValue(throwError(() => new Error('boom')));
      const c = pickWithBilling('student-1');

      c['confirm']();

      expect(enrollmentsServiceMock.batchCreate).toHaveBeenCalled();
      expect(dialogRefMock.close).not.toHaveBeenCalled();
      expect(c['invoiceFailures']().length).toBe(1);
    });

    it('部分失敗時算得出成功幾張、失敗幾張', () => {
      enrollmentsServiceMock.batchCreate.mockReturnValue(
        of({
          results: [
            { studentId: 'student-1', status: 'enrolled', enrollmentId: 'e1' },
            { studentId: 'student-2', status: 'enrolled', enrollmentId: 'e2' },
          ],
        }),
      );
      invoicesServiceMock.create
        .mockReturnValueOnce(of({ data: { id: 'inv-1' } }))
        .mockReturnValueOnce(throwError(() => new Error('boom')));

      const c = pickWithBilling('student-1', 'student-2');
      c['confirm']();

      expect(c['invoicesCreated']()).toBe(1);
      expect(c['invoiceFailures']().length).toBe(1);
      expect(dialogRefMock.close).not.toHaveBeenCalled();
    });

    // 報名不能重報，已經開成的帳單也不該開第二張
    it('重試只送沒開成的那幾筆', () => {
      enrollmentsServiceMock.batchCreate.mockReturnValue(
        of({
          results: [
            { studentId: 'student-1', status: 'enrolled', enrollmentId: 'e1' },
            { studentId: 'student-2', status: 'enrolled', enrollmentId: 'e2' },
          ],
        }),
      );
      invoicesServiceMock.create
        .mockReturnValueOnce(of({ data: { id: 'inv-1' } }))
        .mockReturnValueOnce(throwError(() => new Error('boom')));

      const c = pickWithBilling('student-1', 'student-2');
      c['confirm']();
      invoicesServiceMock.create.mockClear();
      invoicesServiceMock.create.mockReturnValue(of({ data: { id: 'inv-2' } }));

      c['retryInvoices']();

      expect(invoicesServiceMock.create).toHaveBeenCalledTimes(1);
      expect(invoicesServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: 'student-2' }),
      );
      expect(enrollmentsServiceMock.batchCreate).toHaveBeenCalledTimes(1);
    });

    it('帳單沒開成也能離開，回傳的是已經成立的報名', () => {
      invoicesServiceMock.create.mockReturnValue(throwError(() => new Error('boom')));
      const c = pickWithBilling('student-1');
      c['confirm']();

      c['closeWithPartialResult']();

      expect(dialogRefMock.close).toHaveBeenCalledWith(
        expect.objectContaining({ results: expect.any(Array) }),
      );
    });
  });
});
