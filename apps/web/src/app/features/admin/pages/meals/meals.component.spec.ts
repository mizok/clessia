import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { MealsService, type MealBatchRow, type MealRosterRow } from '@core/meals.service';
import { BillingRunsService } from '@core/billing-runs.service';

import { MealsComponent } from './meals.component';

const row = (overrides?: Partial<MealRosterRow>): MealRosterRow => ({
  studentId: 's1',
  studentName: '陳小明',
  mealDefault: true,
  recordId: null,
  ordered: null,
  chargeable: null,
  unitPrice: null,
  settled: false,
  ...overrides,
});

const roster = (rows: MealRosterRow[], defaultUnitPrice = 60) => ({
  data: rows,
  defaultUnitPrice,
});

describe('MealsComponent', () => {
  let component: MealsComponent;
  let fixture: ComponentFixture<MealsComponent>;

  const meals = {
    roster: vi.fn((_date?: string) => of(roster([]))),
    batch: vi.fn((_date?: string, _rows?: MealBatchRow[]) =>
      of({ updated: 0, lockedStudentIds: [] as string[] }),
    ),
  };
  const billingRuns = { run: vi.fn() };

  beforeEach(async () => {
    meals.roster.mockReset().mockReturnValue(of(roster([])));
    meals.batch.mockReset().mockReturnValue(of({ updated: 0, lockedStudentIds: [] }));

    await TestBed.configureTestingModule({
      imports: [MealsComponent],
      providers: [
        { provide: MealsService, useValue: meals },
        { provide: BillingRunsService, useValue: billingRuns },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MealsComponent);
    fixture.componentRef.setInput('page', { label: '餐費管理' });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('進頁就取今天的名單', () => {
    expect(meals.roster).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('換日期會重新取名單', () => {
    meals.roster.mockClear();

    component['onDateChange'](new Date('2026-08-20T00:00:00'));

    expect(meals.roster).toHaveBeenCalledWith('2026-08-20');
  });

  it('清掉日期時不查 —— 沒有日期就沒有名單', () => {
    meals.roster.mockClear();

    component['onDateChange'](null);

    expect(meals.roster).not.toHaveBeenCalled();
  });

  describe('候選名單的預設值', () => {
    it('沒有記錄時照學生的 opt-in 預設勾選', async () => {
      meals.roster.mockReturnValue(
        of(
          roster([
            row({ studentId: 's1', mealDefault: true }),
            row({ studentId: 's2', mealDefault: false }),
          ]),
        ),
      );
      component['load']();
      await fixture.whenStable();

      expect(component['rows']()[0].ordered).toBe(true);
      expect(component['rows']()[1].ordered).toBe(false);
    });

    it('單價帶 org 的預設值', async () => {
      meals.roster.mockReturnValue(of(roster([row()], 75)));
      component['load']();
      await fixture.whenStable();

      expect(component['rows']()[0].unitPrice).toBe(75);
    });
  });

  describe('確認名單', () => {
    beforeEach(async () => {
      meals.roster.mockReturnValue(
        of(roster([row({ studentId: 's1' }), row({ studentId: 's2', mealDefault: false })])),
      );
      component['load']();
      await fixture.whenStable();
    });

    it('送出訂了的與沒訂的，沒訂的不是略過', () => {
      component['save']();

      const rows = meals.batch.mock.calls[0][1]!;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.ordered)).toEqual([true, false]);
    });

    it('寫入後重新取數，不自己猜 settled 與 recordId', async () => {
      meals.roster.mockClear();

      component['save']();
      await fixture.whenStable();

      expect(meals.roster).toHaveBeenCalled();
    });

    it('寫入失敗不會卡在 saving', async () => {
      meals.batch.mockReturnValue(throwError(() => new Error('boom')));

      component['save']();
      await fixture.whenStable();

      expect(component['saving']()).toBe(false);
    });
  });

  // 已結算的後端會擋並回 lockedStudentIds —— 前端不送，也要把擋下來的講出來
  describe('已結算的鎖', () => {
    beforeEach(async () => {
      meals.roster.mockReturnValue(
        of(
          roster([
            row({ studentId: 's1' }),
            row({ studentId: 's2', recordId: 'r2', ordered: true, settled: true }),
          ]),
        ),
      );
      component['load']();
      await fixture.whenStable();
    });

    it('已結算的不送出', () => {
      component['save']();

      const rows = meals.batch.mock.calls[0][1]!;
      expect(rows.map((r) => r.studentId)).toEqual(['s1']);
    });

    it('數得出這天有幾筆鎖住', () => {
      expect(component['settledCount']()).toBe(1);
    });

    it('全部勾選時跳過已結算的', () => {
      component['setAllOrdered'](false);

      const settled = component['rows']().find((r) => r.studentId === 's2');
      expect(settled?.ordered).toBe(true);
    });
  });

  // 靜靜截斷會讓後面的學生沒有記錄而且沒有徵兆
  it('超過後端一次的上限就擋住不送', async () => {
    const many = Array.from({ length: 301 }, (_, i) => row({ studentId: `s${i}` }));
    meals.roster.mockReturnValue(of(roster(many)));
    component['load']();
    await fixture.whenStable();
    meals.batch.mockClear();

    expect(component['overBatchLimit']()).toBe(true);

    component['save']();

    expect(meals.batch).not.toHaveBeenCalled();
  });

  it('取數失敗時顯示失敗狀態而不是空名單', async () => {
    meals.roster.mockReturnValue(throwError(() => new Error('boom')));
    component['load']();
    await fixture.whenStable();

    expect(component['failed']()).toBe(true);
    expect(component['loading']()).toBe(false);
  });

  describe('合計', () => {
    it('訂了但不收費的算份數不算金額', async () => {
      meals.roster.mockReturnValue(
        of(
          roster([
            row({
              studentId: 's1',
              recordId: 'r1',
              ordered: true,
              chargeable: true,
              unitPrice: 60,
            }),
            row({
              studentId: 's2',
              recordId: 'r2',
              ordered: true,
              chargeable: false,
              unitPrice: 60,
            }),
          ]),
        ),
      );
      component['load']();
      await fixture.whenStable();

      expect(component['totals']()).toEqual({ ordered: 2, chargeable: 1, amount: 60 });
    });
  });
});
