import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  untracked,
} from '@angular/core';

/**
 * 重新載入時「保留舊內容並變淡」（#1641 5b，使用者 10-16 13:56 裁定）。
 *
 * ```html
 * <app-reload-veil [loading]="loading()">
 *   <app-skeleton reloadSkeleton label="…載入中" />
 *   @if (failed()) {…} @else if (rows().length === 0) {…} @else {…}
 * </app-reload-veil>
 * ```
 *
 * - **只有第一次、還沒載入過**才顯示 `[reloadSkeleton]`。
 * - 之後每次重抓（換條件、新增刪除後的重查）**舊內容留著、變淡到 40%、`inert`**（滑鼠鍵盤都不能對舊資料動手），
 *   頂端疊一個「載入中…」（A6 的處理中：`aria-busy`＋12px 轉圈）。疊在上面而不是插在上方，版面不會被推動。
 * - 新資料回來時要平滑換上，由呼叫端把「套資料」那一行包在 `injectViewTransition()` 裡 —— 這裡不管。
 *
 * **呼叫端在重抓期間不能先把資料清掉**，否則留著的是空畫面。
 */
@Component({
  selector: 'app-reload-veil',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (phase() === 'initial') {
      <ng-content select="[reloadSkeleton]" />
    } @else {
      <!-- min-h-8：重抓時舊內容是空的（例：上次失敗後按重試），膠囊（約 30px）也要整顆露出，不被下面的東西切掉（#1853） -->
      <div
        class="reload-veil relative"
        [class.reload-veil--stale]="phase() === 'stale'"
        [class.min-h-8]="phase() === 'stale'"
        [class.cursor-progress]="phase() === 'stale'"
        [attr.aria-busy]="phase() === 'stale' ? 'true' : null"
      >
        @if (phase() === 'stale') {
          <p
            class="reload-veil__status absolute top-0 left-1/2 z-10 m-0 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-solid border-zinc-200 bg-white px-3 py-1 text-sm font-medium text-zinc-700 shadow-sm"
            role="status"
          >
            <span
              class="reload-veil__spin size-3 shrink-0 animate-[spin_0.7s_linear_infinite] rounded-full border-[1.5px] border-solid border-current border-r-transparent motion-reduce:animate-none motion-reduce:border-r-current motion-reduce:opacity-50"
              aria-hidden="true"
            ></span>
            載入中…
          </p>
        }
        <!-- 變淡 140ms --leave、回來 200ms --arrive（同 #1634：出場比進場短）。
             兩條都掛 motion-safe：變淡那條是任意變體，比 motion-reduce:transition-none 更具體，
             原本會蓋過它 —— 開了「減少動態」照樣淡 140ms（#1641 5b 錄影抓到） -->
        <!-- inert：滑鼠和鍵盤都碰不到舊內容（不只 pointer-events —— 審核席 #1648） -->
        <div
          class="reload-veil__body motion-safe:[transition:opacity_200ms_var(--arrive)] [.reload-veil--stale>&]:opacity-40 motion-safe:[.reload-veil--stale>&]:[transition:opacity_140ms_var(--leave)]"
          [inert]="phase() === 'stale'"
        >
          <ng-content />
        </div>
      </div>
    }
  `,
})
export class ReloadVeilComponent {
  readonly loading = input.required<boolean>();

  /** 載入完成過一次之後，再 loading 就是「重抓」，不再顯示骨架 */
  private readonly loadedOnce = signal(false);

  protected readonly phase = computed<'initial' | 'stale' | 'ready'>(() => {
    if (!this.loading()) return 'ready';
    return this.loadedOnce() ? 'stale' : 'initial';
  });

  constructor() {
    effect(() => {
      if (!this.loading()) untracked(() => this.loadedOnce.set(true));
    });
  }
}
