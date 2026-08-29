import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';
import { BillingPeriodsService, type BillingPeriod } from '@core/billing-periods.service';

import { FeeTemplatesComponent } from './fee-templates.component';

const template = (overrides?: Partial<FeeTemplate>): FeeTemplate => ({
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

const period = (overrides?: Partial<BillingPeriod>): BillingPeriod => ({
  id: 'bp-1',
  orgId: 'org-1',
  name: '2026 上學期 + 暑假',
  startDate: '2026-02-01',
  endDate: '2026-08-31',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('FeeTemplatesComponent', () => {
  let component: FeeTemplatesComponent;
  let fixture: ComponentFixture<FeeTemplatesComponent>;

  const feeTemplates = {
    list: vi.fn(() => of({ data: [] as FeeTemplate[] })),
    create: vi.fn(),
    update: vi.fn(() => of({ data: template() })),
    delete: vi.fn(() => of({ success: true })),
  };
  const billingPeriods = {
    list: vi.fn(() => of({ data: [] as BillingPeriod[] })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(() => of({ success: true })),
  };

  beforeEach(async () => {
    feeTemplates.list.mockReset().mockReturnValue(of({ data: [] }));
    feeTemplates.delete.mockReset().mockReturnValue(of({ success: true }));
    feeTemplates.update.mockReset().mockReturnValue(of({ data: template() }));
    billingPeriods.list.mockReset().mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [FeeTemplatesComponent],
      providers: [
        { provide: FeeTemplatesService, useValue: feeTemplates },
        { provide: BillingPeriodsService, useValue: billingPeriods },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeeTemplatesComponent);
    fixture.componentRef.setInput('page', { label: '費用方案管理' });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  type Internals = {
    templates: { set: (v: FeeTemplate[]) => void; (): FeeTemplate[] };
    periods: { set: (v: BillingPeriod[]) => void; (): BillingPeriod[] };
    loading: { set: (v: boolean) => void };
    deleteTemplate: (t: FeeTemplate) => void;
  };
  const internals = () => component as unknown as Internals;

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('兩個區塊各自取數 —— 價目表與收費期間都會載入', () => {
    expect(feeTemplates.list).toHaveBeenCalled();
    expect(billingPeriods.list).toHaveBeenCalled();
  });

  /**
   * FK 是 RESTRICT：被報名引用過的價目表刪不掉，後端回 409 `IN_USE`。
   * 樂觀更新在這裡是錯的 —— 那一列必須留著，因為它其實還在資料庫裡。
   */
  it('刪除被引用的價目表失敗時，那一列不會從畫面上消失', () => {
    const existing = template();
    internals().templates.set([existing]);
    feeTemplates.delete.mockReturnValue(
      throwError(() => ({
        error: { error: '這份價目表已被報名引用，請改為停用', code: 'IN_USE' },
      })),
    );

    internals().deleteTemplate(existing);

    expect(internals().templates()).toEqual([existing]);
  });

  it('刪除成功會重新取數，不是自己從陣列裡挑掉', () => {
    const existing = template();
    internals().templates.set([existing]);
    feeTemplates.list.mockClear();

    internals().deleteTemplate(existing);

    expect(feeTemplates.list).toHaveBeenCalled();
  });

  it('收費期間依起始日新到舊排序 —— 後端已排好，前端不重排', () => {
    const older = period({ id: 'bp-2', startDate: '2025-02-01' });
    const newer = period({ id: 'bp-1', startDate: '2026-02-01' });
    internals().periods.set([newer, older]);

    expect(
      internals()
        .periods()
        .map((p) => p.id),
    ).toEqual(['bp-1', 'bp-2']);
  });
});
