import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
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
  imports: [FormsModule, DatePickerModule, SelectFieldComponent],
  templateUrl: './session-filters.component.html',
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

  protected readonly campusOptions = computed(() => [
    { label: '所有分校', value: null as string | null },
    ...this.campuses().map((c) => ({ label: c.name, value: c.id as string | null })),
  ]);

  protected onListDateRangeChange(range: Date[]): void {
    this.listDateRangeChange.emit(range);
  }

  protected onCampusChange(id: string | null): void {
    this.campusIdChange.emit(id);
  }
}
