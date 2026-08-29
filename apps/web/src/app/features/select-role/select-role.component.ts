import {
  Component,
  DestroyRef,
  EnvironmentInjector,
  createEnvironmentInjector,
  inject,
} from '@angular/core';

import { AuthService, type UserRole } from '@core/auth.service';
import { FlowFieldComponent } from '@shared/components/flow-field/flow-field.component';

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
  imports: [FlowFieldComponent],
  templateUrl: './select-role.component.html',
  styleUrl: './select-role.component.scss',
})
export class SelectRoleComponent {
  private readonly auth = inject(AuthService);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly destroyRef = inject(DestroyRef);

  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    void this.openPicker();
  }

  onRoleChosen(role: UserRole) {
    this.auth.navigateToRoleShell(role);
  }

  private async openPicker(): Promise<void> {
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
