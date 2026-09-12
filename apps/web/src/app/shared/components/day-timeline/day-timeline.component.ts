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

  /**
   * 每一根加上「**要不要跟左邊那根接起來**」（#647）。
   *
   * 一堂 90 分鐘的課跨 3 根，而柱間的縫讓它讀起來像 3 件事 —— 旁邊的圖例正好寫
   * 「1 堂」。實心那段靠 `gap: 0` 就接起來了，**但未點名是 `border: 2px` 的中空盒、
   * 有自己的左右框**，所以還要另外把內側那條框去掉。
   *
   * **判準是「前一根也有未點名」，不是「前一根有沒有課」** —— 一根可以「有課但
   * 未點名 = 0」，用後者的話 run 的第一根會被錯誤地拿掉左框。
   * CSS 的兄弟選擇器只表達得出後者（它看不到 seg 的高度），**所以這件事必須在這裡算**。
   */
  protected readonly renderBins = computed(() => {
    const bins = this.layout().bins;
    return bins.map((bin, i) => ({
      bin,
      // **兩邊都要**：一條分隔線是「左邊那根的右框」加「右邊那根的左框」兩條疊起來，
      // 只去掉一邊的話線還在（實測看過 —— 4 根的 run 仍然是 4 個盒子）。
      joinUntakenLeft: bin.untaken > 0 && (bins[i - 1]?.untaken ?? 0) > 0,
      joinUntakenRight: bin.untaken > 0 && (bins[i + 1]?.untaken ?? 0) > 0,
    }));
  });

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

  /**
   * **停課的課堂不算「未點名」**（#686）—— 它永遠不會被點。
   *
   * 原本是 `all.length - taken`，於是一堂停課被算進未點名：實機上兩堂課（一堂停課）
   * 的圖例寫「未點名 2」，而橘帶同時說「其中 1 堂還沒點名」——**同一頁兩個數字打架**。
   *
   * `taken` 不用改：停課的課堂 `takenAt` 本來就是 null，它已經不在裡面。
   * `total` 刻意照算全部 —— 軸上那幾根柱子畫得出停課那一堂，總數少一根就對不上。
   */
  protected readonly summaryOf = computed(() => {
    const all = this.sessions();
    const taken = all.filter((s) => s.takenAt !== null).length;
    const untaken = all.filter((s) => s.status !== 'cancelled' && s.takenAt === null).length;
    return { total: all.length, taken, untaken };
  });
}
