import { ComponentFixture, TestBed } from '@angular/core/testing';

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

  it('renders a lightweight toolbar with filter button and clear button only（分校在頂欄，#1138 H2）', () => {
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
});
