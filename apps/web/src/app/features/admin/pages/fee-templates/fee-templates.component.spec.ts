import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import {
  FeeTemplatesService,
  type FeeTemplate,
  type FeeTemplateListItem,
} from '@core/fee-templates.service';
import {
  BillingPeriodsService,
  type BillingPeriod,
  type BillingPeriodListItem,
} from '@core/billing-periods.service';

import { FeeTemplatesComponent } from './fee-templates.component';

const template = (overrides?: Partial<FeeTemplateListItem>): FeeTemplateListItem => ({
  id: 'ft-1',
  orgId: 'org-1',
  name: '國中主科月繳',
  billingMode: 'monthly',
  amount: 4500,
  isActive: true,
  inUseCount: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const period = (overrides?: Partial<BillingPeriodListItem>): BillingPeriodListItem => ({
  id: 'bp-1',
  orgId: 'org-1',
  name: '2026 上學期 + 暑假',
  startDate: '2026-02-01',
  endDate: '2026-08-31',
  overlappingEnrollmentCount: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('FeeTemplatesComponent', () => {
  let component: FeeTemplatesComponent;
  let fixture: ComponentFixture<FeeTemplatesComponent>;

  const feeTemplates = {
    list: vi.fn(() => of({ data: [] as FeeTemplate[] })),
    create: vi.fn(),
    update: vi.fn(() => of({ data: template() })),
    delete: vi.fn(() => of({ success: true })),
  };
  const billingPeriods = {
    list: vi.fn(() => of({ data: [] as BillingPeriod[] })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(() => of({ success: true })),
  };

  beforeEach(async () => {
    feeTemplates.list.mockReset().mockReturnValue(of({ data: [] }));
    feeTemplates.delete.mockReset().mockReturnValue(of({ success: true }));
    feeTemplates.update.mockReset().mockReturnValue(of({ data: template() }));
    billingPeriods.list.mockReset().mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [FeeTemplatesComponent],
      providers: [
        MessageService,
        { provide: FeeTemplatesService, useValue: feeTemplates },
        { provide: BillingPeriodsService, useValue: billingPeriods },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeeTemplatesComponent);
    fixture.componentRef.setInput('page', { label: '費用方案管理' });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  type Internals = {
    templates: { set: (v: FeeTemplateListItem[]) => void; (): FeeTemplateListItem[] };
    periods: { set: (v: BillingPeriodListItem[]) => void; (): BillingPeriodListItem[] };
    loading: { set: (v: boolean) => void };
    templatesLoading: () => boolean;
    deleteTemplate: (t: FeeTemplate) => void;
  };
  const internals = () => component as unknown as Internals;

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('兩個區塊各自取數 —— 價目表與收費期間都會載入', () => {
    expect(feeTemplates.list).toHaveBeenCalled();
    expect(billingPeriods.list).toHaveBeenCalled();
  });

  /**
   * FK 是 RESTRICT：被報名引用過的價目表刪不掉，後端回 409 `IN_USE`。
   * 這一頁是悲觀刪除（計畫席 10-16 裁定，全站樂觀刪除的例外）—— `IN_USE` 太常見，
   * 樂觀版會常常「先淡出又回來」。所以失敗時那一列**從頭到尾都在**，它其實還在資料庫裡。
   */
  it('刪除被引用的價目表失敗時，那一列不會從畫面上消失', () => {
    const existing = template();
    internals().templates.set([existing]);
    feeTemplates.delete.mockReturnValue(
      throwError(() => ({
        error: { error: '這份價目表已被報名引用，請改為停用', code: 'IN_USE' },
      })),
    );

    internals().deleteTemplate(existing);

    expect(internals().templates()).toEqual([existing]);
  });

  it('刪除：伺服器確認之前那一列還在；成功才拿掉，並在背景重新取數（不回到骨架、不變淡）', () => {
    const existing = template();
    internals().templates.set([existing]);
    const pending = new Subject<{ success: boolean }>();
    feeTemplates.delete.mockReturnValue(pending);
    feeTemplates.list.mockReturnValue(NEVER);
    feeTemplates.list.mockClear();

    internals().deleteTemplate(existing);
    expect(internals().templates()).toEqual([existing]);

    pending.next({ success: true });
    pending.complete();
    expect(internals().templates()).toEqual([]);
    expect(feeTemplates.list).toHaveBeenCalled();
    expect(internals().templatesLoading()).toBe(false);
  });

  it('收費期間依起始日新到舊排序 —— 後端已排好，前端不重排', () => {
    const older = period({ id: 'bp-2', startDate: '2025-02-01' });
    const newer = period({ id: 'bp-1', startDate: '2026-02-01' });
    internals().periods.set([newer, older]);

    expect(
      internals()
        .periods()
        .map((p) => p.id),
    ).toEqual(['bp-1', 'bp-2']);
  });

  describe('A6 價目表與收費期間（#1314 F0／F2／F5）', () => {
    const root = () => fixture.nativeElement as HTMLElement;
    const load = (templates: FeeTemplateListItem[], periods: BillingPeriodListItem[] = []) => {
      feeTemplates.list.mockReturnValue(of({ data: templates }));
      billingPeriods.list.mockReturnValue(of({ data: periods }));
      (component as unknown as { loadTemplates: () => void }).loadTemplates();
      (component as unknown as { loadPeriods: () => void }).loadPeriods();
      fixture.detectChanges();
    };
    const mixed = () => [
      template({ id: 'a', name: '月繳新', billingMode: 'monthly', amount: 3600 }),
      template({ id: 'b', name: '月繳舊', billingMode: 'monthly', amount: 4500, isActive: false }),
      template({ id: 'c', name: '月繳便宜', billingMode: 'monthly', amount: 2400 }),
      template({ id: 'd', name: '期繳', billingMode: 'period', amount: 19800, inUseCount: 3 }),
      template({ id: 'e', name: '十堂', billingMode: 'session_pack', amount: 4500 }),
    ];
    const names = (mode: string) =>
      [...root().querySelectorAll(`[data-chapter="${mode}"] [data-template]`)].map((el) =>
        el.querySelector('button')!.textContent!.trim(),
      );

    it('色面數字句含停用的數字：N 種價目、M 種開放報名', () => {
      load(mixed());
      const title = root().querySelector('app-page-open')!.textContent!.replace(/\s+/g, '');
      expect(title).toContain('5種價目，4種開放報名。');
    });

    it('依計費模式分三章，沒有列的章不顯示；預設不列停用', () => {
      load(mixed());
      expect(
        [...root().querySelectorAll('[data-chapter]')].map((c) => c.getAttribute('data-chapter')),
      ).toEqual(['monthly', 'period', 'session_pack']);
      expect(names('monthly')).toEqual(['月繳便宜', '月繳新']);

      load([template({ id: 'x', billingMode: 'period' })]);
      expect(
        [...root().querySelectorAll('[data-chapter]')].map((c) => c.getAttribute('data-chapter')),
      ).toEqual(['period']);
    });

    // #1698：A6 fee-templates.html 在 ≤860 覆寫 `.chap`＝橫排、章名 28px（listRow）
    it('章頭用 listRow：手機章名 28px', () => {
      load(mixed());
      const name = root().querySelector('[data-chapter] .chapter-head__name');
      expect(name?.classList).toContain('text-[28px]');
      // A6 `.chap` 內距畫在章上（手機照 fee-templates.html 覆寫 24／8）
      const chap = name!.closest('[data-chapter]')!;
      expect(chap.classList).toContain('pt-6');
      expect(chap.classList).toContain('pb-2');
      expect(chap.classList).toContain('wide:py-8');
    });

    it('顯示停用方案：停用的排在章內最後、不重新打 API；鈕上寫停用數', () => {
      load(mixed());
      const calls = feeTemplates.list.mock.calls.length;
      expect(root().textContent).toContain('顯示停用方案（1）');
      (component as unknown as { toggleShowInactive: () => void }).toggleShowInactive();
      fixture.detectChanges();
      expect(names('monthly')).toEqual(['月繳便宜', '月繳新', '月繳舊']);
      expect(feeTemplates.list.mock.calls.length).toBe(calls);
    });

    describe('次要鈕與篩選 chip（A6：白底 zinc-300 框、漏斗圖示）', () => {
      const btn = (id: string) =>
        root().querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
      const chip = () => root().querySelector('app-filter-chip button') as HTMLButtonElement;
      const component_ = () =>
        component as unknown as {
          openAuditLog: () => void;
          openPeriodDialog: () => void;
          toggleShowInactive: () => void;
        };

      it('操作紀錄是全站共用的時鐘圖示鈕（#2006）：白底＋zinc-300 框、方鈕 tbar-control-square（#1903 手機 44／桌機 40）、點了開操作紀錄', () => {
        load(mixed());
        const b = btn('audit-log-button');
        expect(b.tagName).toBe('BUTTON');
        expect([...b.classList]).toEqual(
          expect.arrayContaining(['border-zinc-300', 'bg-white', 'tbar-control-square']),
        );
        expect(b.getAttribute('aria-label')).toBe('操作紀錄');
        expect(b.querySelector('i')!.className).toContain('pi-clock');
        const spy = vi.spyOn(component_(), 'openAuditLog').mockImplementation(() => undefined);
        b.click();
        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('「新增期間」是純按鈕：只在桌機（hidden＋wide:inline-flex 兩個 class 都在）、白底框、點了開期間表單', () => {
        load(mixed());
        const b = btn('new-period-btn');
        expect(b.tagName).toBe('BUTTON');
        expect([...b.classList]).toEqual(
          expect.arrayContaining([
            'hidden',
            'wide:inline-flex',
            'border-zinc-300',
            'bg-white',
            'h-11',
            'wide:h-[30px]',
          ]),
        );
        expect(b.querySelector('i')!.className).toContain('pi-plus');
        const spy = vi.spyOn(component_(), 'openPeriodDialog').mockImplementation(() => undefined);
        b.click();
        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('chip 圖示是漏斗，開／關兩種狀態都一樣；標籤隨狀態換', () => {
        load(mixed());
        expect(chip().querySelector('i')!.className).toContain('pi-filter');
        expect(chip().textContent).toContain('顯示停用方案（1）');
        chip().click();
        fixture.detectChanges();
        expect(chip().querySelector('i')!.className).toContain('pi-filter');
        expect(chip().querySelector('i')!.className).not.toContain('pi-eye');
        expect(chip().textContent).toContain('隱藏停用方案');
        expect(chip().getAttribute('aria-pressed')).toBe('true');
      });

      it('停用數 0／1／2：鈕上的數字跟著變（門檻 ±1）', () => {
        const withInactive = (n: number) =>
          Array.from({ length: n }, (_, i) =>
            template({ id: `x${i}`, name: `停${i}`, isActive: false }),
          );
        for (const n of [0, 1, 2]) {
          load([template({ id: 'on' }), ...withInactive(n)]);
          expect(chip().textContent).toContain(`顯示停用方案（${n}）`);
        }
      });
    });

    it('搜尋在前端過濾，不送請求', () => {
      load(mixed());
      const calls = feeTemplates.list.mock.calls.length;
      (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange('十堂');
      fixture.detectChanges();
      expect(names('session_pack')).toEqual(['十堂']);
      expect(root().querySelector('[data-chapter="monthly"]')).toBeNull();
      expect(feeTemplates.list.mock.calls.length).toBe(calls);
    });

    it('價格寫「NT$ 3,600／月」，堂數制沒有單位', () => {
      load(mixed());
      const price = (id: string) =>
        root().querySelector(`[data-template="${id}"]`)!.textContent!.replace(/\s+/g, '');
      expect(price('a')).toContain('NT$3,600／月');
      expect(price('d')).toContain('NT$19,800／期');
      expect(price('e')).toContain('NT$4,500');
      expect(price('e')).not.toContain('／');
    });

    it('F2 選單：有人在用 → 「N 筆報名在用，無法刪除」且沒有可按的刪除；沒人用 → 刪除', () => {
      const menu = (item: FeeTemplateListItem) => {
        (
          component as unknown as { selectedTemplate: { set: (v: unknown) => void } }
        ).selectedTemplate.set(item);
        return (
          component as unknown as {
            actionMenuItems: () => { label?: string; disabled?: boolean; command?: unknown }[];
          }
        ).actionMenuItems();
      };
      const inUse = menu(template({ inUseCount: 3 }));
      const blocked = inUse.find((i) => i.label === '3 筆報名在用，無法刪除');
      expect(blocked?.disabled).toBe(true);
      expect(inUse.map((i) => i.label)).not.toContain('刪除');
      expect(inUse.map((i) => i.label)).toContain('停用');

      expect(menu(template({ inUseCount: 0 })).map((i) => i.label)).toContain('刪除');
    });

    it('刪除類項目上危險色（#1360）：價目表、收費期間的「刪除」有 danger', () => {
      const page = component as unknown as {
        selectedTemplate: { set: (v: unknown) => void };
        actionMenuItems: () => { label?: string; danger?: boolean }[];
        selectedPeriod: { set: (v: unknown) => void };
        periodMenuItems: () => { label?: string; danger?: boolean }[];
      };
      page.selectedTemplate.set(template({ inUseCount: 0 }));
      expect(page.actionMenuItems().find((i) => i.label === '刪除')?.danger).toBe(true);
      page.selectedPeriod.set(period());
      expect(page.periodMenuItems().find((i) => i.label === '刪除')?.danger).toBe(true);
    });

    it('F5 重疊期間：列上寫「跟「X」重疊」，不重疊的沒有', () => {
      load(
        [],
        [
          period({ id: 'p1', name: '上學期', startDate: '2026-09-01', endDate: '2027-01-31' }),
          period({
            id: 'p2',
            name: '上學期＋暑假',
            startDate: '2026-07-01',
            endDate: '2027-01-31',
          }),
          period({ id: 'p3', name: '去年', startDate: '2025-09-01', endDate: '2026-01-31' }),
        ],
      );
      const row = (id: string) => root().querySelector(`[data-period="${id}"]`)!.textContent!;
      expect(row('p1')).toContain('跟「上學期＋暑假」重疊');
      expect(row('p2')).toContain('跟「上學期」重疊');
      expect(row('p3')).not.toContain('重疊');
      expect(row('p1')).toContain('2026/09/01 — 2027/01/31');
    });
  });

  /**
   * **#788：取數失敗時畫面不能渲染成「尚未有資料」。**
   * 斷言**畫面主體**而不是某個 signal —— 使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」', () => {
    feeTemplates.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    (component as unknown as { loadTemplates: () => void }).loadTemplates();
    if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('載入失敗');
  });
});
