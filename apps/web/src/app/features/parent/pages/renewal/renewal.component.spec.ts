import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentRenewalService,
  type ParentRenewalItem,
  type ParentRenewalPreview,
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
  let api: { preview: ReturnType<typeof vi.fn> };

  async function setup(byKid: Record<string, Partial<ParentRenewalPreview> | 'error'>) {
    api = {
      preview: vi.fn((id: string) => {
        const v = byKid[id];
        return v === 'error'
          ? throwError(() => new Error('boom'))
          : of({
              data: { nextPeriod: PERIOD, items: [], hasMonthlyEnrollments: false, ...v },
            });
      }),
    };
    activeId = signal<string | null>(KID.id);
    const children = signal([KID, KID2]);
    await TestBed.configureTestingModule({
      imports: [RenewalComponent],
      providers: [
        provideRouter([]),
        { provide: ParentRenewalService, useValue: api },
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
    expect(text('[data-testid="renewal-state"]')).toBe('下期費用將於開學前由補習班開立。');
    expect(rows()[0]).toBe('國二數學 A 每週三 19:00–21:00 · 游佩珊 老師 18,100 元 期繳，預計');
    expect(text('[data-testid="renewal-sum"]')).toBe('下期合計（預計）27,100 元');
  });

  it('沒有行為的東西不畫：沒有自動開單日、沒有申請異動鈕', async () => {
    await setup({ 'kid-1': { items: [item()] } });
    expect(el().textContent).not.toContain('自動');
    expect(el().textContent).not.toContain('異動');
    // 孩子切換器有自己的鈕；這頁本身不放任何動作鈕
    expect(el().querySelector('app-child-scope-gate button')).toBeNull();
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

  it('沒有續課：有月繳的孩子多一行說明，沒有的不說', async () => {
    await setup({
      'kid-1': { hasMonthlyEnrollments: true },
      'kid-2': { nextPeriod: null, hasMonthlyEnrollments: false },
    });
    expect(text('h1')).toBe('林子晴目前沒有即將到來的續課。');
    expect(text('[data-testid="renewal-empty"]')).toBe(
      '目前沒有即將到來的續課。 月繳的課每月照常開單，不列在這裡。',
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
