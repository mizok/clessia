import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import { ParentMealsService, type ParentMealRecord } from '@core/parent-meals.service';
import { SystemClockService } from '@core/system-clock.service';
import { MealsComponent } from './meals.component';

const PAGE = {
  label: '餐費紀錄',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: 'pi-shopping-bag',
  showInMenu: true,
};

const rec = (date: string, over: Partial<ParentMealRecord> = {}): ParentMealRecord => ({
  date,
  unitPrice: 80,
  chargeable: true,
  amount: 80,
  settled: false,
  ...over,
});

describe('MealsComponent（A6 p-meals）', () => {
  let fixture: ComponentFixture<MealsComponent>;
  let list: ReturnType<typeof vi.fn>;
  let activeChildId: ReturnType<typeof signal<string | null>>;

  /** `reuseMocks`：沿用呼叫端先準備好的 `list`（本月與期間回不同資料時用） */
  function create(records: ParentMealRecord[] | 'error' = [], opts: { reuseMocks?: boolean } = {}) {
    activeChildId = signal<string | null>(null);
    if (!opts.reuseMocks)
      list = vi.fn((params: { dateFrom: string }) =>
        records === 'error'
          ? throwError(() => new Error('boom'))
          : of({
              // 色面那一支只抓本月
              data:
                params.dateFrom === '2026-10-01'
                  ? records.filter((r) => r.date >= '2026-10-01')
                  : records,
              meta: { months: [] },
            }),
      );

    TestBed.configureTestingModule({
      imports: [MealsComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChildScopeService,
          useValue: {
            activeChildId: activeChildId.asReadonly(),
            children: () => [{ id: 'child-1', name: '林子晴' }],
            activeChild: () => ({ id: 'child-1', name: '林子晴' }),
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: vi.fn(),
          },
        },
        { provide: ParentMealsService, useValue: { list } },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-22' } },
      ],
    });

    fixture = TestBed.createComponent(MealsComponent);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
    activeChildId.set('child-1');
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('預設抓近 3 個月（到今天）與本月', () => {
    create();
    expect(list).toHaveBeenCalledWith({
      childId: 'child-1',
      dateFrom: '2026-08-01',
      dateTo: '2026-10-22',
    });
    expect(list).toHaveBeenCalledWith({
      childId: 'child-1',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-22',
    });
  });

  it('色面：這個月幾餐（只算有收錢的）、多少錢；副行寫單價', () => {
    create([rec('2026-10-08'), rec('2026-10-01', { chargeable: false, amount: 0 })]);
    expect(text()).toContain('林子晴 這個月');
    expect(text()).toContain('1 餐，80 元。');
    expect(text()).toContain('一個便當 80 元');
  });

  it('每月一個摺疊區，第一個打開；已結算的寫「已併入帳單」，不收費的寫「不收費」', () => {
    create([
      rec('2026-10-08'),
      rec('2026-09-10', { settled: true, chargeable: false, amount: 0 }),
      rec('2026-09-03', { settled: true }),
    ]);
    const colls = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLDetailsElement>('details.coll'),
    );

    expect(colls.map((c) => c.querySelector('.coll__t')?.textContent?.trim())).toEqual([
      '10 月',
      '9 月',
    ]);
    expect(colls[0].open).toBe(true);
    expect(colls[0].textContent).toContain('還沒結算 · 月底併入帳單');
    expect(colls[1].querySelector('.coll__m')?.textContent).toContain('80 元 · 1 餐');
    expect(colls[1].textContent).toContain('已併入帳單');
    // A6 展開後寫「併入 <連結>10 月的帳單</連結>」（#1965），不是「已併入帳單 · 看繳費紀錄」
    const billed = colls[1].querySelector('.coll__body a');
    expect(billed?.textContent?.trim()).toBe('10 月的帳單');
    expect(billed?.getAttribute('href')).toBe('/parent/payments');
    expect(colls[1].querySelector('.coll__body')?.textContent).not.toContain('看繳費紀錄');
    // 還沒結算的月份沒有那一行
    expect(colls[0].querySelector('.coll__body a')).toBeNull();
    expect(colls[1].textContent).toContain('9/10（四）');
    expect(colls[1].textContent).toContain('不收費');
  });

  it('沒有紀錄：空狀態＋看近 6 個月的捷徑', () => {
    create([]);
    expect(text()).toContain('這段期間沒有餐費紀錄');

    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('看近 6 個月'))!;
    button.click();
    fixture.detectChanges();

    expect(list).toHaveBeenCalledWith({
      childId: 'child-1',
      dateFrom: '2026-05-01',
      dateTo: '2026-10-22',
    });
  });

  it('指定範圍超過 12 個月：先說，不打 API', () => {
    create();
    list.mockClear();
    const c = fixture.componentInstance as unknown as {
      setPeriod: (p: string) => void;
      customFrom: { set: (v: string) => void };
    };
    c.customFrom.set('2025-01');
    c.setPeriod('custom');
    fixture.detectChanges();

    expect(text()).toContain('一次最多看 12 個月');
    expect(list).not.toHaveBeenCalled();
  });

  it('讀取失敗顯示載入失敗', () => {
    create('error');
    expect(text()).toContain('載入失敗');
  });

  // #1834 二讀 K4：範圍反過來 —— 先說怎麼改，不要打 API 拿 400 變成「讀取失敗」
  it('指定範圍的開始月份晚於結束月份 → 提示、不打 API', () => {
    create();
    list.mockClear();
    const c = fixture.componentInstance as unknown as {
      setPeriod: (p: string) => void;
      customFrom: { set: (v: string) => void };
      customTo: { set: (v: string) => void };
    };
    c.customFrom.set('2026-09');
    c.customTo.set('2026-08');
    c.setPeriod('custom');
    fixture.detectChanges();

    expect(text()).toContain('開始月份要早於結束月份');
    expect(text()).not.toContain('載入失敗');
    expect(list).not.toHaveBeenCalled();
  });

  // K7：單價以本月為準（行政改價後用新的）；期間不含本月時，期間第一筆可能是舊價
  it('單價先看本月：期間不含本月、而且單價不同 → 寫本月的單價', () => {
    activeChildId = signal<string | null>(null);
    list = vi.fn((params: { dateFrom: string }) =>
      of({
        data:
          params.dateFrom === '2026-10-01'
            ? [rec('2026-10-08', { unitPrice: 90, amount: 90 })]
            : [rec('2026-03-10', { unitPrice: 70, amount: 70 })],
        meta: { months: [] },
      }),
    );
    create(undefined, { reuseMocks: true });
    const c = fixture.componentInstance as unknown as {
      setPeriod: (p: string) => void;
      customFrom: { set: (v: string) => void };
      customTo: { set: (v: string) => void };
    };
    c.customFrom.set('2026-01');
    c.customTo.set('2026-03');
    c.setPeriod('custom');
    fixture.detectChanges();

    expect(text()).toContain('一個便當 90 元');
    expect(text()).not.toContain('一個便當 70 元');
  });
});

