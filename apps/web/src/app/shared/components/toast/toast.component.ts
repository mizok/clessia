import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MessageService, type ToastMessageOptions } from 'primeng/api';

type Kind = 'success' | 'error' | 'warn' | 'info';

/** `warning`／`danger` 不是 PrimeNG 的值，但 repo 裡有人這樣寫（#1615 盤點）；照意思歸位 */
const KIND: Record<string, Kind> = {
  success: 'success',
  error: 'error',
  danger: 'error',
  warn: 'warn',
  warning: 'warn',
  info: 'info',
};

/** A6 a6.js 的 16px 線條圖示（check／x／alert／info） */
const ICON_PATH: Record<Kind, string> = {
  success: 'M3.5 8.5l3 3 6-7',
  error: 'M4 4l8 8M12 4l-8 8',
  warn: 'M8 4.8v3.6M8 11h.01',
  info: 'M8 7.2v3.8M8 5h.01',
};

const LEAVE_MS = 160;
const MAX = 3;

interface Item {
  readonly id: number;
  readonly kind: Kind;
  readonly title: string;
  readonly detail: string | null;
  readonly undo: (() => void) | null;
  readonly sticky: boolean;
  readonly leaving: boolean;
}

interface Clock {
  left: number;
  start: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * 全站**唯一**的 toast 出口（#1615）：掛在 `App`，所有 `MessageService.add()` 都到這裡。
 *
 * 樣式與行為照 A6（`kit.html`、`a6.css:674-689`、`a6.js:284-315`）：底部置中、灰面一種、
 * 最多 3 則、滑過或鍵盤移入暫停倒數、有 `data.undo` 給「復原」。A6 沒畫的三點由使用者裁：
 * 四種 severity 同一個灰面只換圖示色；標題一行、內文一行；錯誤 6 秒、其餘照 A6。
 *
 * **不用 `p-toast`**：root component 不加 PrimeNG UI 依賴（見 `app.component.ts`），
 * 而且它的版型、數量上限、暫停都要拆掉重做。這裡只吃 `MessageService` 的兩個 observable。
 *
 * **蓋得過對話框**：外框是 `popover="manual"`，每則新訊息都重新 `showPopover()`，
 * 才會排在最後打開的那層之上（A6 同一招）。
 */
@Component({
  selector: 'app-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'toasts pointer-events-none fixed z-[25000] m-0 flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 [inset:auto_auto_16px_50%]',
    role: 'status',
    'aria-live': 'polite',
    popover: 'manual',
  },
  template: `
    @for (t of items(); track t.id) {
      <div
        class="toast pointer-events-auto flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-zinc-200 pl-4 text-base font-medium text-zinc-900 shadow-[0_14px_32px_-12px_rgb(26_22_20/38%),0_2px_6px_-2px_rgb(26_22_20/12%)] transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-3 starting:opacity-0 data-leaving:translate-y-1.5 data-leaving:opacity-0 data-leaving:duration-[140ms] data-leaving:ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:transition-none"
        [class.pr-4]="!hasAction(t)"
        [class.pr-2]="hasAction(t)"
        [class.py-2]="!!t.detail"
        [class.toast--leaving]="t.leaving"
        [attr.data-leaving]="t.leaving ? '' : null"
        (pointerenter)="hold(t.id)"
        (pointerleave)="run(t.id)"
        (focusin)="hold(t.id)"
        (focusout)="run(t.id)"
      >
        <svg
          class="shrink-0"
          [class]="'toast__icon toast__icon--' + t.kind + ' ' + iconColor[t.kind]"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          @if (t.kind === 'warn' || t.kind === 'info') {
            <circle cx="8" cy="8" r="6.2" />
          }
          <path [attr.d]="iconPath[t.kind]" />
        </svg>
        <span class="flex min-w-0 flex-col">
          <span class="toast__title">{{ t.title }}</span>
          @if (t.detail) {
            <span class="toast__detail text-md font-normal text-zinc-600">{{ t.detail }}</span>
          }
        </span>
        @if (hasAction(t)) {
          <button
            class="toast__action min-h-11 shrink-0 wide:h-8 wide:min-h-0 cursor-pointer rounded-md border-0 bg-transparent px-3 font-bold text-zinc-900 underline underline-offset-3 hover:bg-zinc-300 focus-visible:bg-zinc-300 focus-visible:outline-none"
            type="button"
            (click)="act(t)"
          >
            {{ t.undo ? '復原' : '關閉' }}
          </button>
        }
      </div>
    }
  `,
})
export class ToastComponent {
  private readonly messages = inject(MessageService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly clocks = new Map<number, Clock>();
  private nextId = 0;

  protected readonly items = signal<Item[]>([]);
  protected readonly iconPath = ICON_PATH;
  protected readonly iconColor: Record<Kind, string> = {
    success: 'text-success-600',
    error: 'text-error-600',
    warn: 'text-warning-600',
    info: 'text-zinc-600',
  };

  constructor() {
    this.messages.messageObserver
      .pipe(takeUntilDestroyed())
      .subscribe((m) => (Array.isArray(m) ? m : [m]).forEach((x) => this.show(x)));
    this.messages.clearObserver
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.items().forEach((t) => this.close(t.id)));
  }

