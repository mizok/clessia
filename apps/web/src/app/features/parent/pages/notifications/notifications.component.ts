import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { PushService } from '@core/push.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { AnnouncementInboxComponent } from '@shared/components/announcement-inbox/announcement-inbox.component';
import { PushSettingsComponent } from '../../shared/push-settings/push-settings.component';

/**
 * 家長的通知中心 —— 收件匣本身在 `shared/components/announcement-inbox`，
 * 老師端是同一個東西（見那支的檔頭）。這一層提供頁面標題，以及推播通知設定（#1663）。
 *
 * **推播設定收進彈窗**（#1888，使用者 10-22 選 A；A6 p-notifications 沒有它的位置，a6-adoption-rules R5）：
 * 工具列一顆「通知設定：未開啟／已開啟」，點開是彈窗（手機底部面板），裡面是原本的 push-settings，內容不改。
 * 收進彈窗就沒人找得到，所以**還沒開過**（state=default）時色面句下面多一行提示＋開啟鈕，開了就消失。
 */
@Component({
  selector: 'app-notifications',
  imports: [PushSettingsComponent, AnnouncementInboxComponent],
  templateUrl: './notifications.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  readonly page = input.required<RouteObj>();

  protected readonly push = inject(PushService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('settings');

  /** 彈窗開著才掛 push-settings：每次打開都重讀裝置與開關（它的 ngOnInit 會讀） */
  protected readonly settingsOpen = signal(false);
  protected readonly enabling = signal(false);
  protected readonly enableFailed = signal(false);

  /** 工具列鈕上的狀態字；偵測中先不寫，免得閃一下「未開啟」 */
  protected readonly status = computed(() => {
    const s = this.push.state();
    return s === 'loading' ? null : s === 'enabled' ? '已開啟' : '未開啟';
  });

  constructor() {
    // 鈕上的狀態字與提示列要先知道這台裝置的狀態；refresh 失敗會退回 default，提示列的鈕就是重試
    void this.push.refresh().catch(() => undefined);
  }

  protected openSettings(): void {
    this.settingsOpen.set(true);
    this.dialog()?.nativeElement.showModal();
  }

  protected closeSettings(): void {
    this.dialog()?.nativeElement.close();
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeSettings();
  }

  /** 提示列的開啟鈕 —— 要從按鈕直接呼叫（iOS 規定權限要由使用者操作觸發） */
  protected async enable(): Promise<void> {
    this.enabling.set(true);
    this.enableFailed.set(false);
    try {
      await this.push.enable();
    } catch {
      this.enableFailed.set(true);
    } finally {
      this.enabling.set(false);
    }
  }
}
