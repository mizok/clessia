import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import type { Campus } from '@core/campuses.service';

export const UNASSIGNED_TEACHER_ID = '__unassigned__';

export const SESSION_STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '正常', value: 'scheduled' },
  { label: '已完成', value: 'completed' },
  { label: '已停課', value: 'cancelled' },
];

export const ALL_SESSION_STATUSES = SESSION_STATUS_OPTIONS.map((option) => option.value);
export const DEFAULT_STATUSES = ['scheduled', 'completed'];

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
