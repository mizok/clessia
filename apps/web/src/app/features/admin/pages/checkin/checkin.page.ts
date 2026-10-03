import { Component } from '@angular/core';

import { CheckinStationComponent } from '@shared/components/checkin-station/checkin-station.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';

/** 行政開的到班打卡站（#1127）—— 跟門口機台同一個元件，差在掛在管理端殼裡 */
@Component({
  selector: 'app-checkin',
  imports: [PageOpenComponent, CheckinStationComponent],
  templateUrl: './checkin.page.html',
})
export class CheckinPage {}
