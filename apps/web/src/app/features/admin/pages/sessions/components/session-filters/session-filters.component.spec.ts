import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Campus } from '@core/campuses.service';

import { SessionFiltersComponent } from './session-filters.component';

describe('SessionFiltersComponent', () => {
  let component: SessionFiltersComponent;
  let fixture: ComponentFixture<SessionFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionFiltersComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionFiltersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a lightweight toolbar with date, campus, filter button, and clear button only', () => {
    fixture.componentRef.setInput('campuses', [
      buildCampus({ id: 'campus-1', name: '中正分校' }),
      buildCampus({ id: 'campus-2', name: '大安分校' }),
    ]);
    fixture.componentRef.setInput('selectedCampusIds', ['campus-1']);
    fixture.componentRef.setInput('activeFilterCount', 3);
    fixture.componentRef.setInput('hasActiveFilters', true);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('進階篩選');
    expect(text).toContain('清除篩選');
    expect(text).not.toContain('所有課程');
    expect(text).not.toContain('所有老師');
    expect(text).not.toContain('所有班級');
    expect(text).not.toContain('課堂狀態');
  });

  it('emits openAdvancedFilters when filter button is clicked', () => {
    let openCount = 0;
    component.openAdvancedFilters.subscribe(() => {
      openCount += 1;
    });

    fixture.componentRef.setInput('activeFilterCount', 2);
    fixture.detectChanges();

    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((element) =>
      (element as HTMLButtonElement).textContent?.includes('進階篩選'),
    ) as HTMLButtonElement | undefined;

    button?.click();

    expect(openCount).toBe(1);
  });

  it('emits normalized campus ids from multi-select values', () => {
    let emitted: string[] = [];
    component.campusIdsChange.subscribe((value: string[]) => {
      emitted = value;
    });

    (
      component as unknown as {
        onCampusMultiChange: (values: readonly (string | Campus)[]) => void;
      }
    ).onCampusMultiChange([
      'campus-1',
      buildCampus({ id: 'campus-2', name: '大安分校' }),
      buildCampus({ id: 'campus-1', name: '中正分校' }),
    ]);

    expect(emitted).toEqual(['campus-1', 'campus-2']);
  });
});

function buildCampus(overrides: Partial<Campus>): Campus {
  return {
    id: 'campus-default',
    orgId: 'org-1',
    name: '示範分校',
    address: null,
    phone: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
