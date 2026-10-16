import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  PublicApplicationsService,
  type PublicApplication,
} from '@core/public-applications.service';
import { ParentRequestsService, type ParentRequest } from '@core/parent-requests.service';
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
  ...extra,
});

async function setup(parentData: ParentRequest[] = [req()]) {
  const parents = {
    list: vi.fn().mockReturnValue(of({ data: parentData })),
    reject: vi.fn((id: string, reason: string) =>
      of({ data: req({ id, status: 'rejected', rejectReason: reason }) }),
    ),
    setTrialStatus: vi.fn((id: string, status: string) =>
      of({ data: req({ id, kind: 'trial', status }) }),
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
 * 報名只能拒絕（原因家長看得到）、核准另開 #1726；試聽改狀態。
 */
describe('ApplicationsPage：家長 App 的申請（#1707）', () => {
  const page = (f: { componentInstance: unknown }) => f.componentInstance as any;
  const cards = (el: HTMLElement) =>
    [
      ...el.querySelectorAll(
        '[data-testid="application-card"], [data-testid="parent-request-card"]',
      ),
    ].map((c) => c.getAttribute('data-testid'));

  it('待處理：兩支都打，依時間合在一份（新的在前）；卡片標「家長 App」', async () => {
    const { parents, service, el } = await setup();

    expect(service.list).toHaveBeenCalledWith({ statuses: ['new', 'contacted'], kind: null });
    expect(parents.list).toHaveBeenCalledWith({ group: 'pending', kind: null });
    expect(cards(el)).toEqual(['parent-request-card', 'application-card']);

    const card = el.querySelector('[data-testid="parent-request-card"]')!;
    expect(card.textContent).toContain('家長 App');
    expect(card.textContent).toContain('報名');
    expect(card.textContent).toContain('林媽媽');
    expect(card.querySelector('a[href="tel:0912000111"]')).not.toBeNull();
    expect(card.querySelector('a[href="/admin/students/stu-1"]')?.textContent).toContain('林小華');
    expect(card.textContent).toContain('國二數學 B');
    expect(card.textContent).toContain('大安校');
    expect(card.textContent).toContain('2026-11-01');
    expect(card.textContent).toContain('想上週六班');
    // 核准是金額路徑，另開 #1726 —— 先告訴行政去哪裡做
    expect(card.textContent).toContain('目前請到學生檔案手動報名');
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

  it('已拒絕、待繳費的報名：沒有拒絕鈕', async () => {
    for (const status of ['rejected', 'awaiting_payment']) {
      TestBed.resetTestingModule();
      const { el } = await setup([req({ status })]);
      const buttons = [...el.querySelectorAll('[data-testid="parent-request-card"] button')];
      expect(buttons.some((b) => b.textContent?.includes('拒絕'))).toBe(false);
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
    page(fixture).setTrialStatus(trial, 'scheduled');
    expect(parents.setTrialStatus).toHaveBeenCalledWith('t1', 'scheduled');
  });

  it('家長 App 那支讀不到：整頁顯示讀取失敗（可重試）', async () => {
    TestBed.resetTestingModule();
    const { fixture, parents } = await setup();
    parents.list.mockReturnValue(throwError(() => new Error('boom')));
    page(fixture).load();
    fixture.detectChanges();
    expect(page(fixture).failed()).toBe(true);
  });
});
