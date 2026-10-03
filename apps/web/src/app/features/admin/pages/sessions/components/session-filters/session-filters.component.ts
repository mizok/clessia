import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePickerModule } from 'primeng/datepicker';

export const UNASSIGNED_TEACHER_ID = '__unassigned__';

// 課堂狀態的詞彙住在 `shared/utils/session-status.ts`（單一來源，#640）。
// 這裡 re-export 是為了不動既有的 import 路徑。
export {
  ALL_SESSION_STATUSES,
  DEFAULT_STATUSES,
  SESSION_STATUS_OPTIONS,
  statusesAreFiltering,
} from '@shared/utils/session-status';
import { SESSION_STATUS_OPTIONS as STATUS_OPTIONS } from '@shared/utils/session-status';

@Component({
  selector: 'app-session-filters',
  imports: [FormsModule, DatePickerModule],
  templateUrl: './session-filters.component.html',
})
export class SessionFiltersComponent {
  /** 日期範圍只在「篩選結果」出現；課表（單日甘特）用頁面上的日期條換天 */
  readonly showDateRange = input(true);
  readonly listDateRange = input<Date[]>([]);

  readonly activeFilterCount = input(0);
  readonly hasActiveFilters = input(false);

  readonly listDateRangeChange = output<Date[]>();
  readonly openAdvancedFilters = output<void>();
  readonly clearFilters = output<void>();

  protected onListDateRangeChange(range: Date[]): void {
    this.listDateRangeChange.emit(range);
  }
}
