import { TestBed } from '@angular/core/testing';
import { MessageService, type MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PublicApplicationsService,
  type PublicApplication,
} from '@core/public-applications.service';
import { ParentRequestsService, type ParentRequest } from '@core/parent-requests.service';
import { AuthService } from '@core/auth.service';
import { BillingPeriodsService } from '@core/billing-periods.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { FeeTemplatesService } from '@core/fee-templates.service';
import { ApplicationsPage } from './applications.page';

/**
 * #1245：管理端看公開申請。預設只列待處理（new＋contacted）；改狀態、寫備註；
 * 「建立家長」開既有的新增家長表單並預填 —— 不自動改狀態、不自動建學生或報名。
 */

const app = (extra: Partial<PublicApplication> = {}): PublicApplication => ({
  id: 'a1',
  kind: 'enrollment',
  status: 'new',
  createdAt: '2026-10-04T01:00:00Z',
  parent: { name: '王媽媽', email: null, phone: '0912345678', relation: 'mother' },
  student: { name: '王小明', grade: 'J2', school: '信義國中' },
  preferredStartDate: null,
  preferredTimes: null,
  note: '想週三上課',
  staffNote: null,
  targets: [
    { type: 'class', name: '國二數學 A', campusName: '信義校', isWaitlist: true, deleted: false },
    { type: 'class', name: null, campusName: null, isWaitlist: false, deleted: true },
  ],
  ...extra,
});

/** #1707：家長在 app 送的申請 */
const req = (extra: Partial<ParentRequest> = {}): ParentRequest => ({
  id: 'r1',
  kind: 'enrollment',
  status: 'pending',
  createdAt: '2026-10-05T01:00:00Z',
  student: { id: 'stu-1', name: '林小華' },
  parent: { name: '林媽媽', phone: '0912000111' },
  target: { name: '國二數學 B', campusName: '大安校' },
  preferredStartDate: '2026-11-01',
  preferredTimes: null,
  note: '想上週六班',
  rejectReason: null,
  classId: 'cls-1',
  billingMode: 'monthly',
  defaultFeeTemplateId: null,
  scheduledDate: null,
  scheduledStartTime: null,
  scheduledEndTime: null,
  ...extra,
});

