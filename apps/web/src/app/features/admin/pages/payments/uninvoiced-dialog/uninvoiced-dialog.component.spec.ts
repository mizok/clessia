import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { FeeTemplatesService } from '@core/fee-templates.service';
import { InvoicesService } from '@core/invoices.service';

import { UninvoicedDialogComponent } from './uninvoiced-dialog.component';

const enrollment = (overrides: Partial<Enrollment> = {}): Enrollment =>
  ({
    id: 'en-1',
    classId: 'c1',
    className: '國一數學 A',
    studentId: 'stu-1',
    studentName: '王小明',
    status: 'active',
    billingMode: 'monthly',
    feeTemplateId: 'ft-1',
    agreedAmount: null,
    adjustmentNote: null,
    effectiveFrom: '2026-09-01',
    effectiveTo: null,
    ...overrides,
  }) as Enrollment;

describe('UninvoicedDialogComponent', () => {
  let fixture: ComponentFixture<UninvoicedDialogComponent>;
  let component: UninvoicedDialogComponent;

  const enrollmentsServiceMock = { list: vi.fn() };
  const feeTemplatesServiceMock = { list: vi.fn() };
  const invoicesServiceMock = { create: vi.fn() };
  const dialogRefMock = { close: vi.fn() };

  async function setup(rows: Enrollment[], total = rows.length) {
    enrollmentsServiceMock.list.mockReturnValue(of({ data: rows, meta: { total } }));
    feeTemplatesServiceMock.list.mockReturnValue(
      of({
        data: [
          { id: 'ft-1', name: '國中月繳', billingMode: 'monthly', amount: 4500, isActive: true },
        ],
      }),
    );
    invoicesServiceMock.create.mockReturnValue(of({ data: { id: 'inv-1' } }));
    dialogRefMock.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [UninvoicedDialogComponent],
      providers: [
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: FeeTemplatesService, useValue: feeTemplatesServiceMock },
        { provide: InvoicesService, useValue: invoicesServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UninvoicedDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    return component;
  }

  // `hasInvoice` 是 boolean —— truthy 檢查會把 false 漏掉然後撈回全部報名
  it('查的是「沒有帳單」而不是全部', async () => {
    await setup([enrollment()]);

    expect(enrollmentsServiceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({ hasInvoice: false, status: 'active' }),
    );
  });

  it('金額照價目表帶出來', async () => {
    const c = await setup([enrollment()]);

    expect(c['amountOf'](enrollment())).toBe(4500);
  });

  it('議定金額優先於價目表', async () => {
    const c = await setup([enrollment({ agreedAmount: 3800 })]);

    expect(c['amountOf'](enrollment({ agreedAmount: 3800 }))).toBe(3800);
  });

  // 開一張金額是猜的帳單比不開更糟
  describe('沒有計費設定的報名', () => {
    const noBilling = enrollment({ id: 'en-2', feeTemplateId: null, agreedAmount: null });

    it('算不出金額就不給開', async () => {
      const c = await setup([noBilling]);

      expect(c['amountOf'](noBilling)).toBeNull();
      expect(c['issuableRows']().length).toBe(0);
    });

    it('數出來並指出該去哪裡設定', async () => {
      const c = await setup([enrollment(), noBilling]);

      expect(c['needsBillingCount']()).toBe(1);
      expect(fixture.nativeElement.textContent).toContain('回班級名單設定');
    });

    it('全部開帳只開開得了的那些', async () => {
      const c = await setup([enrollment(), noBilling]);

      c['issueAll']();

      expect(invoicesServiceMock.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('開帳', () => {
    it('單筆開帳帶上 enrollmentId，金額用算出來的', async () => {
      const c = await setup([enrollment()]);

      c['issueOne'](enrollment());

      expect(invoicesServiceMock.create).toHaveBeenCalledWith({
        studentId: 'stu-1',
        items: [{ type: 'tuition', enrollmentId: 'en-1', amount: 4500 }],
      });
    });

    it('堂數制開的是 session_pack', async () => {
      const row = enrollment({ billingMode: 'session_pack' });
      const c = await setup([row]);

      c['issueOne'](row);

      expect(invoicesServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ items: [expect.objectContaining({ type: 'session_pack' })] }),
      );
    });

    it('開過的不會再出現在可開清單裡', async () => {
      const c = await setup([enrollment()]);

      c['issueOne'](enrollment());

      expect(c['isIssued'](enrollment())).toBe(true);
      expect(c['issuableRows']().length).toBe(0);
    });

    // 一張掛掉不該讓其餘已經開出去的看不見
    it('部分失敗時只有那幾筆標成失敗，其餘算開好了', async () => {
      const rowB = enrollment({ id: 'en-2', studentId: 'stu-2', studentName: '李小華' });
      invoicesServiceMock.create
        .mockReturnValueOnce(of({ data: { id: 'inv-1' } }))
        .mockReturnValueOnce(throwError(() => new Error('boom')));
      const c = await setup([enrollment(), rowB]);
      invoicesServiceMock.create
        .mockReset()
        .mockReturnValueOnce(of({ data: { id: 'inv-1' } }))
        .mockReturnValueOnce(throwError(() => new Error('boom')));

      c['issueAll']();

      expect(c['isIssued'](enrollment())).toBe(true);
      expect(c['isFailed'](rowB)).toBe(true);
    });

    it('關閉時把開了幾張回報給呼叫端', async () => {
      const c = await setup([enrollment()]);
      c['issueOne'](enrollment());

      c['close']();

      expect(dialogRefMock.close).toHaveBeenCalledWith({ issued: 1 });
    });

    it('什麼都沒開就關閉，不回報數字', async () => {
      const c = await setup([enrollment()]);

      c['close']();

      expect(dialogRefMock.close).toHaveBeenCalledWith(undefined);
    });
  });

  // 一頁只撈 100 筆，但「還有幾筆」要說真話（charter 坑 #4）
  it('筆數用 meta.total 不是當頁長度', async () => {
    const c = await setup([enrollment()], 37);

    expect(c['total']()).toBe(37);
  });

  it('載入失敗時說失敗，不是顯示「都開過了」', async () => {
    enrollmentsServiceMock.list.mockReturnValue(throwError(() => new Error('boom')));
    feeTemplatesServiceMock.list.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [UninvoicedDialogComponent],
      providers: [
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: FeeTemplatesService, useValue: feeTemplatesServiceMock },
        { provide: InvoicesService, useValue: invoicesServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UninvoicedDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['failed']()).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('都開過帳了');
  });
});
