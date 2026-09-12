import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService } from '@core/campuses.service';
import { StaffService } from '@core/staff.service';
import { SubjectsService } from '@core/subjects.service';
import type { Staff } from '@core/staff.service';
import { vi } from 'vitest';

import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { LoginLinkDialogComponent } from '@shared/components/login-link-dialog/login-link-dialog.component';

import { StaffPage } from './staff.page';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

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
    },
    ...overrides,
  });
  const staffServiceMock = {
    list: vi.fn(() => of(buildStaffResponse())),
    createLoginLink: vi.fn(() => of({ url: 'https://x/verify?token=t', expiresInSeconds: 86400 })),
  };
  const dialogServiceMock = { open: vi.fn(() => ({ onClose: of(undefined) })) };

  beforeEach(async () => {
    staffServiceMock.list.mockReset();
    staffServiceMock.list.mockReturnValue(of(buildStaffResponse()));
    staffServiceMock.createLoginLink.mockClear();
    dialogServiceMock.open.mockClear();

    await TestBed.configureTestingModule({
      imports: [StaffPage],
      providers: [
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('用共用的整頁列表頁大小，不自己訂一個', () => {
    expect((component as unknown as { PAGE_SIZE: number }).PAGE_SIZE).toBe(LIST_PAGE_SIZE);
  });

  it('shows the total staff count in the summary card', () => {
    const staff = [
      {
        id: 'staff-1',
        userId: 'user-1',
        orgId: 'org-1',
        displayName: '王老師',
        phone: null,
        email: 'wang@example.com',
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
      },
    ] satisfies Staff[];

    (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
    (component as unknown as { staffList: { set: (value: Staff[]) => void } }).staffList.set(staff);
    (component as unknown as { total: { set: (value: number) => void } }).total.set(128);
    (
      component as unknown as {
        summary: {
          set: (value: {
            total: number;
            adminCount: number;
            teacherCount: number;
            activeCount: number;
            inactiveCount: number;
            archivedCount: number;
          }) => void;
        };
      }
    ).summary.set({
      total: 128,
      adminCount: 0,
      teacherCount: 1,
      activeCount: 1,
      inactiveCount: 0,
      archivedCount: 0,
    });
    fixture.detectChanges();

    const statValues = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.staff__stat-value'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(statValues[0]).toBe('128');
  });

  it('shows summary counts returned by the API', () => {
    const staff = [
      {
        id: 'staff-1',
        userId: 'user-1',
        orgId: 'org-1',
        displayName: '王老師',
        phone: null,
        email: 'wang@example.com',
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
      },
    ] satisfies Staff[];

    (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
    (component as unknown as { staffList: { set: (value: Staff[]) => void } }).staffList.set(staff);
    (
      component as unknown as {
        summary: {
          set: (value: {
            total: number;
            adminCount: number;
            teacherCount: number;
            activeCount: number;
            inactiveCount: number;
            archivedCount: number;
          }) => void;
        };
      }
    ).summary.set({
      total: 128,
      adminCount: 7,
      teacherCount: 121,
      activeCount: 119,
      inactiveCount: 5,
      archivedCount: 4,
    });
    fixture.detectChanges();

    const statValues = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.staff__stat-value'),
    ).map((element) => element.textContent?.trim() ?? '');

    expect(statValues).toEqual(['128', '7', '121', '119']);
  });

  /**
   * P1-4（Tester 抓到）：13 管理員 + 89 老師 ≠ 101 位人員，因為兼任的人兩邊
   * 各算一次——這是既定規格不是 bug，但畫面原本沒講，行政會停下來以為算錯。
   */
  describe('管理員／老師合併磚的兼任備註', () => {
    function setSummary(overrides: { multiRoleCount: number }) {
      const staff: Staff[] = [
        {
          id: 'staff-1',
          userId: 'user-1',
          orgId: 'org-1',
          displayName: '王老師',
          phone: null,
          email: 'wang@example.com',
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
        },
      ];

      (component as unknown as { loading: { set: (value: boolean) => void } }).loading.set(false);
      (component as unknown as { staffList: { set: (value: Staff[]) => void } }).staffList.set(
        staff,
      );
      (
        component as unknown as {
          summary: {
            set: (value: {
              total: number;
              adminCount: number;
              teacherCount: number;
              multiRoleCount: number;
              activeCount: number;
              inactiveCount: number;
              archivedCount: number;
            }) => void;
          };
        }
      ).summary.set({
        total: 101,
        adminCount: 13,
        teacherCount: 89,
        activeCount: 98,
        inactiveCount: 3,
        archivedCount: 0,
        ...overrides,
      });
      fixture.detectChanges();
    }

    it('有兼任人數時顯示備註，不用自己算', () => {
      setSummary({ multiRoleCount: 1 });

      const note = fixture.nativeElement.querySelector('.staff__stat-note');
      expect(note?.textContent?.trim()).toBe('（1 位身兼兩者）');
    });

    it('沒有兼任（0）時不顯示備註', () => {
      setSummary({ multiRoleCount: 0 });

      expect(fixture.nativeElement.querySelector('.staff__stat-note')).toBeNull();
    });
  });

  // 這個系統沒有密碼 —— 一次性登入連結是員工唯一的進門方式。
  // PR #24 的後端回傳了 loginUrl，但前端型別把它丟掉、頁面也沒有任何入口，
  // 新建的員工因此完全無法登入。
  describe('StaffPage 的登入連結', () => {
    const staff = { id: 's1', userId: 'u1', displayName: '王老師', status: 'active' } as Staff;
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
    // 還沒有登入帳號的人產生不出連結 —— 要說清楚，不要靜靜地什麼都沒發生
    it('沒有 userId 時不呼叫 API', () => {
      (component as unknown as { issueLoginLink: (s: Staff) => void }).issueLoginLink({
        ...staff,
        userId: '',
      } as Staff);
      expect(staffServiceMock.createLoginLink).not.toHaveBeenCalled();
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
});
