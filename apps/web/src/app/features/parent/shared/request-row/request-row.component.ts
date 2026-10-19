import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * 「申請紀錄」的一列（A6 p-enrollment／p-trial 的 `.rq`，#1727）：報名、試聽兩頁共用。
 * 整列是一顆按鈕，按了開詳情；狀態標籤的色相只編碼嚴重度（A6 charter 四之一）。
 */
export type RequestTagTone = 'quiet' | 'warn' | 'ok' | 'error' | 'off' | 'line';

/** 狀態標籤的樣式（詳情裡同一顆標籤也用它） */
export const REQUEST_TAG_CLASS: Record<RequestTagTone, string> = {
  quiet: 'bg-zinc-100 px-2 text-zinc-700',
  warn: 'bg-warning-50 px-2 text-warning-800 shadow-[inset_0_0_0_1px_var(--warning-200)]',
  ok: 'pr-2 text-success-600',
  error: 'text-error-700',
  off: 'pr-2 font-medium text-zinc-600',
  line: 'px-2 text-zinc-800 shadow-[inset_0_0_0_1px_var(--zinc-400)]',
};

@Component({
  selector: 'app-request-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="group grid min-h-16 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-0 border-b border-solid border-zinc-200 bg-transparent px-0 py-3 text-left text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      [attr.data-request]="id()"
      (click)="open.emit()"
    >
      <span class="text-lg font-semibold underline-offset-4 group-hover:underline">{{
        title()
      }}</span>
      <span class="row-span-2 flex items-center gap-2">
        <span
          [class]="
            'inline-flex items-center rounded-full py-0.5 text-sm leading-[1.4] font-semibold whitespace-nowrap ' +
            toneClass()
          "
          >{{ tag() }}</span
        >
      </span>
      <span class="text-md text-zinc-600 tabular-nums">{{ meta() }}</span>
    </button>
  `,
})
export class RequestRowComponent {
  readonly id = input.required<string>();
  readonly title = input.required<string>();
  readonly tag = input.required<string>();
  readonly tone = input.required<RequestTagTone>();
  readonly meta = input.required<string>();
  readonly open = output<void>();

  protected toneClass(): string {
    return REQUEST_TAG_CLASS[this.tone()];
  }
}
