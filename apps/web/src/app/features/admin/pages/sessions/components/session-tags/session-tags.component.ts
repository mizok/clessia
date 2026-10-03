import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Session } from '@core/sessions.service';

/**
 * 課塊上的狀態字（A6 `tags()`）：每種狀態都有字，框線與底色只是加強。
 * 代課・原 X／調課・從…移來 要的異動摘要 `/api/sessions` 沒給，先統一標「有異動」（#1174 後續項）。
 */
@Component({
  selector: 'app-session-tags',
  templateUrl: './session-tags.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionTagsComponent {
  readonly session = input.required<Session>();
  readonly live = input(false);
  readonly clash = input(false);
}
