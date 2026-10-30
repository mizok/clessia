import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { DialogService } from 'primeng/dynamicdialog';

import { OverlayContainerService } from '@core/overlay-container.service';
import { SystemClockService, taipeiDateString } from '@core/system-clock.service';
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
  const today = signal('2026-10-14');
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
    today.set('2026-10-14');

    await TestBed.configureTestingModule({
      imports: [MealsComponent],
      providers: [
        MessageService,
        provideRouter([]),
        { provide: MealsService, useValue: meals },
        { provide: BillingRunsService, useValue: billingRuns },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        { provide: SystemClockService, useValue: { todayTaipei: today } },
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
    expect(meals.roster).toHaveBeenCalledWith('2026-10-14');
  });

  it('換日期會重新取名單', () => {
    meals.roster.mockClear();

    component['onDateChange']('2026-08-20');

    expect(meals.roster).toHaveBeenCalledWith('2026-08-20');
  });

  it('清掉日期時不查 —— 沒有日期就沒有名單', () => {
    meals.roster.mockClear();

    component['onDateChange']('');

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
      expect(count?.textContent).toContain('共 2 位');
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

  describe('#1314 ME2/ME3 分章與已結算連帳單', () => {
    it('當日名單依班分章，章頭寫班名與位數', async () => {
      meals.roster.mockReturnValue(
        of(
          roster([
            row({ studentId: 's1', classNames: ['數學'] }),
            row({ studentId: 's2', classNames: ['數學'] }),
            row({ studentId: 's3', classNames: ['英文'] }),
          ]),
        ),
      );
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();

      const sections = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('section[data-chapter]'),
      );
      expect(sections.map((s) => s.getAttribute('aria-label')).sort()).toEqual(['數學', '英文']);
      // 章頭「訂 N／M」：兩位都預設勾起 → 訂 2／2
      expect(
        sections
          .find((s) => s.getAttribute('aria-label') === '數學')
          ?.querySelector('[data-testid="chapter-head"]')
          ?.textContent?.replace(/\s+/g, ''),
      ).toBe('數學訂2／2');
    });

    it('已結算的列有連到帳單頁的連結', async () => {
      meals.roster.mockReturnValue(
        of(roster([row({ studentId: 's2', recordId: 'r2', ordered: true, settled: true })])),
      );
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();

      const link = (fixture.nativeElement as HTMLElement).querySelector(
        'a[href="/admin/payments"]',
      );
      expect(link?.textContent).toContain('要改走帳單');
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

  describe('M1 頭部（A6）：色面句、分頁連結、日期欄、摘要列', () => {
    const q = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) as HTMLElement;
    /** n 位：前 ordered 位訂了、其中 handled 位已有記錄（recordId）；其餘沒處理 */
    const load = async (rows: MealRosterRow[]) => {
      meals.roster.mockReturnValue(of(roster(rows)));
      component['load']();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const person = (id: string, over: Partial<MealRosterRow> = {}) =>
      row({ studentId: id, studentName: id, mealDate: '2026-10-14', ...over });
    const handled = (id: string, ordered: boolean) =>
      person(id, { recordId: `r-${id}`, ordered, chargeable: true, unitPrice: 65 });

    it('當日色面句兩段：今天 N 份便當／還有 M 位沒處理；<br> 一個', async () => {
      await load([
        person('a'), // 沒處理，預設訂
        handled('b', true),
        handled('c', false),
      ]);

      expect(component['headline']()).toEqual({
        first: '今天 2 份便當，',
        second: '還有 1 位沒處理。',
      });
      expect(fixture.nativeElement.querySelectorAll('app-page-open br')).toHaveLength(1);
    });

    it('沒處理 0／1／2 位（門檻 ±1）：0 位寫「全部處理完了」', async () => {
      await load([handled('a', true), handled('b', true)]);
      expect(component['headline']()!.second).toBe('全部處理完了。');
      await load([person('a'), handled('b', true)]);
      expect(component['headline']()!.second).toBe('還有 1 位沒處理。');
      await load([person('a'), person('b'), handled('c', true)]);
      expect(component['headline']()!.second).toBe('還有 2 位沒處理。');
    });

    describe('「未處理」點的色調（過去日期＝overdue、今天與之後＝pending）', () => {
      // fake today 刻意設成與真實日期不同的一天（遠在未來）—— 元件若改回 `new Date()`，
      // 真實今天 < 2027-03-04，「昨天」就會被判成 pending，這條才會紅
      const FAKE_TODAY = '2027-03-05';
      const toneOn = async (day: string) => {
        meals.roster.mockReturnValue(of(roster([person('a')]))); // recordId null＝未處理
        component['onDateChange'](day);
        await fixture.whenStable();
        fixture.detectChanges();
        return component['unhandledTone']();
      };

      it('昨天 → overdue；今天 → pending；明天 → pending（臨界 ±1 天）', async () => {
        today.set(FAKE_TODAY);
        expect(await toneOn('2027-03-04')).toBe('overdue');
        expect(await toneOn('2027-03-05')).toBe('pending');
        expect(await toneOn('2027-03-06')).toBe('pending');
      });

      it('畫面上的狀態字跟著變（A6 `.stt`：過期寫「未處理（過期）」）', async () => {
        today.set(FAKE_TODAY);
        const state = () =>
          (
            fixture.nativeElement.querySelector('[data-testid="meal-state"]') as HTMLElement
          ).textContent!.trim();
        await toneOn('2027-03-04');
        expect(state()).toBe('未處理（過期）');
        await toneOn('2027-03-05');
        expect(state()).toBe('未處理');
      });

      it('台北時鐘跨過午夜：同一天先是 pending、過了午夜變 overdue', async () => {
        today.set('2027-03-05');
        expect(await toneOn('2027-03-05')).toBe('pending');
        today.set('2027-03-06'); // 台北過午夜，3/5 成了過去
        expect(component['unhandledTone']()).toBe('overdue');
      });
    });

    it('章頭「訂 N／M」：分子是這班訂了幾位，不是總數（0／部分／全部）', async () => {
      await load([
        person('a', { classNames: ['數學'], recordId: 'r1', ordered: true }),
        person('b', { classNames: ['數學'], recordId: 'r2', ordered: false }),
        person('c', { classNames: ['英文'], recordId: 'r3', ordered: false }),
        person('d', { classNames: ['國文'], recordId: 'r4', ordered: true }),
        person('e', { classNames: ['國文'], recordId: 'r5', ordered: true }),
      ]);
      const heads = Object.fromEntries(
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('section[data-chapter]'),
        ).map((sec) => [
          sec.getAttribute('aria-label'),
          sec.querySelector('[data-testid="chapter-head"]')!.textContent!.replace(/\s+/g, ''),
        ]),
      );
      expect(heads).toEqual({
        數學: '數學訂1／2',
        英文: '英文訂0／1',
        國文: '國文訂2／2',
      });
    });

    it('不是今天就把「今天」換成 M/D；時鐘跨過午夜時跟著變', async () => {
      await load([person('a')]);
      expect(component['headline']()!.first).toBe('今天 1 份便當，');
      today.set('2026-10-15'); // 台北過了午夜，頁面上的 10/14 就不是今天了
      expect(component['headline']()!.first).toBe('10/14 1 份便當，');
      component['onDateChange']('2026-10-15');
      await fixture.whenStable();
      expect(component['headline']()!.first).toBe('今天 1 份便當，');
    });

    it('載入中、失敗、空名單：色面退回頁名，不宣稱數字', async () => {
      expect(component['headline']()).toBeNull(); // 預設空名單
      expect(fixture.nativeElement.querySelector('app-page-open')!.textContent).toContain(
        '餐費管理',
      );
      meals.roster.mockReturnValue(throwError(() => new Error('boom')));
      component['load']();
      await fixture.whenStable();
      expect(component['headline']()).toBeNull();
    });

    it('區間色面句：9/1–10/1／N 份便當，NT$ X。數字取後端 meta', async () => {
      meals.range.mockReturnValue(
        of({
          ...roster([person('a')]),
          meta: {
            total: 2473,
            chargeableCount: 2400,
            totalAmount: 148190,
            settledCount: 0,
            page: 1,
            pageSize: 50,
          },
        }),
      );
      component['switchMode']('range');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component['headline']()).toEqual({
        first: '10/1–10/14',
        second: '2473 份便當，NT$ 148,190。',
      });
    });

    it('分頁是文字連結：目前這個 aria-current＝page，點另一個切模式', async () => {
      await load([person('a')]);
      expect(q('mode-day').getAttribute('aria-current')).toBe('page');
      expect(q('mode-range').getAttribute('aria-current')).toBeNull();
      expect(q('mode-day').classList).toContain('border-zinc-900');
      expect(q('mode-range').classList).toContain('border-transparent');
      expect(fixture.nativeElement.querySelector('p-selectbutton')).toBeNull();

      q('mode-range').click();
      fixture.detectChanges();
      expect(meals.range).toHaveBeenCalled();
      expect(q('mode-range').getAttribute('aria-current')).toBe('page');
      expect(q('mode-day').getAttribute('aria-current')).toBeNull();
    });

    describe('名單日期（原生日期欄，台北日期字串）', () => {
      const input = () => q('meals-date') as HTMLInputElement;
      const change = (value: string) => {
        input().value = value;
        input().dispatchEvent(new Event('change'));
      };

      it('是 type=date、有「名單日期」標籤，預設值是台北的今天', () => {
        expect(input().type).toBe('date');
        expect(input().value).toBe('2026-10-14');
        expect(input().closest('label')!.textContent).toContain('名單日期');
        expect(fixture.nativeElement.querySelector('p-datepicker')).toBeNull();
      });

      it('改日期 → 用那個字串查（不經 Date，不會偏一天）', () => {
        meals.roster.mockClear();
        change('2026-09-30');
        expect(meals.roster).toHaveBeenCalledWith('2026-09-30');
        expect(meals.roster).toHaveBeenCalledTimes(1);
      });

      it('清空（或只打一半）→ 不查，欄位還原成目前日期', () => {
        meals.roster.mockClear();
        change('');
        expect(meals.roster).not.toHaveBeenCalled();
        expect(input().value).toBe('2026-10-14');
      });
    });

    it('預設日期取台北日界線：15:59Z 是當天、16:00Z 是隔天', async () => {
      // 替身用真正的台北日算法算「現在」，不靠固定字串 —— 這樣才測得到元件有沒有拿它當初值
      const taipei = (iso: string) => taipeiDateString(Date.parse(iso));
      for (const [now, expected] of [
        ['2026-10-14T15:59:00Z', '2026-10-14'],
        ['2026-10-14T16:00:00Z', '2026-10-15'],
      ] as const) {
        TestBed.resetTestingModule();
        meals.roster.mockReset().mockReturnValue(of(roster([])));
        await TestBed.configureTestingModule({
          imports: [MealsComponent],
          providers: [
            MessageService,
            provideRouter([]),
            { provide: MealsService, useValue: meals },
            { provide: BillingRunsService, useValue: billingRuns },
            { provide: OverlayContainerService, useValue: { getContainer: () => null } },
            { provide: SystemClockService, useValue: { todayTaipei: () => taipei(now) } },
          ],
        }).compileComponents();
        const f = TestBed.createComponent(MealsComponent);
        f.componentRef.setInput('page', { label: '餐費管理' });
        await f.whenStable();
        expect(meals.roster).toHaveBeenCalledWith(expected);
      }
    });

    it('摘要列：N 位候選／訂 N 份／要收費 NT$ X；已結算才多一段（A6 `p.sum`）', async () => {
      await load([
        handled('a', true),
        person('b', { recordId: 'r-b', ordered: true, chargeable: false, unitPrice: 65 }),
        handled('c', false),
      ]);
      const text = q('meals-summary').textContent!.replace(/\s+/g, ' ');
      expect(text).toContain('3 位候選');
      expect(text).toContain('訂 2 份');
      expect(text).toContain('要收費 NT$ 65');
      expect(text).not.toContain('（1 份）');
      expect(text).not.toContain('已結算');

      await load([
        handled('a', true),
        person('s', { recordId: 'r-s', ordered: true, settled: true }),
      ]);
      expect(q('meals-summary').textContent).toContain('（1 筆已結算，鎖住不能改）');
    });

    it('「全部訂／全部不訂」在摘要列，不在工具列；已結算的不動', async () => {
      await load([
        handled('a', true),
        handled('b', true),
        person('s', { recordId: 'r-s', ordered: true, settled: true }),
      ]);
      expect(q('bulk-all-on').closest('[data-testid="meals-summary"]')).not.toBeNull();
      q('bulk-all-off').click();
      fixture.detectChanges();
      expect(component['totals']().ordered).toBe(1); // 只剩已結算的那位
      q('bulk-all-on').click();
      fixture.detectChanges();
      expect(component['totals']().ordered).toBe(3);
    });

    it('「收不收費是人工判斷」說明在頂端（摘要下），不在底部確認列', async () => {
      await load([person('a')]);
      expect(q('meals-note').textContent).toContain('人工判斷');
      expect(q('meals-note').closest('[class*="sticky"]')).toBeNull();
      // 指名底部確認列：章頭（桌機 wide:sticky）也是 sticky
      const bar = fixture.nativeElement.querySelector('[aria-label="確認名單"]') as HTMLElement;
      expect(bar.className).toContain('sticky');
      expect(bar.textContent).not.toContain('人工判斷');
      expect(bar.textContent).toContain('共 1 位');
    });

    it('區間模式的摘要列不放批次鈕與說明', async () => {
      meals.range.mockReturnValue(of(roster([person('a')])));
      component['switchMode']('range');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(q('bulk-all-on')).toBeNull();
      expect(q('meals-note')).toBeNull();
      expect(q('meals-summary').textContent).toContain('筆');
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

  /**
   * #710：切到「區間查詢」而區間內沒有餐記錄時，空狀態講的是**當日模式**的字
   * （「這天沒有候選名單 / 候選名單來自當天有課的班級」）。
   *
   * **而摘要句包在 `rows().length > 0` 裡面，空清單時不印** ——
   * 於是整個畫面上**沒有任何東西說明剛才查的是哪一段期間**，
   * 使用者能得到的結論是「這天沒排課」，實際情況是「這段期間沒有人被登記過餐」。
   * **兩件事。**
   */
  describe('#710 區間查詢的空狀態', () => {
    /** 驅動畫面上真正的原生起訖欄（change 事件），不呼叫元件方法 */
    const setRange = (from: string, to: string) => {
      fixture.detectChanges();
      for (const [id, value] of [
        ['meals-from', from],
        ['meals-to', to],
      ]) {
        const input = fixture.nativeElement.querySelector(
          `[data-testid="${id}"]`,
        ) as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event('change'));
      }
    };
    const emptyStateText = () =>
      (fixture.nativeElement.querySelector('app-empty-state')?.textContent ?? '').replace(
        /\s+/g,
        ' ',
      );

    it('區間模式的空狀態不得講「這天」', async () => {
      component['switchMode']('range');
      setRange('2026-09-01', '2026-09-12');
      await fixture.whenStable();
      fixture.detectChanges();

      const text = emptyStateText();
      expect(text).not.toContain('這天');
      expect(text).not.toContain('候選名單');
    });

    it('空狀態要寫出實際查詢的區間 —— 那是畫面上唯一能說明「查了什麼」的地方', async () => {
      component['switchMode']('range');
      setRange('2026-09-01', '2026-09-12');
      await fixture.whenStable();
      fixture.detectChanges();

      const text = emptyStateText();
      expect(text).toContain('2026-09-01');
      expect(text).toContain('2026-09-12');
    });

    /**
     * **區間講的必須是「送出去的那一段」，不是「欄位現在顯示什麼」。**
     * 起日被清空（或只打一半）時不查、欄位還原，空狀態仍講上一次實際查的那一段。
     */
    it('起日被清空（還沒送出）時，不查、欄位還原，空狀態仍講上一次實際查的區間', async () => {
      component['switchMode']('range');
      setRange('2026-09-01', '2026-09-12');
      await fixture.whenStable();
      fixture.detectChanges();

      meals.range.mockClear();
      const from = fixture.nativeElement.querySelector(
        '[data-testid="meals-from"]',
      ) as HTMLInputElement;
      from.value = '';
      from.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(meals.range).not.toHaveBeenCalled();
      expect(from.value).toBe('2026-09-01');
      expect(component['queriedRange']()).toEqual({
        dateFrom: '2026-09-01',
        dateTo: '2026-09-12',
      });
      const text = emptyStateText();
      expect(text).toContain('2026-09-01');
      expect(text).toContain('2026-09-12');
    });

    /**
     * **反向對照**：當日模式的空狀態不能被改掉。
     * 它那兩句話是對的 —— 當日名單確實來自「當天有課的班級」。
     */
    it('當日模式的空狀態維持原樣', async () => {
      await fixture.whenStable();
      fixture.detectChanges();

      const text = emptyStateText();
      expect(text).toContain('這天沒有候選名單');
      expect(text).toContain('候選名單來自當天有課的班級');
    });
  });

  describe('M2 列版型（A6）：自訂列、有修改才出現的確認列、區間依日分章', () => {
    const q = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const all = (id: string) =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(`[data-testid="${id}"]`),
      ) as HTMLInputElement[];
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const loadDay = async (rows: MealRosterRow[]) => {
      meals.roster.mockReturnValue(of(roster(rows)));
      component['load']();
      await settle();
    };
    const person = (id: string, over: Partial<MealRosterRow> = {}) =>
      row({ studentId: id, studentName: id, mealDate: '2026-10-14', ...over });
    const handled = (id: string, over: Partial<MealRosterRow> = {}) =>
      person(id, { recordId: `r-${id}`, ordered: true, chargeable: true, unitPrice: 65, ...over });
    const fire = (el: HTMLInputElement, value: string) => {
      el.value = value;
      el.dispatchEvent(
        new Event(el.type === 'text' && el.inputMode === 'numeric' ? 'change' : 'input'),
      );
    };
    const lastBatch = () => meals.batch.mock.calls.at(-1)![1]!;

    describe('當日列', () => {
      it('一位學生一列，不再是 responsive-table', async () => {
        await loadDay([handled('a'), handled('b'), handled('c')]);
        expect(all('meal-row')).toHaveLength(3);
        expect(fixture.nativeElement.querySelector('app-responsive-table, table')).toBeNull();
      });

      it('勾選框 → 寫入 payload：訂餐／收費／單價／備註一個字不變', async () => {
        await loadDay([handled('a', { note: '素食' })]);
        component['save']();
        expect(lastBatch()).toEqual([
          { studentId: 'a', ordered: true, chargeable: true, unitPrice: 65, note: '素食' },
        ]);

        all('meal-ordered')[0].click();
        fixture.detectChanges();
        component['save']();
        expect(lastBatch()).toEqual([
          { studentId: 'a', ordered: false, chargeable: true, unitPrice: 65, note: '素食' },
        ]);
      });

      it('沒訂 → 單價與收費停用；訂了 → 啟用（連動）', async () => {
        await loadDay([handled('a', { ordered: false }), handled('b')]);
        expect(all('meal-price').map((i) => i.disabled)).toEqual([true, false]);
        expect(all('meal-chargeable').map((i) => i.disabled)).toEqual([true, false]);
        expect(all('meal-note').map((i) => i.disabled)).toEqual([false, false]);

        all('meal-ordered')[0].click();
        fixture.detectChanges();
        expect(all('meal-price')[0].disabled).toBe(false);
        expect(all('meal-chargeable')[0].disabled).toBe(false);
      });

      it('已結算整列鎖住（含備註、訂餐），並有連到帳單的連結', async () => {
        await loadDay([handled('a', { settled: true })]);
        for (const id of ['meal-ordered', 'meal-price', 'meal-chargeable', 'meal-note']) {
          expect(all(id)[0].disabled).toBe(true);
        }
        expect(q('meal-row').querySelector('a[href="/admin/payments"]')).not.toBeNull();
      });

      it('學生名是連到學生檔案的連結', async () => {
        await loadDay([handled('stu-9')]);
        expect(q('meal-row').querySelector('a[href="/admin/students/stu-9"]')).not.toBeNull();
      });

      it.each([
        ['70', 70],
        ['0', 0],
        ['1', 1],
        ['65元', 65],
      ])('單價輸入 %s → 送出 %s', async (typed, price) => {
        await loadDay([handled('a')]);
        fire(all('meal-price')[0], typed);
        fixture.detectChanges();
        component['save']();
        expect(lastBatch()[0].unitPrice).toBe(price);
      });

      it.each(['', '元', '  '])(
        '單價清空或沒有數字（%j）→ 還原成目前單價、不改資料',
        async (typed) => {
          await loadDay([handled('a')]);
          const input = all('meal-price')[0];
          fire(input, typed);
          expect(input.value).toBe('65');
          component['save']();
          expect(lastBatch()[0].unitPrice).toBe(65);
        },
      );

      it('備註跟著送出；清空送 null（不是空字串）', async () => {
        await loadDay([handled('a', { note: '素食' })]);
        fire(all('meal-note')[0], '');
        fixture.detectChanges();
        component['save']();
        expect(lastBatch()[0].note).toBeNull();
      });
    });

    describe('確認列：有改動或還有人沒處理才出現', () => {
      // 句子是 p 自己的字，小字（共 N 位…）在同一個 p 裡（A6 `.savebar p`）
      const lead = () => (q('save-bar-lead').firstChild as Text).textContent!.trim();

      it('全部處理過、沒動 → 不出現', async () => {
        await loadDay([handled('a'), handled('b')]);
        expect(q('save-bar')).toBeNull();
      });

      it.each([1, 2])('%s 位還沒處理 → 出現，寫「N 位還沒處理」（門檻 ±1）', async (n) => {
        await loadDay([handled('h'), ...Array.from({ length: n }, (_, i) => person(`u${i}`))]);
        expect(lead()).toBe(`${n} 位還沒處理`);
      });

      it('改 1 位 → 出現「改了 1 位」；改 2 位 → 「改了 2 位」', async () => {
        await loadDay([handled('a'), handled('b'), handled('c')]);
        all('meal-ordered')[0].click();
        fixture.detectChanges();
        expect(lead()).toBe('改了 1 位');
        all('meal-ordered')[1].click();
        fixture.detectChanges();
        expect(lead()).toBe('改了 2 位');
      });

      it('改了又改回原值 → 確認列收起來', async () => {
        await loadDay([handled('a')]);
        all('meal-ordered')[0].click();
        fixture.detectChanges();
        expect(q('save-bar')).not.toBeNull();
        all('meal-ordered')[0].click();
        fixture.detectChanges();
        expect(q('save-bar')).toBeNull();
      });

      it('同一列改了三個欄位也只算一位', async () => {
        await loadDay([handled('a')]);
        fire(all('meal-price')[0], '70');
        fire(all('meal-note')[0], '素食');
        all('meal-chargeable')[0].click();
        fixture.detectChanges();
        expect(lead()).toBe('改了 1 位');
      });

      it('改了 1 位、另有 2 位沒處理 → 寫「改了 1 位」（改動優先）', async () => {
        await loadDay([handled('a'), person('u1'), person('u2')]);
        all('meal-ordered')[0].click();
        fixture.detectChanges();
        expect(lead()).toBe('改了 1 位');
      });

      it('「全部不訂」造成的改動也算；已結算的不算', async () => {
        await loadDay([handled('a'), handled('b'), handled('s', { settled: true })]);
        q('bulk-all-off').click();
        fixture.detectChanges();
        expect(lead()).toBe('改了 2 位');
      });

      it('只有已結算的未處理列 → 不出現（鎖住的不用確認）', async () => {
        await loadDay([person('s', { settled: true, recordId: null })]);
        expect(q('save-bar')).toBeNull();
      });

      it('小字寫共幾位、訂幾份、要收費多少', async () => {
        await loadDay([handled('a'), handled('b', { chargeable: false }), person('u')]);
        const text = q('save-bar').textContent!.replace(/\s+/g, ' ');
        expect(text).toContain('共 3 位 · 訂 3 份 · 要收費 NT$ 125');
      });

      it('確認成功重載後，快照換成新資料 → 確認列收起來', async () => {
        await loadDay([handled('a')]);
        all('meal-ordered')[0].click();
        fixture.detectChanges();
        meals.batch.mockReturnValue(of({ updated: 1, lockedStudentIds: [] }));
        meals.roster.mockReturnValue(of(roster([handled('a', { ordered: false })])));
        component['save']();
        await settle();
        expect(q('save-bar')).toBeNull();
      });

      it('確認鈕在確認列裡，按下去走 save（payload 同舊版）', async () => {
        await loadDay([person('u')]);
        meals.batch.mockClear();
        (q('save-bar').querySelector('button') as HTMLButtonElement).click();
        expect(meals.batch).toHaveBeenCalledWith('2026-10-14', [
          { studentId: 'u', ordered: true, chargeable: true, unitPrice: 60, note: null },
        ]);
      });

      it('區間模式沒有確認列', async () => {
        await loadDay([person('u')]);
        meals.range.mockReturnValue(of(roster([])));
        component['switchMode']('range');
        await settle();
        expect(q('save-bar')).toBeNull();
      });
    });

    describe('區間查詢：原生起訖欄、依日分章的唯讀列', () => {
      const rangeRow = (id: string, date: string, over: Partial<MealRosterRow> = {}) =>
        handled(id, { mealDate: date, classNames: [], mealDefault: false, ...over });
      const rangeRes = (rows: MealRosterRow[], total = rows.length) => ({
        ...roster(rows),
        meta: { ...roster(rows).meta, total },
      });
      const goRange = async (rows: MealRosterRow[], total?: number) => {
        meals.range.mockReturnValue(of(rangeRes(rows, total)));
        component['switchMode']('range');
        await settle();
      };
      const setInput = (id: string, value: string) => {
        const input = q(id) as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event('change'));
        return input;
      };
      const lastRange = () => meals.range.mock.calls.at(-1)![0] as Record<string, unknown>;

      it('起訖是原生 type=date（有「從」「到」標籤），預設是當月 1 日到今天', async () => {
        await goRange([]);
        const from = q('meals-from') as HTMLInputElement;
        const to = q('meals-to') as HTMLInputElement;
        expect([from.type, to.type]).toEqual(['date', 'date']);
        expect([from.value, to.value]).toEqual(['2026-10-01', '2026-10-14']);
        expect(from.closest('label')!.textContent).toContain('從');
        expect(to.closest('label')!.textContent).toContain('到');
        expect(fixture.nativeElement.querySelector('p-datepicker')).toBeNull();
      });

      it('改起日／迄日 → 用字串查，回到第 1 頁', async () => {
        await goRange([]);
        setInput('meals-from', '2026-09-30');
        expect(lastRange()).toMatchObject({
          dateFrom: '2026-09-30',
          dateTo: '2026-10-14',
          page: 1,
        });
        setInput('meals-to', '2026-10-05');
        expect(lastRange()).toMatchObject({ dateFrom: '2026-09-30', dateTo: '2026-10-05' });
      });

      it('起訖同一天合法（不被調整）', async () => {
        await goRange([]);
        setInput('meals-to', '2026-10-01');
        expect(lastRange()).toMatchObject({ dateFrom: '2026-10-01', dateTo: '2026-10-01' });
      });

      it('起日晚於迄日（差 1 天）→ 迄日被拉到起日；迄日早於起日（差 1 天）→ 起日被拉到迄日', async () => {
        await goRange([]);
        setInput('meals-from', '2026-10-15');
        expect(lastRange()).toMatchObject({ dateFrom: '2026-10-15', dateTo: '2026-10-15' });
        fixture.detectChanges();
        expect((q('meals-to') as HTMLInputElement).value).toBe('2026-10-15');

        setInput('meals-to', '2026-10-14');
        expect(lastRange()).toMatchObject({ dateFrom: '2026-10-14', dateTo: '2026-10-14' });
        fixture.detectChanges();
        expect((q('meals-from') as HTMLInputElement).value).toBe('2026-10-14');
      });

      it.each(['meals-from', 'meals-to'])('%s 清空 → 不查、欄位還原', async (id) => {
        await goRange([]);
        const before = (q(id) as HTMLInputElement).value;
        meals.range.mockClear();
        const input = setInput(id, '');
        expect(meals.range).not.toHaveBeenCalled();
        expect(input.value).toBe(before);
      });

      it('依日期分章，新的在上；章頭寫 M/D、份數與週幾', async () => {
        await goRange([
          rangeRow('a', '2026-10-11'),
          rangeRow('b', '2026-10-14'),
          rangeRow('c', '2026-10-14'),
          rangeRow('d', '2026-10-12'),
        ]);
        const heads = all('chapter-head').map((h) => h.textContent!.replace(/\s+/g, ' ').trim());
        expect(heads).toEqual(['10/14 2 份 · 三', '10/12 1 份 · 一', '10/11 1 份 · 日']);
      });

      it('章頭份數只算有訂的，沒訂的那列照樣列出', async () => {
        await goRange([
          rangeRow('a', '2026-10-14'),
          rangeRow('b', '2026-10-14', { ordered: false }),
        ]);
        expect(q('chapter-head').textContent!.replace(/\s+/g, ' ')).toContain('1 份');
        expect(all('range-row')).toHaveLength(2);
      });

      it('列是唯讀的：沒有任何輸入控制項', async () => {
        await goRange([rangeRow('a', '2026-10-14')]);
        expect(q('range-row').querySelector('input, select, textarea, p-checkbox')).toBeNull();
      });

      it('金額欄：NT$ 單價／不收費／沒訂', async () => {
        await goRange([
          rangeRow('a', '2026-10-14'),
          rangeRow('b', '2026-10-14', { chargeable: false }),
          rangeRow('c', '2026-10-14', { ordered: false }),
        ]);
        expect(all('range-amount').map((e) => e.textContent!.trim())).toEqual([
          'NT$ 65',
          '不收費',
          '沒訂',
        ]);
      });

      it('狀態欄：已結算／已確認／未處理', async () => {
        await goRange([
          rangeRow('a', '2026-10-14', { settled: true }),
          rangeRow('b', '2026-10-14'),
          rangeRow('c', '2026-10-14', { recordId: null }),
        ]);
        expect(all('range-state').map((e) => e.textContent!.trim())).toEqual([
          '已結算',
          '已確認',
          '未處理',
        ]);
      });

      it('學生名連到學生檔案；有備註才多一段字', async () => {
        await goRange([
          rangeRow('stu-1', '2026-10-14', { note: '素食' }),
          rangeRow('b', '2026-10-14'),
        ]);
        const rows = all('range-row');
        expect(rows[0].querySelector('a[href="/admin/students/stu-1"]')).not.toBeNull();
        expect(rows[0].textContent).toContain('素食');
        expect(rows[1].textContent).not.toContain('素食');
      });

      describe('分頁（每頁 50）', () => {
        it.each([
          [50, false],
          [51, true],
        ])('總數 %s 筆 → 分頁列出現：%s（門檻 ±1）', async (total, shown) => {
          await goRange([rangeRow('a', '2026-10-14')], total);
          expect(q('pager') !== null).toBe(shown);
        });

        it('第 1／3 頁：上一頁停用；下一頁 → 查第 2 頁；最後一頁下一頁停用', async () => {
          await goRange([rangeRow('a', '2026-10-14')], 120);
          expect(q('pager').textContent).toContain('第 1／3 頁');
          expect((q('pager-prev') as HTMLButtonElement).disabled).toBe(true);

          q('pager-next').click();
          expect(lastRange()).toMatchObject({ page: 2 });
          fixture.detectChanges();
          q('pager-next').click();
          expect(lastRange()).toMatchObject({ page: 3 });
          fixture.detectChanges();
          expect((q('pager-next') as HTMLButtonElement).disabled).toBe(true);
        });

        it('最後一頁再往後翻不查', async () => {
          await goRange([rangeRow('a', '2026-10-14')], 120);
          component['goPage'](1);
          component['goPage'](1);
          meals.range.mockClear();
          component['goPage'](1);
          expect(meals.range).not.toHaveBeenCalled();
          expect(component['currentPage']()).toBe(3);
        });

        it('越界的翻頁不查', async () => {
          await goRange([rangeRow('a', '2026-10-14')], 120);
          meals.range.mockClear();
          component['goPage'](-1);
          expect(meals.range).not.toHaveBeenCalled();
        });
      });
    });

    describe('載入防亂序（switchMap）', () => {
      it('先查 9/1、再查 9/2，9/1 的回應晚到也不能蓋掉 9/2', async () => {
        const slow = new Subject<ReturnType<typeof roster>>();
        const fast = new Subject<ReturnType<typeof roster>>();
        meals.roster.mockReset().mockReturnValueOnce(slow).mockReturnValueOnce(fast);

        component['onDateChange']('2026-09-01');
        component['onDateChange']('2026-09-02');
        fast.next(roster([person('new')]));
        slow.next(roster([person('old1'), person('old2')]));

        expect(component['rows']().map((r) => r.studentId)).toEqual(['new']);
        expect(component['loading']()).toBe(false);
      });

      it('舊請求晚到的失敗也不能把新名單換成失敗畫面', async () => {
        const slow = new Subject<ReturnType<typeof roster>>();
        const fast = new Subject<ReturnType<typeof roster>>();
        meals.roster.mockReset().mockReturnValueOnce(slow).mockReturnValueOnce(fast);

        component['onDateChange']('2026-09-01');
        component['onDateChange']('2026-09-02');
        fast.next(roster([person('new')]));
        slow.error(new Error('late'));

        expect(component['failed']()).toBe(false);
        expect(component['rows']().map((r) => r.studentId)).toEqual(['new']);
      });
    });
  });

  // #1293：儀表板「待開單」卡片帶 ?billingRun=period&periodId=… 過來 —— 一進頁就開 dialog、選好那一期
  describe('從待開單卡片進來', () => {
    async function create(inputs: Record<string, string | undefined>) {
      const f = TestBed.createComponent(MealsComponent);
      // DialogService 掛在元件層級（providers），要從元件的 injector 拿、在 ngOnInit 之前 spy
      const dialog = f.debugElement.injector.get(DialogService);
      const open = vi.spyOn(dialog, 'open').mockReturnValue({ onClose: of(false) } as never);
      f.componentRef.setInput('page', { label: '餐費管理' });
      for (const [key, value] of Object.entries(inputs)) f.componentRef.setInput(key, value);
      await f.whenStable();
      return open;
    }

    it('billingRun=period → 開單 dialog 帶 { mode: period, periodId }', async () => {
      const open = await create({ billingRun: 'period', periodId: 'p-1' });
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][1]).toMatchObject({ data: { mode: 'period', periodId: 'p-1' } });
    });

    it('沒帶 billingRun → 不自動開', async () => {
      const open = await create({});
      expect(open).not.toHaveBeenCalled();
    });
  });
});
