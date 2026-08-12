import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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
});
