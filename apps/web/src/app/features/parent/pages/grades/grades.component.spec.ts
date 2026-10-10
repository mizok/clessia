import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentGradesService,
  type ParentScoreListResponse,
  type ParentScoreRecord,
} from '@core/parent-grades.service';
import { SystemClockService } from '@core/system-clock.service';
import { provideRouter } from '@angular/router';
import { GradesComponent } from './grades.component';

const PAGE = {
  label: '成績',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

function record(overrides: Partial<ParentScoreRecord> = {}): ParentScoreRecord {
  return {
    id: 'r1',
    type: 'academy',
    examName: '第一次段考',
    examDate: '2026-09-01',
    subjectName: '數學',
    className: '國三數學 A 班',
    createdAt: '2026-09-01T02:00:00Z',
    score: 88,
    totalScore: 100,
    status: 'scored',
    description: null,
    ...overrides,
  };
}

/**
 * API 端 `apps/api/src/routes/parent/grades.ts` 的
 * `pageSize: z.coerce.number().int().min(1).max(100)`。
 * **寫在這裡是為了讓越界變成紅燈，而不是變成 400** —— 前端送超過它的值時，
 * 使用者看到的是「載入失敗」，而那跟連線問題長得一樣。
 */
const API_MAX_PAGE_SIZE = 100;
const TODAY = '2026-09-10';

describe('GradesComponent', () => {
  let fixture: ComponentFixture<GradesComponent>;
  let listMock: ReturnType<typeof vi.fn>;
  let activeChildId: ReturnType<typeof signal<string | null>>;
  let childScopeLoad: ReturnType<typeof vi.fn>;

  function createComponent(
    response: ParentScoreListResponse | 'error' = {
      data: [],
      meta: { total: 0, page: 1, pageSize: 100, recentCount: 0, periods: [] },
    },
  ) {
    activeChildId = signal<string | null>(null);
    childScopeLoad = vi.fn();
    listMock = vi.fn(() =>
      response === 'error' ? throwError(() => new Error('boom')) : of(response),
    );

    TestBed.configureTestingModule({
      imports: [GradesComponent],
      providers: [
        {
          provide: ChildScopeService,
          useValue: {
            activeChildId: activeChildId.asReadonly(),
            // **不能留 `[]`**：`activeChildId` 只會從 `children[0]` 來，
            // 所以「0 個孩子卻有 activeChildId」是現實中不存在的狀態，
            // 而 `app-child-scope-gate`（#749）會把它擋掉。
            children: () => [{ id: 'child-1', name: '測試孩子' }],
            activeChild: () => null,
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: childScopeLoad,
          },
        },
        { provide: ParentGradesService, useValue: { list: listMock } },
        { provide: SystemClockService, useValue: { todayTaipei: () => TODAY } },
      ],
    });

    fixture = TestBed.createComponent(GradesComponent);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as {
      isFailing: (r: ParentScoreRecord) => boolean;
    };
  }

  it('進頁呼叫 childScope.load()', () => {
    createComponent();
    expect(childScopeLoad).toHaveBeenCalledTimes(1);
  });

  it('沒有 activeChildId 時不打 API', () => {
    createComponent();
    expect(listMock).not.toHaveBeenCalled();
  });

  /**
   * **這條原本斷言 200，而 200 超過 API 的上限**（`parent/grades.ts` 的
   * `pageSize: …max(100)`），所以每一次請求都被 Zod 擋成 400 ——
   * **這一頁從來沒有載入成功過**，而這支測試一直是綠的：替身根本不看那個值。
   *
   * 測試把 bug 背書了，還在標題裡引用了一個「既有 pattern」當理由。
   */
  it('打 API 的 pageSize 不得超過 API 上限 100', () => {
    createComponent();
    activeChildId.set('child-1');
    fixture.detectChanges();

    const sent = listMock.mock.calls[0][0].pageSize;
    expect(sent).toBeLessThanOrEqual(API_MAX_PAGE_SIZE);
    expect(listMock).toHaveBeenCalledWith({ childId: 'child-1', pageSize: 100 });
  });

  it('band anchor 直接用 meta.recentCount', () => {
    createComponent({
      data: [record()],
      meta: { total: 1, page: 1, pageSize: 100, recentCount: 3, periods: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.band-anchor__value')?.textContent?.trim()).toBe(
      '3',
    );
  });

  it('依課程分組顯示；段考（沒有班）歸「學校段考」放最後', () => {
    createComponent({
      data: [
        record({ id: 'r1', className: '數學班' }),
        record({ id: 'r2', className: '英文班', examName: '單字測驗' }),
      ],
      meta: { total: 2, page: 1, pageSize: 100, recentCount: 0, periods: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const titles = fixture.nativeElement.querySelectorAll('.grades__class h2');
    expect(titles.length).toBe(2);
  });

  // #1076（規格「學期篩選，預設當學期」）：學期＝機構的期，預設含今天的那一期
  it('預設只顯示今天所在那一期的考試，換到「全部」才看得到別期的', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-10T10:00:00'));
    try {
      createComponent({
        data: [
          record({ id: 'r1', examName: '九月小考', examDate: '2026-09-05' }),
          record({ id: 'r2', examName: '五月小考', examDate: '2026-05-05' }),
        ],
        meta: {
          total: 2,
          page: 1,
          pageSize: 100,
          recentCount: 0,
          periods: [
            { id: 'fall', name: '115 上學期', startDate: '2026-08-01', endDate: '2027-01-31' },
            { id: 'spring', name: '114 下學期', startDate: '2026-02-01', endDate: '2026-07-31' },
          ],
        },
      });
      const comp = fixture.componentInstance as unknown as {
        onPeriodChange: (f: string | null) => void;
      };
      activeChildId.set('child-1');
      fixture.detectChanges();

      const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text()).toContain('九月小考');
      expect(text()).not.toContain('五月小考');

      comp.onPeriodChange('all');
      fixture.detectChanges();
      expect(text()).toContain('五月小考');
    } finally {
      vi.useRealTimers();
    }
  });

  // #1076（規格「展開詳情」）：有描述的那筆可以展開看，沒有描述的不給一個點了什麼都沒有的展開
  // A6：每一列都能展開；說明有才寫，滿分與登錄日一定有
  it('每一列都可展開：有描述寫描述，另有滿分與登錄日', () => {
    createComponent({
      data: [
        record({ id: 'r1', examName: '單元小考', description: '第三章 一元二次方程式' }),
        record({ id: 'r2', examName: '單字測驗', description: null }),
      ],
      meta: { total: 2, page: 1, pageSize: 100, recentCount: 0, periods: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const items = (fixture.nativeElement as HTMLElement).querySelectorAll('details.grades__item');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.grades__desc')?.textContent).toContain('第三章 一元二次方程式');
    expect(items[1].querySelector('.grades__desc')).toBeNull();
    expect(items[1].querySelector('.grades__total')?.textContent).toContain('滿分 100 分');
    expect(items[1].querySelector('.grades__recorded')?.textContent).toContain('9/1 登錄');
  });

  it('NEW：登錄日在 7 天內才標；開場標題句是最近一次已登錄的成績', () => {
    createComponent({
      data: [
        record({ id: 'new', examName: '新的', createdAt: '2026-09-08T02:00:00Z', score: 77 }),
        record({ id: 'old', examName: '舊的', createdAt: '2026-08-20T02:00:00Z' }),
      ],
      meta: { total: 2, page: 1, pageSize: 100, recentCount: 1, periods: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('details.grades__item');
    expect(items[0].querySelector('.grades__new')).not.toBeNull();
    expect(items[1].querySelector('.grades__new')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain(
      '最近一次 數學 77 分。',
    );
  });

  // PG2：篩光了跟「完全沒成績」分開講，並有出路
  it('篩光時寫「目前的篩選下沒有成績」並可清除；清除後回到預設', () => {
    const old = createComponent({
      data: [record({ examDate: '2026-01-01' })],
      meta: { total: 1, page: 1, pageSize: 100, recentCount: 0, periods: [] },
    }) as unknown as { onRangeChange: (r: string) => void };
    activeChildId.set('child-1');
    fixture.detectChanges();
    old.onRangeChange('1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('目前的篩選下沒有成績');
    (fixture.nativeElement.querySelector('.grades__clear--empty') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('details.grades__item').length).toBe(1);
    expect(fixture.nativeElement.textContent).not.toContain('目前的篩選下沒有成績');
  });

  it('完全沒有成績 → 另一句話，不給清除篩選', () => {
    createComponent();
    activeChildId.set('child-1');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('還沒有任何成績');
    expect(fixture.nativeElement.querySelector('.grades__clear')).toBeNull();
  });

  it('缺考/補考用 chip 顯示，不顯示分數', () => {
    createComponent({
      data: [record({ status: 'absent', score: null })],
      meta: { total: 1, page: 1, pageSize: 100, recentCount: 0, periods: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('缺考');
    expect(fixture.nativeElement.querySelector('.grades__record-score')).toBeNull();
  });

  it('及格判斷不傳 passScore，退回總分比例——欄位還沒接上前的既有行為', () => {
    const isFailing = createComponent();
    expect(isFailing.isFailing(record({ score: 59, totalScore: 100 }))).toBe(true);
    expect(isFailing.isFailing(record({ score: 60, totalScore: 100 }))).toBe(false);
  });

  it('課程篩選只顯示選中的課程', () => {
    const comp = createComponent({
      data: [record({ id: 'r1', className: '數學班' }), record({ id: 'r2', className: '英文班' })],
      meta: { total: 2, page: 1, pageSize: 100, recentCount: 0, periods: [] },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    (comp as unknown as { onClassChange: (s: string | null) => void }).onClassChange('數學班');
    fixture.detectChanges();

    const titles = fixture.nativeElement.querySelectorAll('.grades__class h2');
    expect(titles.length).toBe(1);
    expect(titles[0].textContent).toContain('數學班');
  });

  /**
   * #703：切換孩子時 `subjectFilter` 不會被重設。
   *
   * **它不只是「篩選殘留」** —— `subjectOptions()` 是從 `records()` 算出來的，
   * 換了孩子之後舊科目不在選項裡，於是 `p-select` 解不出標籤、
   * **退回顯示 placeholder「全部科目」**。篩選還在生效，控制項卻長得像沒有篩選，
   * 而空狀態文案（`沒有符合條件的成績`）跟「這個孩子真的沒有成績」一模一樣。
   *
   * 家長會讀成「這個孩子沒有成績」。
   */
  describe('#703 切換孩子時的篩選狀態', () => {
    function listByChild() {
      listMock.mockImplementation(({ childId }: { childId: string }) =>
        of(
          childId === 'child-1'
            ? {
                data: [record({ id: 'r1', className: '數學班', examDate: '2026-09-01' })],
                meta: { total: 1, page: 1, pageSize: 100, recentCount: 1, periods: [] },
              }
            : {
                data: [
                  record({
                    id: 'r2',
                    className: '自然班',
                    examName: '自然模擬考',
                    examDate: '2026-09-01',
                  }),
                ],
                meta: { total: 1, page: 1, pageSize: 100, recentCount: 1, periods: [] },
              },
        ),
      );
    }

    it('切換到沒有該科目的孩子時，不得把他的成績全部濾光', () => {
      const comp = createComponent() as unknown as {
        onClassChange: (s: string | null) => void;
      };
      listByChild();

      activeChildId.set('child-1');
      fixture.detectChanges();
      comp.onClassChange('數學班');
      fixture.detectChanges();
      // 前提成立：篩選確實生效了（孩子一只有數學，所以仍是 1 組）
      expect(fixture.nativeElement.querySelectorAll('.grades__class h2').length).toBe(1);

      activeChildId.set('child-2');
      fixture.detectChanges();

      const titles = fixture.nativeElement.querySelectorAll('.grades__class h2');
      expect(titles.length).toBe(1);
      expect(titles[0].textContent).toContain('自然班');
      expect(fixture.nativeElement.textContent).not.toContain('目前的篩選下沒有成績');
    });

    /**
     * **反向對照**：擋住「切換孩子就把所有篩選重設」那種過寬的修法。
     *
     * 學期篩選跟科目篩選不同 —— 期是機構的，換孩子還是同一組，選中的那個**顯示得出來**，
     * 所以它不會騙人，使用者的選擇要留著。會騙人的只有「值消失但仍生效」的那個。
     */
    it('學期篩選要保留 —— 它顯示得出來，不會騙人', () => {
      const comp = createComponent() as unknown as {
        onPeriodChange: (f: string | null) => void;
        periodFilter: () => string | null;
      };
      listByChild();

      activeChildId.set('child-1');
      fixture.detectChanges();
      comp.onPeriodChange('unassigned');
      fixture.detectChanges();

      activeChildId.set('child-2');
      fixture.detectChanges();

      expect(comp.periodFilter()).toBe('unassigned');
    });
  });

  it('載入失敗顯示失敗狀態', () => {
    createComponent('error');
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
  describe('截斷要講出來（沒有分頁 UI，少掉的跟本來就沒有長得一樣）', () => {
    it('拿到的比總數少時顯示「只顯示最近 N 筆」', () => {
      createComponent({
        data: [record()],
        meta: { total: 137, page: 1, pageSize: 100, recentCount: 0, periods: [] },
      });
      activeChildId.set('child-1');
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('只顯示最近');
      expect(text).toContain('137');
    });

    it('全部拿到時不出現那句話 —— 沒有這一格，上一支證明不了任何事', () => {
      createComponent({
        data: [record()],
        meta: { total: 1, page: 1, pageSize: 100, recentCount: 0, periods: [] },
      });
      activeChildId.set('child-1');
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('只顯示最近');
    });
  });

  /**
   * #749：**接線測試。** `app-child-scope-gate` 的規則與措辭有自己的測試，
   * 但那不代表這一頁真的包了它 —— **元件寫好了不等於接上了**。
   *
   * 斷言的是「頁面內容在 gate **裡面**」而不只是「gate 存在」：
   * 放一個空的 gate 在旁邊也會讓後者通過，而那什麼都擋不住。
   */
  it('頁面內容包在 app-child-scope-gate 裡（#749）', () => {
    createComponent();
    fixture.detectChanges();

    const gate = fixture.nativeElement.querySelector('app-child-scope-gate');

    expect(gate).toBeTruthy();
    expect(gate.querySelector('.grades__content')).toBeTruthy();
  });
});
