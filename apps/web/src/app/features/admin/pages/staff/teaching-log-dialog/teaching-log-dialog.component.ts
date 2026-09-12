import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { SessionsService, type Session, type SubstitutedAwayEntry } from '@core/sessions.service';

import { summariseTeachingLog, type TeachingLogSummary } from './teaching-log.util';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';

export interface TeachingLogDialogData {
  readonly staffId: string;
  readonly staffName: string;
}

const MONTHS_BACK = 12;

import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
@Component({
  selector: 'app-teaching-log-dialog',
  imports: [
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
    StatusDotComponent,
    FormsModule,
    ButtonModule,
    SelectModule,
    TagModule,
  ],
  templateUrl: './teaching-log-dialog.component.html',
  styleUrl: './teaching-log-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeachingLogDialogComponent {
  private readonly sessionsService = inject(SessionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly config = inject(DynamicDialogConfig<TeachingLogDialogData>);
  private readonly ref = inject(DynamicDialogRef);

  protected readonly staffName = this.config.data?.staffName ?? '';
  private readonly staffId = this.config.data?.staffId ?? '';

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly month = signal(format(new Date(), 'yyyy-MM'));
  protected readonly substitutedAway = signal<SubstitutedAwayEntry[]>([]);

  private readonly sessions = signal<Session[]>([]);
  protected readonly summary = computed<TeachingLogSummary>(() =>
    summariseTeachingLog(this.sessions()),
  );

  /** 缺點名的課堂 id，讓 template 直接判斷要不要標記 */
  protected readonly missingAttendanceIds = computed(
    () => new Set(this.summary().missingAttendance.map((s) => s.id)),
  );

  protected readonly monthOptions = Array.from({ length: MONTHS_BACK }, (_, i) => {
    const date = subMonths(new Date(), i);
    return { label: format(date, 'yyyy 年 M 月'), value: format(date, 'yyyy-MM') };
  });

  constructor() {
    this.load();
  }

  protected onMonthChange(value: string): void {
    this.month.set(value);
    this.load();
  }

  private load(): void {
    const [year, month] = this.month().split('-').map(Number);
    const base = new Date(year, month - 1, 1);
    const from = format(startOfMonth(base), 'yyyy-MM-dd');
    const to = format(endOfMonth(base), 'yyyy-MM-dd');

    this.loading.set(true);
    this.loadError.set(false);

    this.sessionsService
      .list({ teacherIds: [this.staffId], from, to, pageSize: 500 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.sessions.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.sessions.set([]);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });

    // 被代課是附屬區塊：它掛掉不該讓整個時數統計失效，所以錯誤只清空這一區。
    this.sessionsService
      .substitutedAway({ teacherId: this.staffId, from, to })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.substitutedAway.set(res.data),
        error: () => this.substitutedAway.set([]),
      });
  }
  /**
   * **這支對話框原本一顆按鈕都沒有**（#727，跟 #714 的家長詳情同型）。
   *
   * 開啟設定（`staff.page.ts` 的 `openTeachingLog`）沒帶 `closable`，而
   * `DynamicDialogComponent` 一律把 `[closable]="ddconfig.closable"` 綁給內層
   * `p-dialog` —— **沒帶就是 `undefined`，把 `p-dialog` 自己的預設 `true` 蓋掉**，
   * 於是標頭的 ✕ 不渲染；模板底部也沒有 footer。使用者只能重新整理整頁。
   *
   * 補在內容區而不是去開 `closable` —— 這個 app 其餘的對話框都是這個形狀
   * （`invoice-detail`、`uninvoiced`、`parent-detail` …），**一致性優先**。
   */
  protected close(): void {
    this.ref.close();
  }
}
