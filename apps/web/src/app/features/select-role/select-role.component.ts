import {
  Component,
  DestroyRef,
  EnvironmentInjector,
  computed,
  createEnvironmentInjector,
  inject,
} from '@angular/core';

import { AuthService, type UserRole } from '@core/auth.service';

/**
 * `/select-role` 的薄殼：路由是骨架，彈窗是長相。
 *
 * 為什麼不回到 root component 掛 DialogService（#34 之前的做法）——
 * LINE OAuth 是整頁離開再整頁回來，登入後的第一眼**必然**是一次全新的頁面載入，
 * 所以「原地彈窗」這個場景根本不存在，而那個做法要付 140 kB 的初始 bundle。
 * 全文見 `kb/wiki/architecture/login-experience.md`。
 *
 * DialogService 與彈窗內容都是 `await import(...)` 進來的 —— 這是初始 bundle
 * 維持在 575 kB 的唯一理由。**不要把 primeng/dynamicdialog 改成靜態 import**，
 * 那會讓整棵 dialog 依賴樹回到初始 chunk。
 */
@Component({
  selector: 'app-select-role',
  imports: [],
  templateUrl: './select-role.component.html',
  styleUrl: './select-role.component.scss',
})
export class SelectRoleComponent {
  private readonly auth = inject(AuthService);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly destroyRef = inject(DestroyRef);

  private destroyed = false;

  /**
   * 這個帳號沒有任何身分。**不開空彈窗、也不亂導向**（沒有 shell 可去），
   * 所以留在這一頁講清楚 —— 否則使用者看到的是只剩字標的空白頁，
   * 那跟「載入中卡住」長得一模一樣。
   */
  protected readonly noRoles = computed(() => this.auth.roles().length === 0);

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    void this.openPicker();
  }

  onRoleChosen(role: UserRole) {
    this.auth.navigateToRoleShell(role);
  }

  private async openPicker(): Promise<void> {
    // 一個角色就沒有選擇可做 —— **直接進去，不要問**。
    //
    // 這條路徑原本只在登入流程實作，`/select-role` 被直接打開時沒有。
    // 後果是單一角色的帳號看到「這個帳號有**多個**身分，請選擇要進入的介面」
    // 卻只有一個選項，而彈窗刻意關不掉 —— 一個沒有選擇的選擇畫面。
    //
    // 修法不是把文案改成條件式，而是**讓這個畫面對他不存在**：
    // 文案在真的有多個身分時是對的，錯的是他不該來到這裡。
    // AGENTS.md 早就寫了「單一角色直接導向對應 shell」，這裡只是補上遺漏的入口。
    const roles = this.auth.roles();
    if (roles.length === 1) {
      this.onRoleChosen(roles[0]);
      return;
    }

    // 零角色是更糟的死路：空的、關不掉的彈窗。不開它 —— 也不能亂導向
    // （沒有 shell 可去），所以留在這一頁由頁面自己說明。
    if (roles.length === 0) {
      return;
    }

    const [{ DialogService }, { RolePickerComponent }] = await Promise.all([
      import('primeng/dynamicdialog'),
      import('./role-picker/role-picker.component'),
    ]);

    // 選完角色會馬上導航離開，而 import 是非同步的 —— 元件已經死了就別再開窗，
    // 否則會留下一個沒有主人的彈窗（NG0911）。
    if (this.destroyed) {
      return;
    }

    // DialogService 一向是元件層級的 provider，而它現在才被載進來 —— 用一個以目前
    // environment injector 為父的子 injector 現場建一個，並跟著元件一起銷毀。
    const injector = createEnvironmentInjector([DialogService], this.envInjector);
    this.destroyRef.onDestroy(() => injector.destroy());

    const ref = injector.get(DialogService).open(RolePickerComponent, {
      width: '400px',
      // 沒選角色就沒有下一步 —— 這個彈窗刻意關不掉
      closable: false,
      closeOnEscape: false,
      dismissableMask: false,
      showHeader: false,
      modal: true,
      // 憲法 c6：不用 vw
      breakpoints: { '640px': '90%' },
      styleClass: 'role-picker-dialog',
    });

    // open() 在 SSR / 沒有 document 的環境回 null
    ref?.onClose.subscribe((role?: UserRole) => {
      if (role) {
        this.onRoleChosen(role);
      }
    });

    // 離開這條路由時彈窗要跟著消失。用 destroy() 而不是 close()——
    // close() 會走 onClose，那條路是「使用者選了角色」的意思。
    this.destroyRef.onDestroy(() => ref?.destroy());
  }
}
