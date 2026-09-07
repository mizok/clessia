import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import type { Campus } from '@core/campuses.service';

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
  imports: [FormsModule, ButtonModule, DatePickerModule, SelectModule],
  templateUrl: './session-filters.component.html',
  styleUrl: './session-filters.component.scss',
})
export class SessionFiltersComponent {
  readonly listDateRange = input<Date[]>([]);

  readonly campuses = input<Campus[]>([]);
  readonly selectedCampusId = input<string | null>(null);
  readonly activeFilterCount = input(0);
  readonly hasActiveFilters = input(false);

  readonly listDateRangeChange = output<Date[]>();
  readonly openAdvancedFilters = output<void>();
  readonly campusIdChange = output<string | null>();
  readonly clearFilters = output<void>();

  protected onListDateRangeChange(range: Date[]): void {
    this.listDateRangeChange.emit(range);
  }

  protected onCampusChange(id: string | null): void {
    this.campusIdChange.emit(id);
  }
}
