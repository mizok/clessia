import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ConfirmationService, MessageService } from 'primeng/api';

import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';
import {
  SessionPacksService,
  type SessionPack,
  type SessionPackListResponse,
} from '@core/session-packs.service';
import { OverlayContainerService } from '@core/overlay-container.service';

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

const emptyPackResponse: SessionPackListResponse = {
  data: [],
  summary: { purchased: 0, deducted: 0, remaining: 0, leaveDeductsSession: false },
};

describe('EnrollmentBillingDialogComponent', () => {
  let component: EnrollmentBillingDialogComponent;
  let fixture: ComponentFixture<EnrollmentBillingDialogComponent>;

  const enrollments = { update: vi.fn(() => of({ data: enrollment() })) };
  const feeTemplates = { list: vi.fn(() => of({ data: [feeTemplate()] })) };
  const sessionPacks = {
    list: vi.fn(() => of(emptyPackResponse)),
    delete: vi.fn(() => of({ success: true })),
  };
  const dialogRef = { close: vi.fn() };
  const dialogService = { open: vi.fn() };
  const overlayContainerService = { getContainer: vi.fn(() => null) };

  async function setup(
    data: Enrollment,
    packResponse: SessionPackListResponse = emptyPackResponse,
  ) {
    TestBed.resetTestingModule();
    enrollments.update.mockReset().mockReturnValue(of({ data }));
    feeTemplates.list.mockReset().mockReturnValue(of({ data: [feeTemplate()] }));
    sessionPacks.list.mockReset().mockReturnValue(of(packResponse));
    sessionPacks.delete.mockReset().mockReturnValue(of({ success: true }));
    dialogRef.close.mockReset();
    dialogService.open.mockReset();

    await TestBed.configureTestingModule({
      imports: [EnrollmentBillingDialogComponent],
      providers: [
        { provide: EnrollmentsService, useValue: enrollments },
        { provide: FeeTemplatesService, useValue: feeTemplates },
        { provide: SessionPacksService, useValue: sessionPacks },
        { provide: DialogService, useValue: dialogService },
        { provide: OverlayContainerService, useValue: overlayContainerService },
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: DynamicDialogConfig, useValue: { data: { enrollment: data } } },
        MessageService,
        ConfirmationService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EnrollmentBillingDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  type Internals = {
    form: { set: (v: Record<string, unknown>) => void; (): Record<string, unknown> };
    save: () => void;
    pricingHint: () => string | null;
    isSessionPackMode: () => boolean;
    packs: () => SessionPack[];
    packSummary: () => unknown;
    openBuyPackDialog: () => void;
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

  describe('堂數包區塊', () => {
    it('一進 dialog 就打 API 查堂數帳，不等切到堂數制才載入', () => {
      expect(sessionPacks.list).toHaveBeenCalledWith('en-1');
    });

    it('不是堂數制時不顯示堂數帳區塊', () => {
      internals().form.set({
        billingMode: 'monthly',
        feeTemplateId: null,
        agreedAmount: null,
        adjustmentNote: '',
      });
      fixture.detectChanges();

      expect(internals().isSessionPackMode()).toBe(false);
      expect(fixture.nativeElement.querySelector('.enrollment-billing__session-pack')).toBeNull();
    });

    it('剩餘 ≤ 0 時顯示追補買警示', async () => {
      await setup(enrollment({ billingMode: 'session_pack' }), {
        data: [],
        summary: { purchased: 10, deducted: 12, remaining: -2, leaveDeductsSession: false },
      });

      expect(internals().isSessionPackMode()).toBe(true);
      const notice = fixture.nativeElement.querySelector('app-inline-notice');
      expect(notice).not.toBeNull();
    });

    it('剩餘 > 0 時只顯示文字，不顯示警示', async () => {
      await setup(enrollment({ billingMode: 'session_pack' }), {
        data: [],
        summary: { purchased: 10, deducted: 3, remaining: 7, leaveDeductsSession: false },
      });

      expect(fixture.nativeElement.querySelector('app-inline-notice')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('剩餘');
      expect(fixture.nativeElement.textContent).toContain('7');
    });

    it('點「記錄一次購買」帶正確的 enrollmentId 開 dialog，關閉後重新載入堂數帳', () => {
      const onClose = of({
        id: 'sp-2',
        enrollmentId: 'en-1',
        purchasedCount: 5,
        purchasedAt: '2026-09-05',
        expiresAt: null,
        invoiceItemId: null,
        note: null,
        createdAt: '2026-09-05T00:00:00.000Z',
      } as SessionPack);
      dialogService.open.mockReturnValue({ onClose });
      sessionPacks.list.mockClear();

      internals().openBuyPackDialog();

      expect(dialogService.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({ enrollmentId: 'en-1', studentName: '王小明' }),
        }),
      );
      expect(sessionPacks.list).toHaveBeenCalledWith('en-1');
    });

    it('確認刪除後才真的呼叫 delete API', () => {
      const pack: SessionPack = {
        id: 'sp-1',
        enrollmentId: 'en-1',
        purchasedCount: 10,
        purchasedAt: '2026-09-01',
        expiresAt: null,
        invoiceItemId: null,
        note: null,
        createdAt: '2026-09-01T00:00:00.000Z',
      };

      (component as unknown as { confirmDeletePack: (p: SessionPack) => void }).confirmDeletePack(
        pack,
      );

      // ConfirmationService 的預設對話框需要使用者互動才會 accept，
      // 這裡只驗證「還沒確認前不會呼叫 delete」——確認流程本身是 PrimeNG 元件的責任
      expect(sessionPacks.delete).not.toHaveBeenCalled();
    });
  });
});
