import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitch } from 'primeng/toggleswitch';

import {
  PushService,
  type NotificationKind,
  type NotificationPreference,
  type PushDevice,
  type PushState,
} from '@core/push.service';

const KIND_LABELS: Record<NotificationKind, string> = {
  invoice_due: '帳單即將到期',
  invoice_overdue: '帳單逾期',
};

/** 這幾種狀態下推播根本用不了，類型開關與裝置列表都不顯示 */
const UNAVAILABLE: readonly PushState[] = [
  'loading',
  'installable',
  'unsupported',
  'not-configured',
];

/**
 * 家長「通知」頁上方的通知設定（#1663，設計稿 kb/wiki/architecture/web-push.md §4、§8）。
 *
 * - **總開關是「這台裝置」**（權限本來就是一台一台給的）；狀態照設計稿 §4 的狀態表
 * - **類型開關是「這個人」**（`notification_preferences`，role=parent），任何一台改了全部生效
 * - 「已開啟通知的裝置」可以個別移除 —— 手機掉了、換手機時用得到
 *
 * A6 沒有這一塊的稿（`p-notifications.html` 只有收件匣），版面沿用收件匣與系統設定的寫法。
 */
@Component({
  selector: 'app-push-settings',
  imports: [ButtonModule, ToggleSwitch, FormsModule, DatePipe],
  templateUrl: './push-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PushSettingsComponent implements OnInit {
  protected readonly push = inject(PushService);

  protected readonly kindLabels = KIND_LABELS;
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  protected readonly preferences = signal<NotificationPreference[]>([]);
  protected readonly devices = signal<PushDevice[]>([]);
  /** 被拒絕時的說明要看平台：iOS 在系統設定、其餘在瀏覽器的網站設定 */
  protected readonly ios = /iP(hone|ad|od)/.test(navigator.userAgent);

  ngOnInit(): void {
    void this.load();
  }

  protected available(state: PushState): boolean {
    return !UNAVAILABLE.includes(state);
  }

  /** 按鈕直接觸發（iOS 規定權限要由使用者操作要求） */
  protected async enable(): Promise<void> {
    await this.run(() => this.push.enable());
    this.loadDevices();
  }

  protected async disableHere(): Promise<void> {
    await this.run(() => this.push.disableHere());
    this.loadDevices();
  }

  protected togglePreference(kind: NotificationKind, enabled: boolean): void {
    const before = this.preferences();
    const next = before.map((p) => (p.kind === kind ? { ...p, enabled } : p));
    this.preferences.set(next);
    this.push.savePreferences('parent', next).subscribe({
      next: (res) => this.preferences.set(res.preferences),
      // 存不進去就放回去 —— 開關停在「看起來改好了」但其實沒存，比不能改更糟
      error: () => this.preferences.set(before),
    });
  }

  protected removeDevice(device: PushDevice): void {
    this.push.removeDevice(device.id).subscribe({
      next: () => {
        this.devices.update((list) => list.filter((d) => d.id !== device.id));
        // 移除的可能就是這一台
        void this.push.refresh().catch(() => undefined);
      },
    });
  }

  /** `user_agent` 的簡化名稱：只留裝置與瀏覽器 */
  protected deviceName(ua: string | null): string {
    if (!ua) return '未知裝置';
    const os = /iPhone/.test(ua)
      ? 'iPhone'
      : /iPad|Macintosh.*Mobile/.test(ua)
        ? 'iPad'
        : /Android/.test(ua)
          ? 'Android'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac OS X/.test(ua)
              ? 'Mac'
              : '其他裝置';
    const browser = /Edg\//.test(ua)
      ? 'Edge'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
    return browser ? `${os} · ${browser}` : os;
  }

  private async load(): Promise<void> {
    await this.run(() => this.push.refresh());
    if (!this.available(this.push.state())) return;
    this.push.preferences('parent').subscribe({
      next: (res) => this.preferences.set(res.preferences),
    });
    this.loadDevices();
  }

  private loadDevices(): void {
    this.push.devices().subscribe({ next: (res) => this.devices.set(res.data) });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failed.set(false);
    try {
      await action();
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
