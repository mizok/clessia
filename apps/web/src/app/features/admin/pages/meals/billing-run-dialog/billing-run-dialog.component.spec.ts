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
    failedStudents: [] as Array<{ studentId: string; studentName: string | null; code: string }>,
  };
  const run = vi.fn();
  let fixture: { nativeElement: HTMLElement; detectChanges: () => void };

  async function create(data?: BillingRunDialogData, res: typeof result = result) {
    run.mockReset().mockReturnValue(of(res));
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
    const created = TestBed.createComponent(BillingRunDialogComponent);
    fixture = created;
    await created.whenStable();
    return created.componentInstance as unknown as {
      run: () => void;
      retry: () => void;
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

  describe('有學生沒開成（#1943）', () => {
    const partial = {
      ...result,
      invoicesCreated: 2,
      failedStudents: [
        { studentId: 's-1', studentName: '王小明', code: 'WRITE_FAILED' },
        { studentId: 's-2', studentName: null, code: 'WRITE_FAILED' },
      ],
    };

    it('結果頁明顯列出沒開成的學生、原因與「再按一次會補開」', async () => {
      const dialog = await create(undefined, partial);
      dialog.run();
      fixture.detectChanges();
      const alert = fixture.nativeElement.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('2 位學生這次沒開成帳單');
      expect(alert?.textContent).toContain('王小明');
      expect(alert?.textContent).toContain('讀不到姓名');
      expect(alert?.textContent).toContain('寫入失敗');
      expect(alert?.textContent).toContain('再按一次月結會補開');
    });

    it('「再跑一次」用同一組設定重送', async () => {
      const dialog = await create(undefined, partial);
      dialog.run();
      dialog.retry();
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1]).toEqual(run.mock.calls[0]);
    });

    it('全部開成 → 不出現沒開成的區塊', async () => {
      const dialog = await create();
      dialog.run();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    });
  });
});
