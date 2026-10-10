import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { AuthService, type UserRole } from '@core/auth.service';
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

async function setup(roles: UserRole[], activeRole: UserRole | null, more = true) {
  const auth = stubAuth(roles, activeRole);
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
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ShellLayoutComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, auth, el: fixture.nativeElement as HTMLElement };
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
    const ctx = (inUse: boolean, n: number) => ({
      inUse: signal(inUse),
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

    it('接上了、多間分校：下拉鈕寫「全部分校」，選單有全部＋每一間，點了寫回去', async () => {
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
});
