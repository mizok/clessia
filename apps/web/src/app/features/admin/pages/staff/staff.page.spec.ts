import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService } from '@core/campuses.service';
import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { StaffService } from '@core/staff.service';
import { SubjectsService } from '@core/subjects.service';
import type { Staff } from '@core/staff.service';
import { By } from '@angular/platform-browser';
import { Select } from 'primeng/select';
import { vi } from 'vitest';

import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { LoginLinkDialogComponent } from '@shared/components/login-link-dialog/login-link-dialog.component';

import { StaffPage } from './staff.page';
import { KioskFormDialogComponent } from './kiosk-form-dialog/kiosk-form-dialog.component';
import { StaffFormDialogComponent } from './staff-form-dialog.component';
import { PermissionListDialogComponent } from './permission-list-dialog/permission-list-dialog.component';

describe('StaffPage', () => {
  let component: StaffPage;
  let fixture: ComponentFixture<StaffPage>;
  const buildStaffResponse = (
    overrides?: Partial<{
      data: Staff[];
      meta: { total: number; page: number; pageSize: number; totalPages: number };
      summary: {
        total: number;
        adminCount: number;
        teacherCount: number;
        activeCount: number;
        inactiveCount: number;
        archivedCount: number;
        multiRoleCount: number;
        byRole: { admin: number; teacher: number; kiosk: number; inactiveOrArchived: number };
      };
    }>,
  ) => ({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    summary: {
      total: 0,
      adminCount: 0,
      teacherCount: 0,
      activeCount: 0,
      inactiveCount: 0,
      archivedCount: 0,
      multiRoleCount: 0,
      byRole: { admin: 0, teacher: 0, kiosk: 0, inactiveOrArchived: 0 },
    },
    ...overrides,
  });
  const staffServiceMock = {
    list: vi.fn(() => of(buildStaffResponse())),
    createLoginLink: vi.fn(() => of({ url: 'https://x/verify?token=t', expiresInSeconds: 86400 })),
    archive: vi.fn(),
  };
  const dialogServiceMock = { open: vi.fn(() => ({ onClose: of(undefined) })) };
  const refDataMock = {
    campuses: signal<unknown[]>([]),
    loadCampuses: vi.fn(),
    invalidate: vi.fn(),
  };

  beforeEach(async () => {
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    staffServiceMock.list.mockReset();
    staffServiceMock.list.mockReturnValue(of(buildStaffResponse()));
    staffServiceMock.createLoginLink.mockClear();
    staffServiceMock.archive.mockReset();
    dialogServiceMock.open.mockClear();

    await TestBed.configureTestingModule({
      imports: [StaffPage],
      providers: [
        provideRouter([]),
        {
          provide: StaffService,
          useValue: staffServiceMock,
        },
        {
          provide: CampusesService,
          useValue: {
            list: () => of({ data: [] }),
          },
        },
        { provide: ReferenceDataService, useValue: refDataMock },
        {
          provide: SubjectsService,
          useValue: {
            list: () => of({ data: [] }),
          },
        },
        {
          provide: DialogService,
          useValue: dialogServiceMock,
        },
        {
          provide: OverlayContainerService,
          useValue: {
            getContainer: () => null,
          },
        },
      ],
    })
      // StaffPage 在 @Component 的 providers 裡自己給 DialogService，
      // 元件層級的 provider 會蓋過 TestBed 的 —— 必須用 overrideComponent 才換得掉
      .overrideComponent(StaffPage, {
        // set 會整個取代 providers 陣列 —— MessageService 必須一起帶上，否則元件建不起來
        set: {
          providers: [MessageService, { provide: DialogService, useValue: dialogServiceMock }],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(StaffPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('報表類：頂欄保留「全部分校」（#1607）', () => {
    const ctx = TestBed.inject(CampusContextService);
    expect(ctx.inUse()).toBe(true);
    expect(ctx.allowAll()).toBe(true);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('分校跟頂欄走：頂欄換分校回第一頁重查，清除篩選不動分校（#1138）', () => {
    staffServiceMock.list.mockClear();

    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();

    const calls = staffServiceMock.list.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual(expect.objectContaining({ campusId: 'campus-1' }));

    component.clearFilters();
    expect(calls[1][0]).toEqual(expect.objectContaining({ campusId: 'campus-1' }));
  });

  it('一次拿全部（pageSize 0），不分頁', () => {
    const calls = staffServiceMock.list.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls.at(-1)![0]).toEqual(expect.objectContaining({ pageSize: 0 }));
    expect(calls.at(-1)![0]).not.toHaveProperty('page');
  });

  describe('依角色分章（#1314 ST1）', () => {
    const person = (id: string, over: Partial<Staff>): Staff => ({
      id,
      userId: `u-${id}`,
      orgId: 'org-1',
      displayName: id,
      phone: null,
      email: `${id}@example.com`,
      birthday: null,
      notes: null,
      subjectIds: [],
      subjectNames: [],
      status: 'active',
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
      campusIds: [],
      roles: ['teacher'],
      permissions: [],
      ...over,
    });

    function show(
      staff: Staff[],
      byRole: Record<string, number>,
      over: Record<string, number> = {},
    ) {
      staffServiceMock.list.mockReturnValue(
        of(
          buildStaffResponse({
            data: staff,
            summary: {
              total: staff.length,
              adminCount: 0,
              teacherCount: 0,
              multiRoleCount: 0,
              activeCount: 0,
              inactiveCount: 0,
              archivedCount: 0,
              byRole: { admin: 0, teacher: 0, kiosk: 0, inactiveOrArchived: 0, ...byRole },
              ...over,
            },
          }),
        ),
      );
      (component as unknown as { loadStaff: () => void }).loadStaff();
      fixture.detectChanges();
    }

    const chapterHeads = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('[data-chapter] app-chapter-head'),
      ).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

    afterEach(() => staffServiceMock.list.mockReturnValue(of(buildStaffResponse())));

    // #1100 #38：同家長列表 —— 只標啟用中、還沒登入過的人；機台不標
    it('「還沒登入過」只標啟用中的人，停用的、機台、登入過的不標', () => {
      (
        component as unknown as { staffStatusFilter: { set: (v: string) => void } }
      ).staffStatusFilter.set('all');
      show(
        [
          person('新老師', { hasLoggedIn: false }),
          person('老鳥', { hasLoggedIn: true }),
          person('停用的', { hasLoggedIn: false, status: 'inactive' }),
          person('門口平板', { hasLoggedIn: false, roles: ['kiosk'] }),
        ],
        { teacher: 2, kiosk: 1, inactiveOrArchived: 1 },
      );
      const tagged = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('[data-staff]'),
      )
        .filter((row) => row.textContent?.includes('還沒登入過'))
        .map((row) => row.getAttribute('data-staff'));
      expect(tagged).toEqual(['新老師']);
    });

    it('四桶互斥：兼任歸管理員章、停用與封存同一章；章名張數讀 byRole', () => {
      // 預設狀態（啟用中＋已停用）不含封存；要看封存要選「全部」
      (
        component as unknown as { staffStatusFilter: { set: (v: string) => void } }
      ).staffStatusFilter.set('all');
      show(
        [
          person('a', { roles: ['admin'] }),
          person('both', { roles: ['admin', 'teacher'] }),
          person('t', {}),
          person('old', { status: 'archived' }),
        ],
        { admin: 2, teacher: 1, inactiveOrArchived: 1 },
      );
      expect(chapterHeads()).toEqual(['管理員 2 位', '老師 1 位', '停用與封存 1 位']);
    });

    // #1698：A6 staff.html 在 ≤860 覆寫 `.chap`＝橫排、章名 28px（listRow），不是共用的 26px
    it('章頭用 listRow：手機章名 28px', () => {
      show([person('a', { roles: ['admin'] })], { admin: 1, teacher: 0, inactiveOrArchived: 0 });
      const name = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-chapter] .chapter-head__name',
      );
      expect(name?.classList).toContain('text-[28px]');
      // #1715：A6 `.chap` 手機上內距 24px —— 現在 padding 在章（section）本身，同稿
      expect(name!.closest('[data-chapter]')!.classList).toContain('pt-6');
    });

    it('沒有人的章不顯示（kiosk 章只在有機台時出現）；沒有封存叫「已停用」', () => {
      show(
        [person('t', {}), person('off', { status: 'inactive' })],
        { teacher: 1, inactiveOrArchived: 1 },
        { inactiveCount: 1 },
      );
      expect(chapterHeads()).toEqual(['老師 1 位', '已停用 1 位']);

      show([person('k', { roles: ['kiosk'] })], { kiosk: 1 });
      expect(chapterHeads()).toEqual(['掃碼機台 1 位']);
    });

    it('開場副行：N 位管理員 · N 位老師（N 位身兼兩者），0 位身兼時不寫括號', () => {
      show(
        [person('t', {})],
        { teacher: 1 },
        { adminCount: 7, teacherCount: 121, multiRoleCount: 2 },
      );
      const sub = () => (fixture.nativeElement as HTMLElement).textContent!;
      expect(sub()).toContain('7 位管理員 · 121 位老師（2 位身兼兩者）');

      show(
        [person('t', {})],
        { teacher: 1 },
        { adminCount: 7, teacherCount: 121, multiRoleCount: 0 },
      );
      expect(sub()).toContain('7 位管理員 · 121 位老師');
      expect(sub()).not.toContain('身兼兩者');
    });
  });

  // 這個系統沒有密碼 —— 一次性登入連結是員工唯一的進門方式。
  // PR #24 的後端回傳了 loginUrl，但前端型別把它丟掉、頁面也沒有任何入口，
  // 新建的員工因此完全無法登入。
  describe('StaffPage 的登入連結', () => {
    const staff = {
      id: 's1',
      userId: 'u1',
      displayName: '王老師',
      status: 'active',
      roles: ['teacher'],
    } as Staff;
    it('產生連結會開 LoginLinkDialog 並帶入網址', () => {
      (component as unknown as { issueLoginLink: (s: Staff) => void }).issueLoginLink(staff);
      expect(staffServiceMock.createLoginLink).toHaveBeenCalledWith('u1');
      expect(dialogServiceMock.open).toHaveBeenCalled();
      const lastCall = dialogServiceMock.open.mock.calls.at(-1) as unknown as [
        unknown,
        { data: { loginUrl: string; personName: string } },
      ];
      const [dialogComponent, config] = lastCall;
      expect(dialogComponent).toBe(LoginLinkDialogComponent);
      expect(config.data.loginUrl).toContain('token=t');
      expect(config.data.personName).toBe('王老師');
    });
    /**
     * #666 之二：**這條接線不接上，對話框那半就是死碼。**
     *
     * `LoginLinkDialogComponent` 的 `audience` 預設是 `'parent'`
     * （家長那條路刻意一字不動），所以**職員版只有在這裡明式傳了才會出現**。
     * 少了這一行，對話框裡的兩套措辭永遠只會用到一套，而且沒有任何東西會報錯。
     */
    it('開的時候要標明對象是職員 —— 否則對話框會用家長的措辭', () => {
      (component as unknown as { issueLoginLink: (s: Staff) => void }).issueLoginLink(staff);

      const lastCall = dialogServiceMock.open.mock.calls.at(-1) as unknown as [
        unknown,
        { data: { audience?: string } },
      ];

      expect(lastCall[1].data.audience).toBe('staff');
    });

    // 還沒有登入帳號的人產生不出連結 —— 要說清楚，不要靜靜地什麼都沒發生
    // #1028：loginUrl 為 null（後端 mint 失敗）也要說出來，並且照常刷新列表
    describe('新增人員後 loginUrl 為 null', () => {
      const created = (loginUrl: string | null) => {
        dialogServiceMock.open.mockReturnValueOnce({
          onClose: of({ data: staff, loginUrl }),
        } as never);
        const add = vi.spyOn(fixture.debugElement.injector.get(MessageService), 'add');
        const listCalls = staffServiceMock.list.mock.calls.length;
        component.openCreateDialog();
        return { add, listCalls };
      };

      it('null → warn toast，不開 QR 對話框，仍重抓列表', () => {
        const { add, listCalls } = created(null);

        expect(add).toHaveBeenCalledWith(
          expect.objectContaining({ severity: 'warn', summary: '人員已建立' }),
        );
        expect(dialogServiceMock.open).toHaveBeenCalledTimes(1); // 只有建立表單那次
        expect(staffServiceMock.list.mock.calls.length).toBe(listCalls + 1);
      });

      it('有 loginUrl → 開 QR 對話框，不出 warn', () => {
        const { add } = created('https://x/verify?token=t');

        expect(add).not.toHaveBeenCalled();
        expect(dialogServiceMock.open).toHaveBeenCalledTimes(2);
      });
    });

    it('沒有 userId 時不呼叫 API', () => {
      (component as unknown as { issueLoginLink: (s: Staff) => void }).issueLoginLink({
        ...staff,
        userId: '',
      } as Staff);
      expect(staffServiceMock.createLoginLink).not.toHaveBeenCalled();
    });
  });

  // #1127：分校門口的掃碼機台。建立／編輯走自己的 dialog（不是人員表單），QR 給平板掃
  describe('掃碼機台', () => {
    const kiosk = {
      id: 'k1',
      userId: 'uk',
      displayName: '本校門口',
      status: 'active',
      roles: ['kiosk'],
      campusIds: ['c1'],
    } as Staff;
    type MenuHarness = {
      selectedStaff: { set: (s: Staff) => void };
      actionMenuItems: () => Array<{ label?: string; command?: () => void }>;
    };
    const menuFor = (s: Staff) => {
      const h = component as unknown as MenuHarness;
      h.selectedStaff.set(s);
      return h.actionMenuItems();
    };
    const lastDialog = () =>
      dialogServiceMock.open.mock.calls.at(-1) as unknown as [
        unknown,
        { data: Record<string, unknown> },
      ];

    it('「新增掃碼機台」開機台 dialog；建好後用機台措辭開 QR', () => {
      dialogServiceMock.open.mockReturnValueOnce({
        onClose: of({ data: kiosk, loginUrl: 'https://x/link' }),
      } as never);
      // A6 沒畫「新增掃碼機台」：收進頁面的「⋯」選單
      (
        component as unknown as { pageMenuItems: { label: string; command: () => void }[] }
      ).pageMenuItems
        .find((i) => i.label === '新增掃碼機台')!
        .command();

      expect((dialogServiceMock.open.mock.calls as unknown as unknown[][])[0]?.[0]).toBe(
        KioskFormDialogComponent,
      );
      const [dialog, config] = lastDialog();
      expect(dialog).toBe(LoginLinkDialogComponent);
      expect(config.data['audience']).toBe('kiosk');
    });

    it('機台的選單：沒有授課紀錄，編輯開機台 dialog', () => {
      const items = menuFor(kiosk);
      expect(items.map((i) => i.label)).not.toContain('授課紀錄');
      items.find((i) => i.label === '編輯')?.command?.();
      const [dialog, config] = lastDialog();
      expect(dialog).toBe(KioskFormDialogComponent);
      expect(config.data['staff']).toBe(kiosk);
    });

    it('一般人員的選單不變', () => {
      const items = menuFor({ ...kiosk, roles: ['teacher'] } as Staff);
      expect(items.map((i) => i.label)).toContain('授課紀錄');
      items.find((i) => i.label === '編輯')?.command?.();
      expect(lastDialog()[0]).toBe(StaffFormDialogComponent);
    });

    it('角色標籤寫「掃碼機台」', () => {
      expect(component.getRoleLabel('kiosk')).toBe('掃碼機台');
    });
  });

  /**
   * #661：搜尋沒有 debounce 也沒有取消。
   *
   * 可用性測試席的活重現：一次打完「李語涵」四個字 → **回 4 筆**
   * （李語涵、李宇翔、李彥廷、李泓安），那是「**李**」的結果集 ——
   * 搜尋框顯示的字跟送出去查的字不一樣，而且**它不會自己追上**。
   *
   * 這個時序**實機演不到**（本機 API 太快，沒有重疊窗口），只有替身做得到：
   * 每支請求回一個我們自己控制何時完成的 `Subject`。
   */
  describe('搜尋的在途請求（#661）', () => {
    type StaffListRes = ReturnType<typeof buildStaffResponse>;
    const pending: Array<{ search: string | undefined; subject: Subject<StaffListRes> }> = [];

    // `roles` / `subjectNames` / `campusIds` 不能省 —— 模板有 `staff.roles.includes('admin')`
    // 與 `staff.subjectNames.length`，少了它們會在測試輸出裡噴 TypeError 而
    // **不讓任何一條測試紅**（渲染的例外不會傳回斷言）。
    const staffNamed = (names: string[]) =>
      buildStaffResponse({
        data: names.map(
          (displayName, i) =>
            ({
              id: `s${i}`,
              userId: `u${i}`,
              displayName,
              status: 'active',
              roles: ['teacher'],
              permissions: [],
              subjectIds: [],
              subjectNames: [],
              campusIds: [],
            }) as unknown as Staff,
        ),
        meta: { total: names.length, page: 1, pageSize: 20, totalPages: 1 },
      });

    const type = (text: string) =>
      (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(text);

    const names = () =>
      (component as unknown as { staffList: () => Array<{ displayName: string }> })
        .staffList()
        .map((s) => s.displayName);

    beforeEach(() => {
      // 這個 app 是 zoneless（Angular 21 + signals），沒有 `fakeAsync` ——
      // 時間用 vitest 的假計時器控制。`debounceTime` 走 asyncScheduler 的 setTimeout。
      vi.useFakeTimers();
      pending.length = 0;
      staffServiceMock.list.mockReset();
      staffServiceMock.list.mockImplementation((params?: { search?: string }) => {
        const subject = new Subject<StaffListRes>();
        pending.push({ search: params?.search, subject });
        return subject.asObservable();
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('連續打字只送出一次請求（最後那個字）', () => {
      type('李');
      type('李語');
      type('李語涵');
      vi.advanceTimersByTime(300);

      expect(staffServiceMock.list).toHaveBeenCalledTimes(1);
      expect(pending.at(-1)?.search).toBe('李語涵');
    });

    /**
     * **debounce 只解一半。** 打字慢的人（每次間隔超過 300ms）仍然會送出多支請求，
     * 而它們回來的順序不保證 —— 先發的後到就會蓋掉畫面。
     *
     * 這條**故意讓兩支請求都真的送出**（中間 tick 過 debounce），
     * 然後讓**先發的後回**。有 `switchMap` 的話先發的那支已經被取消，
     * 它的結果不該出現在畫面上。
     */
    it('先發的請求後回時不會蓋掉畫面（switchMap 取消）', () => {
      type('李');
      vi.advanceTimersByTime(300);
      type('李語涵');
      vi.advanceTimersByTime(300);

      expect(staffServiceMock.list).toHaveBeenCalledTimes(2);

      // 後發的先回 —— 畫面應該是「李語涵」的結果
      pending[1].subject.next(staffNamed(['李語涵']));
      pending[1].subject.complete();

      // 先發的那支現在才回（就是那 4 筆）。它已經被取消，不該被採用。
      pending[0].subject.next(staffNamed(['李語涵', '李宇翔', '李彥廷', '李泓安']));
      pending[0].subject.complete();

      expect(names()).toEqual(['李語涵']);
    });

    /** 篩選下拉也走同一條 switchMap：連切兩次角色，先發的後回不能蓋掉畫面（A6 篩選面板） */
    it('連切兩次篩選下拉，先發的後回不會蓋掉畫面', () => {
      const c = component as unknown as {
        onRoleFilterChange: (v: string | null) => void;
        onStaffStatusFilterChange: (v: string) => void;
      };
      pending.length = 0;
      c.onRoleFilterChange('admin');
      c.onStaffStatusFilterChange('inactive');
      expect(pending).toHaveLength(2);

      pending[1].subject.next(staffNamed(['停用的老師']));
      pending[1].subject.complete();
      pending[0].subject.next(staffNamed(['管理員甲', '管理員乙']));
      pending[0].subject.complete();

      expect(names()).toEqual(['停用的老師']);
    });

    /** 對照組：同樣的字不重複送（否則上面那兩條在「每次都送」的實作下也會過） */
    it('同樣的關鍵字不重複送出請求', () => {
      type('李語涵');
      vi.advanceTimersByTime(300);
      type('李語涵');
      vi.advanceTimersByTime(300);

      expect(staffServiceMock.list).toHaveBeenCalledTimes(1);
    });

    /**
     * 去重比對的是 `searchQuery` signal，不是 `distinctUntilChanged`。
     *
     * `clearFilters()` 直接 `searchQuery.set('')`、不經過搜尋管線 ——
     * 若去重的記憶是管線自己的那一份，清完篩選再打一次同樣的字會被整個吞掉，
     * **搜尋框有字、列表卻是未篩選的全部**。那是同一族的另一種穿法。
     */
    it('清除篩選之後再打同樣的字，仍然會查', () => {
      type('李語涵');
      vi.advanceTimersByTime(300);
      expect(staffServiceMock.list).toHaveBeenCalledTimes(1);

      (component as unknown as { clearFilters: () => void }).clearFilters();
      expect(staffServiceMock.list).toHaveBeenCalledTimes(2);
      expect(pending.at(-1)?.search).toBeUndefined();

      type('李語涵');
      vi.advanceTimersByTime(300);

      expect(staffServiceMock.list).toHaveBeenCalledTimes(3);
      expect(pending.at(-1)?.search).toBe('李語涵');
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
     */
    it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
      type('李');
      vi.advanceTimersByTime(300);
      expect(staffServiceMock.list).toHaveBeenCalledTimes(1);

      pending[0].subject.error(new Error('boom'));

      type('王');
      vi.advanceTimersByTime(300);

      expect(staffServiceMock.list).toHaveBeenCalledTimes(2);

      pending[1].subject.next(staffNamed(['王大明']));
      pending[1].subject.complete();
      expect(names()).toEqual(['王大明']);
    });
  });

  /**
   * **#788：取數失敗時畫面不能渲染成「尚未有資料」。**
   * 斷言**畫面主體**而不是某個 signal —— 使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」而不是「尚未建立人員」', () => {
    staffServiceMock.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    (component as unknown as { loadStaff: () => void }).loadStaff();
    if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('載入失敗');
    expect(text).not.toContain('尚未建立人員');
  });
  describe('A6 人員列（#1314 ST）', () => {
    const person = (id: string, over: Partial<Staff>): Staff => ({
      id,
      userId: `u-${id}`,
      orgId: 'org-1',
      displayName: id,
      phone: '0912-345-678',
      email: `${id}@example.com`,
      birthday: null,
      notes: null,
      subjectIds: [],
      subjectNames: ['數學'],
      status: 'active',
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
      campusIds: [],
      roles: ['teacher'],
      permissions: [],
      ...over,
    });
    const lastList = () =>
      (staffServiceMock.list.mock.calls as unknown as Array<[Record<string, unknown>]>).at(-1)![0];
    const root = () => fixture.nativeElement as HTMLElement;
    const text = () => root().textContent!.replace(/\s+/g, ' ');
    const respond = (staff: Staff[], summary: Record<string, unknown> = {}) => {
      staffServiceMock.list.mockReturnValue(
        of(
          buildStaffResponse({
            data: staff,
            summary: {
              total: staff.length,
              adminCount: 1,
              teacherCount: 1,
              multiRoleCount: 0,
              activeCount: staff.filter((s) => s.status === 'active').length,
              inactiveCount: 0,
              archivedCount: 0,
              byRole: { admin: 1, teacher: 1, kiosk: 0, inactiveOrArchived: 0 },
              ...summary,
            } as never,
          }),
        ),
      );
      (component as unknown as { loadStaff: () => void }).loadStaff();
      fixture.detectChanges();
    };
    afterEach(() => staffServiceMock.list.mockReturnValue(of(buildStaffResponse())));

    it('色面數字句：N 位人員（不含封存），M 位啟用中', () => {
      respond([person('a', { roles: ['admin'] }), person('t', {})], {
        total: 5,
        archivedCount: 2,
        activeCount: 2,
      });
      const title = root().querySelector('app-page-open')!.textContent!.replace(/\s+/g, '');
      expect(title).toContain('3位人員，2位啟用中。');
    });

    it('預設不含封存：封存的人不在列上，停用章張數讀 inactiveCount（不是 byRole 那桶）', () => {
      respond(
        [
          person('t', {}),
          person('off', { status: 'inactive' }),
          person('gone', { status: 'archived' }),
        ],
        {
          inactiveCount: 1,
          archivedCount: 1,
          byRole: { admin: 0, teacher: 1, kiosk: 0, inactiveOrArchived: 2 },
        },
      );
      expect(root().querySelector('[data-staff="gone"]')).toBeNull();
      expect(root().querySelector('[data-chapter="inactive"]')!.textContent).toContain('1');
      expect(root().querySelector('[data-chapter="inactive"]')!.textContent).not.toContain('2 位');
    });

    it('明確選「已停用」時章名數列，不讀不吃狀態篩選的 byRole', () => {
      (component as any).staffStatusFilter.set('inactive');
      respond([person('off', { status: 'inactive' })], {
        inactiveCount: 1,
        byRole: { admin: 0, teacher: 0, kiosk: 0, inactiveOrArchived: 2 },
      });
      expect(root().querySelector('[data-chapter="inactive"]')!.textContent).toContain('1 位');
      expect(root().querySelector('[data-chapter="inactive"]')!.textContent).not.toContain('2 位');
    });

    it('選「全部（含已封存）」不帶 status 且封存的人出現；選「已封存」帶 status=archived', () => {
      respond([person('t', {})]);
      (component as any).onStaffStatusFilterChange('all');
      expect(lastList()['status']).toBeUndefined();
      (component as any).onStaffStatusFilterChange('archived');
      expect(lastList()['status']).toBe('archived');
    });

    it('管理員列有「權限 N 項」，老師沒有；點下去開唯讀清單，只列他有的權限', () => {
      respond([
        person('boss', { roles: ['admin'], permissions: ['manage_courses', 'view_reports'] }),
        person('t', {}),
      ]);
      expect(root().querySelector('[data-testid="permission-count-boss"]')!.textContent).toContain(
        '權限 2 項',
      );
      expect(root().querySelector('[data-testid="permission-count-t"]')).toBeNull();

      (root().querySelector('[data-testid="permission-count-boss"]') as HTMLElement).click();
      const [dialog, config] = dialogServiceMock.open.mock.calls.at(-1) as unknown as [
        unknown,
        { data: Record<string, unknown> },
      ];
      expect(dialog).toBe(PermissionListDialogComponent);
      expect(config.data['permissions']).toEqual(['manage_courses', 'view_reports']);
    });

    it('點姓名開編輯；機台開機台 dialog', () => {
      respond([person('t', {}), person('k', { roles: ['kiosk'] })]);
      (root().querySelector('[data-staff="t"] button') as HTMLElement).click();
      expect((dialogServiceMock.open.mock.calls as unknown as unknown[][]).at(-1)![0]).toBe(
        StaffFormDialogComponent,
      );
      (root().querySelector('[data-staff="k"] button') as HTMLElement).click();
      expect((dialogServiceMock.open.mock.calls as unknown as unknown[][]).at(-1)![0]).toBe(
        KioskFormDialogComponent,
      );
    });

    it('篩選摘要寫出目前條件；清除篩選回預設並一起清搜尋', () => {
      respond([person('t', {})]);
      (component as any).onRoleFilterChange('teacher');
      expect((component as any).filterSummary()).toBe('老師');
      (component as any).onStaffStatusFilterChange('inactive');
      expect((component as any).filterSummary()).toBe('老師 · 已停用');
      fixture.detectChanges();
      expect(text()).toContain('位符合');

      (component as any).clearFilters();
      expect((component as any).filterSummary()).toBe('全部');
      expect(lastList()).toMatchObject({
        role: undefined,
        status: undefined,
      });
    });

    describe('篩選面板（A6 `.ff`：常開面板＋手機摺疊列）', () => {
      const panel = () => root().querySelector('#staff-filters') as HTMLElement;
      const fold = () => root().querySelector('[data-testid="filter-fold"]') as HTMLButtonElement;
      const selects = () => Array.from(panel().querySelectorAll('p-select'));

      it('面板有三個帶標籤的下拉：角色、教學科目、狀態（沒有服務分校）', () => {
        respond([person('t', {})]);
        expect(
          fixture.debugElement
            .queryAll(By.directive(Select))
            .map((d) => (d.componentInstance as Select).ariaLabel),
        ).toEqual(['角色', '教學科目', '狀態']);
        expect(selects()).toHaveLength(3);
        const labels = Array.from(panel().querySelectorAll('label')).map((l) =>
          l.textContent!.replace(/\s+/g, ''),
        );
        expect(labels.some((l) => l.startsWith('角色'))).toBe(true);
        expect(labels.some((l) => l.startsWith('教學科目'))).toBe(true);
        expect(labels.some((l) => l.startsWith('狀態'))).toBe(true);
        expect(panel().textContent).not.toContain('服務分校');
      });

      it('桌機常開、手機預設收合：面板有 hidden 與 wide:grid，摺疊鈕有 wide:hidden', () => {
        respond([person('t', {})]);
        expect(panel().classList).toContain('hidden');
        expect(panel().classList).toContain('wide:grid');
        expect(panel().classList).toContain('grid');
        expect(fold().classList).toContain('wide:hidden');
        expect(fold().getAttribute('aria-expanded')).toBe('false');
        expect(fold().querySelector('[data-testid="filter-fold-meta"]')!.textContent!.trim()).toBe(
          '全部',
        );
      });

      it('按摺疊鈕展開（hidden 拿掉）、再按收合；aria-expanded 與 chevron 跟著走', () => {
        respond([person('t', {})]);
        fold().click();
        fixture.detectChanges();
        expect(panel().classList).not.toContain('hidden');
        expect(panel().classList).toContain('wide:grid');
        expect(fold().getAttribute('aria-expanded')).toBe('true');
        expect(fold().querySelector('i')!.classList).toContain('rotate-180');
        fold().click();
        fixture.detectChanges();
        expect(panel().classList).toContain('hidden');
        expect(fold().getAttribute('aria-expanded')).toBe('false');
      });

      it('摺疊列的摘要跟著篩選走（手機看不到面板時仍知道有篩選）', () => {
        respond([person('t', {})]);
        (component as any).onRoleFilterChange('admin');
        fixture.detectChanges();
        expect(fold().querySelector('[data-testid="filter-fold-meta"]')!.textContent!.trim()).toBe(
          '管理員',
        );
      });

      it('下拉改值會帶進查詢：角色、科目、狀態各一次，「全部」回到未帶參數', () => {
        respond([person('t', {})]);
        const pick = (label: string, value: unknown) => {
          const i = ['角色', '教學科目', '狀態'].indexOf(label);
          fixture.debugElement
            .queryAll(By.directive(Select))
            [i].triggerEventHandler('ngModelChange', value);
        };
        pick('角色', 'teacher');
        expect(lastList()).toMatchObject({ role: 'teacher' });
        pick('教學科目', 'sub-1');
        expect(lastList()).toMatchObject({ role: 'teacher', subjectId: 'sub-1' });
        pick('狀態', 'inactive');
        expect(lastList()).toMatchObject({ status: 'inactive' });
        pick('角色', null);
        pick('教學科目', null);
        pick('狀態', 'live');
        expect(lastList()).toMatchObject({
          role: undefined,
          subjectId: undefined,
          status: undefined,
        });
      });

      it('狀態選項五個、預設「啟用中＋已停用」；角色選項首項是「全部角色」', () => {
        respond([person('t', {})]);
        expect((component as any).statusOptions.map((o: { label: string }) => o.label)).toEqual([
          '啟用中＋已停用',
          '啟用中',
          '已停用',
          '已封存',
          '全部（含已封存）',
        ]);
        expect((component as any).roleSelectOptions[0]).toEqual({ value: null, label: '全部角色' });
        expect((component as any).subjectSelectOptions()[0]).toEqual({
          value: null,
          label: '全部科目',
        });
      });
    });

    it('操作紀錄是全站共用的時鐘圖示鈕、不佔底部托盤（#2006）；新增人員仍帶 + 圖示；「⋯」還在', () => {
      respond([person('t', {})]);
      expect(
        root().querySelector('app-audit-log-button button[aria-label="操作紀錄"]'),
      ).not.toBeNull();
      expect(root().querySelectorAll('.page-actions__dock button').length).toBe(1);
      expect((component as any).primaryAction.icon).toBe('pi pi-plus');
      expect(root().querySelector('[data-testid="staff-page-menu"]')).not.toBeNull();
      expect(root().querySelector('app-filter-toggle')).toBeNull();
    });

    it('列上：角色 chip、科目、狀態、電話都是純文字（沒有 tel 連結）', () => {
      respond([person('t', {})]);
      const row = root().querySelector('[data-staff="t"]')!;
      expect(row.textContent).toContain('數學');
      expect(row.textContent).toContain('啟用中');
      expect(row.textContent).toContain('0912-345-678');
      expect(row.querySelector('a[href^="tel:"]')).toBeNull();
    });
  });

  // #1641 5b（使用者 10-16 裁定第 1 點）：封存是樂觀的 —— 按下就淡出；失敗要放回去並說明
  describe('樂觀封存', () => {
    const person = (id: string) =>
      ({ id, displayName: `人員${id}`, status: 'active', roles: ['teacher'] }) as unknown as Staff;
    type Page = {
      staffList: { set: (v: Staff[]) => void; (): Staff[] };
      staffStatusFilter: { set: (v: string) => void };
      archiveStaff: (s: Staff) => void;
    };
    const page = () => component as unknown as Page;
    const ids = () =>
      page()
        .staffList()
        .map((s) => s.id);

    it('失敗：那一列放回原位，並跳錯誤 toast', () => {
      const add = vi.spyOn(fixture.debugElement.injector.get(MessageService), 'add');
      page().staffList.set([person('a'), person('b')]);
      staffServiceMock.archive.mockReturnValueOnce(
        throwError(() => ({ error: { error: '伺服器錯誤' } })),
      );
      page().archiveStaff(person('b'));
      expect(ids()).toEqual(['a', 'b']);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('成功：維持拿掉、toast 帶回應的待指派堂數，背景重抓不變淡', () => {
      const add = vi.spyOn(fixture.debugElement.injector.get(MessageService), 'add');
      page().staffList.set([person('a'), person('b')]);
      staffServiceMock.archive.mockReturnValueOnce(of({ unassignedSessions: 3 }));
      staffServiceMock.list.mockReturnValue(NEVER);
      page().archiveStaff(person('b'));
      expect(ids()).toEqual(['a']);
      expect(component.loading()).toBe(false);
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success', detail: expect.stringContaining('3 堂') }),
      );
    });

    it('篩選「全部」：封存的人只是換章，等伺服器回來才動，不先拿掉', () => {
      page().staffList.set([person('a'), person('b')]);
      page().staffStatusFilter.set('all');
      const pending = new Subject<{ unassignedSessions: number }>();
      staffServiceMock.archive.mockReturnValueOnce(pending);
      page().archiveStaff(person('b'));
      expect(ids()).toEqual(['a', 'b']);
    });
  });
});
