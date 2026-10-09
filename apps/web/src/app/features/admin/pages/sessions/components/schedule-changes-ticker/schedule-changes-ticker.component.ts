import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  computed,
  effect,
  Injector,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { addDays, format, parseISO } from 'date-fns';
import type { Subscription } from 'rxjs';

import { CampusContextService } from '@core/campus-context.service';
import { SessionsService, type ChangeLogEntry } from '@core/sessions.service';
import { SystemClockService } from '@core/system-clock.service';
import {
  CHANGE_TYPE_LABELS,
  groupChanges,
} from '@shared/components/change-log-list/change-log.util';

/** 跑馬燈速度（A6）：每秒 32px */
const PX_PER_SECOND = 32;
/** 今天起幾天內的異動 */
const WINDOW_DAYS = 7;

export interface TickerSessionPick {
  readonly sessionId: string;
  /** 上課日 `yyyy-MM-dd` */
  readonly date: string;
}

export interface TickerBatchPick {
  /** 清單裡那一則的 key（有 `batchId` 用它，舊資料是合成鍵）——抽屜用它展開那一批 */
  readonly key: string;
  /** 該批第一堂的上課日，抽屜用它決定預設月份 */
  readonly date: string;
}

interface TickerItem {
  readonly key: string;
  readonly text: string;
  readonly batch: boolean;
  readonly date: string;
  readonly sessionId: string;
}

/**
 * 課表的異動跑馬燈（A6，#1314 S3）：灰底一條，左「異動 · 今天起 N 則」、中間今天起 7 天內的異動
 * 慢慢往左捲、右「全部異動」。單堂點了切到那天並打開它的選單；同一批的收成一則，點了開抽屜並展開。
 *
 * **會動的東西要能停**：`prefers-reduced-motion` 時不動、改成可橫捲；hover／鍵盤 focus 時暫停
 * （WCAG 2.2.2）。資料只有這一條查詢（`GET /sessions/changes`，今天起 7 天，含 `batchId`）。
 */
@Component({
  selector: 'app-schedule-changes-ticker',
  imports: [RouterLink],
  templateUrl: './schedule-changes-ticker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleChangesTickerComponent {
  readonly pickSession = output<TickerSessionPick>();
  readonly pickBatch = output<TickerBatchPick>();

  private readonly sessionsService = inject(SessionsService);
  private readonly campusCtx = inject(CampusContextService);
  private readonly clock = inject(SystemClockService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  private readonly entries = signal<ChangeLogEntry[]>([]);
  protected readonly total = signal(0);
  /** 動畫時長（秒）：（容器寬＋內容寬）÷ 速度，量過才寫 */
  protected readonly duration = signal<number | null>(null);
  private inFlight: Subscription | null = null;

  /** 今天起 N 則：整數加總的是「則」（批次算一則），跟畫面上看到的項目數一致 */
  protected readonly items = computed<TickerItem[]>(() =>
    groupChanges(this.entries(), this.clock.todayTaipei()).flatMap((chapter) =>
      chapter.items.map((item): TickerItem => {
        const first = item.rows[0];
        const md = `${+chapter.date.slice(5, 7)}/${+chapter.date.slice(8, 10)}`;
        const type = CHANGE_TYPE_LABELS[first.changeType] ?? first.changeType;
        const batch = item.rows.length > 1;
        const text = batch
          ? `${type} ${item.rows.length} 堂${first.reason ? ` · ${first.reason}` : ''} · 批次`
          : `${md} ${first.className ?? ''} ${type}`.replace(/\s+/g, ' ').trim();
        return { key: item.key, text, batch, date: chapter.date, sessionId: first.sessionId };
      }),
    ),
  );

  constructor() {
    // 初次載入與頂欄換分校都走這裡（effect 追 `campusCtx.id`）
    effect(() => {
      const campusId = this.campusCtx.id();
      this.load(campusId);
    });
    // 內容換了就重量時長：擺到下一次 render 之後才量得到寬度
    effect(() => {
      this.items();
      afterNextRender(() => this.measure(), { injector: this.injector });
    });
  }

  private readonly injector = inject(Injector);

  private measure(): void {
    const el = this.track()?.nativeElement;
    const box = el?.parentElement;
    if (!el || !box) return;
    // 軌道前面有一整個容器寬的空白（讓字從右邊進來），所以走完 = 軌道自己的寬度
    this.duration.set(Math.max(8, Math.round(el.scrollWidth / PX_PER_SECOND)));
  }

  private load(campusId: string | null): void {
    this.inFlight?.unsubscribe();
    const today = this.clock.todayTaipei();
    this.inFlight = this.sessionsService
      .listChanges({
        from: today,
        to: format(addDays(parseISO(today), WINDOW_DAYS), 'yyyy-MM-dd'),
        campusId: campusId ?? undefined,
        page: 1,
        pageSize: 100,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.entries.set(res.data);
          this.total.set(res.meta.total);
        },
        // 失敗就不顯示這一條（它是輔助訊號，不擋課表）
        error: () => {
          this.entries.set([]);
          this.total.set(0);
        },
      });
  }

  protected pick(item: TickerItem): void {
    if (item.batch) this.pickBatch.emit({ key: item.key, date: item.date });
    else this.pickSession.emit({ sessionId: item.sessionId, date: item.date });
  }
}
