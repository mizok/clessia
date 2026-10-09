import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, vi } from 'vitest';

import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SessionsService, type ChangeLogEntry } from '@core/sessions.service';
import { SystemClockService } from '@core/system-clock.service';

import { ScheduleChangesDrawerComponent } from './schedule-changes-drawer.component';

const entry = (over: Partial<ChangeLogEntry> = {}): ChangeLogEntry => ({
  id: 'c1',
  sessionId: 's1',
  changeType: 'cancellation',
  summary: '停課',
  sessionDate: '2026-08-15',
  className: '國二數學 A',
  reason: '颱風',
  createdByName: '王主任',
  createdAt: '2026-08-10T03:00:00Z',
  isBatch: false,
  batchId: null,
  ...over,
});

describe('ScheduleChangesDrawerComponent', () => {
  let fixture: ComponentFixture<ScheduleChangesDrawerComponent>;
  const listChanges = vi.fn();

  // jsdom 沒有 <dialog> 的 modal 行為：只補開關狀態與 close 事件
  const proto = HTMLDialogElement.prototype;
  const original = { showModal: proto.showModal, close: proto.close };
  beforeEach(() => {
    proto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
    localStorage.removeItem('clessia.campusContext');
  });
  afterEach(() => Object.assign(proto, original));

  async function setup(open = false) {
    listChanges
      .mockReset()
      .mockReturnValue(of({ data: [entry()], meta: { total: 1, page: 1, pageSize: 100 } }));
    await TestBed.configureTestingModule({
      imports: [ScheduleChangesDrawerComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges } },
        {
          provide: ReferenceDataService,
          useValue: { campuses: signal([]), loadCampuses: vi.fn() },
        },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-08-15') } },
        CampusContextService,
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ScheduleChangesDrawerComponent);
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
    await fixture.whenStable();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const dialog = () => el().querySelector('dialog') as HTMLDialogElement;

  it('關著的時候不取數；打開才取當月的異動', async () => {
    await setup(false);
    expect(listChanges).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog().open).toBe(true);
    expect(listChanges).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-08-01', to: '2026-08-31', page: 1, pageSize: 100 }),
    );
    expect(el().textContent).toContain('國二數學 A');
  });

  it('換類型與月份會重新取數，而且帶對參數', async () => {
    await setup(true);
    listChanges.mockClear();

    (fixture.componentInstance as unknown as { onTypeChange: (v: string) => void }).onTypeChange(
      'substitute',
    );
    expect(listChanges).toHaveBeenLastCalledWith(
      expect.objectContaining({ changeType: 'substitute' }),
    );

    (fixture.componentInstance as unknown as { onMonthChange: (v: string) => void }).onMonthChange(
      '2026-07',
    );
    expect(listChanges).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-07-01', to: '2026-07-31' }),
    );
  });

  it('篩選選項沒有後端還不收的 makeup 與合成的 creation', async () => {
    await setup(true);
    const values = (
      fixture.componentInstance as unknown as { changeTypeOptions: { value: string | null }[] }
    ).changeTypeOptions.map((o) => o.value);
    expect(values).not.toContain('makeup');
    expect(values).not.toContain('creation');
    expect(values).toContain('substitute');
  });

  it('查詢失敗講出來，不留空白', async () => {
    await setup(false);
    listChanges.mockReturnValue(throwError(() => new Error('boom')));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().textContent).toContain('查詢失敗');
  });

  it('超過一頁時說只列前 100 則並連到全部異動頁', async () => {
    await setup(false);
    listChanges.mockReturnValue(
      of({ data: [entry()], meta: { total: 250, page: 1, pageSize: 100 } }),
    );
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().textContent).toContain('只列出前 100 則');
  });

  it('關閉（×、Esc、背景都會走 dialog 的 close）回報 closed', async () => {
    await setup(true);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    dialog().close();

    expect(closed).toHaveBeenCalledTimes(1);
  });
});
