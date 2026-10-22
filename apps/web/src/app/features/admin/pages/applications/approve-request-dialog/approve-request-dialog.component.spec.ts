import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BillingPeriodsService } from '@core/billing-periods.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { FeeTemplatesService } from '@core/fee-templates.service';
import { ParentRequestsService, type ParentRequest } from '@core/parent-requests.service';
import { SystemClockService } from '@core/system-clock.service';
import { ApproveRequestDialogComponent } from './approve-request-dialog.component';

/**
 * #1726 拆單 2：管理端核准對話框（spec approve-request.md §1）。
 * 預選、模式不符的琥珀字、期繳沒有涵蓋的期、改金額要原因、堂數制要堂數、送出 body、撞課「仍要核准」、錯誤碼。
 */

const req = (extra: Partial<ParentRequest> = {}): ParentRequest => ({
  id: 'r1',
  kind: 'enrollment',
  status: 'pending',
  createdAt: '2026-10-05T01:00:00Z',
  student: { id: 'stu-1', name: '林小華' },
  parent: { name: '林媽媽', phone: null },
  target: { name: '國二數學 B', campusName: '大安校' },
  preferredStartDate: '2026-11-11',
  preferredTimes: null,
  note: null,
  rejectReason: null,
  classId: 'cls-1',
  billingMode: 'monthly',
  defaultFeeTemplateId: null,
  scheduledDate: null,
  scheduledStartTime: null,
  scheduledEndTime: null,
  ...extra,
});

const tpl = (id: string, billingMode: string, amount: number) => ({
  id,
  orgId: 'o1',
  name: id,
  billingMode,
  amount,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  inUseCount: 0,
});

const TEMPLATES = [
  tpl('m1', 'monthly', 3000),
  tpl('m2', 'monthly', 3500),
  tpl('p1', 'period', 20000),
  tpl('s1', 'session_pack', 4000),
];
const PERIOD = { id: 'bp1', name: '上學期', startDate: '2026-09-01', endDate: '2027-01-31' };

