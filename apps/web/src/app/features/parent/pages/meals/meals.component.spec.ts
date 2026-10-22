import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
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

  function create(records: ParentMealRecord[] | 'error' = []) {
    activeChildId = signal<string | null>(null);
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
});
