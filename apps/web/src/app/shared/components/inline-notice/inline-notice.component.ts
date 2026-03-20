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
  readonly severity = input<InlineNoticeSeverity>('error');
  readonly summary = input<string | null>(null);
  readonly detail = input<string | null>(null);
  readonly dismissible = input(true);

  readonly dismissed = output<void>();
}
