import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BillingPeriodsService } from '@core/billing-periods.service';
import { BillingRunsService } from '@core/billing-runs.service';

import {
  BillingRunDialogComponent,
  type BillingRunDialogData,
} from './billing-run-dialog.component';

/**
 * 開單 dialog（#1293）：原本只送 `periodMonth`（月結），後端的期 run（`billingPeriodId`）在 UI 上點不到。
 */
describe('BillingRunDialogComponent', () => {
  const result = {
    invoicesCreated: 3,
    tuitionItems: 3,
    mealItems: 0,
    mealRecordsSettled: 0,
    anomalies: [],
  };
  const run = vi.fn();

  async function create(data?: BillingRunDialogData) {
    run.mockReset().mockReturnValue(of(result));
    await TestBed.configureTestingModule({
      imports: [BillingRunDialogComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: BillingRunsService, useValue: { run } },
        {
          provide: BillingPeriodsService,
          useValue: {
            list: () =>
              of({
                data: [
                  {
                    id: 'p-1',
                    name: '2027 上學期',
                    startDate: '2027-02-01',
                    endDate: '2027-07-31',
                  },
                ],
              }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BillingRunDialogComponent);
    await fixture.whenStable();
    return fixture.componentInstance as unknown as {
      run: () => void;
      mode: () => 'month' | 'period';
      periodId: string | null;
    };
  }

  it('從待開單卡片帶 { mode: period, periodId } 進來 → 送期 run（billingPeriodId）', async () => {
    const dialog = await create({ mode: 'period', periodId: 'p-1' });
    expect(dialog.mode()).toBe('period');
    dialog.run();
    expect(run).toHaveBeenCalledWith({ billingPeriodId: 'p-1' });
  });

  it('預設照舊是月結（periodMonth）', async () => {
    const dialog = await create();
    expect(dialog.mode()).toBe('month');
    dialog.run();
    expect(run).toHaveBeenCalledWith({ periodMonth: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });

  it('期繳模式沒選期 → 不送', async () => {
    const dialog = await create({ mode: 'period' });
    dialog.run();
    expect(run).not.toHaveBeenCalled();
  });
});
