import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';

import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';

import { EnrollmentBillingDialogComponent } from './enrollment-billing-dialog.component';

const feeTemplate = (overrides?: Partial<FeeTemplate>): FeeTemplate => ({
  id: 'ft-1',
  orgId: 'org-1',
  name: '國中主科月繳',
  billingMode: 'monthly',
  amount: 4500,
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const enrollment = (overrides?: Partial<Enrollment>): Enrollment =>
  ({
    id: 'en-1',
    studentId: 's-1',
    studentName: '王小明',
    classId: 'c-1',
    status: 'active',
    billingMode: null,
    feeTemplateId: null,
    agreedAmount: null,
    adjustmentNote: null,
    ...overrides,
  }) as Enrollment;

describe('EnrollmentBillingDialogComponent', () => {
  let component: EnrollmentBillingDialogComponent;
  let fixture: ComponentFixture<EnrollmentBillingDialogComponent>;

  const enrollments = { update: vi.fn(() => of({ data: enrollment() })) };
  const feeTemplates = { list: vi.fn(() => of({ data: [feeTemplate()] })) };
  const dialogRef = { close: vi.fn() };

  async function setup(data: Enrollment) {
    TestBed.resetTestingModule();
    enrollments.update.mockReset().mockReturnValue(of({ data }));
    feeTemplates.list.mockReset().mockReturnValue(of({ data: [feeTemplate()] }));
    dialogRef.close.mockReset();

    await TestBed.configureTestingModule({
      imports: [EnrollmentBillingDialogComponent],
      providers: [
        { provide: EnrollmentsService, useValue: enrollments },
        { provide: FeeTemplatesService, useValue: feeTemplates },
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: DynamicDialogConfig, useValue: { data: { enrollment: data } } },
        MessageService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EnrollmentBillingDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  type Internals = {
    form: { set: (v: Record<string, unknown>) => void; (): Record<string, unknown> };
    save: () => void;
    pricingHint: () => string | null;
  };
  const internals = () => component as unknown as Internals;

  beforeEach(async () => {
    await setup(enrollment());
  });

  it('只列出啟用中的價目表 —— 停用的不該還能被挑到', () => {
    expect(feeTemplates.list).toHaveBeenCalledWith({ isActive: true });
  });

  /**
   * billing-rules 規則 2：金額永遠可人工覆寫。留空 = 照定價，有值 = 議定價。
   * 這兩件事在 API 上是 null 與數字的差別，不能把「留空」送成 0 —— 那是「這個學生免費」。
   */
  it('議定金額留空時送 null，不是 0', () => {
    internals().form.set({
      billingMode: 'monthly',
      feeTemplateId: 'ft-1',
      agreedAmount: null,
      adjustmentNote: '',
    });

    internals().save();

    expect(enrollments.update).toHaveBeenCalledWith(
      'en-1',
      expect.objectContaining({ agreedAmount: null }),
    );
  });

  it('議定金額有值時原樣送出', () => {
    internals().form.set({
      billingMode: 'monthly',
      feeTemplateId: 'ft-1',
      agreedAmount: 4000,
      adjustmentNote: '老生續讀',
    });

    internals().save();

    expect(enrollments.update).toHaveBeenCalledWith(
      'en-1',
      expect.objectContaining({ agreedAmount: 4000, adjustmentNote: '老生續讀' }),
    );
  });

  it('改了金額卻沒填原因會擋下來 —— 規則 2 要求調整要留原因', () => {
    internals().form.set({
      billingMode: 'monthly',
      feeTemplateId: 'ft-1',
      agreedAmount: 4000,
      adjustmentNote: '   ',
    });

    internals().save();

    expect(enrollments.update).not.toHaveBeenCalled();
  });

  it('金額等於定價時不算調整，不需要原因', () => {
    internals().form.set({
      billingMode: 'monthly',
      feeTemplateId: 'ft-1',
      agreedAmount: 4500,
      adjustmentNote: '',
    });

    internals().save();

    expect(enrollments.update).toHaveBeenCalled();
  });

  it('選了價目表就把定價當參考顯示出來', () => {
    internals().form.set({
      billingMode: 'monthly',
      feeTemplateId: 'ft-1',
      agreedAmount: null,
      adjustmentNote: '',
    });

    expect(internals().pricingHint()).toContain('4,500');
  });
});
