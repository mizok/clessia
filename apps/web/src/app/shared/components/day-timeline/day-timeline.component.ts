import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { EventSessionSummary } from '@core/attendance.service';
import { axisTicks, binDay, nowMarkerPct, type DensityBin } from './day-timeline.util';

/**
 * 橘帶裡那條「今天」的資訊圖：**每半小時一根，柱高是同時堂數**。
 * 設計見 `kb/wiki/architecture/timeline-density.md`。
 *
 * 只畫圖，**不取數**、也不定義「未點名」（那是 `takenAt` 是否為 null，由呼叫端
 * 既有的邏輯決定）。計數全在 `day-timeline.util.ts`，這裡只把數字畫成 DOM。
 *
 * **為什麼從 lane 換成柱**：lane 式佈局每多一條就高 30px，實測 4 條時橘帶佔 48% 視窗、
 * 整頁 1.76 螢幕，課表整段掉到摺線下 —— 課越多這張圖越擋住使用者要去的地方，
 * 而課多正是他最需要往下看的日子。柱狀的高度與課量脫鉤。
 *
 * **失去的東西要知道**：一根柱是一個時段的統計量，不是一堂課，所以 aria-label 給的是
 * 「09:30–10:00，3 堂課，其中 2 堂未點名」而不是班級名。逐堂的細節本來就在下方的
 * 課表清單裡 —— 時間軸從一開始就不負責身分。
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

  protected readonly layout = computed(() => binDay(this.sessions()));
  protected readonly ticks = computed(() => axisTicks(this.layout().window));
  protected readonly nowPct = computed(() =>
    nowMarkerPct(this.layout().window, this.date(), this.now()),
  );

  protected readonly hasBars = computed(() => this.layout().maxTotal > 0);

  /**
   * 柱高按**當日最大同時堂數**正規化，並把那個最大值顯示出來（「最忙 N 堂」）。
   *
   * 拒絕「固定尺度 + 超出截斷」—— 截斷會說謊：8 堂同時的日子會畫得跟 5 堂一樣高，
   * 而那正是最該被看見的日子。
   */
  protected heightPct(count: number): number {
    const max = this.layout().maxTotal;
    return max === 0 ? 0 : (count / max) * 100;
  }

  protected hour(h: number): string {
    return String(h).padStart(2, '0');
  }

  /** `9.5` → `09:30`。aria-label 要講得出時段，使用者才知道那一根是什麼時候。 */
  private clock(hour: number): string {
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  protected describe(bin: DensityBin): string {
    const span = `${this.clock(bin.startHour)}–${this.clock(bin.startHour + 0.5)}`;
    if (bin.total === 0) return `${span}，沒有課`;
    return `${span}，${bin.total} 堂課，其中 ${bin.untaken} 堂未點名`;
  }

  protected trackBin(_: number, bin: DensityBin): number {
    return bin.startHour;
  }

  protected readonly summaryOf = computed(() => {
    const all = this.sessions();
    const taken = all.filter((s) => s.takenAt !== null).length;
    return { total: all.length, taken, untaken: all.length - taken };
  });
}
