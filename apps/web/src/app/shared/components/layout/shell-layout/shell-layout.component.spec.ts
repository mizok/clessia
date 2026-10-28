import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { AuthService, type UserRole } from '@core/auth.service';
import { InboxBadgeService } from '@core/inbox-badge.service';
import { NavigationService } from '@core/navigation.service';
import { CampusContextService } from '@core/campus-context.service';
import { ShellLayoutComponent } from './shell-layout.component';

/** shell-layout 底下的 InheritSizeDirective 需要它；jsdom 沒有（專案既有慣例是各 spec 自備） */
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function stubAuth(roles: UserRole[], activeRole: UserRole | null) {
  return {
    roles: signal<UserRole[]>(roles),
    activeRole: signal<UserRole | null>(activeRole),
    profile: signal({ id: 'u1', display_name: '王主任', branch_id: null }),
    user: signal({ id: 'u1', email: 'a@example.com' }),
    permissions: signal<string[]>(['*']),
    hasPermission: () => true,
    navigateToRoleShell: vi.fn(),
    signOut: vi.fn(),
  };
}

const item = (label: string, route: string) => ({ label, route, icon: '' });

async function setup(
  roles: UserRole[],
  activeRole: UserRole | null,
  more = true,
  bell: { route?: string | null; unread?: number } = {},
) {
  const auth = stubAuth(roles, activeRole);
  const badge = {
    unread: signal(bell.unread ?? 0),
    hasInbox: signal(activeRole === 'teacher' || activeRole === 'parent'),
  };
  TestBed.configureTestingModule({
    imports: [ShellLayoutComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      providePrimeNG({}),
      { provide: AuthService, useValue: auth },
      {
        provide: NavigationService,
        useValue: {
          topItems: signal([item('儀表板', '/admin/dashboard'), item('學生', '/admin/students')]),
          moreGroups: signal(
            more ? [{ label: '課務管理', items: [item('課務異動', '/admin/changes')] }] : [],
          ),
          notificationsRoute: signal(
            bell.route === undefined ? `/${activeRole}/notifications` : bell.route,
          ),
        },
      },
      { provide: InboxBadgeService, useValue: badge },
    ],
  });
  const fixture = TestBed.createComponent(ShellLayoutComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, auth, badge, el: fixture.nativeElement as HTMLElement };
}

const switchItems = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('[role="group"] button'));

