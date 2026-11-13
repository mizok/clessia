import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentRenewalService,
  type ParentRenewalItem,
  type ParentRenewalPreview,
  type ParentRenewalRequest,
} from '@core/parent-renewal.service';
import { RenewalComponent } from './renewal.component';

/**
 * 家長端續課資訊（計畫席 10-22）。釘的是裁定的那幾條字與分支：
 * 期繳的字、待確認時合計不給數字、月繳那行只對有月繳的孩子、沒有行為的東西不畫。
 */

const PAGE = {
  label: '續課資訊',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};
const KID = { id: 'kid-1', name: '林子晴', grade: 'junior_3', school: null };
const KID2 = { id: 'kid-2', name: '林子安', grade: 'junior_1', school: null };
const PERIOD = { name: '2027 上學期', startDate: '2027-02-01', endDate: '2027-07-31' };

const item = (over: Partial<ParentRenewalItem> = {}): ParentRenewalItem => ({
  enrollmentId: 'e1',
  courseName: '數學',
  currentClassName: '國二數學 A',
  nextClassName: '國二數學 A',
  upgraded: false,
  schedules: [{ weekday: 3, startTime: '19:00', endTime: '21:00' }],
  teacherNames: ['游佩珊'],
  estimatedAmount: 18100,
  estimateSource: 'enrollment',
  ...over,
});

