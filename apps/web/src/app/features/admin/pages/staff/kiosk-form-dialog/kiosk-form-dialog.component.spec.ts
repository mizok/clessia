import { TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StaffService, type Staff } from '@core/staff.service';
import { KioskFormDialogComponent, type KioskFormDialogData } from './kiosk-form-dialog.component';

const campuses = [
  { id: 'c1', name: '本校' },
  { id: 'c2', name: '分校' },
] as KioskFormDialogData['campuses'];
const kiosk = { id: 'k1', displayName: '本校門口', campusIds: ['c1'], roles: ['kiosk'] } as Staff;

interface Harness {
  name: { set: (v: string) => void };
  campusId: { set: (v: string) => void };
  save: () => void;
  error: () => string | null;
}

function setup(data: KioskFormDialogData, service: Partial<StaffService>) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    imports: [KioskFormDialogComponent],
    providers: [
      { provide: DynamicDialogRef, useValue: { close } },
      { provide: DynamicDialogConfig, useValue: { data } },
      { provide: StaffService, useValue: service },
    ],
  });
  const fixture = TestBed.createComponent(KioskFormDialogComponent);
  fixture.detectChanges();
  return { close, c: fixture.componentInstance as unknown as Harness };
}

describe('KioskFormDialogComponent（#1127）', () => {
  it('建立：只送名稱、一個分校、roles=[kiosk]，不送 email；把 loginUrl 交出去', () => {
    const create = vi.fn(() => of({ data: kiosk, loginUrl: 'https://x/link' }));
    const { c, close } = setup({ campuses }, { create });

    c.name.set('  本校門口 ');
    c.campusId.set('c1');
    c.save();

    expect(create).toHaveBeenCalledWith({
      displayName: '本校門口',
      campusIds: ['c1'],
      roles: ['kiosk'],
    });
    expect(close).toHaveBeenCalledWith({ data: kiosk, loginUrl: 'https://x/link' });
  });

  it('編輯：只送名稱與分校（後端不准改角色／權限／科目）', () => {
    const update = vi.fn(() => of({ data: kiosk }));
    const { c } = setup({ campuses, staff: kiosk }, { update });

    c.campusId.set('c2');
    c.save();

    expect(update).toHaveBeenCalledWith('k1', { displayName: '本校門口', campusIds: ['c2'] });
  });

  it('沒選分校不送', () => {
    const create = vi.fn();
    const { c } = setup({ campuses }, { create });
    c.name.set('門口');
    c.save();
    expect(create).not.toHaveBeenCalled();
  });

  it('失敗時顯示伺服器的原因、不關窗', () => {
    const create = vi.fn(() => throwError(() => ({ error: { error: '沒有這個分校的權限' } })));
    const { c, close } = setup({ campuses }, { create });
    c.name.set('門口');
    c.campusId.set('c2');
    c.save();
    expect(c.error()).toBe('沒有這個分校的權限');
    expect(close).not.toHaveBeenCalled();
  });
});
