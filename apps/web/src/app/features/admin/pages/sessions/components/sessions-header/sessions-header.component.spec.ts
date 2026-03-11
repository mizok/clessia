import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionsHeaderComponent } from './sessions-header.component';

describe('SessionsHeaderComponent', () => {
  let component: SessionsHeaderComponent;
  let fixture: ComponentFixture<SessionsHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionsHeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionsHeaderComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not show badge when unassignedCount is 0', async () => {
    fixture.componentRef.setInput('unassignedCount', 0);
    await fixture.whenStable();
    const badge = fixture.nativeElement.querySelector('.sessions-header__badge');
    expect(badge).toBeNull();
  });

  it('should show badge with count when unassignedCount > 0', async () => {
    fixture.componentRef.setInput('unassignedCount', 5);
    await fixture.whenStable();
    const badge = fixture.nativeElement.querySelector('.sessions-header__badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toContain('5');
    expect(badge.textContent.trim()).toContain('堂未指派');
  });

  it('should emit filterUnassigned when badge is clicked', async () => {
    fixture.componentRef.setInput('unassignedCount', 3);
    await fixture.whenStable();

    const emitted: void[] = [];
    component.filterUnassigned.subscribe(() => emitted.push(undefined));

    const badge = fixture.nativeElement.querySelector('.sessions-header__badge');
    badge.click();

    expect(emitted).toHaveLength(1);
  });
});
