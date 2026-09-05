import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { AnnouncementInboxComponent } from '@shared/components/announcement-inbox/announcement-inbox.component';

/**
 * 老師的通知中心 —— 收件匣本身在 `shared/components/announcement-inbox`，
 * 家長端是同一個東西（見那支的檔頭）。這一層只提供頁面標題。
 *
 * 在 #291 之前這裡是自己的一份實作（212 行 spec）。抽成共用件時 14 條測試
 * 逐條搬過去了，所以這裡連同 html / scss / spec 一起刪 —— 留著只會兩份各自長。
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
