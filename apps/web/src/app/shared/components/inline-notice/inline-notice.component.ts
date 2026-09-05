import { Component, input, output } from '@angular/core';

export type InlineNoticeSeverity = 'error' | 'success' | 'warning' | 'info';

@Component({
  selector: 'app-inline-notice',
  standalone: true,
  imports: [],
  templateUrl: './inline-notice.component.html',
  styleUrl: './inline-notice.component.scss',
})
export class InlineNoticeComponent {
  /**
   * 預設 `info` 不是 `error`。查過全站 32 個使用點，**沒有一個依賴這個預設值**
   * ——每一處都明寫 severity，所以改這個值對現有畫面零影響。改的理由是防未來：
   * 忘記指定時的失效方向該是「不夠醒目」，不是「假警報」——假警報比不夠醒目貴，
   * 使用者對一個常喊狼來了的元件會整體降低信任，連真的 error 都被折扣。
   */
  readonly severity = input<InlineNoticeSeverity>('info');
  readonly summary = input<string | null>(null);
  readonly detail = input<string | null>(null);
  readonly dismissible = input(true);

  readonly dismissed = output<void>();
}
