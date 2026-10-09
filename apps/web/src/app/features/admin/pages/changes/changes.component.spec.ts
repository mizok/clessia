import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { provideRouter } from '@angular/router';

import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SessionsService, type ChangeLogEntry } from '@core/sessions.service';
import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SystemClockService } from '@core/system-clock.service';

import { ChangesComponent } from './changes.component';

function entry(overrides: Partial<ChangeLogEntry> = {}): ChangeLogEntry {
  return {
    id: 'chg-1',
    sessionId: 'sess-1',
    changeType: 'cancellation',
    summary: '停課',
    sessionDate: '2026-08-12',
    className: '國二數學 A',
    reason: '颱風',
    createdByName: '王主任',
    createdAt: '2026-08-10T03:00:00Z',
    isBatch: false,
    batchId: null,
    ...overrides,
  };
}

describe('ChangesComponent', () => {
  let fixture: ComponentFixture<ChangesComponent>;
  let component: ChangesComponent;

  const listChangesMock = vi.fn();
  const refDataMock = { campuses: signal<unknown[]>([]), loadCampuses: vi.fn() };

  // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
  beforeEach(() => localStorage.removeItem('clessia.campusContext'));

  async function setup() {
    listChangesMock.mockReset();
    listChangesMock.mockReturnValue(
      of({ data: [entry()], meta: { total: 1, page: 1, pageSize: 20 } }),
    );

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-08-15') } },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChangesComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_CHANGES);
    fixture.detectChanges();
  }

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('載入中顯示骨架列表，不是整塊被文字取代', async () => {
    listChangesMock.mockReset();
    listChangesMock.mockReturnValue(NEVER);

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-08-15') } },
        provideRouter([]),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ChangesComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_CHANGES);
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
  });

  it('預設查當月', async () => {
    await setup();

    const call = listChangesMock.mock.calls[0][0];
    expect(call.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(call.to >= call.from).toBe(true);
  });

  it('呈現後端組好的變更摘要', async () => {
    await setup();

    expect(component['entries']()[0].summary).toBe('停課');
    expect(fixture.nativeElement.textContent).toContain('停課');
  });

  it('切換異動類型會重新查詢並回到第一頁', async () => {
    await setup();
    component['onPageChange'](3);
    listChangesMock.mockClear();

    component['onChangeTypeChange']('substitute');

    const call = listChangesMock.mock.calls[0][0];
    expect(call.changeType).toBe('substitute');
    expect(call.page).toBe(1);
  });

  it('分校跟頂欄走：換分校回第一頁重查，月總數不重查；清除篩選不動分校（#1138）', async () => {
    await setup();
    component['onPageChange'](3);
    listChangesMock.mockClear();

    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();

    expect(listChangesMock).toHaveBeenCalledTimes(1);
    const call = listChangesMock.mock.calls[0][0];
    expect(call.campusId).toBe('campus-1');
    expect(call.page).toBe(1);

    listChangesMock.mockClear();
    component['resetFilters']();
    expect(listChangesMock.mock.calls[0][0].campusId).toBe('campus-1');
    expect(fixture.nativeElement.textContent).not.toContain('全部分校');
  });

  it('搜尋「老師或班級」：帶 q 重查、回第一頁；開場月總數不帶 q；清除篩選連搜尋框一起清', async () => {
    await setup();
    component['onPageChange'](3);
    listChangesMock.mockClear();

    component['onQueryChange']('王老師');
    fixture.detectChanges();

    const list = listChangesMock.mock.calls[0][0];
    expect(list.q).toBe('王老師');
    expect(list.page).toBe(1);
    expect(listChangesMock.mock.calls.every(([c]) => c.pageSize !== 1)).toBe(true);
    expect(
      (fixture.nativeElement.querySelector('input[type=search]') as HTMLInputElement).value,
    ).toBe('王老師');

    listChangesMock.mockClear();
    component['resetFilters']();
    fixture.detectChanges();
    expect(listChangesMock.mock.calls[0][0].q).toBeUndefined();
    expect(
      (fixture.nativeElement.querySelector('input[type=search]') as HTMLInputElement).value,
    ).toBe('');
  });

  it('「全部」類型不送 changeType 參數', async () => {
    await setup();
    listChangesMock.mockClear();

    component['onChangeTypeChange'](null);

    expect(listChangesMock.mock.calls[0][0].changeType).toBeUndefined();
  });

  it('批次操作要標記出來', async () => {
    listChangesMock.mockReset();
    listChangesMock.mockReturnValue(
      of({ data: [entry({ isBatch: true })], meta: { total: 1, page: 1, pageSize: 20 } }),
    );

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-08-15') } },
        provideRouter([]),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ChangesComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_CHANGES);
    f.detectChanges();

    expect(f.nativeElement.textContent).toContain('批次');
  });

  it('查詢失敗顯示錯誤而不是空白', async () => {
    listChangesMock.mockReset();
    listChangesMock.mockReturnValue(throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-08-15') } },
        provideRouter([]),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ChangesComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_CHANGES);
    f.detectChanges();

    expect(f.componentInstance['loadError']()).toBe(true);
    expect(f.componentInstance['loading']()).toBe(false);
  });

  it('沒有紀錄時顯示空狀態', async () => {
    listChangesMock.mockReset();
    listChangesMock.mockReturnValue(of({ data: [], meta: { total: 0, page: 1, pageSize: 20 } }));

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-08-15') } },
        provideRouter([]),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ChangesComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_CHANGES);
    f.detectChanges();

    expect(f.nativeElement.textContent).toContain('8 月沒有任何調課、代課或停課');
  });

  // 分章、批次分組、日期標籤的邏輯在共用的 change-log-list（util／component 各有 spec）；
  // 這裡只確認頁面把資料交給它、而且畫出來
  it('把這一頁的資料交給共用清單：批次收成一則、依日分章', async () => {
    await setup();
    const at = '2026-08-10T03:00:00Z';
    component['entries'].set([
      entry({
        id: 'b1',
        isBatch: true,
        batchId: 'batch-1',
        createdAt: at,
        className: '國二數學 A',
      }),
      entry({
        id: 'b2',
        isBatch: true,
        batchId: 'batch-1',
        createdAt: at,
        className: '國三英文 B',
      }),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-change-log-list')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('看是哪 2 堂');
  });

  it('開場標題：這個月總共幾則、停課幾堂（不看類型與分校篩選）', async () => {
    listChangesMock.mockReset();
    listChangesMock.mockImplementation((p: { changeType?: string; pageSize: number }) =>
      of({
        data: p.pageSize === 1 ? [] : [entry()],
        meta: { total: p.changeType === 'cancellation' ? 3 : 6, page: 1, pageSize: p.pageSize },
      }),
    );

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-08-15') } },
        provideRouter([]),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ChangesComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_CHANGES);
    f.detectChanges();

    const h1 = f.nativeElement.querySelector('h1').textContent.replace(/\s+/g, '');
    expect(h1).toBe('8月6則異動，停課3堂。');
    const summaryCalls = listChangesMock.mock.calls.filter(([p]) => p.pageSize === 1);
    expect(summaryCalls.map(([p]) => p.campusId)).toEqual([undefined, undefined]);
  });

  /**
   * `makeup` 是 2026-09-06 加進 `schedule_change_type` 的（補課）。
   * **漏標籤不會拋錯**：表格靠 `?? value` 顯示原始英文字，列照樣出現。
   *
   * 標籤完整性現在由型別守著（`Record<ScheduleChangeType, string>`，漏一個編不過），
   * 這兩條守的是型別看不到的另一半：**篩選選項該有誰、不該有誰**。
   */
  describe('補課（makeup）', () => {
    // 「表格顯示補課」那條搬到共用清單的 spec（它才是畫表格的人）

    /**
     * **後端還不收 `makeup`**（`ChangeLogQuerySchema.changeType` 的 `z.enum` 沒有它），
     * 送過去會被擋成 400。給一個必然出錯的選項比不給更糟 ——
     * 使用者會把「請求根本沒送到查詢」讀成「補課這個月沒有」。
     *
     * **等後端收了就把 `makeup` 從 `UNFILTERABLE_CHANGE_TYPES` 拿掉，並刪掉這條斷言。**
     */
    it('但篩選選項裡沒有它 —— 後端的 z.enum 還不收，給了會 400', () => {
      const values = (
        component as unknown as { changeTypeOptions: { value: string | null }[] }
      ).changeTypeOptions.map((o) => o.value);

      expect(values).not.toContain('makeup');
      expect(values).not.toContain('creation');
      // 陷阱：其餘的都還在 —— 免得有人「修好」成把整組選項砍掉
      expect(values).toEqual(
        expect.arrayContaining([
          null,
          'reschedule',
          'substitute',
          'cancellation',
          'uncancel',
          'time_change',
        ]),
      );
    });
  });
});
