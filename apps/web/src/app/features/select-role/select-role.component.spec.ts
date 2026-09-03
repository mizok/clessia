import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';

import { AuthService, type UserRole } from '@core/auth.service';
import { SelectRoleComponent } from './select-role.component';

/**
 * 這頁是「路由骨架 + 彈窗長相」：`/select-role` 仍是唯一入口（LINE callbackURL、
 * guest.guard、role.guard、shell 的切換角色都指向它，#34 修好的無限重導向不回歸），
 * 但使用者看到的是彈窗。
 *
 * PrimeNG 的 dialog 依賴樹是**動態 import** 的 —— 那是初始 bundle 維持 575 kB 的
 * 唯一理由，所以「彈窗真的開得起來」必須有測試守著，不能只靠人工點。
 *
 * 沒有「離開」測試了：彈窗不可略過（沒選角色就沒有下一步），這是刻意的設計改變。
 * 角色清單本身的行為在 role-picker.component.spec.ts。
 */
function stubAuth(roles: UserRole[]) {
  return {
    roles: signal<UserRole[]>(roles),
    activeRole: signal<UserRole | null>(null),
    profile: signal({ id: 'u1', display_name: '王主任', branch_id: null }),
    user: signal({ id: 'u1', email: 'a@example.com' }),
    navigateToRoleShell: vi.fn(),
  };
}

/** 不等彈窗 —— 用在「不該開窗」的情況（等它出現會固定等到 timeout） */
async function setupNoPicker(roles: UserRole[]) {
  const auth = stubAuth(roles);
  TestBed.configureTestingModule({
    imports: [SelectRoleComponent],
    providers: [
      provideRouter([]),
      provideAnimationsAsync(),
      providePrimeNG({}),
      { provide: AuthService, useValue: auth },
    ],
  });
  const fixture = TestBed.createComponent(SelectRoleComponent);
  fixture.detectChanges();
  // 給動態 import 足夠時間 —— 如果它會開窗，這段時間內就會開
  await new Promise((r) => setTimeout(r, 300));
  fixture.detectChanges();
  return { fixture, auth };
}

async function setup(roles: UserRole[] = ['admin', 'teacher']) {
  const auth = stubAuth(roles);
  TestBed.configureTestingModule({
    imports: [SelectRoleComponent],
    providers: [
      provideRouter([]),
      provideAnimationsAsync(),
      providePrimeNG({}),
      { provide: AuthService, useValue: auth },
    ],
  });
  const fixture = TestBed.createComponent(SelectRoleComponent);
  fixture.detectChanges();
  // 真的去載模組，不是 mock —— 等到彈窗出現為止，這正是這組測試要守的東西
  await waitFor(() => !!pickerEl());
  fixture.detectChanges();
  return { fixture, auth };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

function pickerEl(): HTMLElement | null {
  return document.body.querySelector('.role-picker');
}

describe('SelectRoleComponent（薄殼 + 動態載入的彈窗）', () => {
  afterEach(() => {
    document.body.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
  });

  it('進場就把角色彈窗開起來 —— 動態 import 的路徑是活的', async () => {
    await setup();

    expect(pickerEl()).toBeTruthy();
  });

  /**
   * 沒選角色就沒有下一步。Esc 若能關掉，使用者會落在一個只剩品牌底、
   * 什麼都不能做的空白頁上。
   */
  it('Esc 關不掉彈窗', async () => {
    await setup();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(pickerEl()).toBeTruthy();
  });

  it('點 backdrop 關不掉彈窗', async () => {
    await setup();

    (document.body.querySelector('.p-dialog-mask') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(pickerEl()).toBeTruthy();
  });

  it('彈窗回傳角色後，導向交給 AuthService —— 邏輯只有一份', async () => {
    const { fixture, auth } = await setup();

    fixture.componentInstance.onRoleChosen('teacher');

    expect(auth.navigateToRoleShell).toHaveBeenCalledWith('teacher');
  });

  /**
   * 2026-09 實測發現的矛盾：單一角色的帳號直接打 `/select-role`，
   * 會看到「這個帳號有**多個**身分，請選擇要進入的介面」但**只有一個選項**，
   * 而彈窗刻意關不掉 —— 一個沒有選擇的選擇畫面。
   *
   * 修法不是改文案而是**讓這個畫面對他不存在**：一個角色就直接進去。
   * 這也是 AGENTS.md 早就寫的規則（單一角色直接導向對應 shell），
   * 只是 `/select-role` 這條直接進來的路徑沒有實作它。
   */
  it('只有一個角色 → 不開窗，直接導向那個 shell', async () => {
    const { auth } = await setupNoPicker(['teacher']);

    expect(pickerEl()).toBeNull();
    expect(auth.navigateToRoleShell).toHaveBeenCalledWith('teacher');
  });

  it('兩個角色才開窗（文案說「多個」時就真的是多個）', async () => {
    const { auth } = await setup(['admin', 'teacher']);

    expect(pickerEl()).toBeTruthy();
    expect(auth.navigateToRoleShell).not.toHaveBeenCalled();
  });

  /**
   * 零角色是更糟的死路：空的、關不掉的彈窗。不開它 ——
   * 也不能亂導向（沒有 shell 可去），所以留在這一頁，由頁面自己說明。
   */
  it('零角色 → 不開空彈窗，也不亂導向', async () => {
    const { auth } = await setupNoPicker([]);

    expect(pickerEl()).toBeNull();
    expect(auth.navigateToRoleShell).not.toHaveBeenCalled();
  });

  /**
   * 不開彈窗之後這一頁只剩字標 —— 那跟「卡在載入中」長得一模一樣。
   * 死路要說出自己是死路。
   */
  it('零角色時頁面自己講清楚，不是空白', async () => {
    const { fixture } = await setupNoPicker([]);

    expect(fixture.nativeElement.textContent).toContain('沒有可用的身分');
  });

  it('有身分時不顯示那句話', async () => {
    const { fixture } = await setup(['admin', 'teacher']);

    expect(fixture.nativeElement.textContent).not.toContain('沒有可用的身分');
  });
});
