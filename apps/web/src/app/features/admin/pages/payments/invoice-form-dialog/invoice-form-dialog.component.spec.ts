import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';
import { InvoicesService } from '@core/invoices.service';
import { StudentsService } from '@core/students.service';
import { InvoiceFormDialogComponent } from './invoice-form-dialog.component';

describe('InvoiceFormDialogComponent', () => {
  // #1641 項 5：原本 track $index —— 刪中間一列時 Angular 移掉的是最後一個節點，
  // 再把其餘節點重綁，所以「被刪的那一列淡出」會播在錯的列上
  it('刪掉中間的明細：其餘明細的 DOM 節點不換（track 用穩定 key）', async () => {
    await TestBed.configureTestingModule({
      imports: [InvoiceFormDialogComponent],
      providers: [
        { provide: InvoicesService, useValue: {} },
        { provide: StudentsService, useValue: { list: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(InvoiceFormDialogComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      addItem: () => void;
      removeItem: (i: number) => void;
    };
    c.addItem();
    c.addItem();
    fixture.detectChanges();
    const rows = () =>
      Array.from(fixture.nativeElement.querySelectorAll('.vt-row')) as HTMLElement[];
    expect(rows()).toHaveLength(3);
    const third = rows()[2];
    c.removeItem(1);
    fixture.detectChanges();
    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toBe(third);
  });
});
