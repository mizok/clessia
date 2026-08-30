import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { EventSessionSummary } from '@core/attendance.service';
import { axisTicks, layoutDay, nowMarkerPct, type PlacedSession } from './day-timeline.util';

/**
 * 橘帶裡那條「今天」的資訊圖。設計見 `kb/wiki/architecture/day-timeline.md`。
 *
 * 只畫圖，**不取數**、也不定義「未點名」（那是 `takenAt` 是否為 null，由呼叫端
 * 既有的邏輯決定）。佈局數學全在 `day-timeline.util.ts`，這裡只把座標畫成 DOM。
 *
 * **方塊刻意不可互動。** 設計原本寫「每個方塊連到該堂課」，實作時確認點名是從
 * 課堂清單開的 dialog、沒有單堂路由 —— 連到清單頁會是個假的 affordance
 * （看起來可以點進那一堂，其實只到清單）。所以它是資料圖形：`role="img"` 加
 * 完整的 aria-label，滑鼠看到的 tooltip 與螢幕閱讀器聽到的是同一句。
 */
@Component({
  selector: 'app-day-timeline',
  imports: [],
  templateUrl: './day-timeline.component.html',
  styleUrl: './day-timeline.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DayTimelineComponent {
  readonly sessions = input.required<readonly EventSessionSummary[]>();
  /** 這條軸代表的日期（`YYYY-MM-DD`）。等於今天時才畫「現在」標記。 */
  readonly date = input.required<string>();

  /**
   * 「現在」只在建構時取一次。儀表板開著幾小時之後標記會停在原處 ——
   * 這是知情的取捨：為了一條參考線掛一個計時器，代價高於它的價值。
   */
  private readonly now = signal(new Date());

  protected readonly layout = computed(() => layoutDay(this.sessions()));
  protected readonly ticks = computed(() => axisTicks(this.layout().window));
  protected readonly nowPct = computed(() =>
    nowMarkerPct(this.layout().window, this.date(), this.now()),
  );

  protected readonly hasBlocks = computed(() => this.layout().lanes.length > 0);

  /**
   * 軌道高度隨 lane 數長高（設計：lane 不設上限）。
   * 每條 lane 的節距與 SCSS 的方塊高度是一組，改一個要改另一個。
   */
  protected readonly trackHeight = computed(() => this.layout().lanes.length * 30 + 16);

  protected hour(h: number): string {
    return String(h).padStart(2, '0');
  }

  protected describe(placed: PlacedSession): string {
    const s = placed.session;
    const span = placed.isPoint ? s.startTime : `${s.startTime}–${s.endTime}`;
    const who = s.teacherName ? ` · ${s.teacherName}` : '';
    return `${span} ${s.className}${who} · ${s.takenAt ? '已點名' : '未點名'}`;
  }

  protected isTaken(placed: PlacedSession): boolean {
    return placed.session.takenAt !== null;
  }

  protected trackId(_: number, placed: PlacedSession): string {
    return placed.session.eventId;
  }

  protected readonly summaryOf = computed(() => {
    const all = this.sessions();
    const taken = all.filter((s) => s.takenAt !== null).length;
    return { total: all.length, taken, untaken: all.length - taken };
  });
}