describe('ShellLayoutComponent —— A6 頂欄', () => {
  let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      originalResizeObserver;
  });

  describe('頭像圓章取字（A6）', () => {
    const initialFor = async (displayName: string, email = 'a@example.com') => {
      const { auth, fixture, el } = await setup(['admin'], 'admin');
      auth.profile.set({ id: 'u1', display_name: displayName, branch_id: null });
      auth.user.set({ id: 'u1', email });
      fixture.detectChanges();
      return el.querySelector('button[popovertarget="shell-account"] span[aria-hidden="true"]')
        ?.textContent;
    };

    it('中文名取第一個字', async () => expect(await initialFor('王主任')).toBe('王'));
    it('英文名大寫', async () => expect(await initialFor('alice')).toBe('A'));
    it('前後空白不算', async () => expect(await initialFor('  bob  ')).toBe('B'));
    it('沒有名字就用 email 第一個字', async () => expect(await initialFor('')).toBe('A'));
    it('名字與 email 都空 → ?', async () => expect(await initialFor('', '')).toBe('?'));
    it('代理對（𠮷）不被拆半', async () => expect(await initialFor('𠮷野')).toBe('𠮷'));
  });

  it('頂欄列出 topItems，字標連到第一項（角色首頁）', async () => {
    const { el } = await setup(['admin'], 'admin');
    const nav = el.querySelector('nav[aria-label="主要導覽"]')!;

    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim())).toEqual([
      '儀表板',
      '學生',
    ]);
    expect(el.querySelector('header a')?.getAttribute('href')).toBe('/admin/dashboard');
  });

  it('有「更多」分組才出「更多」鈕，鈕指向同一個 popover', async () => {
    const withMore = await setup(['admin'], 'admin');
    const btn = withMore.el.querySelector('[popovertarget="shell-more"]');

    expect(btn?.textContent).toContain('更多');
    expect(withMore.el.querySelector('#shell-more')?.textContent).toContain('課務異動');

    TestBed.resetTestingModule();
    const none = await setup(['teacher'], 'teacher', false);
    expect(none.el.querySelector('[popovertarget="shell-more"]')).toBeNull();
  });

  /** #34 的教訓：切個身分不該走一趟 `/select-role`。現在入口在帳戶浮層，就地切換。 */
  it('帳戶浮層列出「其他」身分，點了交給 auth.navigateToRoleShell', async () => {
    const { el, auth } = await setup(['admin', 'teacher', 'parent'], 'admin');

    expect(switchItems(el).map((b) => b.textContent?.trim())).toEqual(['任課老師', '家長']);
    switchItems(el)[0].click();
    expect(auth.navigateToRoleShell).toHaveBeenCalledWith('teacher');
  });

  it('單一身分：沒有「切換身分」那一組', async () => {
    const { el } = await setup(['teacher'], 'teacher');

    expect(el.querySelector('[role="group"]')).toBeNull();
  });

  it('帳戶鈕的無障礙名稱講出人與目前身分', async () => {
    const { el } = await setup(['admin', 'teacher'], 'admin');

    expect(el.querySelector('[popovertarget="shell-account"]')?.getAttribute('aria-label')).toBe(
      '帳戶：王主任，目前身分 管理員',
    );
  });

  it('登出交給 auth.signOut', async () => {
    const { el, auth } = await setup(['admin'], 'admin');
    const btn = Array.from(el.querySelectorAll<HTMLButtonElement>('#shell-account button')).find(
      (b) => b.textContent?.includes('登出'),
    );

    btn!.click();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('全站搜尋只給管理員（#1138）：老師、家長的頂欄沒有', async () => {
    const admin = await setup(['admin'], 'admin');
    expect(admin.el.querySelector('app-global-search')).not.toBeNull();
    TestBed.resetTestingModule();
    const teacher = await setup(['teacher'], 'teacher');
    expect(teacher.el.querySelector('app-global-search')).toBeNull();
  });

  describe('頂欄分校（#1138 H2）', () => {
    const ctx = (inUse: boolean, n: number, allowAll = true) => ({
      inUse: signal(inUse),
      allowAll: signal(allowAll),
      campuses: signal(Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `分校${i}` }))),
      id: signal<string | null>(null),
      name: signal<string | null>(null),
      select: vi.fn(),
      use: vi.fn(),
    });
    async function withCtx(c: ReturnType<typeof ctx>) {
      TestBed.overrideProvider(CampusContextService, { useValue: c });
      return setup(['admin'], 'admin');
    }

    it('頁面沒接上就不出現（過渡期：不讓頂欄跟頁面說不同的分校）', async () => {
      const { el } = await withCtx(ctx(false, 3));
      expect(el.querySelector('[popovertarget="shell-campus"]')).toBeNull();
    });

    it('日常頁（不允許全部）：選單只有每一間，沒有「全部分校」（#1607）', async () => {
      const c = ctx(true, 2, false);
      c.id.set('c0');
      c.name.set('分校0');
      const { el } = await withCtx(c);
      expect(el.querySelector('[popovertarget="shell-campus"]')?.textContent).toContain('分校0');
      const items = Array.from(
        document.querySelectorAll<HTMLButtonElement>('#shell-campus button'),
      );
      expect(items.map((b) => b.textContent?.trim())).toEqual(['分校0', '分校1']);
    });

    it('報表頁、多間分校：下拉鈕寫「全部分校」，選單有全部＋每一間，點了寫回去', async () => {
      const c = ctx(true, 2);
      const { el } = await withCtx(c);
      expect(el.querySelector('[popovertarget="shell-campus"]')?.textContent).toContain('全部分校');
      const items = Array.from(
        document.querySelectorAll<HTMLButtonElement>('#shell-campus button'),
      );
      expect(items.map((b) => b.textContent?.trim())).toEqual(['全部分校', '分校0', '分校1']);
      items[2].click();
      expect(c.select).toHaveBeenCalledWith('c1');
    });

    it('只管一間：只寫名字、不給點', async () => {
      const { el } = await withCtx(ctx(true, 1));
      expect(el.querySelector('[popovertarget="shell-campus"]')).toBeNull();
      expect(el.textContent).toContain('分校0');
    });
  });

  /**
   * #1314 殼層對齊 A6（用 conformance 工具量，不靠肉眼）。jsdom 沒有版面，量不到尺寸；能量到的是
   * **產生那個尺寸的 class**。基底（手機）≥44px（A27，`constitution-enforcement.md:101`），
   * 桌機照稿縮（`wide:` 覆寫）——兩個 class 都要在，拿掉任一個都紅。
   */
  // #1866（使用者 10-22）：手機頂欄不換行。jsdom 沒有版面，釘的是產生「一列放得下」的 class
  describe('手機頂欄一列（#1866）', () => {
    it('工具組在手機的假想寬度是 0（flex: 1 1 0＋min-w-0），所以永遠跟 Logo 排在同一列', async () => {
      const { el } = await setup(['admin'], 'admin');
      const tools = el.querySelector('header .page-wrap > div.ml-auto')!;
      expect(tools.classList).toContain('max-wide:flex-[1_1_0]');
      expect(tools.classList).toContain('max-wide:min-w-0');
    });

    it('Logo 與搜尋鈕不被擠壓（shrink-0）：分校名再長，搜尋鈕也維持 44px（A27）', async () => {
      const { el } = await setup(['admin'], 'admin');
      expect(el.querySelector('header .page-wrap > a')!.classList).toContain('shrink-0');
      expect(el.querySelector('app-global-search')!.classList).toContain('shrink-0');
    });

    // 放不下的寬度由分校名吸收：外層 min-w-0 讓 flex 子項縮得下去，內層 truncate 畫省略號
    const campusCtx = (n: number) => ({
      inUse: signal(true),
      allowAll: signal(true),
      campuses: signal(Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `分校${i}` }))),
      id: signal<string | null>(null),
      name: signal<string | null>(null),
      select: vi.fn(),
      use: vi.fn(),
    });

    it('只有一間分校：名字外層 min-w-0、內層 truncate，長名截斷而不撐破頂欄', async () => {
      TestBed.overrideProvider(CampusContextService, { useValue: campusCtx(1) });
      const { el } = await setup(['admin'], 'admin');
      const tools = el.querySelector('header .page-wrap > div.ml-auto')!;
      const outer = Array.from(tools.children).find((c) => c.textContent?.trim() === '分校0')!;
      expect(outer.classList).toContain('min-w-0');
      expect(outer.querySelector(':scope > span')!.classList).toContain('truncate');
    });

    it('多間分校：分校鈕 min-w-0、名字 truncate', async () => {
      TestBed.overrideProvider(CampusContextService, { useValue: campusCtx(2) });
      const { el } = await setup(['admin'], 'admin');
      const btn = el.querySelector('[popovertarget="shell-campus"]')!;
      expect(btn.classList).toContain('min-w-0');
      expect(btn.querySelector(':scope > span')!.classList).toContain('truncate');
    });

    it('未讀徽章從鈴鐺中線偏右往右長，不貼右邊往左長（「99+」不蓋住鈴鐺）', async () => {
      // 角標要有未讀才畫出來；錨點是模板寫死的 class，直接讀模板原文（同 route-lateral-fade.spec 讀 styles.css）
      const tpl = readFileSync(
        resolve(
          process.cwd(),
          'apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.html',
        ),
        'utf8',
      );
      const badge = /data-part="bell-badge"[\s\S]*?class="([^"]+)"/.exec(tpl)![1]!;
      expect(badge).toContain('left-[calc(50%+3px)]');
      expect(badge).not.toMatch(/\bright-/);
    });

    it('帳戶鈕只留頭像（手機桌機一致，使用者 10-22）：沒有名字、身分字樣與箭頭，aria-label 寫出名字與身分', async () => {
      const { el } = await setup(['admin'], 'admin');
      const acc = el.querySelector('[popovertarget="shell-account"]')!;
      expect(acc.children).toHaveLength(1);
      expect(acc.children[0]!.classList).toContain('rounded-full');
      expect(acc.querySelector('.pi-chevron-down')).toBeNull();
      expect(acc.getAttribute('aria-label')).toMatch(/帳戶：.+，目前身分 管理員/);
    });
  });

  describe('A6 幾何（#1314 殼層）', () => {
    const cls = (e: Element | null) => (e as HTMLElement).className.split(/\s+/);
    const has = (e: Element | null, ...names: string[]) => {
      const c = cls(e);
      for (const n of names) expect(c, n).toContain(n);
    };

    /**
     * A6 兩列頂欄（`a6.css:163-165`）：手機放不下的整組工具換到第二列、導覽獨占第三列；
     * 桌機一列不換行（高 56）。**斷點由這幾個 class 決定**：基底 `flex-wrap`、桌機 `flex-nowrap`；
     * 導覽基底 `order-3 w-full`（排到最後、獨占一列）、桌機 `order-none w-auto`。
     * 拿掉任何一個，手機頂欄就從兩列變一列（或桌機變兩列）。
     */
    it('頂欄兩列斷點：基底 flex-wrap＋桌機 flex-nowrap；導覽基底 order-3 w-full、桌機還原', async () => {
      const { el } = await setup(['admin'], 'admin');
      const row = el.querySelector('header > div')!;
      // 手機第一列上下各 6px 置中（#1850，R5）：上 pt-1.5、下是跟導覽列之間的列距 gap-y-1.5
      has(row, 'flex', 'flex-wrap', 'items-center', 'gap-x-4', 'pt-1.5', 'gap-y-1.5');
      expect(cls(row)).not.toContain('pt-3');
      has(row, 'wide:flex-nowrap', 'wide:h-14', 'wide:gap-x-8', 'wide:pt-0');
      // 基底不能是 nowrap（會讓手機一列擠爆）、桌機不能少了 nowrap（會換行）
      expect(cls(row)).not.toContain('flex-nowrap');
      expect(cls(row)).not.toContain('flex-wrap-reverse');
      const nav = el.querySelector('nav[aria-label="主要導覽"]')!;
      has(nav, 'order-3', 'w-full', 'wide:order-none', 'wide:w-auto', 'flex', 'overflow-x-auto');
      // 工具組在導覽之前（DOM 順序）：手機換行時才會先落在第二列、導覽在第三列
      const kids = Array.from(row.children);
      expect(kids.indexOf(nav)).toBeLessThan(kids.length - 1);
      expect(cls(kids[kids.length - 1])).toContain('ml-auto');
    });

    it('字標：手機 44px 點擊區但只占 22px 版面（負邊距）、桌機 24px 字、高度回到行高', async () => {
      const { el } = await setup(['admin'], 'admin');
      has(
        el.querySelector('header a'),
        'min-h-11',
        'wide:min-h-0',
        'wide:text-[24px]',
        'wide:block',
      );
      has(el.querySelector('header a'), 'max-wide:my-[-11px]');
    });

    it('導覽連結：框線與 padding 在 <a> 自己（不是內層 span），目前頁 2px 橘線；手機 44／桌機縮', async () => {
      const { el } = await setup(['admin'], 'admin');
      const links = Array.from(el.querySelectorAll('nav[aria-label="主要導覽"] > a'));
      expect(links).toHaveLength(2);
      for (const a of links) {
        has(a, 'min-h-11', 'wide:min-h-0', 'border-b-[1.5px]', 'py-0.5', 'gap-1', 'leading-[1.5]');
        has(a, 'aria-[current=page]:border-b-2', 'aria-[current=page]:border-accent-vivid');
        expect(a.querySelector('span')).toBeNull();
      }
    });

    it('導覽列 padding 照稿 0（不再 px-1／-mx-1）；鍵盤焦點環往內縮，才不被 overflow 裁掉（A6 沒定義 offset，保留現況可見）', async () => {
      const { el } = await setup(['admin'], 'admin');
      const nav = el.querySelector('nav[aria-label="主要導覽"]')!;
      expect(cls(nav)).not.toContain('px-1');
      expect(cls(nav)).not.toContain('-mx-1');
      has(
        nav,
        'max-wide:[&_:focus-visible]:-outline-offset-2',
        'max-wide:[&_:focus-visible]:outline-zinc-900',
      );
    });

    it('「更多」鈕：同導覽連結的框線與高度規則；箭頭 14px', async () => {
      const { el } = await setup(['admin'], 'admin');
      const btn = el.querySelector('[popovertarget="shell-more"]')!;
      has(btn, 'min-h-11', 'wide:min-h-0', 'border-b-[1.5px]', 'py-0.5', 'leading-[1.5]');
      has(btn.querySelector('i'), 'text-[14px]');
    });

    it('搜尋、分校、帳戶是同一組（margin-left:auto 在組上，不在各鈕上）', async () => {
      const campus = {
        inUse: signal(true),
        allowAll: signal(true),
        campuses: signal([
          { id: 'c0', name: '分校0' },
          { id: 'c1', name: '分校1' },
        ]),
        id: signal<string | null>(null),
        name: signal<string | null>(null),
        select: vi.fn(),
        use: vi.fn(),
      };
      TestBed.overrideProvider(CampusContextService, { useValue: campus });
      const { el } = await setup(['admin'], 'admin');
      const group = el.querySelector('app-global-search')!.parentElement!;
      has(group, 'ml-auto', 'flex', 'wide:gap-x-4');
      expect(group.querySelector('[popovertarget="shell-campus"]')).not.toBeNull();
      expect(group.querySelector('[popovertarget="shell-account"]')).not.toBeNull();
      // 各鈕自己不再帶 ml-auto
      expect(cls(el.querySelector('[popovertarget="shell-account"]'))).not.toContain('ml-auto');
      expect(cls(el.querySelector('app-global-search'))).not.toContain('ml-auto');
    });

    it('非管理員：帳戶鈕自己成一組靠右（ml-auto 在組上）', async () => {
      const { el } = await setup(['teacher'], 'teacher');
      const group = el.querySelector('[popovertarget="shell-account"]')!.parentElement!;
      has(group, 'ml-auto');
    });

    it.each([
      [null, '切換分校：全部分校'],
      ['分校1', '切換分校：分校1'],
    ])(
      '分校鈕（名字 %s）：aria-label 是「%s」；名字手機也顯示、沒有大樓圖示、白字',
      async (name, label) => {
        const campus = {
          inUse: signal(true),
          allowAll: signal(true),
          campuses: signal([
            { id: 'c0', name: '分校0' },
            { id: 'c1', name: '分校1' },
          ]),
          id: signal<string | null>(null),
          name: signal<string | null>(name),
          select: vi.fn(),
          use: vi.fn(),
        };
        TestBed.overrideProvider(CampusContextService, { useValue: campus });
        const { el } = await setup(['admin'], 'admin');
        const btn = el.querySelector('[popovertarget="shell-campus"]')!;
        expect(btn.getAttribute('aria-label')).toBe(label);
        expect(btn.textContent).toContain(name ?? '全部分校');
        expect(btn.querySelector('.pi-building')).toBeNull();
        has(btn, 'text-white', 'pr-[18px]', 'min-h-11', 'wide:min-h-0');
        // 名字手機也顯示（A6 兩列頂欄）：不再有 hidden／wide:inline
        expect(cls(btn.querySelector('span'))).not.toContain('hidden');
      },
    );

    it('「更多」彈窗：手機 340 寬／桌機內容寬；手機 2 欄流排（#1701）→ 桌機 3 欄、欄距 32', async () => {
      const { el } = await setup(['admin'], 'admin');
      const pop = el.querySelector('#shell-more')!;
      has(pop, 'max-wide:w-[340px]', 'wide:w-fit');
      expect(cls(pop)).not.toContain('w-[340px]');
      const grid = pop.querySelector('[data-part="more-scroll"] > div')!;
      has(
        grid,
        'max-wide:columns-2',
        'wide:grid',
        'wide:grid-cols-[repeat(3,max-content)]',
        'wide:gap-x-8',
        'wide:gap-y-6',
      );
    });

    it('「更多」群組標題 h3：13px 粗、zinc-800、字距、下方 1px 線；項目 14px 常規字重、桌機 29px', async () => {
      const { el } = await setup(['admin'], 'admin');
      has(
        el.querySelector('#shell-more h3'),
        'text-md',
        'font-bold',
        'text-zinc-800',
        'tracking-[0.04em]',
        'border-b',
        'border-zinc-200',
        'pb-1.5',
        'mb-2',
      );
      has(
        el.querySelector('#shell-more a'),
        'text-base',
        'font-normal',
        'leading-[1.5]',
        'min-h-11',
        'wide:min-h-0',
        'wide:py-1',
        'wide:block',
      );
    });

    // #1856：切換身分改黑細框透明底（使用者 10-22）；兩種寬度一樣，不再分手機白／桌機灰
    it('帳戶浮層：手機抽屜 zinc-200、桌機白；「切換身分」群組 zinc-900 細框透明底、標題 13px 粗 zinc-800', async () => {
      const { el } = await setup(['admin', 'teacher'], 'admin');
      has(el.querySelector('#shell-account'), 'bg-white', 'max-wide:bg-zinc-200');
      const group = el.querySelector('#shell-account [role="group"]')!;
      has(group, 'border', 'border-solid', 'border-zinc-900', 'bg-transparent');
      expect(group.className).not.toMatch(/bg-(white|zinc-\d+)/);
      has(
        el.querySelector('#shell-account-switch'),
        'text-md',
        'font-bold',
        'text-zinc-800',
        'tracking-[0.04em]',
      );
    });

    it('帳戶浮層：名字手機 18px、email 常規字重；每個項目 手機 48px／16px、桌機 40px', async () => {
      const { el } = await setup(['admin', 'teacher'], 'admin');
      const pop = el.querySelector('#shell-account')!;
      has(pop.querySelector('p.font-bold'), 'max-wide:text-[18px]');
      has(pop.querySelectorAll('p')[1], 'font-normal');
      const items = Array.from(pop.querySelectorAll('button'));
      expect(items.map((b) => b.textContent?.trim())).toEqual(['任課老師', '帳號設定', '登出']);
      for (const b of items) {
        has(
          b,
          'min-h-11',
          'max-wide:min-h-12',
          'max-wide:text-[16px]',
          'wide:min-h-10',
          'leading-[1.5]',
        );
      }
    });
  });

  /**
   * 「更多」貼著按鈕下緣往下 8px（A6 a6.js）；帳戶／分校仍從頁首下緣算。
   * 「更多」鈕桌機縮成 27px 後，從頁首算會比稿低 15px（工具量到的 Δy）。
   */
  describe('彈窗定位', () => {
    const place = async (which: 'more' | 'campus', before?: (pop: HTMLElement) => void) => {
      const campus = {
        inUse: signal(true),
        allowAll: signal(true),
        campuses: signal([
          { id: 'c0', name: '分校0' },
          { id: 'c1', name: '分校1' },
        ]),
        id: signal<string | null>(null),
        name: signal<string | null>(null),
        select: vi.fn(),
        use: vi.fn(),
      };
      TestBed.overrideProvider(CampusContextService, { useValue: campus });
      const { fixture, el } = await setup(['admin'], 'admin');
      const popId = which === 'more' ? 'shell-more' : 'shell-campus';
      const opener = el.querySelector(`[popovertarget="${popId}"]`) as HTMLElement;
      const header = el.querySelector('header') as HTMLElement;
      const rect = (o: Partial<DOMRect>) => () =>
        ({ left: 0, right: 0, top: 0, bottom: 0, ...o }) as DOMRect;
      opener.getBoundingClientRect = rect({ left: 300, right: 348, top: 14, bottom: 41 });
      header.getBoundingClientRect = rect({ bottom: 56 });
      const pop = document.getElementById(popId)!;
      before?.(pop);
      (
        fixture.componentInstance as unknown as {
          onPopoverToggle: (e: unknown, w: 'more' | 'campus') => void;
        }
      ).onPopoverToggle({ target: pop, newState: 'open' }, which);
      return pop.style.top;
    };

    /**
     * #1701：手機 360×640 時「更多」被切掉兩項（人員管理、系統設定）。保底：最大高度到可視區底部留 16px，
     * 超出就選單自己捲。選單在 top layer，`100%` 就是可視高 —— 不用 vh（c6）
     */
    it('更多：捲動層最大高度＝可視高扣掉上緣與底部 16px（px，不用 vh），popover 本身不動', async () => {
      await place('more');
      const pop = document.getElementById('shell-more')!;
      const scroller = pop.querySelector<HTMLElement>('[data-part="more-scroll"]')!;
      expect(scroller.style.maxHeight).toBe(`${window.innerHeight - 49 - 16}px`);
      expect(scroller.classList).toContain('overflow-y-auto');
      expect(pop.style.maxHeight).toBe('');
      expect(pop.classList).toContain('px-5'); // 內距留在 popover，維持 A6
    });

    // 審核席 #1721 突變：替身裡 popover 與捲動層一樣高（chrome 0）時，不扣內距＋框線也會綠
    it('更多：扣掉 popover 的內距與框線（chrome），不然選單底部超出、最後一兩項被切掉', async () => {
      const height = (el: HTMLElement, h: number) =>
        Object.defineProperty(el, 'offsetHeight', { get: () => h, configurable: true });
      await place('more', (pop) => {
        height(pop, 500);
        height(pop.querySelector<HTMLElement>('[data-part="more-scroll"]')!, 466); // 16+16 內距、1+1 框線
      });
      const scroller = document.querySelector<HTMLElement>(
        '#shell-more [data-part="more-scroll"]',
      )!;
      expect(scroller.style.maxHeight).toBe(`${window.innerHeight - 49 - 16 - 34}px`);
    });

    it('更多：可視高極矮時，捲動層至少留 120px（不會縮成 0 或負的）', async () => {
      const original = Object.getOwnPropertyDescriptor(window, 'innerHeight');
      Object.defineProperty(window, 'innerHeight', { value: 100, configurable: true });
      try {
        await place('more');
        const scroller = document.querySelector<HTMLElement>(
          '#shell-more [data-part="more-scroll"]',
        )!;
        expect(scroller.style.maxHeight).toBe('120px');
      } finally {
        if (original) Object.defineProperty(window, 'innerHeight', original);
      }
    });

    it('分校：不加最大高度（只有「更多」會長）', async () => {
      await place('campus');
      expect(document.getElementById('shell-campus')!.style.maxHeight).toBe('');
    });

    it('更多：按鈕下緣 41 + 8 = 49px（不是頁首下緣 56 + 8）', async () => {
      expect(await place('more')).toBe('49px');
    });

    it('分校：仍從頁首下緣 56 + 8 = 64px', async () => {
      expect(await place('campus')).toBe('64px');
    });
  });

  /** #1683：通知中心從「更多」移到頂欄鈴鐺，三個角色都要有（A6 偏離，R5） */
  describe('通知鈴鐺', () => {
    const bell = (el: HTMLElement) => el.querySelector<HTMLAnchorElement>('[data-part=bell]');

    it.each<[UserRole, string]>([
      ['admin', '/admin/notifications'],
      ['teacher', '/teacher/notifications'],
      ['parent', '/parent/notifications'],
    ])('%s：有鈴鐺、連到 %s、放在帳戶按鈕左邊', async (role, href) => {
      const { el } = await setup([role], role);
      const link = bell(el)!;

      expect(link.getAttribute('href')).toBe(href);
      const account = el.querySelector('[popovertarget="shell-account"]')!;
      expect(link.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(link.parentElement).toBe(account.parentElement);
    });

    it('觸控目標 44px（size-11，R3）；桌機 40px（A6 頂欄控制項高 40，深色帶上下各 8px，#1850）', async () => {
      const { el } = await setup(['parent'], 'parent');
      expect(bell(el)!.classList).toContain('size-11');
      expect(bell(el)!.classList).toContain('wide:size-10');
    });

    it('帳戶鈕：手機 44、桌機 40（A6 `.acct` height 40）；右邊距 -6px 手機桌機都有，頭像右緣跟 Logo 左緣一樣離邊 16px（#1850）', async () => {
      const { el } = await setup(['parent'], 'parent');
      const account = el.querySelector('[popovertarget="shell-account"]')!;
      const c = account.className.split(/\s+/);
      for (const n of ['min-h-11', 'wide:min-h-10', 'px-1.5', '-mr-1.5']) expect(c, n).toContain(n);
      expect(c).not.toContain('wide:-mr-1.5');
    });

    it('管理員：沒有未讀時沒有角標，aria-label 跟老師家長同一套', async () => {
      const { el } = await setup(['admin'], 'admin', true, { unread: 0 });
      expect(el.querySelector('[data-part=bell-badge]')).toBeNull();
      expect(bell(el)!.getAttribute('aria-label')).toBe('通知，沒有未讀');
    });

    it('管理員也有通知（#1693、#1692）：有未讀就顯示角標', async () => {
      const { el } = await setup(['admin'], 'admin', true, { unread: 5 });
      expect(el.querySelector('[data-part=bell-badge]')!.textContent!.trim()).toBe('5');
      expect(bell(el)!.getAttribute('aria-label')).toBe('通知，5 則未讀');
    });

    it.each<[number, string | null, string]>([
      [0, null, '通知，沒有未讀'],
      [3, '3', '通知，3 則未讀'],
      [99, '99', '通知，99 則未讀'],
      [100, '99+', '通知，100 則未讀'],
      [120, '99+', '通知，120 則未讀'],
    ])('家長未讀 %d：角標 %s、aria-label「%s」（角標本身 aria-hidden）', async (n, text, label) => {
      const { el } = await setup(['parent'], 'parent', true, { unread: n });
      const badge = el.querySelector('[data-part=bell-badge]');

      expect(badge?.textContent?.trim() ?? null).toBe(text);
      if (badge) expect(badge.getAttribute('aria-hidden')).toBe('true');
      expect(bell(el)!.getAttribute('aria-label')).toBe(label);
    });

    it('角標跟著 service 的數字變', async () => {
      const { el, badge, fixture } = await setup(['teacher'], 'teacher', true, { unread: 1 });
      const num = el.querySelector<HTMLElement>('[data-part=bell-badge]')!;
      vi.stubGlobal('matchMedia', () => ({ matches: false }));
      const animate = vi.fn();
      num.animate = animate;

      badge.unread.set(4);
      fixture.detectChanges();
      expect(num.textContent!.trim()).toBe('4');
      expect(animate).toHaveBeenCalledTimes(1); // 數字淡入（#1676）
      vi.unstubAllGlobals();
    });

    it('沒有目的地（掃碼機台）：不畫鈴鐺', async () => {
      const { el } = await setup(['kiosk'], 'kiosk', true, { route: null });
      expect(bell(el)).toBeNull();
    });
  });

  /** #1701：手機的「更多」看得出「下面還有」，到底才消失 */
  describe('更多選單：下面還有', () => {
    async function openMore() {
      const { fixture, el } = await setup(['admin'], 'admin');
      const host = document.getElementById('shell-more')!;
      const pop = host.querySelector<HTMLElement>('[data-part="more-scroll"]')!;
      const metrics = { scrollTop: 0, clientHeight: 400, scrollHeight: 600 };
      for (const k of Object.keys(metrics) as (keyof typeof metrics)[])
        Object.defineProperty(pop, k, { get: () => metrics[k], configurable: true });
      (
        fixture.componentInstance as unknown as {
          onPopoverToggle: (e: unknown, w: 'more') => void;
        }
      ).onPopoverToggle({ target: host, newState: 'open' }, 'more');
      return { pop, host, metrics, el };
    }

    it('超出：打開就標 data-more-below（底部淡出）—— 標在捲動層，不是 popover（不然白底跟著淡掉）', async () => {
      const { pop, host } = await openMore();
      expect(pop.hasAttribute('data-more-below')).toBe(true);
      expect(host.hasAttribute('data-more-below')).toBe(false);
      expect(host.className).not.toContain('mask-image');
    });

    it('捲到底：拿掉；往回捲：又出現', async () => {
      const { pop, metrics } = await openMore();
      metrics.scrollTop = 200;
      pop.dispatchEvent(new Event('scroll'));
      expect(pop.hasAttribute('data-more-below')).toBe(false);
      metrics.scrollTop = 50;
      pop.dispatchEvent(new Event('scroll'));
      expect(pop.hasAttribute('data-more-below')).toBe(true);
    });

    // 審核席 #1721 突變：高 DPI 螢幕捲到底時 scrollTop 是小數，差不到 1px 也算到底
    it('捲到底差不到 1px（高 DPI 的小數 scrollTop）：算到底，淡出拿掉', async () => {
      const { pop, metrics } = await openMore();
      metrics.scrollTop = 199.5;
      pop.dispatchEvent(new Event('scroll'));
      expect(pop.hasAttribute('data-more-below')).toBe(false);
    });

    it('放得下：不標', async () => {
      const { pop, metrics } = await openMore();
      metrics.scrollHeight = 400;
      pop.dispatchEvent(new Event('scroll'));
      expect(pop.hasAttribute('data-more-below')).toBe(false);
    });

    // (b)：手機是欄式流排，分組不從中間斷開 —— 不是「一列兩組對齊」（那會被最長的那組撐高）
    it('手機是兩欄流排，分組不斷開', async () => {
      await openMore();
      const list = document.querySelector('#shell-more [data-part="more-scroll"] > div')!;
      expect(list.classList).toContain('max-wide:columns-2');
      expect(list.classList).not.toContain('grid-cols-2');
      for (const g of Array.from(list.children))
        expect(g.classList).toContain('break-inside-avoid');
    });
  });
});