/**
 * #1834 二讀 K1／K8／色面序號：換期間或換孩子很快時，慢回來的舊回應不能蓋掉新的。
 * 每一支請求回一個自己控制何時完成的 Subject。
 */
describe('MealsComponent —— 舊回應不能蓋掉新的（#1834）', () => {
  let fixture: ComponentFixture<MealsComponent>;
  const pending: Array<{
    params: { childId: string; dateFrom: string };
    subject: Subject<unknown>;
  }> = [];
  const activeChildId = signal<string | null>(null);
  const names: Record<string, string> = { c1: '林子晴', c2: '王小明' };

  beforeEach(() => {
    pending.length = 0;
    activeChildId.set(null);
    TestBed.configureTestingModule({
      imports: [MealsComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChildScopeService,
          useValue: {
            activeChildId: activeChildId.asReadonly(),
            children: () => [
              { id: 'c1', name: names['c1'] },
              { id: 'c2', name: names['c2'] },
            ],
            activeChild: () => {
              const id = activeChildId();
              return id ? { id, name: names[id] } : null;
            },
            status: () => 'ready' as const,
            canSwitch: () => true,
            setActiveChild: vi.fn(),
            load: vi.fn(),
          },
        },
        {
          provide: ParentMealsService,
          useValue: {
            list: (params: { childId: string; dateFrom: string }) => {
              const subject = new Subject<unknown>();
              pending.push({ params, subject });
              return subject.asObservable();
            },
          },
        },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-22' } },
      ],
    });
    fixture = TestBed.createComponent(MealsComponent);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
  });

  const reply = (childId: string, thisMonth: boolean, data: ParentMealRecord[]) => {
    const hit = pending.find(
      (p) => p.params.childId === childId && (p.params.dateFrom === '2026-10-01') === thisMonth,
    )!;
    hit.subject.next({ data, meta: { months: [] } });
    hit.subject.complete();
    fixture.detectChanges();
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('K8＋色面序號：換孩子時色面先清掉；上一個孩子的本月回應晚到也不會蓋掉', () => {
    activeChildId.set('c1');
    fixture.detectChanges();
    reply('c1', true, [rec('2026-10-08'), rec('2026-10-09')]);
    expect(text()).toContain('2 餐，160 元');

    activeChildId.set('c2');
    fixture.detectChanges();
    // 新孩子的本月還沒回來：不能還寫著上一個孩子的數字
    expect(text()).not.toContain('2 餐，160 元');

    reply('c2', true, [rec('2026-10-08')]);
    expect(text()).toContain('王小明 這個月');
    expect(text()).toContain('1 餐，80 元');
  });

  it('色面：上一個孩子的本月回應比新孩子晚到 → 不蓋掉', () => {
    activeChildId.set('c1');
    fixture.detectChanges();
    activeChildId.set('c2');
    fixture.detectChanges();

    reply('c2', true, [rec('2026-10-08')]);
    reply('c1', true, [rec('2026-10-08'), rec('2026-10-09')]); // 晚到
    expect(text()).toContain('1 餐，80 元');
    expect(text()).not.toContain('2 餐，160 元');
  });

  /**
   * #1978 後續（計畫席 10-23）：A→B→A，先回第二次 A、B 晚到 —— 色面與期間兩支都不能被 B 蓋掉。
   * 防護是兩個序號（`thisMonthSeq`／`loadSeq`），不是比對 childId。
   */
  it('#1978 A→B→A：B 晚到的本月與期間回應都不蓋掉現在的 A', () => {
    for (const id of ['c1', 'c2', 'c1']) {
      activeChildId.set(id);
      fixture.detectChanges();
    }
    const last = (childId: string, thisMonth: boolean) =>
      pending.filter(
        (p) => p.params.childId === childId && (p.params.dateFrom === '2026-10-01') === thisMonth,
      );
    for (const thisMonth of [true, false]) {
      const a = last('c1', thisMonth).at(-1)!;
      a.subject.next({ data: [rec('2026-10-02')], meta: { months: [] } });
      a.subject.complete();
    }
    for (const thisMonth of [true, false]) {
      const b = last('c2', thisMonth)[0];
      b.subject.next({
        data: [rec('2026-08-05'), rec('2026-08-06'), rec('2026-08-07')],
        meta: { months: [] },
      });
      b.subject.complete();
    }
    fixture.detectChanges();

    const months = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.coll__t'),
    ).map((el) => el.textContent?.trim());
    expect(months).toEqual(['10 月']);
    expect(text()).toContain('1 餐，80 元');
    expect(text()).not.toContain('3 餐');
  });

  it('K1：期間的舊回應晚到 → 不蓋掉新孩子的紀錄', () => {
    activeChildId.set('c1');
    fixture.detectChanges();
    activeChildId.set('c2');
    fixture.detectChanges();

    reply('c2', false, [rec('2026-09-03')]);
    reply('c1', false, [rec('2026-08-05'), rec('2026-08-06')]); // 上一個孩子的，晚到

    const months = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.coll__t'),
    ).map((el) => el.textContent?.trim());
    expect(months).toEqual(['9 月']);
  });
});
