import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';

import { AuthService } from '@core/auth.service';
import { BillingPeriodsService } from '@core/billing-periods.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { FeeTemplatesService } from '@core/fee-templates.service';
import { StudentsService } from '@core/students.service';
import { SystemClockService } from '@core/system-clock.service';
import { DirectEnrollDialogComponent } from './direct-enroll-dialog.component';

const STUDENT = { id: 'stu-1', name: '陳大同' };
const TEMPLATES = [
  { id: 'ft-m', name: '國中月繳', billingMode: 'monthly', amount: 3000 },
  { id: 'ft-p', name: '國中期繳', billingMode: 'period', amount: 15000 },
  { id: 'ft-s', name: '堂數包', billingMode: 'session_pack', amount: 6000 },
];
const PERIODS = [{ id: 'bp-1', startDate: '2027-02-01', endDate: '2027-06-30' }];

/** 預設沒有財務權限（＝只能不建立，EN2 原本的行為）；SD9 的測試帶 manage_finance */
function setup(permissions: readonly string[] = []) {
  const create = vi.fn((_input: unknown) => of({ data: { id: 'enr-new' } }));
  const prorationPreview = vi.fn((_input: unknown) =>
    of({
      fullAmount: 3100,
      amount: 1700,
      note: '期間 31 天，實際 17 天（17/31），比例試算，可調整',
    }),
  );
  const add = vi.fn();
  const proto = HTMLDialogElement.prototype as any;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  TestBed.configureTestingModule({
    imports: [DirectEnrollDialogComponent],
    providers: [
      { provide: EnrollmentsService, useValue: { create, prorationPreview } },
      { provide: BillingPeriodsService, useValue: { list: () => of({ data: PERIODS }) } },
      {
        provide: AuthService,
        useValue: { hasPermission: (p: string) => permissions.includes(p) },
      },
      { provide: StudentsService, useValue: { list: vi.fn(() => of({ data: [STUDENT] })) } },
      { provide: FeeTemplatesService, useValue: { list: () => of({ data: TEMPLATES }) } },
      { provide: SystemClockService, useValue: { todayTaipei: signal('2027-03-15') } },
      { provide: MessageService, useValue: { add } },
    ],
  });
  const fixture = TestBed.createComponent(DirectEnrollDialogComponent);
  fixture.componentRef.setInput('classes', [{ label: '國二數學 A', value: 'class-1' }]);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.open();
  fixture.detectChanges();
  const cmp = fixture.componentInstance as any;
  const el = fixture.nativeElement as HTMLElement;
  const fill = () => {
    cmp.onStudent(STUDENT);
    cmp.classId.set('class-1');
    fixture.detectChanges();
  };
  const hint = () => el.querySelector('[data-testid="direct-enroll-hint"]')?.textContent?.trim();
  return { fixture, cmp, el, create, prorationPreview, add, closed, fill, hint };
}

