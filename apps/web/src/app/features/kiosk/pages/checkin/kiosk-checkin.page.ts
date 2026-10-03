import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { AuthService } from '@core/auth.service';
import { CheckinStationComponent } from '@shared/components/checkin-station/checkin-station.component';

/**
 * 分校門口的掃碼機台（#1127）。**不走 ShellLayout**：沒有選單、沒有其他頁可去 ——
 * kiosk 帳號在後端只能打卡，畫面也只給這一件事。登出留給櫃台（換機台、停用前）。
 */
@Component({
  selector: 'app-kiosk-checkin',
  imports: [ButtonModule, CheckinStationComponent],
  templateUrl: './kiosk-checkin.page.html',
})
export class KioskCheckinPage {
  private readonly auth = inject(AuthService);

  protected readonly stationName = this.auth.profile;

  protected signOut(): void {
    void this.auth.signOut();
  }
}
