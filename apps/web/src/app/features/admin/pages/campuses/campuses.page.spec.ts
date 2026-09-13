import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { vi } from 'vitest';

import { CampusesPage } from './campuses.page';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

describe('CampusesPage', () => {
  let component: CampusesPage;
  let fixture: ComponentFixture<CampusesPage>;
  const buildCampusResponse = (
    overrides?: Partial<{
      data: Campus[];
      meta: { total: number; page: number; pageSize: number; totalPages: number };
      summary: { total: number; activeCount: number; inactiveCount: number };
    }>,
  ) => ({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    summary: { total: 0, activeCount: 0, inactiveCount: 0 },
    ...overrides,
  });
  const campusesServiceMock = {
    list: vi.fn(() => of(buildCampusResponse())),
    delete: vi.fn(() => of({})),
  };

  beforeEach(async () => {
    campusesServiceMock.list.mockReset();
    campusesServiceMock.list.mockReturnValue(of(buildCampusResponse()));

    await TestBed.configureTestingModule({
      imports: [CampusesPage],
      providers: [
        {
          provide: CampusesService,
          useValue: campusesServiceMock,
        },
        {
          provide: OverlayContainerService,
          useValue: {
            getContainer: () => null,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CampusesPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  /**
   * **#812：取數失敗時畫面不能說「尚無分校」或「沒有找到符合…的分校」。**
   * 實際有 13 個。後者更糟 —— 它叫使用者換關鍵字，而換了不會有用。
   */
  it('取數失敗時渲染「載入失敗」，不說沒有分校', () => {
    campusesServiceMock.list.mockReturnValue(throwError(() => new Error('boom')));
    component.loadCampuses();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('載入失敗');
    expect(host.textContent).not.toContain('尚無分校');
    expect(host.textContent).not.toContain('請嘗試其他關鍵字');
  });

  it('重試鈕真的重打', () => {
    campusesServiceMock.list.mockReturnValue(throwError(() => new Error('boom')));
    component.loadCampuses();
    fixture.detectChanges();
    const callsBefore = campusesServiceMock.list.mock.calls.length;

    campusesServiceMock.list.mockReturnValue(of(buildCampusResponse()));
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('app-load-failed button')!
      .click();
    fixture.detectChanges();

    expect(campusesServiceMock.list.mock.calls.length).toBe(callsBefore + 1);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('載入失敗');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('用共用的整頁列表頁大小，不自己訂一個', () => {
    expect((component as unknown as { PAGE_SIZE: number }).PAGE_SIZE).toBe(LIST_PAGE_SIZE);
  });

  it('shows summary counts returned by the API', () => {
    const campuses = [
      {
        id: 'campus-1',
        orgId: 'org-1',
        name: '台北校',
        address: null,
        phone: null,
        isActive: true,
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
      },
    ] satisfies Campus[];

    (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
    (component as unknown as { campuses: { set: (value: Campus[]) => void } }).campuses.set(
      campuses,
    );
    (
      component as unknown as {
        summary: {
          set: (value: { total: number; activeCount: number; inactiveCount: number }) => void;
        };
      }
    ).summary.set({
      total: 38,
      activeCount: 33,
      inactiveCount: 5,
    });
    fixture.detectChanges();

    const statValues = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.campuses__stat-value'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(statValues).toEqual(['38', '33', '5']);
  });

  // 分校刪除是連動最廣的操作（courses CASCADE），但選單裡原本跟「編輯」同一個
  // 字重——使用者按下去之前完全感覺不到量級。這條釘住視覺升級不會被之後的改動悄悄拿掉。
  it('刪除分校在選單裡用紅字並跟其他項目分隔，不是跟編輯同一個字重', () => {
    const campus: Campus = {
      id: 'campus-1',
      orgId: 'org-1',
      name: '台北校',
      address: null,
      phone: null,
      isActive: true,
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
    };
    (
      component as unknown as { selectedCampus: { set: (value: Campus) => void } }
    ).selectedCampus.set(campus);

    const items = (
      component as unknown as {
        actionMenuItems: () => { label?: string; itemClass?: string; separator?: boolean }[];
      }
    ).actionMenuItems();

    const deleteIndex = items.findIndex((item) => item.label === '刪除分校');
    expect(deleteIndex).toBeGreaterThan(0);
    expect(items[deleteIndex].itemClass).toBe('text-red-500');
    expect(items[deleteIndex - 1].separator).toBe(true);
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
    const pending: Array<Subject<ReturnType<typeof buildCampusResponse>>> = [];

    beforeEach(() => {
      // 這個 app 是 zoneless（Angular 21 + signals），沒有 `fakeAsync` ——
      // 時間用 vitest 的假計時器控制。`debounceTime` 走 asyncScheduler 的 setTimeout。
      vi.useFakeTimers();
      pending.length = 0;
      campusesServiceMock.list.mockReset();
      campusesServiceMock.list.mockImplementation(() => {
        const subject = new Subject<ReturnType<typeof buildCampusResponse>>();
        pending.push(subject);
        return subject.asObservable();
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      campusesServiceMock.list.mockReset();
      campusesServiceMock.list.mockReturnValue(of(buildCampusResponse()));
    });

    it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
      const type = (text: string) =>
        (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(text);

      type('台北');
      vi.advanceTimersByTime(300);
      expect(campusesServiceMock.list).toHaveBeenCalledTimes(1);

      pending[0].error(new Error('boom'));

      type('新竹');
      vi.advanceTimersByTime(300);

      expect(campusesServiceMock.list).toHaveBeenCalledTimes(2);
    });
  });
});
