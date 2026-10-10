import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { AuthService, type UserRole } from '@core/auth.service';
import { NavigationService } from '@core/navigation.service';
import { CampusContextService } from '@core/campus-context.service';
import { InheritSizeDirective } from '@shared/directives/inherit-size.directive';
import { OverlayContainerService } from '@core/overlay-container.service';
import { OverlayContainerDirective } from '@shared/directives/overlay-container.directive';
import { AccountSettingsDialogComponent } from '@shared/components/account-settings-dialog/account-settings-dialog.component';
import { GlobalSearchComponent } from '@shared/components/layout/global-search/global-search.component';

/** A6 的手機／桌機切換（tailwind.css 的 `--breakpoint-wide`） */
const WIDE = '(min-width: 861px)';

/**
 * 三個角色共用的殼（A6 頂欄，#991 殼切片 S3）：頂欄＋main。側欄與手機底部分頁已拿掉 ——
 * 導覽全在頂欄（≤860 掉到第二列橫捲），其餘項目進「更多」。選單資料來自 `NavigationService`
 * 的 `topItems`／`moreGroups`，權限過濾在那裡。
 *
 * **main 自己捲、頂欄不動**（不是 A6 稿的文件捲動＋sticky，#991 裁定 Q1）：
 * `--shell-layout-body-*`（對話框尺寸）、overlay container、`shell-content` 容器查詢、
 * view-transition 都依賴 main 是捲動容器。
 *
 * 「更多」與帳戶浮層用原生 popover：點外面、Esc、焦點回到觸發鈕都是瀏覽器給的。
 */
@Component({
  selector: 'app-shell-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    InheritSizeDirective,
    OverlayContainerDirective,
    GlobalSearchComponent,
  ],
  providers: [DialogService],
  templateUrl: './shell-layout.component.html',
  host: { class: 'block' },
})
export class ShellLayoutComponent {
  public readonly auth = inject(AuthService);
  protected readonly nav = inject(NavigationService);
  protected readonly campus = inject(CampusContextService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly roleLabels: Record<UserRole, string> = {
    admin: '管理員',
    teacher: '任課老師',
    parent: '家長',
    kiosk: '掃碼機台',
  };
  /** 跟 `/select-role` 的角色卡片用同一組圖示，兩個入口看起來是同一件事 */
  protected readonly roleIcons: Record<UserRole, string> = {
    admin: 'pi-shield',
    teacher: 'pi-book',
    parent: 'pi-users',
    kiosk: 'pi-qrcode',
  };

  protected readonly displayName = computed(
    () => this.auth.profile()?.display_name || this.auth.user()?.email || '',
  );
  /** 頭像圓章的字（A6）：名字第一個字；空名顯示「?」。`Array.from` 不把代理對拆半 */
  protected readonly avatarInitial = computed(
    () => Array.from(this.displayName().trim())[0]?.toUpperCase() ?? '?',
  );
  /** 帳戶浮層裡點得到的身分 —— 目前這個不列，點自己沒有意義 */
  protected readonly otherRoles = computed(() =>
    this.auth.roles().filter((role) => role !== this.auth.activeRole()),
  );

  protected readonly scrolled = signal(false);
  protected readonly moreOpen = signal(false);
  protected readonly accountOpen = signal(false);
  protected readonly campusOpen = signal(false);
  protected readonly campusChoices = computed(() => [
    { id: null as string | null, name: '全部分校' },
    ...this.campus.campuses().map((c) => ({ id: c.id as string | null, name: c.name })),
  ]);

  protected onScroll(event: Event) {
    this.scrolled.set((event.target as HTMLElement).scrollTop > 0);
  }

  /**
   * popover 預設開在畫面正中，這裡讓它貼著觸發鈕（A6 同一招）。帳戶浮層在手機是 CSS 的底部抽屜，
   * 不給位置；「更多」兩種寬度都貼著鈕，往左貼齊不超出畫面；分校兩種寬度都貼著鈕、往右貼齊。
   */
  protected onPopoverToggle(event: Event, which: 'more' | 'account' | 'campus') {
    const pop = event.target as HTMLElement;
    const open = (event as ToggleEvent).newState === 'open';
    ({ more: this.moreOpen, account: this.accountOpen, campus: this.campusOpen })[which].set(open);
    if (!open) return;
    pop.removeAttribute('style');
    if (which === 'account' && !window.matchMedia(WIDE).matches) return;
    const opener = document.querySelector(`[popovertarget="${pop.id}"]`);
    if (!opener) return;
    const r = opener.getBoundingClientRect();
    const header = (opener.closest('header') ?? opener).getBoundingClientRect();
    const left =
      which !== 'more'
        ? Math.max(16, r.right - pop.offsetWidth)
        : Math.max(16, Math.min(r.left, window.innerWidth - pop.offsetWidth - 16));
    // 從頁首下緣往下 8px，不從按鈕下緣：按鈕在頁首裡置中，從它算會黏著頁首邊緣
    Object.assign(pop.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${header.bottom + 8}px`,
    });
  }

  /** 原生 popover 裡點連結不會自己關 */
  protected hide(id: string) {
    document.getElementById(id)?.hidePopover?.();
  }

  /** 位置是開的那一刻算的，視窗一變就失準 —— 直接關掉 */
  @HostListener('window:resize')
  onResize() {
    this.hide('shell-more');
    this.hide('shell-account');
    this.hide('shell-campus');
  }

  /** 頂欄分校（#1138 H2）：寫進 CampusContextService，接上的頁面自己跟著重查 */
  protected selectCampus(id: string | null) {
    this.hide('shell-campus');
    this.campus.select(id);
  }

  /** 就地切換身分：零導航、零動態載入（`/select-role` 是登入後的初選，另一個場景） */
  protected switchRole(role: UserRole) {
    this.hide('shell-account');
    this.auth.navigateToRoleShell(role);
  }

  protected openAccountSettings() {
    this.hide('shell-account');
    this.dialogService.open(AccountSettingsDialogComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainerService.getContainer() ?? 'body',
    });
  }

  protected signOut() {
    this.hide('shell-account');
    this.auth.signOut();
  }
}
