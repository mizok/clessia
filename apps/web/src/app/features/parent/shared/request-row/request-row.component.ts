import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * 「申請紀錄」的一列（A6 p-enrollment／p-trial 的 `.rq`，#1727）：報名、試聽兩頁共用。
 * 整列是一顆按鈕，按了開詳情；狀態標籤的色相只編碼嚴重度（A6 charter 四之一）。
 */
export type RequestTagTone = 'quiet' | 'warn' | 'ok' | 'error' | 'off' | 'line';

/** 狀態標籤的樣式（詳情裡同一顆標籤也用它） */
export const REQUEST_TAG_CLASS: Record<RequestTagTone, string> = {
  quiet: 'bg-zinc-100 px-2 font-semibold text-zinc-700',
  warn: 'bg-warning-50 px-2 font-semibold text-warning-800 shadow-[inset_0_0_0_1px_var(--warning-200)]',
  ok: 'pr-2 font-semibold text-success-600',
  error: 'font-semibold text-error-700',
  // A6 .tag--off：字重 500（其他 600）—— 字重放在各色調裡，免得跟基底的 600 打架
  off: 'pr-2 font-medium text-zinc-600',
  line: 'px-2 font-semibold text-zinc-800 shadow-[inset_0_0_0_1px_var(--zinc-400)]',
};

/** meta 的一段；`strong` 的那段照 A6 `.rq__m b` 加粗（試聽紀錄的「10/21（三） 18:30 試聽」） */
export interface RequestMetaPart {
  readonly text: string;
  readonly strong?: boolean;
}

@Component({
  selector: 'app-request-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // 宿主不佔版面：A6 是 `div > button.rq`，按鈕直接當列（#1314）
  host: { class: 'contents' },
  template: `
    <button
      type="button"
      class="group grid min-h-16 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-0 border-b border-solid border-zinc-200 bg-transparent px-0 py-3 text-left [font:inherit] text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      [attr.data-request]="id()"
      (click)="open.emit()"
    >
      <span class="text-lg leading-6 font-semibold underline-offset-4 group-hover:underline">{{
        title()
      }}</span>
      <span class="row-span-2 flex items-center gap-2">
        <span
          [class]="
            'inline-flex items-center gap-1 rounded-full py-0.5 text-sm leading-[1.4] whitespace-nowrap ' +
            toneClass()
          "
          >{{ tag() }}</span
        >
      </span>
      <!-- prettier-ignore -->
      <span class="text-md leading-normal text-zinc-600 tabular-nums">@for (p of pieces(); track $index) {@if (p.strong) {<b>{{ p.text }}</b>} @else {<ng-container>{{ p.text }}</ng-container>}}</span>
    </button>
  `,
})
export class RequestRowComponent {
  readonly id = input.required<string>();
  readonly title = input.required<string>();
  readonly tag = input.required<string>();
  readonly tone = input.required<RequestTagTone>();
  /** 字串＝一整段；陣列＝各段以「 · 」相接 */
  readonly meta = input.required<string | readonly RequestMetaPart[]>();
  readonly open = output<void>();

  /** 各段以「 · 」相接；分隔符併進非粗體的鄰段，粗體只包日期本身（A6 `· <b>…</b> ·`） */
  protected readonly pieces = computed<readonly RequestMetaPart[]>(() => {
    const m = this.meta();
    const parts = typeof m === 'string' ? [{ text: m }] : m;
    return parts.flatMap((part, i) => {
      const sep = i === 0 ? [] : [{ text: ' · ' }];
      return [...sep, part];
    });
  });

  protected toneClass(): string {
    return REQUEST_TAG_CLASS[this.tone()];
  }
}
