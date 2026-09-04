import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { AnnouncementInboxComponent } from '@shared/components/announcement-inbox/announcement-inbox.component';

/**
 * 家長的通知中心 —— 收件匣本身在 `shared/components/announcement-inbox`，
 * 老師端是同一個東西（見那支的檔頭）。這一層只提供頁面標題。
 */
@Component({
  selector: 'app-notifications',
  imports: [AnnouncementInboxComponent],
  template: `<app-announcement-inbox [heading]="page().label" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  readonly page = input.required<RouteObj>();
}