describe('DirectEnrollDialogComponent（#1314 EN2）', () => {
  it('必填沒填：寫還差什麼、不送', () => {
    const { cmp, create, hint } = setup();
    expect(hint()).toBe('還沒填：學生、開課班');
    cmp.save();
    expect(create).not.toHaveBeenCalled();
  });

  it('只打字沒選到人不算選了學生', () => {
    const { cmp, fixture, hint } = setup();
    cmp.onStudent('陳');
    cmp.classId.set('class-1');
    fixture.detectChanges();
    expect(hint()).toBe('還沒填：學生');
  });

  it('送出建 active（計畫席 11-05 裁 (a)），模式預設月繳（稿選第一個），生效起預設台北今天，迄留白＝null', () => {
    const { cmp, create, add, closed, fill } = setup();
    fill();
    cmp.save();
    expect(create).toHaveBeenCalledWith({
      classId: 'class-1',
      studentId: 'stu-1',
      status: 'active',
      billingMode: 'monthly',
      effectiveFrom: '2027-03-15',
      effectiveTo: null,
      skipConflictCheck: false,
    });
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: '已幫 陳大同 報名 國二數學 A' }),
    );
    expect(closed).toHaveBeenCalledWith({ id: 'enr-new' });
  });

  it('計費模式與方案一起送；方案只列選定模式的，換模式清掉方案', () => {
    const { cmp, create, fill } = setup();
    fill();
    cmp.onMode('monthly');
    expect(cmp.templateOptions().map((o: { value: string | null }) => o.value)).toEqual([
      null,
      'ft-m',
    ]);
    cmp.feeTemplateId.set('ft-m');
    cmp.save();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ billingMode: 'monthly', feeTemplateId: 'ft-m' }),
    );
    cmp.onMode('period');
    expect(cmp.feeTemplateId()).toBeNull();
  });

  it('生效迄早於生效起：不送', () => {
    const { cmp, create, fill, fixture, hint } = setup();
    fill();
    cmp.to.set('2027-03-01');
    fixture.detectChanges();
    expect(hint()).toBe('生效迄不能早於生效起');
    cmp.save();
    expect(create).not.toHaveBeenCalled();
  });

  it('409 撞課：列出衝突、按鈕變「仍要報名」，再按帶 skipConflictCheck', () => {
    const { cmp, create, fill, fixture, el, closed } = setup();
    fill();
    create.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'SCHEDULE_CONFLICT',
          warnings: [
            {
              conflictingClassId: 'c9',
              conflictingClassName: '國二英文',
              weekday: 2,
              startTime: '18:00:00',
              endTime: '19:30:00',
            },
          ],
        },
      })) as never,
    );
    cmp.save();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="direct-enroll-conflict"]')?.textContent).toContain(
      '國二英文 · 週二 18:00–19:30',
    );
    expect(el.querySelector('[data-testid="direct-enroll-submit"]')?.textContent?.trim()).toBe(
      '仍要報名',
    );
    expect(closed).not.toHaveBeenCalled();
    cmp.save();
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ skipConflictCheck: true }));
  });

  it('額滿：對話框內寫原因、不關', () => {
    const { cmp, create, fill, fixture, hint, closed } = setup();
    fill();
    create.mockReturnValueOnce(throwError(() => ({ error: { code: 'OVER_QUOTA' } })) as never);
    cmp.save();
    fixture.detectChanges();
    expect(hint()).toBe('這個班已經額滿');
    expect(closed).not.toHaveBeenCalled();
  });

  describe('繳費單（#2296 SD9）', () => {
    it('有財務權限：預設「建立繳費單」（稿選第一個），方案必填、沒有「未指定」', () => {
      const { cmp, fill, hint, create } = setup(['manage_finance']);
      fill();
      expect(cmp.invoice()).toBe('create');
      expect(cmp.templateOptions().map((o: { value: string | null }) => o.value)).toEqual(['ft-m']);
      expect(hint()).toBe('還沒填：費用方案');
      cmp.save();
      expect(create).not.toHaveBeenCalled();
    });

    it('建立：送 pending_payment＋firstInvoice，底部唯讀首期試算（伺服器算，帶生效迄）', async () => {
      const { cmp, fill, fixture, el, create, prorationPreview } = setup(['manage_finance']);
      fill();
      cmp.feeTemplateId.set('ft-m');
      cmp.to.set('2027-06-30');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(prorationPreview).toHaveBeenLastCalledWith({
        periodMonth: '2027-03',
        effectiveFrom: '2027-03-15',
        effectiveTo: '2027-06-30',
        feeTemplateId: 'ft-m',
      });
      expect(el.querySelector('[data-testid="direct-enroll-first"]')?.textContent?.trim()).toBe(
        '首期 $1,700（期間 31 天，實際 17 天（17/31），比例試算，可調整）',
      );
      cmp.save();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending_payment',
          billingMode: 'monthly',
          feeTemplateId: 'ft-m',
          firstInvoice: {},
        }),
      );
    });

    it('堂數制：要填堂數，送 sessionCount；首期＝方案金額不按比例', () => {
      const { cmp, fill, fixture, el, hint, create } = setup(['manage_finance']);
      fill();
      cmp.onMode('session_pack');
      cmp.feeTemplateId.set('ft-s');
      fixture.detectChanges();
      expect(hint()).toBe('還沒填：堂數');
      expect(el.querySelector('[data-testid="direct-enroll-first"]')?.textContent?.trim()).toBe(
        '首期 $6,000（堂數制不按比例）',
      );
      cmp.sessionCount.set(12);
      cmp.save();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending_payment', firstInvoice: { sessionCount: 12 } }),
      );
    });

    it('期繳：生效起沒有涵蓋的繳費期 → 不送，寫原因', () => {
      const { cmp, fill, fixture, hint, create } = setup(['manage_finance']);
      fill();
      cmp.onMode('period');
      cmp.feeTemplateId.set('ft-p');
      cmp.from.set('2027-08-01');
      fixture.detectChanges();
      expect(hint()).toBe('沒有涵蓋生效起的繳費期，先到繳費期設定新增');
      cmp.save();
      expect(create).not.toHaveBeenCalled();
    });

    it('不建立：送 active、不帶 firstInvoice、方案可不選', () => {
      const { cmp, fill, create } = setup(['manage_finance']);
      fill();
      cmp.invoice.set('none');
      cmp.save();
      const body = create.mock.calls[0]![0] as Record<string, unknown>;
      expect(body['status']).toBe('active');
      expect(body).not.toHaveProperty('firstInvoice');
    });

    it('沒有財務權限：預設不建立，「建立」那顆 disabled', () => {
      const { cmp, fixture, el } = setup();
      fixture.detectChanges();
      expect(cmp.invoice()).toBe('none');
      const radios = el.querySelectorAll<HTMLInputElement>('input[name="direct-enroll-invoice"]');
      expect([...radios].map((r) => r.disabled)).toEqual([true, false]);
      expect(el.textContent).toContain('建立繳費單需要財務權限');
    });

    it('伺服器說沒有涵蓋的繳費期：對話框內寫原因、不關', () => {
      const { cmp, create, fill, fixture, hint, closed } = setup(['manage_finance']);
      fill();
      cmp.feeTemplateId.set('ft-m');
      create.mockReturnValueOnce(throwError(() => ({ error: { code: 'ZERO_AMOUNT' } })) as never);
      cmp.save();
      fixture.detectChanges();
      expect(hint()).toBe('首期金額是 0，免費請選「不建立」');
      expect(closed).not.toHaveBeenCalled();
    });
  });

  describe('送出只有 form submit 一條路（type=submit form=id，不綁 click）', () => {
    it('點底部送出鈕：save 一次', () => {
      const { cmp, fill, el } = setup();
      fill();
      const save = vi.spyOn(cmp, 'save');
      const btn = el.querySelector<HTMLButtonElement>('[data-testid="direct-enroll-submit"]')!;
      expect(btn.getAttribute('type')).toBe('submit');
      expect(btn.getAttribute('form')).toBe('direct-enroll-form');
      btn.click();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('表單 submit（欄位按 Enter）：save 一次', () => {
      const { cmp, fill, el } = setup();
      fill();
      const save = vi.spyOn(cmp, 'save');
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      expect(save).toHaveBeenCalledTimes(1);
    });
  });
});