async function setup(
  parentData: ParentRequest[] = [req()],
  permissions = ['manage_finance'],
  /** 進頁時網址上的 query（通知連過來帶 `?kind=`，#1821） */
  query: Record<string, string> | null = null,
) {
  const parents = {
    list: vi.fn().mockReturnValue(of({ data: parentData })),
    reject: vi.fn((id: string, reason: string) =>
      of({ data: req({ id, status: 'rejected', rejectReason: reason }) }),
    ),
    setTrialStatus: vi.fn((id: string, status: string, schedule?: object) =>
      of({ data: req({ id, kind: 'trial', status, ...schedule }) }),
    ),
  };
  const service = {
    list: vi.fn().mockReturnValue(of({ data: [app()] })),
    update: vi.fn((_id: string, patch: object) =>
      of({ data: app(patch as Partial<PublicApplication>) }),
    ),
  };
  const dialog = { open: vi.fn().mockReturnValue({ onClose: of(undefined) }) };
  await TestBed.configureTestingModule({
    imports: [ApplicationsPage],
    providers: [
      provideRouter([]),
      { provide: PublicApplicationsService, useValue: service },
      { provide: ParentRequestsService, useValue: parents },
      { provide: MessageService, useValue: { add: vi.fn() } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
      // 核准對話框（#1726）開起來會讀這三支；這裡只驗頁面怎麼開、關、toast
      { provide: FeeTemplatesService, useValue: { list: () => of({ data: [] }) } },
      { provide: BillingPeriodsService, useValue: { list: () => of({ data: [] }) } },
      { provide: EnrollmentsService, useValue: { prorationPreview: () => of(null) } },
      ...(query
        ? [
            {
              provide: ActivatedRoute,
              useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
            },
          ]
        : []),
    ],
  })
    .overrideComponent(ApplicationsPage, {
      set: { providers: [{ provide: DialogService, useValue: dialog }] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(ApplicationsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, service, parents, dialog, el: fixture.nativeElement as HTMLElement };
}

describe('ApplicationsPage（#1245）', () => {
  // #1821：申請提醒的連結帶 ?kind=，點進來要落在那個分頁
  it.each([
    ['trial', 'trial'],
    ['enrollment', 'enrollment'],
    ['bogus', null],
  ] as const)('網址 ?kind=%s → 以 %s 讀取', async (kind, expected) => {
    const { service, parents } = await setup([req()], ['manage_finance'], { kind });

    expect(service.list).toHaveBeenCalledWith({ statuses: ['new', 'contacted'], kind: expected });
    expect(parents.list).toHaveBeenCalledWith(expect.objectContaining({ kind: expected }));
  });

  it('預設讀待處理；卡片有學生、家長、目標班（候補、已刪除）與家長備註', async () => {
    const { service, el } = await setup();

    expect(service.list).toHaveBeenCalledWith({ statuses: ['new', 'contacted'], kind: null });
    const card = el.querySelector('[data-testid="application-card"]')!;
    expect(card.textContent).toContain('王小明');
    expect(card.textContent).toContain('國二');
    expect(card.textContent).toContain('王媽媽（母親）');
    expect(card.textContent).toContain('國二數學 A');
    expect(card.textContent).toContain('候補');
    expect(card.textContent).toContain('已刪除的班');
    expect(card.textContent).toContain('想週三上課');
    expect(card.querySelector('a[href="tel:0912345678"]')).not.toBeNull();
  });

  it('改狀態送 PATCH', async () => {
    const { fixture, service } = await setup();

    (fixture.componentInstance as any).setStatus(app(), 'contacted');

    expect(service.update).toHaveBeenCalledWith('a1', { status: 'contacted' });
  });

  it('備註沒改不送；改了才送', async () => {
    const { fixture, service } = await setup();
    const page = fixture.componentInstance as any;

    page.saveNote(app(), '');
    expect(service.update).not.toHaveBeenCalled();
    page.saveNote(app(), ' 10/4 打過電話 ');
    expect(service.update).toHaveBeenCalledWith('a1', { staffNote: '10/4 打過電話' });
  });

  it('「建立家長」開新增家長表單、預填申請人；不改狀態', async () => {
    const { fixture, service, dialog } = await setup();

    (fixture.componentInstance as any).createParent(app());

    expect(dialog.open.mock.calls[0][1].data).toEqual({
      parent: null,
      prefill: { name: '王媽媽', email: null, phone: '0912345678' },
    });
    expect(service.update).not.toHaveBeenCalled();
  });
});

/**
 * #1707：家長登入後在 app 送的申請，跟公開申請同一頁（使用者裁定 (a)）。兩套狀態不合併，分頁共用；
 * 報名可核准（#1726）或拒絕（原因家長看得到）；試聽改狀態。
 */
describe('ApplicationsPage：家長 App 的申請（#1707）', () => {
  const page = (f: { componentInstance: unknown }) => f.componentInstance as any;
  const cards = (el: HTMLElement) =>
    [
      ...el.querySelectorAll(
        '[data-testid="application-card"], [data-testid="parent-request-card"]',
      ),
    ].map((c) => c.getAttribute('data-testid'));

  // #1874：依要做的事分章 —— 家長 App 的報名在「報名」章、公開表單在「新家長」章；列上標狀態（不再標來源）
  it('待處理：兩支都打；家長 App 報名在「報名」章、公開表單在「新家長」章，列上標狀態', async () => {
    const { parents, service, el } = await setup();

    expect(service.list).toHaveBeenCalledWith({ statuses: ['new', 'contacted'], kind: null });
    expect(parents.list).toHaveBeenCalledWith({ group: 'pending', kind: null });
    expect(cards(el)).toEqual(['parent-request-card', 'application-card']);
    expect(
      [...el.querySelectorAll('section[data-chapter]')].map((c) => c.getAttribute('data-chapter')),
    ).toEqual(['enroll', 'lead']);

    const card = el.querySelector('[data-testid="parent-request-card"]')!;
    expect(card.closest('section')!.getAttribute('data-chapter')).toBe('enroll');
    expect(card.textContent).toContain('待審核');
    expect(card.textContent).toContain('林媽媽');
    expect(card.querySelector('a[href="tel:0912000111"]')).not.toBeNull();
    expect(card.querySelector('a[href="/admin/students/stu-1"]')?.textContent).toContain('林小華');
    expect(card.textContent).toContain('國二數學 B');
    expect(card.textContent).toContain('大安校');
    expect(card.textContent).toContain('2026-11-01');
    expect(card.textContent).toContain('想上週六班');
    expect(card.textContent).not.toContain('目前請到學生檔案手動報名');
  });

  // 外層清單原本沒有 list-none：li 在 flex 容器裡仍是 list-item，每張卡片左邊多一個圓點（#1245 起就有）
  it('卡片清單不顯示項目符號', async () => {
    const { el } = await setup();
    const list = el.querySelector('[data-testid="parent-request-card"]')!.parentElement!;
    expect(list.classList).toContain('list-none');
  });

  // 每個分頁對兩種來源各打什麼（#1707 範圍說明 §2）；null＝那一邊不打
  it.each<[string, string[] | null, string | null]>([
    ['待處理', ['new', 'contacted'], 'pending'],
    ['進行中', null, 'active'],
    ['已轉入', ['converted'], 'done'],
    ['不受理', ['rejected'], 'rejected'],
    ['已取消', null, 'cancelled'],
    ['垃圾送件', ['spam'], null],
  ])('分頁「%s」：公開表單 statuses=%j、家長 App group=%s', async (label, statuses, group) => {
    const { fixture, parents, service } = await setup();
    const p = page(fixture);
    service.list.mockClear();
    parents.list.mockClear();
    p.setFilter(p.filters.find((f: { label: string }) => f.label === label));

    if (statuses) expect(service.list).toHaveBeenCalledWith({ statuses, kind: null });
    else expect(service.list).not.toHaveBeenCalled();
    if (group) expect(parents.list).toHaveBeenCalledWith({ group, kind: null });
    else expect(parents.list).not.toHaveBeenCalled();
  });

  it('只有一邊有的分頁：另一邊不打（已取消只有家長 App、垃圾送件只有公開表單）', async () => {
    const { fixture, parents, service } = await setup();
    const p = page(fixture);
    const tab = (label: string) => p.filters.find((f: { label: string }) => f.label === label);

    service.list.mockClear();
    parents.list.mockClear();
    p.setFilter(tab('已取消'));
    expect(service.list).not.toHaveBeenCalled();
    expect(parents.list).toHaveBeenCalledWith({ group: 'cancelled', kind: null });

    service.list.mockClear();
    parents.list.mockClear();
    p.setFilter(tab('垃圾送件'));
    expect(parents.list).not.toHaveBeenCalled();
    expect(service.list).toHaveBeenCalledWith({ statuses: ['spam'], kind: null });
  });

  it('拒絕報名：原因必填；送出後卡片換成已拒絕＋原因', async () => {
    const { fixture, parents, el } = await setup();
    const p = page(fixture);

    p.startReject(req());
    fixture.detectChanges();
    p.submitReject(req(), '   ');
    expect(parents.reject).not.toHaveBeenCalled();

    p.submitReject(req(), ' 這班已經額滿 ');
    fixture.detectChanges();
    expect(parents.reject).toHaveBeenCalledWith('r1', '這班已經額滿');
    const card = el.querySelector('[data-testid="parent-request-card"]')!;
    expect(card.textContent).toContain('已拒絕');
    expect(card.textContent).toContain('這班已經額滿');
  });

  // #1874：拒絕收進列的「⋯」（全頁一份選單，打開時依那一列重算）
  const menuLabels = (p: any, item: unknown) => {
    p.menuFor.set(item);
    return (p.rowMenuItems() as Array<{ label?: string }>).map((i) => i.label);
  };

  it('待審核、候補的報名：「⋯」裡有拒絕（跟 API 可拒絕的狀態同一條）', async () => {
    for (const status of ['pending', 'waitlist']) {
      TestBed.resetTestingModule();
      const { fixture } = await setup([req({ status })]);
      const p = page(fixture);
      expect(menuLabels(p, p.items()[0])).toContain('拒絕…');
    }
  });

  it('拒絕回 409（被搶先核准）：說清楚、收起原因欄、重抓；其他錯誤寫稍後再試', async () => {
    const { fixture, parents, el } = await setup();
    const p = page(fixture);
    const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
    parents.reject.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    p.startReject(req());
    parents.list.mockClear();
    p.submitReject(req(), '額滿');
    fixture.detectChanges();
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ summary: '這筆已經不是待審核' }),
    );
    expect(p.rejectingId()).toBeNull();
    expect(parents.list).toHaveBeenCalledTimes(1);
    expect(el.querySelector('textarea[aria-label^="拒絕原因"]')).toBeNull();

    parents.reject.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    p.startReject(req());
    parents.list.mockClear();
    p.submitReject(req(), '額滿');
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ summary: '拒絕失敗' }));
    expect(parents.list).not.toHaveBeenCalled();
  });

  it('試聽改狀態失敗：那一列換成新物件（讓下拉重畫回原狀態）', async () => {
    const trial = req({ id: 't1', kind: 'trial', status: 'pending' });
    const { fixture, parents } = await setup([trial]);
    const p = page(fixture);
    parents.setTrialStatus.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    const before = p.requests()[0];
    p.setTrialStatus(before, 'completed');
    const after = p.requests()[0];
    expect(after).not.toBe(before);
    expect(after.status).toBe('pending');
  });

  it('已拒絕、待繳費的報名：「⋯」裡沒有拒絕、列上也沒有核准', async () => {
    for (const status of ['rejected', 'awaiting_payment']) {
      TestBed.resetTestingModule();
      const { fixture, el } = await setup([req({ status })]);
      const p = page(fixture);
      expect(
        menuLabels(
          p,
          p.items().find((i: any) => i.source === 'parent'),
        ),
      ).not.toContain('拒絕…');
      const buttons = [...el.querySelectorAll('[data-testid="parent-request-card"] button')];
      expect(buttons.some((b) => b.textContent?.trim() === '核准')).toBe(false);
    }
  });

  it('試聽：改狀態送出', async () => {
    const trial = req({
      id: 't1',
      kind: 'trial',
      preferredStartDate: null,
      preferredTimes: '平日晚上',
    });
    const { fixture, parents, el } = await setup([trial]);
    expect(el.textContent).toContain('平日晚上');

    page(fixture).setTrialStatus(trial, 'pending'); // 沒變不送
    expect(parents.setTrialStatus).not.toHaveBeenCalled();
    page(fixture).setTrialStatus(trial, 'completed');
    expect(parents.setTrialStatus).toHaveBeenCalledWith('t1', 'completed', undefined);
  });

  // ── #1747 試聽排定日期（計畫席 10-22：日期必填、時間選填）──────────────────
  describe('試聽排定日期（#1747）', () => {
    const input = (el: HTMLElement, label: string) =>
      el.querySelector<HTMLInputElement>(`input[aria-label^="${label}"]`)!;
    const button = (el: HTMLElement, text: string) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

    it('選「已排定」不直接送：下拉彈回原狀態，展開日期表單', async () => {
      const trial = req({ id: 't1', kind: 'trial' });
      const { fixture, parents, el } = await setup([trial]);
      page(fixture).setTrialStatus(trial, 'scheduled');
      fixture.detectChanges();

      expect(parents.setTrialStatus).not.toHaveBeenCalled();
      expect(page(fixture).requests()[0]!.status).toBe('pending');
      expect(page(fixture).requests()[0]).not.toBe(trial);
      expect(input(el, '試聽日期')).toBeTruthy();
    });

    it('填日期與時間按確定：送 scheduled＋三欄，成功收起表單、顯示日期', async () => {
      const trial = req({ id: 't1', kind: 'trial' });
      const { fixture, parents, el } = await setup([trial]);
      page(fixture).setTrialStatus(trial, 'scheduled');
      fixture.detectChanges();
      input(el, '試聽日期').value = '2026-11-04';
      input(el, '開始時間').value = '19:00';
      input(el, '結束時間').value = '20:30';
      button(el, '確定排定').click();
      fixture.detectChanges();

      expect(parents.setTrialStatus).toHaveBeenCalledWith('t1', 'scheduled', {
        scheduledDate: '2026-11-04',
        scheduledStartTime: '19:00',
        scheduledEndTime: '20:30',
      });
      expect(page(fixture).schedulingId()).toBeNull();
      expect(
        el.querySelector('[data-testid="trial-schedule"]')!.textContent!.replace(/\s+/g, ''),
      ).toBe('試聽：11/4（三）19:00–20:30');
    });

    it('沒填日期不送；時間沒填就不帶（不送空字串）', async () => {
      const trial = req({ id: 't1', kind: 'trial' });
      const { fixture, parents } = await setup([trial]);
      page(fixture).submitSchedule(trial, '', '19:00', '');
      expect(parents.setTrialStatus).not.toHaveBeenCalled();

      page(fixture).submitSchedule(trial, '2026-11-04', '', '');
      expect(parents.setTrialStatus).toHaveBeenCalledWith('t1', 'scheduled', {
        scheduledDate: '2026-11-04',
      });
    });

    it('已排定：顯示日期與「改時間」，表單帶入原值', async () => {
      const trial = req({
        id: 't1',
        kind: 'trial',
        status: 'scheduled',
        scheduledDate: '2026-11-04',
        scheduledStartTime: '19:00',
      });
      const { fixture, el } = await setup([trial]);
      expect(el.querySelector('[data-testid="trial-schedule"]')!.textContent).toContain(
        '11/4（三）',
      );
      button(el, '改時間').click();
      fixture.detectChanges();
      expect(input(el, '試聽日期').value).toBe('2026-11-04');
      expect(input(el, '開始時間').value).toBe('19:00');
    });

    it.each([
      [{ scheduledDate: '2026-11-04' }, '試聽：11/4（三）'],
      [{ scheduledDate: '2026-11-04', scheduledStartTime: '19:00' }, '試聽：11/4（三）19:00'],
    ])('只有日期、只有開始時間：不出現多餘的「–」或 null（%o）', async (extra, expected) => {
      const trial = req({ id: 't1', kind: 'trial', status: 'scheduled', ...extra });
      const { el } = await setup([trial]);
      const text = el
        .querySelector('[data-testid="trial-schedule"]')!
        .textContent!.replace(/\s+/g, '');
      expect(text).toBe(expected);
    });

    it('表單按「取消」：收起表單、不送出', async () => {
      const trial = req({ id: 't1', kind: 'trial' });
      const { fixture, parents, el } = await setup([trial]);
      page(fixture).setTrialStatus(trial, 'scheduled');
      fixture.detectChanges();
      // 頁上別處也有「取消」（例：拒絕原因），要按的是日期表單裡那顆
      button(input(el, '試聽日期').closest('div')!.parentElement as HTMLElement, '取消').click();
      fixture.detectChanges();
      expect(page(fixture).schedulingId()).toBeNull();
      expect(input(el, '試聽日期')).toBeNull();
      expect(parents.setTrialStatus).not.toHaveBeenCalled();
    });

    it('400（時間不合法）：說出後端原因，表單留著', async () => {
      const trial = req({ id: 't1', kind: 'trial' });
      const { fixture, parents } = await setup([trial]);
      const messages = TestBed.inject(MessageService) as unknown as {
        add: ReturnType<typeof vi.fn>;
      };
      parents.setTrialStatus.mockReturnValueOnce(
        throwError(() => ({ status: 400, error: { error: '結束時間要晚於開始時間' } })),
      );
      page(fixture).setTrialStatus(trial, 'scheduled');
      page(fixture).submitSchedule(trial, '2026-11-04', '19:00', '18:00');

      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({ detail: '結束時間要晚於開始時間' }),
      );
      expect(page(fixture).schedulingId()).toBe('t1');
    });
  });

  it('家長 App 那支讀不到：整頁顯示讀取失敗（可重試）', async () => {
    TestBed.resetTestingModule();
    const { fixture, parents } = await setup();
    parents.list.mockReturnValue(throwError(() => new Error('boom')));
    page(fixture).load();
    fixture.detectChanges();
    expect(page(fixture).failed()).toBe(true);
  });

  describe('核准（#1726）', () => {
    // jsdom 沒有 <dialog> 的 modal 行為：只補開關狀態與 close 事件（照家長端請假）
    const dialogProto = HTMLDialogElement.prototype;
    const originalDialog = { showModal: dialogProto.showModal, close: dialogProto.close };
    beforeEach(() => {
      dialogProto.showModal = function (this: HTMLDialogElement) {
        this.open = true;
      };
      dialogProto.close = function (this: HTMLDialogElement) {
        if (!this.open) return;
        this.open = false;
        this.dispatchEvent(new Event('close'));
      };
    });
    afterEach(() => Object.assign(dialogProto, originalDialog));

    const approveButton = (el: HTMLElement) =>
      [
        ...el.querySelectorAll<HTMLButtonElement>('[data-testid="parent-request-card"] button'),
      ].find((b) => b.textContent?.trim() === '核准');

    it('待審核：拒絕旁有核准鈕；點了開對話框', async () => {
      TestBed.resetTestingModule();
      const { fixture, el } = await setup();
      const button = approveButton(el)!;
      expect(button.disabled).toBe(false);
      button.click();
      await Promise.resolve();
      fixture.detectChanges();
      const dialog = el.querySelector<HTMLDialogElement>('dialog')!;
      expect(dialog.open).toBe(true);
      expect(dialog.querySelector('app-approve-request-dialog')).not.toBeNull();
      expect(dialog.textContent).toContain('林小華');
    });

    it('沒有 manage_finance：核准鈕停用、寫「需要財務權限」（Q6）', async () => {
      TestBed.resetTestingModule();
      const { el } = await setup([req()], []);
      expect(approveButton(el)!.disabled).toBe(true);
      expect(el.querySelector('[data-testid="parent-request-card"]')!.textContent).toContain(
        '需要財務權限',
      );
    });

    it('待繳費：沒有核准鈕', async () => {
      TestBed.resetTestingModule();
      const { el } = await setup([req({ status: 'awaiting_payment' })]);
      expect(approveButton(el)).toBeUndefined();
    });

    it('核准成功：關對話框、toast 帳單編號、重抓；取消只關', async () => {
      TestBed.resetTestingModule();
      const { fixture, parents, el } = await setup();
      const p = page(fixture);
      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');

      p.openApprove(req());
      await Promise.resolve();
      fixture.detectChanges();
      parents.list.mockClear();
      p.onApproveClosed(null);
      fixture.detectChanges();
      expect(el.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
      expect(p.approving()).toBeNull();
      expect(toast).not.toHaveBeenCalled();
      expect(parents.list).not.toHaveBeenCalled();

      p.openApprove(req());
      await Promise.resolve();
      p.onApproveClosed({ invoiceNo: 'INV-202610-0001' });
      expect(el.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ summary: '已核准，帳單 INV-202610-0001 已開' }),
      );
      expect(parents.list).toHaveBeenCalledTimes(1);
    });
  });
});

