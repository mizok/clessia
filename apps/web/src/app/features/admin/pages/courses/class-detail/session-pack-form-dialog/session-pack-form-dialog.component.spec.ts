import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';

import { SessionPacksService, type SessionPack } from '@core/session-packs.service';
import { SessionPackFormDialogComponent } from './session-pack-form-dialog.component';

const pack: SessionPack = {
  id: 'sp-1',
  enrollmentId: 'en-1',
  purchasedCount: 10,
  purchasedAt: '2026-09-05',
  expiresAt: null,
  invoiceItemId: null,
  note: null,
  createdAt: '2026-09-05T00:00:00.000Z',
};

describe('SessionPackFormDialogComponent', () => {
  let component: SessionPackFormDialogComponent;
  let fixture: ComponentFixture<SessionPackFormDialogComponent>;

  const createMock = vi.fn(() => of({ data: pack }));
  const dialogRef = { close: vi.fn() };

  beforeEach(async () => {
    createMock.mockReset().mockReturnValue(of({ data: pack }));
    dialogRef.close.mockReset();

    await TestBed.configureTestingModule({
      imports: [SessionPackFormDialogComponent],
      providers: [
        { provide: SessionPacksService, useValue: { create: createMock } },
        { provide: DynamicDialogRef, useValue: dialogRef },
        {
          provide: DynamicDialogConfig,
          useValue: { data: { enrollmentId: 'en-1', studentName: '王小明' } },
        },
        MessageService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionPackFormDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  type Internals = {
    form: { set: (v: Record<string, unknown>) => void; (): Record<string, unknown> };
    save: () => void;
  };
  const internals = () => component as unknown as Internals;

  it('送出時把日期轉成 yyyy-MM-dd 字串', () => {
    internals().form.set({ purchasedCount: 8, purchasedAt: new Date('2026-09-05'), note: '' });

    internals().save();

    expect(createMock).toHaveBeenCalledWith({
      enrollmentId: 'en-1',
      purchasedCount: 8,
      purchasedAt: '2026-09-05',
      note: undefined,
    });
  });

  it('堂數是 0 或負數會被擋下來，不送出 API', () => {
    internals().form.set({ purchasedCount: 0, purchasedAt: new Date('2026-09-05'), note: '' });

    internals().save();

    expect(createMock).not.toHaveBeenCalled();
  });

  it('成功後把新建的紀錄回傳給呼叫端', () => {
    internals().form.set({ purchasedCount: 10, purchasedAt: new Date('2026-09-05'), note: '' });

    internals().save();

    expect(dialogRef.close).toHaveBeenCalledWith(pack);
  });

  it('備註留空送 undefined 不是空字串——後端 optional 欄位不需要空字串', () => {
    internals().form.set({ purchasedCount: 10, purchasedAt: new Date('2026-09-05'), note: '   ' });

    internals().save();

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ note: undefined }));
  });
});
