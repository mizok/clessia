import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { InvoicesService } from '@core/invoices.service';
import { PaymentFormDialogComponent, paymentToastDetail } from './payment-form-dialog.component';

/** #1778 拆單 3：記收款 toast 帶出伺服器同一個交易做的轉正式、完成申請（有才寫） */
const row = (studentName: string, className: string) => ({
  id: 'x',
  studentId: 's',
  studentName,
  className,
});

describe('paymentToastDetail（#1778）', () => {
  it('沒有連帶結果：只寫金額', () => {
    expect(
      paymentToastDetail(3600, false, { activatedEnrollments: [], completedRequests: [] }),
    ).toBe('收款 3,600 元');
  });

  it('退費：寫退費（伺服器兩個都回空陣列）；舊版回應沒有這兩欄也不壞', () => {
    expect(paymentToastDetail(500, true, {})).toBe('退費 500 元');
  });

  it('第一筆收款（定金）：報名轉正式，申請還沒完成', () => {
    expect(
      paymentToastDetail(1000, false, {
        activatedEnrollments: [row('林小華', '國二數學 B')],
        completedRequests: [],
      }),
    ).toBe('收款 1,000 元 · 林小華（國二數學 B）轉為正式');
  });

  it('一次繳清：轉正式＋申請完成；一張帳單多個報名全部列出', () => {
    expect(
      paymentToastDetail(7200, false, {
        activatedEnrollments: [row('林小華', '國二數學 B'), row('林小華', '國二英文 A')],
        completedRequests: [row('林小華', '國二數學 B')],
      }),
    ).toBe('收款 7,200 元 · 林小華（國二數學 B）、林小華（國二英文 A）轉為正式 · 報名申請已完成');
  });

  it('之前已轉正式、這次繳清：只寫申請完成', () => {
    expect(
      paymentToastDetail(2600, false, {
        activatedEnrollments: [],
        completedRequests: [row('林小華', '國二數學 B')],
      }),
    ).toBe('收款 2,600 元 · 報名申請已完成');
  });
});

describe('PaymentFormDialogComponent：記收款 toast 接伺服器回應（#1778）', () => {
  it('回應帶一筆轉正式、一筆完成申請：toast 寫出學生、班名與申請完成', async () => {
    const res = {
      data: { id: 'inv-1' },
      activatedEnrollments: [row('林小華', '國二數學 B')],
      completedRequests: [row('林小華', '國二數學 B')],
    };
    const recordPayment = vi.fn().mockReturnValue(of(res));
    const add = vi.fn();
    const close = vi.fn();
    await TestBed.configureTestingModule({
      imports: [PaymentFormDialogComponent],
      providers: [
        { provide: InvoicesService, useValue: { recordPayment } },
        { provide: MessageService, useValue: { add } },
        { provide: DynamicDialogRef, useValue: { close } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: { invoice: { id: 'inv-1', status: 'unpaid', total: 3600, netPaid: 0 } },
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentFormDialogComponent);
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { save(): void }).save();

    expect(recordPayment).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        detail: '收款 3,600 元 · 林小華（國二數學 B）轉為正式 · 報名申請已完成',
      }),
    );
    expect(close).toHaveBeenCalledWith(res.data);
  });
});
