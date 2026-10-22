import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { By } from '@angular/platform-browser';
import { CampusesPage } from './campuses.page';
import { ClassroomsDialogComponent } from './classrooms-dialog.component';
import { CampusFormDialogComponent } from './campus-form-dialog.component';
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

  const orgSettings = signal<{ attendanceMode: 'per_session' | 'daily_checkin' } | null>({
    attendanceMode: 'daily_checkin',
  });
  let orgStatus: 'unloaded' | 'ready' = 'ready';
  const orgLoad = vi.fn();

  beforeEach(async () => {
    orgSettings.set({ attendanceMode: 'daily_checkin' });
    orgStatus = 'ready';
    orgLoad.mockClear();
    campusesServiceMock.list.mockReset();
    campusesServiceMock.list.mockReturnValue(of(buildCampusResponse()));

    await TestBed.configureTestingModule({
      imports: [CampusesPage],
      providers: [
        MessageService,
        {
          provide: CampusesService,
          useValue: campusesServiceMock,
        },
        {
          provide: OrgSettingsService,
          useValue: { settings: orgSettings, status: () => orgStatus, load: orgLoad },
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
        paymentInfo: null,
        attendanceMode: null,
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
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-count] b'),
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
      paymentInfo: null,
      attendanceMode: null,
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
    };
    (
      component as unknown as { selectedCampus: { set: (value: Campus) => void } }
    ).selectedCampus.set(campus);

    const items = (
      component as unknown as {
        actionMenuItems: () => { label?: string; danger?: boolean; separator?: boolean }[];
      }
    ).actionMenuItems();

    const deleteIndex = items.findIndex((item) => item.label === '刪除分校');
    expect(deleteIndex).toBeGreaterThan(0);
    expect(items[deleteIndex].danger).toBe(true);
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

  // #1641 5b（使用者 10-16 裁定第 1 點）：刪除是樂觀的 —— 按下就淡出；失敗要放回去並說明
  describe('樂觀刪除', () => {
    const campus = (id: string) => ({ id, name: `分校${id}` }) as unknown as Campus;
    type Page = {
      campuses: { set: (v: Campus[]) => void; (): Campus[] };
      deleteCampus: (c: Campus) => void;
    };
    const page = () => component as unknown as Page;

    it('失敗：那一列放回原位，並跳錯誤 toast', () => {
      const add = vi.spyOn(TestBed.inject(MessageService), 'add');
      page().campuses.set([campus('a'), campus('b')]);
      campusesServiceMock.delete.mockReturnValueOnce(
        throwError(() => ({ error: { error: '伺服器錯誤' } })),
      );
      page().deleteCampus(campus('b'));
      expect(
        page()
          .campuses()
          .map((c) => c.id),
      ).toEqual(['a', 'b']);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('成功：維持拿掉，背景重抓不回到骨架', () => {
      page().campuses.set([campus('a'), campus('b')]);
      campusesServiceMock.list.mockReturnValue(NEVER);
      page().deleteCampus(campus('b'));
      expect(
        page()
          .campuses()
          .map((c) => c.id),
      ).toEqual(['a']);
      expect(component.loading()).toBe(false);
    });
  });

  // A6 settings.html#campuses 的列（#1314 SE 插單）
  describe('A6 列', () => {
    const c = (
      over: Partial<Campus & { classroomCount: number }>,
    ): Campus & { classroomCount: number } => ({
      id: 'cp',
      classroomCount: 0,
      orgId: 'org-1',
      name: '文山旗艦校',
      address: '台北市羅斯福路 12 號',
      phone: '02-2930-1000',
      isActive: true,
      paymentInfo: null,
      attendanceMode: null,
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
      ...over,
    });
    const show = async (
      data: Array<Campus & { classroomCount: number }>,
      summary = { total: data.length, activeCount: data.length, inactiveCount: 0 },
    ) => {
      campusesServiceMock.list.mockReturnValue(
        of(
          buildCampusResponse({
            data,
            summary,
            meta: { total: data.length, page: 1, pageSize: 20, totalPages: 1 },
          }),
        ),
      );
      component.loadCampuses();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const row = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-campus="${id}"]`)!;
    const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

    it('名稱＋地址｜電話＋出勤模式｜⋮；沒填寫的寫「未填寫」；停用的加小字', async () => {
      await show([
        c({ id: 'a' }),
        c({ id: 'b', name: '信義分校', address: null, phone: null, isActive: false }),
      ]);
      expect(row('a').textContent).toContain('台北市羅斯福路 12 號');
      expect(row('a').textContent).toContain('02-2930-1000');
      expect(row('a').querySelector('button[aria-label="文山旗艦校 的更多動作"]')).not.toBeNull();
      expect(row('b').textContent).toContain('地址未填寫');
      expect(row('b').textContent).toContain('電話未填寫');
      expect(row('b').querySelector('small')!.textContent).toContain('已停用');
      expect(row('a').textContent).not.toContain('已停用');
    });

    it('教室數（#1314 SE3）：「N 間教室」／「還沒有教室」', async () => {
      await show([c({ id: 'a', classroomCount: 3 }), c({ id: 'b' })]);
      const rooms = (id: string) => row(id).querySelector('[data-rooms]')!.textContent!.trim();
      expect(rooms('a')).toBe('3 間教室');
      expect(rooms('b')).toBe('還沒有教室');
    });

    it('⋮ 有「教室」，按了打開教室對話框（帶分校）；有改過才安靜重抓教室數', async () => {
      const campus = c({ id: 'a' });
      const dialog = fixture.debugElement.query(By.directive(ClassroomsDialogComponent))
        .componentInstance as ClassroomsDialogComponent;
      const open = vi.spyOn(dialog, 'open').mockImplementation(() => undefined);
      (component as any).selectedCampus.set(campus);
      (component as any)
        .actionMenuItems()
        .find((i: { label?: string }) => i.label === '教室')
        .command();
      expect(open).toHaveBeenCalledWith(campus);

      campusesServiceMock.list.mockClear();
      dialog.closed.emit(false);
      expect(campusesServiceMock.list).not.toHaveBeenCalled();
      dialog.closed.emit(true);
      expect(campusesServiceMock.list).toHaveBeenCalledTimes(1);
      expect(component.loading()).toBe(false);
    });

    it('分校表單存成功才重抓列表（新增、編輯完列上要看到）；取消不重抓', async () => {
      const form = fixture.debugElement.query(By.directive(CampusFormDialogComponent))
        .componentInstance as CampusFormDialogComponent;
      campusesServiceMock.list.mockClear();
      form.closed.emit(null);
      expect(campusesServiceMock.list).not.toHaveBeenCalled();
      form.closed.emit(c({ id: 'a' }));
      expect(campusesServiceMock.list).toHaveBeenCalledTimes(1);
    });

    it('出勤模式：沒設 → 機構預設＋沿用預設；跟預設不同的標出來；同預設只寫模式', async () => {
      await show([
        c({ id: 'n', attendanceMode: null }),
        c({ id: 'd', attendanceMode: 'per_session' }),
        c({ id: 's', attendanceMode: 'daily_checkin' }),
      ]);
      const mode = (id: string) => row(id).querySelector('[data-mode]')!.textContent!.trim();
      expect(mode('n')).toBe('日到班（沿用預設）');
      expect(mode('d')).toBe('隨堂點名（跟預設不同）');
      expect(mode('s')).toBe('日到班');
    });

    it('機構預設還沒讀到：沒設的寫「沿用機構預設」，有設的不標差異', async () => {
      orgSettings.set(null);
      await show([c({ id: 'n' }), c({ id: 'd', attendanceMode: 'per_session' })]);
      expect(row('n').querySelector('[data-mode]')!.textContent!.trim()).toBe('沿用機構預設');
      expect(row('d').querySelector('[data-mode]')!.textContent!.trim()).toBe('隨堂點名');
    });

    it('停用的預設隱藏：「顯示停用的 N 個」→ 不帶 isActive 重抓；再按「隱藏停用的」', async () => {
      await show([c({ id: 'a' })], { total: 3, activeCount: 1, inactiveCount: 2 });
      expect(campusesServiceMock.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ isActive: true }),
      );
      const toggle = () =>
        [
          ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
        ].find((b) => /停用的/.test(b.textContent ?? ''))!;
      expect(toggle().textContent!.trim()).toBe('顯示停用的 2 個');
      toggle().click();
      fixture.detectChanges();
      expect(campusesServiceMock.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ isActive: undefined }),
      );
      expect(toggle().textContent!.trim()).toBe('隱藏停用的');
    });

    it('沒有停用的：不出現切換鈕', async () => {
      await show([c({ id: 'a' })]);
      expect(text()).not.toContain('顯示停用的');
    });

    it('搜尋找不到：寫怎麼找＋清除搜尋', async () => {
      (component as unknown as { searchQuery: { set: (v: string) => void } }).searchQuery.set(
        'xyz',
      );
      await show([], { total: 3, activeCount: 3, inactiveCount: 0 });
      expect(text()).toContain('找不到「xyz」。可以用分校名、路名或電話找。');
      expect(
        [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].some(
          (b) => b.textContent!.trim() === '清除搜尋',
        ),
      ).toBe(true);
    });

    // R2（計畫席 10-21）：手機不拿掉操作紀錄，收進頁首「⋯」
    it('手機頁首「⋯」裡有操作紀錄，按了開操作紀錄', async () => {
      await show([c({ id: 'a' })]);
      const more = (fixture.nativeElement as HTMLElement).querySelector(
        'button[aria-label="分校的更多動作"]',
      );
      expect(more).not.toBeNull();
      const open = vi.spyOn(component, 'openAuditLog').mockImplementation(() => undefined);
      const items = (
        component as unknown as { pageMenuItems: { label: string; command: () => void }[] }
      ).pageMenuItems;
      expect(items.map((i) => i.label)).toEqual(['操作紀錄']);
      items[0].command();
      expect(open).toHaveBeenCalled();
    });

    // 審核席 C2：機構預設沒載過就載；載過不重載
    it('機構設定還沒載：進頁就載一次；已載好不重載', async () => {
      expect(orgLoad).not.toHaveBeenCalled();
      orgStatus = 'unloaded';
      const again = TestBed.createComponent(CampusesPage);
      again.detectChanges();
      await again.whenStable();
      expect(orgLoad).toHaveBeenCalledTimes(1);
    });

    // 審核席 C3／C4：paginator 剛好一頁不出現、多一筆才出現；翻頁頁碼是 page + 1
    it('剛好一頁不出 paginator；多一筆才出；翻到第 2 頁打 page: 2', async () => {
      const many = (n: number) =>
        Array.from({ length: Math.min(n, LIST_PAGE_SIZE) }, (_, i) => c({ id: 'p' + i }));
      const page = async (total: number) => {
        campusesServiceMock.list.mockReturnValue(
          of(
            buildCampusResponse({
              data: many(total),
              summary: { total, activeCount: total, inactiveCount: 0 },
              meta: {
                total,
                page: 1,
                pageSize: LIST_PAGE_SIZE,
                totalPages: Math.ceil(total / LIST_PAGE_SIZE),
              },
            }),
          ),
        );
        component.loadCampuses();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return (fixture.nativeElement as HTMLElement).querySelector('p-paginator');
      };
      expect(await page(LIST_PAGE_SIZE)).toBeNull();
      expect(await page(LIST_PAGE_SIZE + 1)).not.toBeNull();
      (component as unknown as { onPage: (e: { page: number }) => void }).onPage({ page: 1 });
      expect(campusesServiceMock.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });

    // 審核席 C7：清除搜尋真的清掉關鍵字並重抓
    it('找不到時按清除搜尋：關鍵字清空、不帶 search 重抓', async () => {
      vi.useFakeTimers();
      try {
        const type = (v: string) =>
          (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(v);
        campusesServiceMock.list.mockReturnValue(
          of(buildCampusResponse({ summary: { total: 3, activeCount: 3, inactiveCount: 0 } })),
        );
        type('xyz');
        vi.advanceTimersByTime(300);
        fixture.detectChanges();
        const clear = [
          ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
        ].find((b) => b.textContent!.trim() === '清除搜尋')!;
        clear.click();
        vi.advanceTimersByTime(300);
        expect((component as unknown as { searchQuery: () => string }).searchQuery()).toBe('');
        expect(campusesServiceMock.list).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: undefined }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