async function setup(request: ParentRequest = req(), periods = [PERIOD]) {
  const parents = {
    approve: vi.fn().mockReturnValue(
      of({
        data: {
          enrollmentId: 'e1',
          invoiceId: 'i1',
          invoiceNo: 'INV-1',
          amount: 2000,
          dueDate: '2026-11-04',
        },
      }),
    ),
  };
  const fees = { list: vi.fn().mockReturnValue(of({ data: TEMPLATES })) };
  const enrollments = {
    prorationPreview: vi.fn().mockReturnValue(
      of({
        fullAmount: 3000,
        amount: 2000,
        note: '當月 30 天，實際 20 天',
        periodStart: '',
        periodEnd: '',
      }),
    ),
  };
  await TestBed.configureTestingModule({
    imports: [ApproveRequestDialogComponent],
    providers: [
      { provide: ParentRequestsService, useValue: parents },
      { provide: FeeTemplatesService, useValue: fees },
      { provide: BillingPeriodsService, useValue: { list: () => of({ data: periods }) } },
      { provide: EnrollmentsService, useValue: enrollments },
      { provide: SystemClockService, useValue: { todayTaipei: signal('2026-10-21') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ApproveRequestDialogComponent);
  fixture.componentRef.setInput('request', request);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const c = fixture.componentInstance as any;
  const el = fixture.nativeElement as HTMLElement;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const click = (testid: string) =>
    el.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!.click();
  const hint = () => el.querySelector('[data-testid="hint"]')!.textContent!.trim();
  return { fixture, c, el, parents, fees, enrollments, closed, render, click, hint };
}

describe('ApproveRequestDialogComponent（#1726）', () => {
  it('只讀啟用中的價目表；生效起預設家長的希望開始', async () => {
    const { c, fees } = await setup();
    expect(fees.list).toHaveBeenCalledWith({ isActive: true });
    expect(c.effectiveFrom()).toBe('2026-11-11');
  });

  it('沒有希望開始：生效起是今天（台北）', async () => {
    const { c } = await setup(req({ preferredStartDate: null }));
    expect(c.effectiveFrom()).toBe('2026-10-21');
  });

  it('預設模式＝家長選的；該模式有兩張、沒有班級預設 → 價目表不預選', async () => {
    const { c, hint } = await setup();
    expect(c.mode()).toBe('monthly');
    expect(c.templateId()).toBeNull();
    expect(hint()).toBe('還沒填：價目表');
  });

  it('預設價目表＝班級預設（模式相符）；家長沒選模式 → 用班級預設範本的模式', async () => {
    const { c } = await setup(req({ billingMode: null, defaultFeeTemplateId: 'p1' }));
    expect(c.mode()).toBe('period');
    expect(c.templateId()).toBe('p1');
  });

  it('班級預設模式不符 → 該模式唯一一張；都沒有 → 不預選模式', async () => {
    const a = await setup(req({ billingMode: 'session_pack', defaultFeeTemplateId: 'm1' }));
    expect(a.c.templateId()).toBe('s1');
    TestBed.resetTestingModule();
    const b = await setup(req({ billingMode: null, defaultFeeTemplateId: null }));
    expect(b.c.mode()).toBeNull();
    expect(b.hint()).toBe('還沒填：計費模式、價目表');
  });

  it('改選家長沒選的模式：琥珀字「家長選的是月繳」，不擋', async () => {
    const { c, el, render } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    expect(el.querySelector('[data-testid="mode-mismatch"]')).toBeNull();
    c.setMode('period');
    await render();
    expect(el.querySelector('[data-testid="mode-mismatch"]')!.textContent).toContain(
      '家長選的是月繳',
    );
    expect(c.templateId()).toBe('p1');
    expect(c.canSubmit()).toBe(true);
  });

  it('月繳：用生效起的月份打試算，顯示試算與算式', async () => {
    const { c, el, enrollments, render } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    await render();
    expect(enrollments.prorationPreview).toHaveBeenLastCalledWith({
      periodMonth: '2026-11',
      effectiveFrom: '2026-11-11',
      feeTemplateId: 'm1',
    });
    expect(c.finalAmount()).toBe(2000);
    expect(el.querySelector('[data-testid="suggested"]')!.textContent).toContain('試算 2000 元');
    expect(el.querySelector('[data-testid="suggested"]')!.textContent).toContain('實際 20 天');
  });

  it('期繳：用涵蓋生效起的期打試算；沒有涵蓋的期 → 寫請先建立、送出無效', async () => {
    const a = await setup(req({ billingMode: 'period' }));
    await a.render();
    expect(a.enrollments.prorationPreview).toHaveBeenLastCalledWith({
      billingPeriodId: 'bp1',
      effectiveFrom: '2026-11-11',
      feeTemplateId: 'p1',
    });

    TestBed.resetTestingModule();
    const b = await setup(req({ billingMode: 'period' }), []);
    await b.render();
    expect(b.el.querySelector('[data-testid="no-period"]')!.textContent).toContain(
      '沒有涵蓋這天的繳費期，請先到設定建立',
    );
    expect(b.el.querySelector('[data-testid="submit"]')!.getAttribute('aria-disabled')).toBe(
      'true',
    );
    b.click('submit');
    expect(b.parents.approve).not.toHaveBeenCalled();
  });

  it('改了首期金額沒寫原因：擋下、提示「修改原因」；寫了才送 amount＋amountNote', async () => {
    const { c, parents, render, click, hint } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    await render();
    c.amountInput.set(1500);
    await render();
    expect(hint()).toBe('還沒填：修改原因');
    click('submit');
    expect(parents.approve).not.toHaveBeenCalled();

    c.amountNote.set(' 少上一週 ');
    await render();
    click('submit');
    expect(parents.approve).toHaveBeenCalledWith('r1', {
      billingMode: 'monthly',
      feeTemplateId: 'm1',
      effectiveFrom: '2026-11-11',
      amount: 1500,
      amountNote: '少上一週',
    });
  });

  it('改回跟試算一樣不算改；0 元擋', async () => {
    const { c, render, hint } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    await render();
    c.amountInput.set(2000);
    expect(c.amountEdited()).toBe(false);
    c.amountInput.set(0);
    c.amountNote.set('免費');
    await render();
    expect(hint()).toBe('首期金額不能是 0');
    expect(c.canSubmit()).toBe(false);
  });

  it('堂數制：堂數必填（≥1 整數）；試算＝議定價 ?? 價目表金額、不打 preview；body 帶 sessionCount', async () => {
    const { c, parents, enrollments, render, click, hint } = await setup(
      req({ billingMode: 'session_pack' }),
    );
    await render();
    expect(enrollments.prorationPreview).not.toHaveBeenCalled();
    expect(c.suggested()).toBe(4000);
    expect(hint()).toBe('還沒填：堂數');
    c.sessionCount.set(2.5);
    expect(c.canSubmit()).toBe(false);

    c.sessionCount.set(10);
    c.agreedAmount.set(3600);
    c.adjustmentNote.set('舊生');
    c.dueDate.set('2026-11-01');
    await render();
    expect(c.suggested()).toBe(3600);
    click('submit');
    expect(parents.approve).toHaveBeenCalledWith('r1', {
      billingMode: 'session_pack',
      feeTemplateId: 's1',
      effectiveFrom: '2026-11-11',
      agreedAmount: 3600,
      adjustmentNote: '舊生',
      dueDate: '2026-11-01',
      sessionCount: 10,
    });
  });

  it('議定金額要附調整原因；繳費期限不能早於今天', async () => {
    const { c, render, hint } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    c.agreedAmount.set(2800);
    await render();
    expect(hint()).toBe('還沒填：調整原因');
    c.adjustmentNote.set('手足');
    c.dueDate.set('2026-10-20');
    await render();
    expect(hint()).toBe('繳費期限不能早於今天');
  });

  it('成功：帶回帳單編號', async () => {
    const { closed, render, click } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    await render();
    click('submit');
    expect(closed).toHaveBeenCalledWith({ invoiceNo: 'INV-1' });
  });

  it('撞課：列出衝突，「仍要核准」帶 skipConflictCheck 重送', async () => {
    const { parents, el, render, click, closed } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    await render();
    parents.approve.mockReturnValueOnce(
      throwError(() => ({
        status: 409,
        error: {
          code: 'SCHEDULE_CONFLICT',
          details: {
            conflicts: [
              {
                studentId: 'stu-1',
                conflictingClassId: 'c9',
                conflictingClassName: '英文 A',
                conflictingCourseName: '國二英文',
                weekday: 3,
                startTime: '19:00:00',
                endTime: '21:00:00',
              },
            ],
          },
        },
      })),
    );
    click('submit');
    await render();
    const list = el.querySelector('[data-testid="conflicts"]')!.textContent!;
    expect(list).toContain('英文 A');
    expect(list).toContain('週三');
    expect(list).toContain('19:00–21:00');
    expect(closed).not.toHaveBeenCalled();

    click('force-approve');
    expect(parents.approve).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({ skipConflictCheck: true }),
    );
    expect(closed).toHaveBeenCalledWith({ invoiceNo: 'INV-1' });
  });

  it('議定金額：試算帶 agreedAmount（不帶 feeTemplateId），首期＝議定價的比例；沒改首期就不送 amount', async () => {
    const { c, el, parents, enrollments, render, click } = await setup(
      req({ defaultFeeTemplateId: 'm1' }),
    );
    enrollments.prorationPreview.mockImplementation((p: { agreedAmount?: number }) =>
      of({
        fullAmount: p.agreedAmount ?? 3000,
        amount: p.agreedAmount !== undefined ? Math.round((p.agreedAmount * 2) / 3) : 2000,
        note: null,
        periodStart: '',
        periodEnd: '',
      }),
    );
    c.agreedAmount.set(2700);
    c.adjustmentNote.set('手足');
    await render();
    expect(enrollments.prorationPreview).toHaveBeenLastCalledWith({
      periodMonth: '2026-11',
      effectiveFrom: '2026-11-11',
      agreedAmount: 2700,
    });
    expect(c.finalAmount()).toBe(1800);
    expect(el.querySelector('[data-testid="suggested"]')!.textContent).toContain('試算 1800 元');

    click('submit');
    const body = parents.approve.mock.calls[0][1];
    expect(body).toEqual({
      billingMode: 'monthly',
      feeTemplateId: 'm1',
      effectiveFrom: '2026-11-11',
      agreedAmount: 2700,
      adjustmentNote: '手足',
    });
    expect('amount' in body).toBe(false);
  });

  it('價目表選單只列目前模式的啟用中範本；換模式清掉不同模式的已選範本', async () => {
    const { c, render } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    const optionIds = () => c.templateOptions().map((o: { value: string }) => o.value);
    expect(optionIds()).toEqual(['m1', 'm2']);
    expect(c.templateId()).toBe('m1');

    c.setMode('period');
    await render();
    expect(optionIds()).toEqual(['p1']);
    expect(c.templateId()).toBe('p1');

    // 堂數制沒有班級預設、只有一張 → 換成那張，月繳的 m1 不能留著
    c.setMode('session_pack');
    expect(optionIds()).toEqual(['s1']);
    expect(c.templateId()).toBe('s1');
  });

  it('期繳：兩期都涵蓋生效起 → 取最晚開始那期（同 API ORDER BY start_date DESC）', async () => {
    const early = { id: 'bp-early', name: '全年', startDate: '2026-08-01', endDate: '2027-07-31' };
    const late = { id: 'bp-late', name: '上學期', startDate: '2026-09-01', endDate: '2027-01-31' };
    for (const periods of [
      [early, late],
      [late, early],
    ]) {
      TestBed.resetTestingModule();
      const { enrollments, render } = await setup(req({ billingMode: 'period' }), periods);
      await render();
      expect(enrollments.prorationPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ billingPeriodId: 'bp-late' }),
      );
    }
  });

  const conflictError = () =>
    throwError(() => ({
      status: 409,
      error: {
        code: 'SCHEDULE_CONFLICT',
        details: {
          conflicts: [
            {
              studentId: 'stu-1',
              conflictingClassId: 'c9',
              conflictingClassName: '英文 A',
              conflictingCourseName: '國二英文',
              weekday: 3,
              startTime: '19:00:00',
              endTime: '21:00:00',
            },
          ],
        },
      },
    }));

  it('撞課後「仍要核准」回額滿：收掉撞課清單與「仍要核准」、寫額滿', async () => {
    const { parents, el, render, click, hint } = await setup(req({ defaultFeeTemplateId: 'm1' }));
    await render();
    parents.approve
      .mockReturnValueOnce(conflictError())
      .mockReturnValueOnce(throwError(() => ({ status: 409, error: { code: 'CLASS_FULL' } })));
    click('submit');
    await render();
    expect(el.querySelector('[data-testid="conflicts"]')).not.toBeNull();

    click('force-approve');
    await render();
    expect(el.querySelector('[data-testid="conflicts"]')).toBeNull();
    expect(el.querySelector('[data-testid="force-approve"]')).toBeNull();
    expect(el.querySelector('[data-testid="submit"]')).not.toBeNull();
    expect(hint()).toContain('這班已額滿');
  });

  it.each<[string, (c: any) => void]>([
    ['模式', (c) => c.setMode('period')],
    ['價目表', (c) => c.templateId.set('m2')],
    ['議定金額', (c) => c.agreedAmount.set(2500)],
    ['生效起', (c) => c.effectiveFrom.set('2026-11-18')],
    ['首期金額', (c) => c.amountInput.set(1500)],
    ['繳費期限', (c) => c.dueDate.set('2026-11-30')],
    ['堂數', (c) => c.sessionCount.set(8)],
  ])(
    '撞課後改了%s：收掉撞課清單，主按鈕回到「核准」（不會帶 skipConflictCheck 送沒檢查過的值）',
    async (_label, change) => {
      const { c, parents, el, render, click } = await setup(req({ defaultFeeTemplateId: 'm1' }));
      await render();
      parents.approve.mockReturnValueOnce(conflictError());
      click('submit');
      await render();
      expect(el.querySelector('[data-testid="force-approve"]')).not.toBeNull();

      change(c);
      await render();
      expect(el.querySelector('[data-testid="conflicts"]')).toBeNull();
      expect(el.querySelector('[data-testid="force-approve"]')).toBeNull();
      expect(el.querySelector('[data-testid="submit"]')).not.toBeNull();
      expect(c.errorMessage()).toBeNull();
    },
  );

  it.each([
    [409, 'CLASS_FULL', undefined, '這班已額滿'],
    [409, 'NOT_APPROVABLE', undefined, '這筆申請已經不是待審核（可能已被處理），請重新整理'],
    [409, 'ALREADY_ENROLLED', undefined, '孩子已經在這班了'],
    [409, 'NO_BILLING_PERIOD', undefined, '沒有涵蓋這天的繳費期，請先到設定建立'],
    [400, 'AMOUNT_NOTE_REQUIRED', { suggested: 1800 }, '首期金額跟試算（1800 元）不同，要寫原因'],
    [403, 'FINANCE_REQUIRED', undefined, '需要財務權限'],
    [0, undefined, undefined, '連線失敗，請檢查網路後再試'],
    [500, 'SERVER_ERROR', undefined, '核准失敗，請稍後再試'],
  ])('%s %s：錯誤寫在表單、不關', async (status, code, details, message) => {
    const { parents, render, click, hint, closed, c } = await setup(
      req({ defaultFeeTemplateId: 'm1' }),
    );
    await render();
    parents.approve.mockReturnValueOnce(
      throwError(() => ({ status, error: code ? { code, details } : null })),
    );
    click('submit');
    await render();
    expect(hint()).toContain(message);
    expect(closed).not.toHaveBeenCalled();
    expect(c.templateId()).toBe('m1');
  });
});
