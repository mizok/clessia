import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SessionsService, type ChangeLogEntry } from '@core/sessions.service';
import { CampusesService } from '@core/campuses.service';

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
    ...overrides,
  };
}

describe('ChangesComponent', () => {
  let fixture: ComponentFixture<ChangesComponent>;
  let component: ChangesComponent;

  const listChangesMock = vi.fn();
  const listCampusesMock = vi.fn();

  async function setup() {
    listChangesMock.mockReset();
    listCampusesMock.mockReset();
    listChangesMock.mockReturnValue(
      of({ data: [entry()], meta: { total: 1, page: 1, pageSize: 20 } }),
    );
    listCampusesMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: CampusesService, useValue: { list: listCampusesMock } },
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
    listCampusesMock.mockReset();
    listChangesMock.mockReturnValue(NEVER);
    listCampusesMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: CampusesService, useValue: { list: listCampusesMock } },
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

  it('「全部」類型不送 changeType 參數', async () => {
    await setup();
    listChangesMock.mockClear();

    component['onChangeTypeChange'](null);

    expect(listChangesMock.mock.calls[0][0].changeType).toBeUndefined();
  });

  it('批次操作要標記出來', async () => {
    listChangesMock.mockReset();
    listCampusesMock.mockReset();
    listChangesMock.mockReturnValue(
      of({ data: [entry({ isBatch: true })], meta: { total: 1, page: 1, pageSize: 20 } }),
    );
    listCampusesMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: CampusesService, useValue: { list: listCampusesMock } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ChangesComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_CHANGES);
    f.detectChanges();

    expect(f.nativeElement.textContent).toContain('批次');
  });

  it('查詢失敗顯示錯誤而不是空白', async () => {
    listChangesMock.mockReset();
    listCampusesMock.mockReset();
    listChangesMock.mockReturnValue(throwError(() => new Error('boom')));
    listCampusesMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: CampusesService, useValue: { list: listCampusesMock } },
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
    listCampusesMock.mockReset();
    listChangesMock.mockReturnValue(of({ data: [], meta: { total: 0, page: 1, pageSize: 20 } }));
    listCampusesMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges: listChangesMock } },
        { provide: CampusesService, useValue: { list: listCampusesMock } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ChangesComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_CHANGES);
    f.detectChanges();

    expect(f.nativeElement.textContent).toContain('沒有課務異動');
  });

  /**
   * `makeup` 是 2026-09-06 加進 `schedule_change_type` 的（補課）。
   * **漏標籤不會拋錯**：表格靠 `?? value` 顯示原始英文字，列照樣出現。
   *
   * 標籤完整性現在由型別守著（`Record<ScheduleChangeType, string>`，漏一個編不過），
   * 這兩條守的是型別看不到的另一半：**篩選選項該有誰、不該有誰**。
   */
  describe('補課（makeup）', () => {
    it('表格顯示「補課」，不是原始 enum 值', () => {
      const label = (component as unknown as { typeLabel: (v: string) => string }).typeLabel(
        'makeup',
      );

      expect(label).toBe('補課');
      expect(label).not.toBe('makeup');
    });

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
