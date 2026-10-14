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

  // #1314：日／週檢視的進階篩選收進頁面工具列的「⋯」，這裡只剩清除；結果模式才有自己的鈕
  it('日／週檢視（showDateRange=false）沒有任何篩選鈕，有篩選時仍有「清除篩選」', () => {
    fixture.componentRef.setInput('showDateRange', false);
    fixture.componentRef.setInput('activeFilterCount', 2);
    fixture.componentRef.setInput('hasActiveFilters', false);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('進階篩選');
    expect(el.textContent).not.toContain('篩選');
    expect(el.querySelectorAll('button').length).toBe(0);

    fixture.componentRef.setInput('hasActiveFilters', true);
    fixture.detectChanges();
    expect(el.textContent).toContain('清除篩選');
    expect(el.textContent).not.toContain('進階篩選');
  });

  it('結果模式（showDateRange=true）：手機「篩選」與桌機「進階篩選」都在', () => {
    fixture.componentRef.setInput('showDateRange', true);
    fixture.detectChanges();
    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => b.textContent?.replace(/\s+/g, ''));
    expect(labels).toContain('篩選');
    expect(labels).toContain('進階篩選');
  });
});
