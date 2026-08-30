import {
  Component,
  HostListener,
  inject,
  computed,
  input,
  viewChild,
  type ElementRef,
  afterNextRender,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Tooltip } from 'primeng/tooltip';
import { Popover } from 'primeng/popover';
import { DialogService } from 'primeng/dynamicdialog';
import { JdenticonAvatarComponent } from '@shared/components/jdenticon-avatar/jdenticon-avatar.component';
import { AuthService, type UserRole } from '@core/auth.service';
import { AutoOpenTooltipDirective } from '@shared/directives/auto-open-tooltip.directive';
import { DeviceService } from '@core/device.service';
import { InheritSizeDirective } from '@shared/directives/inherit-size.directive';
import { OverlayContainerService } from '@core/overlay-container.service';
import { OverlayContainerDirective } from '@shared/directives/overlay-container.directive';
import { AccountSettingsDialogComponent } from '@shared/components/account-settings-dialog/account-settings-dialog.component';

@Component({
  selector: 'app-shell-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    Tooltip,
    AutoOpenTooltipDirective,
    Popover,
    JdenticonAvatarComponent,
    InheritSizeDirective,
    OverlayContainerDirective,
  ],
  providers: [DialogService],
  templateUrl: './shell-layout.component.html',
  styleUrl: './shell-layout.component.scss',
})
export class ShellLayoutComponent {
  // template 裡的 `op.toggle()` 用的是 template reference variable，
  // 跟這個 query 無關 —— 這裡只服務 TS 側的兩處 hide()。
  private readonly op = viewChild<Popover>('op');

  private readonly shellBody = viewChild<ElementRef<HTMLElement>>('shellBody');
  private readonly overlayContainerService = inject(OverlayContainerService);
  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  public readonly auth = inject(AuthService);
  protected readonly avatarSeed = computed(() => {
    return (
      (this.auth.user()?.id || 'ANYMOUS') + '_' + (this.auth.profile()?.display_name || 'USER')
    );
  });
  protected readonly device = inject(DeviceService);
  protected readonly roleLabels: Record<UserRole, string> = {
    admin: '管理員',
    teacher: '任課老師',
    parent: '家長',
  };
  /** 跟 `/select-role` 的角色卡片用同一組圖示，兩個入口看起來是同一件事 */
  protected readonly roleIcons: Record<UserRole, string> = {
    admin: 'pi-shield',
    teacher: 'pi-book',
    parent: 'pi-users',
  };

  /**
   * 徽章上點得到的選項 —— 目前這個角色不列，點自己沒有意義。
   * 只有多重角色的人看得到徽章的互動樣式，所以這裡不會是空的。
   */
  protected readonly otherRoles = computed(() =>
    this.auth.roles().filter((role) => role !== this.auth.activeRole()),
  );

  /**
   * Header 的角色快速切換。#34 曾把徽章改成導向 `/select-role`，切個身分要走一整趟
   * 頁面 —— 那是退步。這裡就地切換：零導航、零動態載入。
   *
   * `/select-role` 那條路仍然在，服務的是登入後的初選與 guard 的落點，是另一個場景。
   */
  protected switchRole(role: UserRole) {
    this.auth.navigateToRoleShell(role);
  }

  private readonly dialogService = inject(DialogService);

  readonly centered = input(false, { transform: (v: boolean | string) => v === '' || v === true });

  @HostListener('window:resize')
  onResize() {
    this.op()?.hide();
  }

  openAccountSettings() {
    this.op()?.hide();
    this.dialogService.open(AccountSettingsDialogComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer ?? 'body',
    });
  }

  signOut() {
    this.auth.signOut();
  }
}
