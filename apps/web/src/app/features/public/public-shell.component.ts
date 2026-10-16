import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { FlowFieldComponent } from '@shared/components/flow-field/flow-field.component';

/** 手機的右面（表單面）用網址片段表示：重新整理、瀏覽器返回鍵都跟著同一個狀態走 */
const FORM_FRAGMENT = 'form';

/**
 * 公開頁外框（A6 #990 批 6，#1636）。
 *
 * 桌機：左 40% 橘色品牌面＋右邊白色表單面。
 * 手機（≤1024）：**橫向兩面**，一次只看一面。第一屏是整片品牌面；點入口整條軌道往左平移
 * 露出表單面，表單面頂端「← 返回＋頁名」移回來。兩面寬度都是 `--window-width`（c6 不用 vw）。
 * 登入頁例外：點「登入」從底部升起面板（面板在 LoginComponent 裡，LINE 鍵在面板內）。
 * 選擇身分一進頁就在表單面，而且沒有返回列 —— 彈窗關不掉，看得到按不到的「返回」是死路。
 */
@Component({
  selector: 'app-public-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FlowFieldComponent],
  templateUrl: './public-shell.component.html',
})
export class PublicShellComponent {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly publicRoutes = RoutesCatalog.values.filter((r) => !r.role && r.showInMenu);
  protected readonly formFragment = FORM_FRAGMENT;
  protected readonly loginPath = RoutesCatalog.PUBLIC_LOGIN.absolutePath;
  /** 入口連結。桌機：13px 細連結、本頁 1.5px 底框；手機：16px/600、高 44、本頁 2px 底框 */
  protected readonly linkClass =
    'block border-0 border-b-[1.5px] border-solid border-transparent pb-0.5 text-md leading-normal font-medium text-zinc-900 no-underline opacity-72 transition-[opacity,border-color] duration-150 hover:border-[rgb(26_22_20/40%)] hover:opacity-100 min-[1025px]:pointer-coarse:py-3 max-[1024px]:inline-flex max-[1024px]:min-h-11 max-[1024px]:items-center max-[1024px]:border-b-2 max-[1024px]:p-0 max-[1024px]:text-lg max-[1024px]:font-semibold max-[1024px]:opacity-100';

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.parseUrl(this.router.url)),
      startWith(this.router.parseUrl(this.router.url)),
    ),
    { requireSync: true },
  );
  private readonly path = computed(
    () =>
      '/' +
      (this.url()
        .root.children['primary']?.segments.map((s) => s.path)
        .join('/') ?? ''),
  );

  protected readonly isLogin = computed(
    () => this.path() === RoutesCatalog.PUBLIC_LOGIN.absolutePath,
  );
  /** 選擇身分：彈窗必選、關不掉 —— 手機直接落在表單面，且不給返回列 */
  protected readonly isLocked = computed(
    () => this.path() === RoutesCatalog.PUBLIC_SELECT_ROLE.absolutePath,
  );
  protected readonly page = computed(() => RoutesCatalog.findByAbsolutePath(this.path()));
  /** 不在四條入口裡的頁（綁定 LINE、選擇身分）：手機上多一條本頁連結，否則從品牌面回不到它 */
  protected readonly pageOutsideMenu = computed(() => {
    const page = this.page();
    return page && !this.publicRoutes.includes(page) ? page : null;
  });

  protected readonly isMobile = signal(false);
  protected readonly isRight = computed(() => {
    if (!this.isMobile()) return false;
    const url = this.url();
    // 登入失敗被導回來（?error= / ?reason=）：要看的是錯誤訊息，直接落在表單面
    return (
      this.isLocked() ||
      url.fragment === FORM_FRAGMENT ||
      (this.isLogin() && ('error' in url.queryParams || 'reason' in url.queryParams))
    );
  });

  /** 入口連結推進歷史時帶的記號：返回列看到它就 back（跟瀏覽器返回鍵同一條路） */
  protected readonly pushedState = { publicForm: true };

  constructor() {
    const mq = matchMedia('(max-width: 1024px)');
    const sync = () => this.isMobile.set(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', sync));
  }

  protected back(): void {
    if ((history.state as { publicForm?: boolean } | null)?.publicForm) {
      this.location.back();
      return;
    }
    // 深連結進來的（含登入錯誤的查詢參數）：換掉網址，移回品牌面
    void this.router.navigateByUrl(this.path(), { replaceUrl: true });
  }
}