describe('RenewalComponent', () => {
  let fixture: ComponentFixture<RenewalComponent>;
  let activeId: ReturnType<typeof signal<string | null>>;
  let api: {
    preview: ReturnType<typeof vi.fn>;
    createRequest: ReturnType<typeof vi.fn>;
    withdrawRequest: ReturnType<typeof vi.fn>;
  };

  async function setup(byKid: Record<string, Partial<ParentRenewalPreview> | 'error'>) {
    api = {
      preview: vi.fn((id: string) => {
        const v = byKid[id];
        return v === 'error'
          ? throwError(() => new Error('boom'))
          : of({
              data: {
                nextPeriod: PERIOD,
                items: [],
                hasMonthlyEnrollments: false,
                pendingRequest: null,
                ...v,
              },
            });
      }),
      createRequest: vi.fn(() => of({})),
      withdrawRequest: vi.fn(() => of({ success: true })),
    };
    // 原生 dialog：無條件換掉（環境自帶的不一定設 open，#2473）
    (HTMLDialogElement.prototype as any).showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    (HTMLDialogElement.prototype as any).close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    activeId = signal<string | null>(KID.id);
    const children = signal([KID, KID2]);
    await TestBed.configureTestingModule({
      imports: [RenewalComponent],
      providers: [
        provideRouter([]),
        { provide: ParentRenewalService, useValue: api },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: ChildScopeService,
          useValue: {
            children: children.asReadonly(),
            activeChildId: activeId.asReadonly(),
            activeChild: computed(() => children().find((k) => k.id === activeId()) ?? null),
            status: () => 'ready' as const,
            canSwitch: () => true,
            setActiveChild: (id: string) => activeId.set(id),
            load: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RenewalComponent);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (sel: string) =>
    el().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const rows = () =>
    [...el().querySelectorAll('[data-testid="renewal-row"]')].map((r) =>
      r.textContent!.replace(/\s+/g, ' ').trim(),
    );

  it('有續課：標題、期別、狀態列用 spec 的字，每列班名、時段、老師、期繳金額，合計', async () => {
    await setup({
      'kid-1': { items: [item(), item({ enrollmentId: 'e2', estimatedAmount: 9000 })] },
    });
    expect(text('h1')).toBe('林子晴下期續 2 個班。');
    expect(el().textContent).toContain('下期 2027 上學期 · 2/1 – 7/31');
    expect(text('[data-testid="renewal-state"]')).toBe('下期費用將於開學前由補習班開立。 申請異動');
    expect(rows()[0]).toBe('國二數學 A 每週三 19:00–21:00 · 游佩珊 老師 18,100 元 期繳，預計');
    expect(text('[data-testid="renewal-sum"]')).toBe('下期合計（預計）27,100 元');
  });

  it('沒有自動開單日（系統沒有自動開單）；沒有處理中的申請時沒有處理中標籤、只有「申請異動」', async () => {
    await setup({ 'kid-1': { items: [item()] } });
    expect(el().textContent).not.toContain('自動');
    expect(el().querySelector('[data-testid="renewal-pending-tag"]')).toBeNull();
    expect(el().querySelector('[data-testid="renewal-withdraw"]')).toBeNull();
    expect(el().querySelector('[data-testid="renewal-change"]')).not.toBeNull();
  });

  const PENDING: ParentRenewalRequest = {
    id: 'rr-1',
    enrollmentId: 'e2',
    kind: 'transfer',
    detail: '想改到週六的班',
    note: null,
    status: 'pending',
    // UTC 11/12 晚上 = 台北 11/13
    createdAt: '2026-11-12T17:00:00Z',
  };

  it('#1122 處理中：狀態條寫暫停、送出日（台北）與內容；那一列標「異動處理中」；只有撤回鈕', async () => {
    await setup({
      'kid-1': {
        items: [item(), item({ enrollmentId: 'e2', nextClassName: '國二英文 B' })],
        pendingRequest: PENDING,
      },
    });
    expect(text('[data-testid="renewal-state"]')).toBe(
      '你已提交異動申請，管理員處理中，自動開單已暫停。 11/13 送出 · 國二英文 B · 轉班：想改到週六的班 撤回申請',
    );
    const tagged = [...el().querySelectorAll('[data-testid="renewal-row"]')].map(
      (r) => !!r.querySelector('[data-testid="renewal-pending-tag"]'),
    );
    expect(tagged).toEqual([false, true]);
    expect(el().querySelector('[data-testid="renewal-change"]')).toBeNull();
  });

  it('#1122 申請異動：送出帶孩子、課、類型、想怎麼改；成功後重抓', async () => {
    await setup({
      'kid-1': { items: [item(), item({ enrollmentId: 'e2', nextClassName: '國二英文 B' })] },
    });
    el().querySelector<HTMLButtonElement>('[data-testid="renewal-change"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = el().querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    const submit = el().querySelector<HTMLButtonElement>('[data-testid="renewal-submit"]')!;
    expect([submit.type, submit.getAttribute('form')]).toEqual(['submit', 'renewal-request-form']);
    // 兩門課時不預選；沒選課＋沒填 → 不送
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(api.createRequest).not.toHaveBeenCalled();

    const cmp = fixture.debugElement.query((d) => d.name === 'app-renewal-request-dialog')
      .componentInstance as any;
    cmp.enrollmentId.set('e2');
    cmp.kind.set('stop');
    cmp.detail.set('  下期社團比賽  ');
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(api.createRequest).toHaveBeenCalledWith({
      childId: 'kid-1',
      enrollmentId: 'e2',
      kind: 'stop',
      detail: '下期社團比賽',
      note: null,
    });
    expect(api.preview).toHaveBeenCalledTimes(2); // 送出後重抓
  });

  it('#1122 撤回：先確認，確認了才打 API 並重抓；不確認不打', async () => {
    await setup({ 'kid-1': { items: [item({ enrollmentId: 'e2' })], pendingRequest: PENDING } });
    const dialogs = fixture.debugElement.injector.get(DialogService);
    const open = vi.spyOn(dialogs, 'open');
    open.mockReturnValueOnce({ onClose: of(false) } as never);
    el().querySelector<HTMLButtonElement>('[data-testid="renewal-withdraw"]')!.click();
    expect(api.withdrawRequest).not.toHaveBeenCalled();

    open.mockReturnValueOnce({ onClose: of(true) } as never);
    el().querySelector<HTMLButtonElement>('[data-testid="renewal-withdraw"]')!.click();
    expect(api.withdrawRequest).toHaveBeenCalledWith('rr-1');
    expect(api.preview).toHaveBeenCalledTimes(2);
  });

  it('升班：新班名＋「升級」，舊班名劃掉', async () => {
    await setup({
      'kid-1': {
        items: [
          item({ upgraded: true, nextClassName: '國三數學 A', currentClassName: '國二數學 A' }),
        ],
      },
    });
    const row = el().querySelector('[data-testid="renewal-row"]')!;
    expect(row.querySelector('p')!.textContent).toContain('國三數學 A');
    expect(row.querySelector('p')!.textContent).toContain('升級');
    expect(row.querySelector('s')!.textContent).toBe('國二數學 A');
  });

  it('任一列待確認：那列寫「待確認」，合計不給數字', async () => {
    await setup({
      'kid-1': { items: [item(), item({ enrollmentId: 'e2', estimatedAmount: null })] },
    });
    expect(rows()[1]).toContain('待確認');
    expect(text('[data-testid="renewal-sum"]')).toBe('下期合計（預計）部分金額待補習班確認');
  });

  it('合計是 0 元時照樣給數字（不誤判成待確認）', async () => {
    await setup({ 'kid-1': { items: [item({ estimatedAmount: 0 })] } });
    expect(text('[data-testid="renewal-sum"]')).toBe('下期合計（預計）0 元');
  });

  it('沒有續課：有月繳的孩子說「不需要續課、要調整找補習班」（不只說沒有，#2498），沒有的不說', async () => {
    await setup({
      'kid-1': { hasMonthlyEnrollments: true },
      'kid-2': { nextPeriod: null, hasMonthlyEnrollments: false },
    });
    expect(text('h1')).toBe('林子晴目前沒有即將到來的續課。');
    expect(text('[data-testid="renewal-empty"]')).toBe(
      '月繳的課每月照常開單，不需要續課。要轉班、停課或改繳費方式，請直接聯絡補習班。',
    );

    activeId.set(KID2.id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.preview).toHaveBeenLastCalledWith('kid-2');
    expect(text('[data-testid="renewal-empty"]')).toBe('目前沒有即將到來的續課。');
  });

  it('進頁就載入孩子清單（沒人載的話停在讀取中）', async () => {
    await setup({ 'kid-1': {} });
    const scope = TestBed.inject(ChildScopeService) as unknown as {
      load: ReturnType<typeof vi.fn>;
    };
    expect(scope.load).toHaveBeenCalled();
  });

  it('有下一期但沒有要續的課：副行不出現（期別只在有續課時寫）', async () => {
    await setup({ 'kid-1': { items: [] } });
    expect(el().textContent).not.toContain('2027 上學期');
    expect(el().textContent).not.toContain('2/1');
  });

  it('加選連結到 /parent/add-course', async () => {
    await setup({ 'kid-1': {} });
    expect(el().querySelector('a[href="/parent/add-course"]')!.textContent).toContain(
      '瀏覽可加選課程',
    );
  });

  it('讀取失敗：說讀不到，不畫成「沒有續課」', async () => {
    await setup({ 'kid-1': 'error' });
    expect(el().textContent).toContain('讀不到續課資訊');
    expect(el().querySelector('[data-testid="renewal-empty"]')).toBeNull();
  });
});
