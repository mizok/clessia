import {
  Component,
  ViewChild,
  HostListener,
  inject,
  computed,
  input,
  viewChild,
  type ElementRef,
  afterNextRender,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Tooltip } from 'primeng/tooltip';
import { Popover } from 'primeng/popover';
import { JdenticonAvatarComponent } from '@shared/components/jdenticon-avatar/jdenticon-avatar.component';
import { AuthService, type UserRole } from '@core/auth.service';
import { AutoOpenTooltipDirective } from '@shared/directives/auto-open-tooltip.directive';
import { DeviceService } from '@core/device.service';
import { InheritSizeDirective } from '@shared/directives/inherit-size.directive';
import { OverlayContainerService } from '@core/overlay-container.service';
import { OverlayContainerDirective } from '@shared/directives/overlay-container.directive';

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
  templateUrl: './shell-layout.component.html',
  styleUrl: './shell-layout.component.scss',
})
export class ShellLayoutComponent {
  @ViewChild('op') op!: Popover;

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

  private readonly router = inject(Router);

  readonly centered = input(false, { transform: (v: boolean | string) => v === '' || v === true });

  @HostListener('window:resize')
  onResize() {
    this.op?.hide();
  }

  changePassword() {
    this.op.hide();
    const role = this.auth.activeRole();
    this.router.navigate([`/${role}/change-password`]);
  }

  signOut() {
    this.auth.signOut();
  }
}