  protected hasAction(t: Item): boolean {
    return t.undo !== null || t.sticky;
  }

  private show(m: ToastMessageOptions): void {
    const undo = typeof m.data?.undo === 'function' ? (m.data.undo as () => void) : null;
    const kind = KIND[m.severity ?? ''] ?? 'info';
    const item: Item = {
      id: this.nextId++,
      kind,
      title: m.summary || m.detail || '',
      detail: m.summary && m.detail ? m.detail : null,
      undo,
      sticky: !!m.sticky,
      leaving: false,
    };

    this.place();
    const kept = this.items().filter((t) => !t.leaving);
    for (const old of kept.slice(0, Math.max(0, kept.length - MAX + 1))) this.remove(old.id);
    this.items.update((list) => [...list, item]);

    if (item.sticky) return;
    this.clocks.set(item.id, {
      left: m.life ?? (undo || kind === 'error' ? 6000 : 4000),
      start: 0,
    });
    this.run(item.id);
  }

  /** 重新放進頂層（蓋過最後打開的對話框）；底部有動作列時浮在它上面 12px（A6 a6.js:296-300） */
  private place(): void {
    if (this.host.matches?.(':popover-open')) this.host.hidePopover?.();
    this.host.showPopover?.();
    const docks = [...document.querySelectorAll<HTMLElement>('[data-toast-dock]')].filter(
      (d) => d.getClientRects().length > 0,
    );
    const top = Math.min(window.innerHeight, ...docks.map((d) => d.getBoundingClientRect().top));
    this.host.style.bottom = `${Math.max(16, window.innerHeight - top + 12)}px`;
  }

  protected run(id: number): void {
    const c = this.clocks.get(id);
    if (!c) return;
    clearTimeout(c.timer);
    c.start = Date.now();
    c.timer = setTimeout(() => this.close(id), c.left);
  }

  protected hold(id: number): void {
    const c = this.clocks.get(id);
    if (!c) return;
    clearTimeout(c.timer);
    c.left -= Date.now() - c.start;
  }

  protected act(t: Item): void {
    this.close(t.id);
    if (!t.undo) return;
    t.undo();
    this.show({ severity: 'success', summary: '已復原' });
  }

  private close(id: number): void {
    clearTimeout(this.clocks.get(id)?.timer);
    this.clocks.delete(id);
    this.items.update((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => this.remove(id), LEAVE_MS);
  }

  private remove(id: number): void {
    clearTimeout(this.clocks.get(id)?.timer);
    this.clocks.delete(id);
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}
