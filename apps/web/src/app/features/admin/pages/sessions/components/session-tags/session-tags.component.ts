import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Session } from '@core/sessions.service';

/**
 * 課塊上的狀態字（A6 `tags()`）：每種狀態都有字，框線與底色只是加強。
 * 異動的字吃 `latestChange`（#1194）：代課・原 X／調課・從 M/D HH:mm 移來／停課・原因；
 * 其餘類型（改時間、恢復、加開）仍標「有異動」。
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

  protected readonly cancelLabel = computed(() => {
    const c = this.session().latestChange;
    return c?.type === 'cancellation' && c.reason ? `停課 · ${c.reason}` : '停課';
  });

  /** `null` = 不標（沒異動、停課由停課標籤說、補課由補課標籤說） */
  protected readonly changeLabel = computed(() => {
    const s = this.session();
    if (!s.hasChanges || s.status === 'cancelled') return null;
    const c = s.latestChange;
    if (c?.type === 'substitute') {
      return c.originalTeacherName ? `代課 · 原 ${c.originalTeacherName}` : '代課';
    }
    if (c?.type === 'reschedule') {
      if (!c.originalDate) return '調課';
      const [, m, d] = c.originalDate.split('-');
      const at = `${+m}/${+d}${c.originalStartTime ? ' ' + c.originalStartTime : ''}`;
      return `調課 · 從 ${at} 移來`;
    }
    if (c?.type === 'makeup' && s.makeupFor) return null;
    return '有異動';
  });
}
