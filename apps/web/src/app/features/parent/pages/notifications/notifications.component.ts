import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { AnnouncementInboxComponent } from '@shared/components/announcement-inbox/announcement-inbox.component';
import { PushSettingsComponent } from '../../shared/push-settings/push-settings.component';

/**
 * 家長的通知中心 —— 收件匣本身在 `shared/components/announcement-inbox`，
 * 老師端是同一個東西（見那支的檔頭）。這一層提供頁面標題，
 * 以及收件匣上方的推播通知設定（#1663；第一版只開家長，設計稿 web-push.md Q7）。
 */
@Component({
  selector: 'app-notifications',
  imports: [PushSettingsComponent, AnnouncementInboxComponent],
  template: `<app-push-settings /><app-announcement-inbox [heading]="page().label" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  readonly page = input.required<RouteObj>();
}
