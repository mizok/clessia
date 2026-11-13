import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { CampusContextService } from '@core/campus-context.service';
import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { FeeTemplatesService } from '@core/fee-templates.service';
import { InvoicesService } from '@core/invoices.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { SystemClockService } from '@core/system-clock.service';

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
  // #2445：全部開帳先開確認框 —— 元件層 providers 會遮蔽 TestBed 的，要 overrideComponent
  let confirmClose$: Subject<boolean | undefined>;
  const dialogServiceMock = { open: vi.fn() };
  const orgSettingsMock = {
    getSettings: vi.fn(() => of<{ invoiceDueDays?: number }>({ invoiceDueDays: 14 })),
  };
  const providers = () => [
    { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
    { provide: FeeTemplatesService, useValue: feeTemplatesServiceMock },
    { provide: InvoicesService, useValue: invoicesServiceMock },
    { provide: DynamicDialogRef, useValue: dialogRefMock },
    { provide: OrgSettingsService, useValue: orgSettingsMock },
    { provide: SystemClockService, useValue: { todayTaipei: () => '2026-11-12' } },
  ];
  async function configure() {
    confirmClose$ = new Subject<boolean | undefined>();
    dialogServiceMock.open.mockReset().mockReturnValue({ onClose: confirmClose$ });
    await TestBed.configureTestingModule({
      imports: [UninvoicedDialogComponent],
      providers: providers(),
    })
      .overrideComponent(UninvoicedDialogComponent, {
        set: { providers: [{ provide: DialogService, useValue: dialogServiceMock }] },
      })
      .compileComponents();
  }
  /** 全部開帳＝按鈕＋確認框按主鈕 */
  const issueAllConfirmed = (c: UninvoicedDialogComponent) => {
    c['issueAll']();
    confirmClose$.next(true);
  };

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
    invoicesServiceMock.create.mockClear();

    await configure();

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

  // 頂欄分校（#1314 DB-campus）：「還沒開單」名單要跟頁面同一個分校，不然卡片說 N 筆、點進去是全部
  describe('頂欄分校', () => {
    const campusCtx = () => TestBed.inject(CampusContextService);
    const lastCall = () => {
      const calls = enrollmentsServiceMock.list.mock.calls;
      return calls[calls.length - 1][0] as { campusId?: string };
    };
    beforeEach(() => {
      localStorage.removeItem('clessia.campusContext');
      localStorage.removeItem('clessia.campusContext.single');
    });

    it('頂欄是「全部分校」：不帶 campusId', async () => {
      await setup([enrollment()]);
      expect(lastCall().campusId).toBeUndefined();
    });

    it('頂欄選了分校：請求帶那間的 campusId', async () => {
      localStorage.setItem('clessia.campusContext', 'campus-A');
      TestBed.resetTestingModule();
      localStorage.setItem('clessia.campusContext', 'campus-A');
      await setup([enrollment()]);
      expect(lastCall().campusId).toBe('campus-A');
    });

    it('換分校後再開一次：帶新的分校，不是上次那間；清成 null 仍帶上次那間（#1607）', async () => {
      await setup([enrollment()]);
      campusCtx().select('campus-A');
      TestBed.createComponent(UninvoicedDialogComponent).detectChanges();
      expect(lastCall().campusId).toBe('campus-A');

      campusCtx().select('campus-B');
      TestBed.createComponent(UninvoicedDialogComponent).detectChanges();
      expect(lastCall().campusId).toBe('campus-B');

      campusCtx().select(null);
      TestBed.createComponent(UninvoicedDialogComponent).detectChanges();
      expect(lastCall().campusId).toBe('campus-B');
    });
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

      issueAllConfirmed(c);

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

      issueAllConfirmed(c);

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

  describe('全部開帳先預覽再確認（#2445）', () => {
    const rowB = enrollment({
      id: 'en-2',
      studentId: 'stu-2',
      studentName: '李小華',
      billingMode: 'session_pack',
      agreedAmount: 3200,
    });

    it('按全部開帳先出確認：張數、合計 NT$、期別、期限；按「再看看」一張都不開', async () => {
      const c = await setup([enrollment(), rowB]);
      c['issueAll']();

      expect(dialogServiceMock.open).toHaveBeenCalledTimes(1);
      const [, config] = dialogServiceMock.open.mock.calls[0];
      expect(config.data.message).toBe(
        '開 2 張\n合計 NT$ 7,700\n期別 學費、堂數包\n期限 2026/11/26',
      );
      expect(config.data.acceptLabel).toBe('開 2 張');

      confirmClose$.next(false);
      expect(invoicesServiceMock.create).not.toHaveBeenCalled();
    });

    // golden：改動前（#2445 之前）issueAll 對這兩筆送出的 payload，原樣抄下 —— 確認框不能改到開出去的帳單
    it('確認後開出的 invoices 跟改動前逐欄相同', async () => {
      const golden = [
        [{ studentId: 'stu-1', items: [{ type: 'tuition', enrollmentId: 'en-1', amount: 4500 }] }],
        [
          {
            studentId: 'stu-2',
            items: [{ type: 'session_pack', enrollmentId: 'en-2', amount: 3200 }],
          },
        ],
      ];
      const c = await setup([enrollment(), rowB]);
      issueAllConfirmed(c);

      expect(invoicesServiceMock.create.mock.calls).toEqual(golden);
    });

    it('拿不到機構繳費天數（沒有財務權限）→ 期限寫依機構設定，不猜', async () => {
      orgSettingsMock.getSettings.mockReturnValueOnce(of({}));
      const c = await setup([enrollment()]);
      c['issueAll']();
      const [, config] = dialogServiceMock.open.mock.calls[0];
      expect(config.data.message).toContain('期限 開立日起依機構設定');
    });

    it('每列寫期別、金額寫 NT$', async () => {
      await setup([enrollment()]);
      const text = (fixture.nativeElement as HTMLElement).textContent!;
      expect(text).toContain('國一數學 A · 學費 · 2026-09-01');
      expect(text).toContain('NT$ 4,500');
      expect(text).not.toMatch(/\$4,500/);
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

    await configure();

    fixture = TestBed.createComponent(UninvoicedDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['failed']()).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('都開過帳了');
  });
});