/** #1874：A6 語言重排（版面稿使用者 10-22 確認）—— 只改畫面，寫入路徑不變 */
describe('ApplicationsPage：版面（#1874）', () => {
  const page = (f: { componentInstance: unknown }) => f.componentInstance as any;
  const title = (el: HTMLElement) =>
    el.querySelector('app-page-open h1')!.textContent!.replace(/\s+/g, '');
  const labels = (p: any, item: unknown) => {
    p.menuFor.set(item);
    return (p.rowMenuItems() as Array<{ label?: string }>).map((i) => i.label);
  };
  const trial = (extra: Partial<ParentRequest> = {}) =>
    req({
      id: 't1',
      kind: 'trial',
      status: 'pending',
      createdAt: '2026-10-06T01:00:00Z',
      ...extra,
    });

  it('三章依序：報名、試聽、新家長；家長 App 的試聽在「試聽」章', async () => {
    const { el } = await setup([req(), trial()]);
    const chapters = [...el.querySelectorAll('section[data-chapter]')];
    expect(chapters.map((c) => c.getAttribute('data-chapter'))).toEqual([
      'enroll',
      'trial',
      'lead',
    ]);
    expect(chapters[1]!.querySelectorAll('[data-testid="parent-request-card"]')).toHaveLength(1);
  });

  it('色面句：待處理寫「N 筆申請等你處理」，有沒排的試聽再加一句；別的分頁寫「分頁名 N 筆」', async () => {
    // 二讀：已排定的試聽不算「還沒排」—— 只數 status === 'pending'
    const scheduled = trial({ id: 't2', status: 'scheduled', scheduledDate: '2026-10-25' });
    const { fixture, el } = await setup([req(), trial(), scheduled]);
    expect(title(el)).toBe('4筆申請等你處理，1堂試聽還沒排時間。');
    // 模板換行不能變成標點前的空白（實機截圖抓到「處理 ，」）
    expect(el.querySelector('app-page-open h1')!.textContent).not.toMatch(/\s[，。]/);

    const p = page(fixture);
    p.setFilter(p.filters.find((f: { label: string }) => f.label === '已轉入'));
    fixture.detectChanges();
    expect(title(el)).toBe('已轉入4筆。');
  });

  it('完成的報名寫「已轉正式」（不寫已繳清：手動轉正式也會完成）；待繳費、完成的試聽不寫', async () => {
    const { el } = await setup([
      req({ id: 'r1', status: 'completed' }),
      req({ id: 'r2', status: 'awaiting_payment' }),
      trial({ status: 'completed' }),
    ]);
    const marks = el.querySelectorAll('[data-testid="request-completed"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent!.trim()).toBe('已轉正式');
    expect(marks[0]!.closest('[data-testid="parent-request-card"]')!.textContent).toContain(
      '已完成',
    );
    expect(el.textContent).not.toContain('已繳清');
  });

  it('沒有沒排的試聽：色面只有第一句', async () => {
    const { el } = await setup([req()]);
    expect(title(el)).toBe('2筆申請等你處理。');
  });

  it('待處理沒有申請：色面寫「沒有待處理的申請。」', async () => {
    const { fixture, el, service } = await setup([]);
    service.list.mockReturnValue(of({ data: [] }));
    page(fixture).load();
    fixture.detectChanges();
    expect(title(el)).toBe('沒有待處理的申請。');
  });

  it('「查看學生檔案」導到那個學生的檔案頁（帶學生 id）', async () => {
    const { fixture } = await setup([trial()]);
    const p = page(fixture);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    p.menuFor.set(p.items().find((i: any) => i.source === 'parent'));
    const profile = (p.rowMenuItems() as MenuItem[]).find((i) => i.label === '查看學生檔案')!;
    profile.command!({});
    expect(navigate).toHaveBeenCalledWith(['/admin/students', 'stu-1']);
  });

  it('搜尋：學生、家長姓名或電話數字（不打 API）；沒有符合的寫一句提示', async () => {
    const { fixture, el, service, parents } = await setup([req()]);
    const p = page(fixture);
    service.list.mockClear();
    parents.list.mockClear();
    const shown = () =>
      el.querySelectorAll('[data-testid="parent-request-card"], [data-testid="application-card"]')
        .length;

    p.query.set('林小');
    fixture.detectChanges();
    expect(shown()).toBe(1);
    p.query.set('王媽');
    fixture.detectChanges();
    expect(shown()).toBe(1);
    p.query.set('0912-345');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="application-card"]')).not.toBeNull();
    expect(shown()).toBe(1);
    p.query.set('沒這個人');
    fixture.detectChanges();
    expect(shown()).toBe(0);
    expect(el.textContent).toContain('找不到符合「沒這個人」的申請');
    expect(service.list).not.toHaveBeenCalled();
    expect(parents.list).not.toHaveBeenCalled();
  });

  it('核准是深色主鈕（這頁最重的一步）', async () => {
    const { el } = await setup([req()]);
    const approve = [...el.querySelectorAll('[data-testid="parent-request-card"] button')].find(
      (b) => b.textContent?.trim() === '核准',
    )!;
    expect(approve.classList).toContain('bg-zinc-900');
    expect(approve.classList).toContain('text-white');
  });

  it('試聽的「⋯」：改成其他狀態（不含已排定：要填日期，走「排時間」），加查看學生檔案', async () => {
    const { fixture } = await setup([trial()]);
    const p = page(fixture);
    const item = p.items().find((i: any) => i.source === 'parent');
    expect(labels(p, item)).toEqual([
      '改成「已完成」',
      '改成「已取消」',
      undefined,
      '查看學生檔案',
    ]);
  });

  it('公開表單的「⋯」：改聯絡狀態（不含目前的）送 PATCH；櫃檯備註展開、儲存才送並收起', async () => {
    const { fixture, el, service } = await setup([]);
    const p = page(fixture);
    const item = p.items()[0];
    const ls = labels(p, item);
    expect(ls).not.toContain('改成「新申請」');
    expect(ls).toContain('改成「垃圾送件」');
    expect(ls).toContain('櫃檯備註');

    (p.rowMenuItems() as Array<{ label?: string; command?: () => void }>).find(
      (i) => i.label === '改成「已聯絡」',
    )!.command!();
    expect(service.update).toHaveBeenCalledWith('a1', { status: 'contacted' });

    service.update.mockClear();
    (p.rowMenuItems() as Array<{ label?: string; command?: () => void }>).find(
      (i) => i.label === '櫃檯備註',
    )!.command!();
    fixture.detectChanges();
    const ta = el.querySelector<HTMLTextAreaElement>('textarea[aria-label^="櫃檯備註"]')!;
    expect(ta).not.toBeNull();
    expect(service.update).not.toHaveBeenCalled();
    p.submitNote(app(), '週六來試聽');
    fixture.detectChanges();
    expect(service.update).toHaveBeenCalledWith('a1', { staffNote: '週六來試聽' });
    expect(el.querySelector('textarea[aria-label^="櫃檯備註"]')).toBeNull();
  });

  // 二讀：存檔失敗時編輯列不能收起，打的字要留著，並跳錯誤
  it('櫃檯備註存檔失敗：編輯列留著、打的字還在、跳錯誤；重按成功才收起', async () => {
    const { fixture, el, service } = await setup([]);
    const p = page(fixture);
    const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
    p.notingId.set('a1');
    fixture.detectChanges();
    const ta = () => el.querySelector<HTMLTextAreaElement>('textarea[aria-label^="櫃檯備註"]');
    ta()!.value = '週六來試聽';

    service.update.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    p.submitNote(app(), ta()!.value);
    fixture.detectChanges();
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'error' }));
    expect(p.notingId()).toBe('a1');
    expect(ta()!.value).toBe('週六來試聽');

    p.submitNote(app(), ta()!.value);
    fixture.detectChanges();
    expect(service.update).toHaveBeenLastCalledWith('a1', { staffNote: '週六來試聽' });
    expect(ta()).toBeNull();
  });

  it('櫃檯備註沒改就按儲存：直接收起、不送', async () => {
    const { fixture, service } = await setup([]);
    const p = page(fixture);
    p.notingId.set('a1');
    p.submitNote(app(), '  ');
    expect(service.update).not.toHaveBeenCalled();
    expect(p.notingId()).toBeNull();
  });

  it('試聽列：待安排是「排時間」、已排定是「改時間」，按了展開日期表單', async () => {
    const { fixture, el } = await setup([trial()]);
    const btn = () =>
      [...el.querySelectorAll('[data-testid="parent-request-card"] button')].find((b) =>
        /排時間|改時間/.test(b.textContent ?? ''),
      ) as HTMLButtonElement;
    expect(btn().textContent?.trim()).toBe('排時間');
    btn().click();
    fixture.detectChanges();
    expect(el.querySelector('input[aria-label^="試聽日期"]')).not.toBeNull();
  });
});
