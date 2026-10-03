import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Session } from '@core/sessions.service';
import { isLive, toMin, type GanttLayout } from '../../schedule-day.util';
import { SessionTagsComponent } from '../session-tags/session-tags.component';

export interface ScheduleMenuRequest {
  readonly event: Event;
  readonly session: Session;
}

/** 勾一堂（`shiftKey`：按著 Shift ＝ 範圍勾，A6） */
export interface SchedulePickRequest {
  readonly id: string;
  readonly shiftKey: boolean;
}

/**
 * 勾選框外層 44px `<label>` 的 click（掛在 label 上：觸控尺寸 gate 看的是有 `(click)` 的元素）。
 * - 只處理**落在 checkbox 上**的那一下：點 label 空白處時瀏覽器會再對 checkbox 補發一次 click，不處理會勾兩次。
 * - **擋掉瀏覽器自己的切換**，勾不勾一律由頁面的狀態決定：Shift 範圍勾在已勾的那格上按，
 *   狀態不變（只加不減），瀏覽器卻會先把它取消勾 —— `[checked]` 的值沒變，Angular 不會改回來。
 */
export function pickEvent(event: MouseEvent, id: string): SchedulePickRequest | null {
  if (!(event.target instanceof HTMLInputElement)) return null;
  event.preventDefault();
  return { id, shiftKey: event.shiftKey };
}

/** 欄寬：左邊老師欄，與每小時至少多寬（A6 `.gt` 的 --lab／120px） */
const LAB = 148;
const HOUR_PX = 120;

/**
 * 桌機日視圖：以老師為列的甘特（A6 `gantt()`，#1174 G1）。
 * 只畫 `layoutDay()` 算好的結果；點課塊＝開那一堂的「⋯」選單（現有的單堂操作）。
 */
@Component({
  selector: 'app-schedule-gantt',
  imports: [SessionTagsComponent],
  templateUrl: './schedule-gantt.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleGanttComponent {
  readonly layout = input.required<GanttLayout>();
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  /** 「現在」：只在今天才畫線，由頁面在載入時給 */
  readonly now = input.required<Date>();
  readonly isToday = input(false);
  /** 快速選取模式（桌機）：每塊的勾選框都露出來，不用滑過 */
  readonly picking = input(false);

  readonly toggle = output<SchedulePickRequest>();
  protected onPickClick(event: MouseEvent, id: string): void {
    const req = pickEvent(event, id);
    if (req) this.toggle.emit(req);
  }
  readonly menu = output<ScheduleMenuRequest>();

  protected readonly lab = LAB;
  protected readonly hours = computed(() => this.layout().endHour - this.layout().startHour);
  protected readonly minWidth = computed(() => LAB + this.hours() * HOUR_PX);

  protected readonly ticks = computed(() => {
    const { startHour } = this.layout();
    const n = this.hours();
    return Array.from({ length: n + 1 }, (_, i) => ({
      label: `${startHour + i}:00`,
      left: (i / n) * 100,
      shift: i === 0 ? '0' : i === n ? '-100%' : '-50%',
    }));
  });

  protected readonly nowPct = computed(() => {
    if (!this.isToday()) return null;
    const { startHour, endHour } = this.layout();
    const m = this.now().getHours() * 60 + this.now().getMinutes();
    if (m <= startHour * 60 || m >= endHour * 60) return null;
    return ((m - startHour * 60) / ((endHour - startHour) * 60)) * 100;
  });
  protected readonly nowLabel = computed(
    () =>
      `${String(this.now().getHours()).padStart(2, '0')}:${String(this.now().getMinutes()).padStart(2, '0')}`,
  );

  protected readonly peakBand = computed(() => {
    const { peak, startHour, endHour } = this.layout();
    if (!peak) return null;
    const span = (endHour - startHour) * 60;
    const pct = (t: string) => ((toMin(t) - startHour * 60) / span) * 100;
    return { a: pct(peak.from), b: pct(peak.to), count: peak.count };
  });

  /** 跟左欄同一套 calc：軸上 p% 落在整列的哪裡 */
  protected at(p: number): string {
    return `calc(${LAB}px + (100% - ${LAB}px) * ${p / 100})`;
  }

  protected kind(s: Session): 'cancelled' | 'done' | 'live' | 'next' {
    if (s.status === 'cancelled') return 'cancelled';
    if (s.status === 'completed') return 'done';
    return isLive(s, this.now()) ? 'live' : 'next';
  }

  protected selected(s: Session): boolean {
    return this.selectedIds().has(s.id);
  }

  protected rowHasClash(row: GanttLayout['rows'][number]): boolean {
    return row.blocks.some((b) => this.layout().clashIds.has(b.session.id));
  }
}
