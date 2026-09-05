import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { MealsService, type MealBatchRow, type MealRosterRow } from '@core/meals.service';
import { BillingRunsService } from '@core/billing-runs.service';

import { MealsComponent } from './meals.component';
import { rosterToDraft } from './meals.util';

const row = (overrides?: Partial<MealRosterRow>): MealRosterRow => ({
  studentId: 's1',
  studentName: '陳小明',
  classNames: ['三年級數學'],
  mealDate: '2026-08-30',
  mealDefault: true,
  note: null,
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
  meta: {
    total: rows.length,
    chargeableCount: 0,
    totalAmount: 0,
    settledCount: 0,
    page: 1,
    pageSize: 100,
  },
});

describe('MealsComponent', () => {
  let component: MealsComponent;
  let fixture: ComponentFixture<MealsComponent>;

  const meals = {
    roster: vi.fn((_date?: string) => of(roster([]))),
    range: vi.fn((_params?: unknown) => of(roster([]))),
    batch: vi.fn((_date?: string, _rows?: MealBatchRow[]) =>
      of({ updated: 0, lockedStudentIds: [] as string[] }),
    ),
  };
  const billingRuns = { run: vi.fn() };

  beforeEach(async () => {
    meals.roster.mockReset().mockReturnValue(of(roster([])));
    meals.batch.mockReset().mockReturnValue(of({ updated: 0, lockedStudentIds: [] }));
    meals.range.mockReset().mockReturnValue(of(roster([])));

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

    /**
     * P0-1（Tester 抓到）：確認名單 100% 失敗，toast 顯示 `[object Object]`。
     * 後端某些錯誤的 `error` 欄位不是字串（例如驗證錯誤是物件），直接塞進
     * toast 的 detail 會被轉成 "[object Object]"，比沒有訊息更誤導。
     */
    it('後端回的 error 不是字串時，不顯示 [object Object]', async () => {
      meals.batch.mockReturnValue(
        throwError(() => ({ error: { error: { issues: ['unitPrice required'] } } })),
      );
      const addSpy = vi.spyOn(component['messageService'], 'add');

      component['save']();
      await fixture.whenStable();

      const call = addSpy.mock.calls.find((c) => c[0].severity === 'error');
      expect(call?.[0].detail).not.toContain('[object Object]');
      expect(typeof call?.[0].detail).toBe('string');
    });

    // 失敗訊息不能幾秒後自己消失——使用者要有時間看到、決定要不要重試
    it('失敗訊息不會自動消失', async () => {
      meals.batch.mockReturnValue(throwError(() => ({ error: { error: '寫入失敗' } })));
      const addSpy = vi.spyOn(component['messageService'], 'add');

      component['save']();
      await fixture.whenStable();

      const call = addSpy.mock.calls.find((c) => c[0].severity === 'error');
      expect(call?.[0].sticky).toBe(true);
    });

    /**
     * P1-7（Tester 抓到）：黏在底部的確認鈕跟表格同一片白，行政會把它讀成
     * 「表格的最後一列」，以為看到按鈕就是名單到底，漏勾沒捲到的學生直接訂錯份數。
     * 明寫總數是第二層防線——就算視覺分不開，文字也要講出邊界在哪。
     */
    it('確認鈕旁明寫名單總數，不能只靠視覺分開表格跟動作列', () => {
      fixture.detectChanges();

      const count = fixture.nativeElement.querySelector('.meals__actions-count');
      expect(count?.textContent?.trim()).toBe('共 2 位');
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

  // 靜靜截斷會讓後面的學生沒有記錄而且沒有徵兆。
  // **不經過 fixture.whenStable()**：渲染 301 列的 PrimeNG 輸入元件會爆堆疊，
  // 而這裡要驗的是擋不擋得住，不是畫得出來。
  it('超過後端一次的上限就擋住不送', () => {
    const many = Array.from({ length: 301 }, (_, i) =>
      row({ studentId: `s${i}`, studentName: `學生${i}` }),
    );
    component['rows'].set(rosterToDraft(many, 60));
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

  describe('區間查詢', () => {
    it('預設是當日模式，走 roster 不走 range', () => {
      expect(meals.roster).toHaveBeenCalled();
      expect(meals.range).not.toHaveBeenCalled();
    });

    it('切到區間模式改打 range', () => {
      meals.roster.mockClear();

      component['switchMode']('range');

      expect(meals.range).toHaveBeenCalled();
      expect(meals.roster).not.toHaveBeenCalled();
    });

    // 不帶區間後端會回 400
    it('切到區間時自動給一個預設區間', () => {
      component['switchMode']('range');

      const params = meals.range.mock.calls[0][0] as { dateFrom: string; dateTo: string };
      expect(params.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('切回當日模式改打 roster', () => {
      component['switchMode']('range');
      meals.range.mockClear();

      component['switchMode']('day');

      expect(meals.roster).toHaveBeenCalled();
      expect(meals.range).not.toHaveBeenCalled();
    });

    it('同一個模式再切一次不重打', () => {
      meals.roster.mockClear();

      component['switchMode']('day');

      expect(meals.roster).not.toHaveBeenCalled();
    });

    // range 模式選第一個日期時 end 還是 null
    it('區間只選了一半時不查', () => {
      component['switchMode']('range');
      meals.range.mockClear();

      component['onRangeChange']([new Date('2026-08-01T00:00:00'), null as unknown as Date]);

      expect(meals.range).not.toHaveBeenCalled();
    });

    // 區間的數字要取後端的 meta —— 前端手上只有當頁
    it('分頁總數取後端的 meta.total 不是當頁長度', async () => {
      meals.range.mockReturnValue(
        of({
          data: [row({ recordId: 'r1', ordered: true })],
          defaultUnitPrice: 60,
          meta: {
            total: 412,
            chargeableCount: 380,
            totalAmount: 22800,
            settledCount: 300,
            page: 1,
            pageSize: 50,
          },
        }),
      );
      component['switchMode']('range');
      await fixture.whenStable();

      expect(component['pagination']().totalRecords).toBe(412);
      expect(component['summary']()?.totalAmount).toBe(22800);
    });

    it('取數失敗時把統計清掉，不留上一次的數字', async () => {
      meals.range.mockReturnValue(throwError(() => new Error('boom')));
      component['switchMode']('range');
      await fixture.whenStable();

      expect(component['summary']()).toBeNull();
      expect(component['failed']()).toBe(true);
    });
  });

  describe('備註', () => {
    it('沒有備註時是空字串，不是字面上的 null', async () => {
      meals.roster.mockReturnValue(
        of(roster([row({ recordId: 'r1', ordered: true, note: null })])),
      );
      component['load']();
      await fixture.whenStable();

      expect(component['rows']()[0].note).toBe('');
    });

    it('備註跟著送出', async () => {
      meals.roster.mockReturnValue(
        of(roster([row({ recordId: 'r1', ordered: true, note: '素食' })])),
      );
      component['load']();
      await fixture.whenStable();

      component['save']();

      expect(meals.batch.mock.calls[0][1]![0].note).toBe('素食');
    });
  });
});
