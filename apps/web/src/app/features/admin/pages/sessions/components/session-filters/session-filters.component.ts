import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { MultiSelectModule } from 'primeng/multiselect';
import type { Campus } from '@core/campuses.service';
import { ImeFilterInputComponent } from '@shared/components/ime-filter-input/ime-filter-input.component';

export const UNASSIGNED_TEACHER_ID = '__unassigned__';

export const SESSION_STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '已排課', value: 'scheduled' },
  { label: '已完成', value: 'completed' },
  { label: '已停課', value: 'cancelled' },
];

export const ALL_SESSION_STATUSES = SESSION_STATUS_OPTIONS.map((option) => option.value);
export const DEFAULT_STATUSES = ['scheduled', 'completed'];

@Component({
  selector: 'app-session-filters',
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    MultiSelectModule,
    ImeFilterInputComponent,
  ],
  templateUrl: './session-filters.component.html',
  styleUrl: './session-filters.component.scss',
})
export class SessionFiltersComponent {
  readonly listDateRange = input<Date[]>([]);

  readonly campuses = input<Campus[]>([]);
  readonly selectedCampusIds = input<string[]>([]);
  readonly activeFilterCount = input(0);
  readonly hasActiveFilters = input(false);

  readonly listDateRangeChange = output<Date[]>();
  readonly openAdvancedFilters = output<void>();
  readonly campusIdsChange = output<string[]>();
  readonly clearFilters = output<void>();

  // ── IME-aware filter queries ─────────────────────────────────────────────
  protected readonly campusFilterQuery = signal('');

  protected readonly filteredCampusOptions = computed(() =>
    matchesAll(this.campuses(), this.campusFilterQuery(), (c) => [c.name]),
  );

  protected onListDateRangeChange(range: Date[]): void {
    this.listDateRangeChange.emit(range);
  }

  protected onCampusMultiChange(ids: readonly (string | Campus)[]): void {
    this.campusIdsChange.emit(this.normalizeIdList(ids));
  }

  private toId(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.trim().length > 0 ? value : null;
    }
    if (
      value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof (value as { id: unknown }).id === 'string'
    ) {
      const id = (value as { id: string }).id.trim();
      return id.length > 0 ? id : null;
    }
    return null;
  }

  private normalizeIdList(values: readonly unknown[]): string[] {
    const ids = values.map((value) => this.toId(value)).filter((id): id is string => id !== null);
    return Array.from(new Set(ids));
  }
}

function matchesAll<T>(
  items: T[],
  query: string,
  fields: (item: T) => (string | null | undefined)[],
): T[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter((item) => fields(item).some((f) => f && f.toLowerCase().includes(q)));
}
