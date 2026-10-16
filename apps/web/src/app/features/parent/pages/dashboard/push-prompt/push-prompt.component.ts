import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { PushService } from '@core/push.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

/** 關掉提示卡的時間（ms）；30 天內不再出現 */
export const PUSH_PROMPT_DISMISSED_KEY = 'clessia:push-prompt-dismissed';
const QUIET_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 家長首頁的推播提示卡（#1663，設計稿 kb/wiki/architecture/web-push.md §4「入口」）。
 *
 * **只在「尚未決定」或「可安裝」時出現**：已開啟、被拒絕、不支援都不打擾。
 * 關掉後 30 天內不再出現，記在 `localStorage` —— 丟了也只是再出現一次。
 * 「尚未決定」直接在這裡開（按鈕觸發權限，iOS 規定）；「可安裝」的步驟較長，帶去通知頁看。
 */
@Component({
  selector: 'app-push-prompt',
  imports: [ButtonModule, RouterLink],
  template: `
    @if (visible()) {
      <aside
        class="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-accent-200 bg-accent-50 p-4"
        aria-label="繳費提醒"
        data-testid="push-prompt"
      >
        <i class="pi pi-bell mt-0.5 text-lg text-accent-600" aria-hidden="true"></i>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          @if (push.state() === 'installable') {
            <p class="m-0 text-md text-zinc-900">
              把 Clessia 加入主畫面，帳單快到期時手機會提醒你。
            </p>
            <a
              class="inline-flex min-h-11 items-center self-start font-semibold text-accent-700 underline underline-offset-4"
              [routerLink]="notificationsPath"
              >看怎麼加入</a
            >
          } @else {
            <p class="m-0 text-md text-zinc-900">開啟繳費提醒，帳單快到期時手機會通知你。</p>
            <p-button class="self-start" label="開啟繳費提醒" size="small" (onClick)="enable()" />
          }
        </div>
        <p-button
          icon="pi pi-times"
          [text]="true"
          [rounded]="true"
          severity="secondary"
          ariaLabel="關閉提示，30 天內不再顯示"
          (onClick)="dismiss()"
        />
      </aside>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PushPromptComponent implements OnInit {
  protected readonly push = inject(PushService);
  protected readonly notificationsPath = RoutesCatalog.PARENT_NOTIFICATIONS.absolutePath;

  private readonly dismissed = signal(recentlyDismissed());
  protected readonly visible = computed(
    () =>
      !this.dismissed() && (this.push.state() === 'default' || this.push.state() === 'installable'),
  );

  ngOnInit(): void {
    void this.push.refresh().catch(() => undefined);
  }

  protected enable(): void {
    void this.push.enable().catch(() => undefined);
  }

  protected dismiss(): void {
    try {
      localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, String(Date.now()));
    } catch {
      // 存不了就只在這一次關掉
    }
    this.dismissed.set(true);
  }
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY));
    return at > 0 && Date.now() - at < QUIET_MS;
  } catch {
    return false;
  }
}
