import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import type { FeeTemplate } from '@core/fee-templates.service';
import type { ProrationPreview } from '@core/enrollments.service';

import { emptyBillingDraft, type BillingDraft } from '../enrollment-billing.util';
import { EnrollmentBillingFieldsComponent } from './enrollment-billing-fields.component';

const template = (overrides: Partial<FeeTemplate> = {}): FeeTemplate =>
  ({
    id: 'ft-1',
    name: '國中月繳',
    billingMode: 'monthly',
    amount: 4500,
    isActive: true,
    ...overrides,
  }) as FeeTemplate;

const preview = (overrides: Partial<ProrationPreview> = {}): ProrationPreview => ({
  fullAmount: 4500,
  amount: 2250,
  note: '期間 30 天，實際 15 天（15/30），比例試算，可調整',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  ...overrides,
});

describe('EnrollmentBillingFieldsComponent', () => {
  let fixture: ComponentFixture<EnrollmentBillingFieldsComponent>;

  async function setup(
    draft: Partial<BillingDraft> = {},
    proration: ProrationPreview | null = null,
  ) {
    await TestBed.configureTestingModule({
      imports: [EnrollmentBillingFieldsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EnrollmentBillingFieldsComponent);
    fixture.componentRef.setInput('draft', { ...emptyBillingDraft(), ...draft });
    fixture.componentRef.setInput('templates', [template()]);
    fixture.componentRef.setInput('proration', proration);
    fixture.detectChanges();
    return fixture;
  }

  it('照定價時不問調整原因 —— 沒改就不要打擾', async () => {
    await setup({ feeTemplateId: 'ft-1', agreedAmount: 4500 });

    expect(fixture.nativeElement.textContent).not.toContain('調整原因');
  });

  it('議價時要求填原因', async () => {
    await setup({ feeTemplateId: 'ft-1', agreedAmount: 3800 });

    expect(fixture.nativeElement.textContent).toContain('調整原因');
  });

  it('定價當參考值顯示在標籤旁，行政要知道自己議的價偏離多少', async () => {
    await setup({ feeTemplateId: 'ft-1' });

    expect(fixture.nativeElement.textContent).toContain('定價 $4,500');
  });

  describe('期中插班的試算', () => {
    // 只給一個數字沒有人敢改它 —— 那句 note 是行政決定動不動數字的依據
    it('金額旁邊照原樣顯示算式的說明', async () => {
      await setup({ feeTemplateId: 'ft-1' }, preview());

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('2,250');
      expect(text).toContain('期間 30 天，實際 15 天（15/30）');
    });

    it('沒有試算時整塊不出現', async () => {
      await setup({ feeTemplateId: 'ft-1' }, null);

      expect(fixture.nativeElement.textContent).not.toContain('本期試算');
    });

    it('按套用會通知外面 —— 這個元件不自己改 draft', async () => {
      await setup({ feeTemplateId: 'ft-1' }, preview());
      const spy = vi.fn();
      fixture.componentInstance.prorationApplied.subscribe(spy);

      fixture.nativeElement.querySelector('p-button button').click();

      expect(spy).toHaveBeenCalled();
    });

    it('金額已經等於試算值時套用鈕是關的', async () => {
      await setup({ feeTemplateId: 'ft-1', agreedAmount: 2250 }, preview());

      expect(fixture.nativeElement.querySelector('p-button button').disabled).toBe(true);
    });
  });

  it('改一個欄位時吐出完整的 draft，不是只吐那一格', async () => {
    await setup({ feeTemplateId: 'ft-1', adjustmentNote: '舊生' });
    const spy = vi.fn();
    fixture.componentInstance.draftChange.subscribe(spy);

    fixture.componentInstance['update']('agreedAmount', 3800);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        agreedAmount: 3800,
        feeTemplateId: 'ft-1',
        adjustmentNote: '舊生',
      }),
    );
  });
});
