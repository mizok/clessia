import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { addDays, format, parseISO } from 'date-fns';

import type { ChangeLogEntry, ScheduleChangeType } from '@core/sessions.service';

import {
  CHANGE_TYPE_ICONS,
  CHANGE_TYPE_LABELS,
  groupChanges,
  type ChangeChapter,
} from './change-log.util';

/**
 * 寬版（桌機頁面）的版面 class。**全部是完整字面量** —— Tailwind 掃的是原始碼字串，
 * 不能用字串拼接。`compact`（窄容器，例如課表的抽屜）時整組不套：抽屜在桌機也只有
 * 480px，用 `wide:`（視窗 ≥861px）會把它排成左 208px 的兩欄而擠爆。
 */
const WIDE = {
  chapter: 'wide:grid-cols-[208px_minmax(0,1fr)] wide:gap-8 wide:py-8',
  chapterHead: 'wide:sticky wide:top-4 wide:block wide:self-start',
  day: 'wide:text-[44px]',
  dayMeta: 'wide:mt-0.5',
  count: 'wide:mt-3 wide:text-xl',
  row: 'wide:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)] wide:items-baseline',
  summary:
    'wide:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] wide:items-baseline',
} as const;
const NARROW = {
  chapter: '',
  chapterHead: '',
  day: '',
  dayMeta: '',
  count: '',
  row: '',
  summary: '',
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 課務異動清單：依上課日分章、同一次批次收成一則、批次可展開看是哪幾堂（A6）。
 *
 * **`/admin/changes`（#991）與課表的 `#changes` 抽屜共用這一份** —— 兩處講同一份紀錄，
 * 各寫一份會對同一則異動說不一樣的話。只負責畫清單：取數、篩選、分頁在呼叫端。
 */
@Component({
  selector: 'app-change-log-list',
  imports: [DatePipe, NgTemplateOutlet],
  templateUrl: './change-log-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeLogListComponent {
  readonly entries = input.required<readonly ChangeLogEntry[]>();
  /** 今天（台北，`yyyy-MM-dd`）：決定章的排序與「今天／明天」 */
  readonly today = input.required<string>();
  /** 窄容器（抽屜）：不用 `wide:` 的左右兩欄版面 */
  readonly compact = input(false);

  protected readonly wide = computed(() => (this.compact() ? NARROW : WIDE));

  protected readonly chapters = computed<ChangeChapter[]>(() =>
    groupChanges(this.entries(), this.today()),
  );

  /**
   * `?? value` 是最後的退路，不是設計 —— 它會顯示原始英文字（`makeup`）。
   * `CHANGE_TYPE_LABELS` 綁死 `ScheduleChangeType`，漏標籤會編不過，所以正常情況走不到那個 `??`；
   * 留著是因為後端的 `changeType` 回的是 `z.string()`，執行期仍可能出現型別沒涵蓋的值。
   */
  protected typeLabel(value: ScheduleChangeType): string {
    return CHANGE_TYPE_LABELS[value] ?? value;
  }

  protected typeIcon(value: ScheduleChangeType): string {
    return CHANGE_TYPE_ICONS[value] ?? 'pi-circle';
  }

  /** 章的大字：今天／明天／M/D；沒有上課日（理論上不會有）寫「未排日期」 */
  protected dayLabel(date: string): string {
    if (!date) return '未排日期';
    if (date === this.today()) return '今天';
    if (date === format(addDays(parseISO(this.today()), 1), 'yyyy-MM-dd')) return '明天';
    return format(parseISO(date), 'M/d');
  }

  /** 章的小字：今天／明天要補上日期，其他只寫星期 */
  protected dayMeta(date: string): string {
    if (!date) return '';
    const d = parseISO(date);
    const weekday = `週${WEEKDAYS[d.getDay()]}`;
    return this.dayLabel(date).includes('/') ? weekday : `${format(d, 'M/d')} ${weekday}`;
  }

  protected classCount(rows: readonly ChangeLogEntry[]): number {
    return new Set(rows.map((r) => r.className)).size;
  }
}
