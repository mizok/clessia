import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';
import { BillingPeriodsService, type BillingPeriod } from '@core/billing-periods.service';

import { FeeTemplatesComponent } from './fee-templates.component';

const template = (overrides?: Partial<FeeTemplate>): FeeTemplate => ({
  id: 'ft-1',
  orgId: 'org-1',
  name: '國中主科月繳',
  billingMode: 'monthly',
  amount: 4500,
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const period = (overrides?: Partial<BillingPeriod>): BillingPeriod => ({
  id: 'bp-1',
  orgId: 'org-1',
  name: '2026 上學期 + 暑假',
  startDate: '2026-02-01',
  endDate: '2026-08-31',
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
    templates: { set: (v: FeeTemplate[]) => void; (): FeeTemplate[] };
    periods: { set: (v: BillingPeriod[]) => void; (): BillingPeriod[] };
    loading: { set: (v: boolean) => void };
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
   * 樂觀更新在這裡是錯的 —— 那一列必須留著，因為它其實還在資料庫裡。
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

  it('刪除成功會重新取數，不是自己從陣列裡挑掉', () => {
    const existing = template();
    internals().templates.set([existing]);
    feeTemplates.list.mockClear();

    internals().deleteTemplate(existing);

    expect(feeTemplates.list).toHaveBeenCalled();
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

  /**
   * **把所有取數收進同一條 `switchMap` 會帶來一個新的失效模式：
   * 內層一 error，外層管線就終止 —— 之後這一頁永遠不會再載入任何東西。**
   *
   * 修改前每次取數是各自獨立的訂閱，錯一次只影響那一次；改成單一管線之後，
   * **一次網路錯誤會把搜尋框變成死的**，而畫面上只有一則 toast，
   * 看起來像「這次失敗了」而不是「這一頁壞了」。
   *
   * 這條釘住「錯過一次之後還能再查」。**沒有它，下一個重構的人會把
   * `catchError` 拿掉，而那個缺陷安靜到沒有人會回報。**
   *
   * 這支 spec 的其他測試用的是立即完成的 `of()` 替身，餵不出「還沒回來的請求」——
   * 所以這一區自己換上可控的 `Subject` 替身，並在收尾時換回去。
   */
  describe('搜尋管線的錯誤復原（#689）', () => {
    const pending: Array<Subject<{ data: FeeTemplate[] }>> = [];

    beforeEach(() => {
      // 這個 app 是 zoneless（Angular 21 + signals），沒有 `fakeAsync` ——
      // 時間用 vitest 的假計時器控制。`debounceTime` 走 asyncScheduler 的 setTimeout。
      vi.useFakeTimers();
      pending.length = 0;
      feeTemplates.list.mockReset();
      feeTemplates.list.mockImplementation(() => {
        const subject = new Subject<{ data: FeeTemplate[] }>();
        pending.push(subject);
        return subject.asObservable();
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      feeTemplates.list.mockReset().mockReturnValue(of({ data: [] }));
    });

    it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
      const type = (text: string) =>
        (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(text);

      type('國中');
      vi.advanceTimersByTime(300);
      expect(feeTemplates.list).toHaveBeenCalledTimes(1);

      pending[0].error(new Error('boom'));

      type('高中');
      vi.advanceTimersByTime(300);

      expect(feeTemplates.list).toHaveBeenCalledTimes(2);
    });
  });
});
