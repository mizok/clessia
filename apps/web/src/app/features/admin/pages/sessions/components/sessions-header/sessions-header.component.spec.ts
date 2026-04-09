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

  it('should not show badge when both counts are 0', async () => {
    fixture.componentRef.setInput('monthUnassignedCount', 0);
    fixture.componentRef.setInput('todayPendingAttendanceCount', 0);
    await fixture.whenStable();
    const badge = fixture.nativeElement.querySelector('.sessions-header__badge');
    expect(badge).toBeNull();
  });

  it('should show unassigned badge with count when monthUnassignedCount > 0', async () => {
    fixture.componentRef.setInput('monthUnassignedCount', 5);
    await fixture.whenStable();
    const badge = fixture.nativeElement.querySelector('.sessions-header__badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toContain('5');
    expect(badge.textContent.trim()).toContain('本月未指派');
  });

  it('should show pending attendance badge when todayPendingAttendanceCount > 0', async () => {
    fixture.componentRef.setInput('todayPendingAttendanceCount', 3);
    await fixture.whenStable();
    const badge = fixture.nativeElement.querySelector('.sessions-header__badge--attendance');
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toContain('3');
    expect(badge.textContent.trim()).toContain('今日未點名');
  });

  it('should emit filterUnassigned when unassigned badge is clicked', async () => {
    fixture.componentRef.setInput('monthUnassignedCount', 3);
    await fixture.whenStable();

    const emitted: void[] = [];
    component.filterUnassigned.subscribe(() => emitted.push(undefined));

    const badge = fixture.nativeElement.querySelector('.sessions-header__badge');
    badge.click();

    expect(emitted).toHaveLength(1);
  });

  it('should emit filterPendingAttendance when attendance badge is clicked', async () => {
    fixture.componentRef.setInput('todayPendingAttendanceCount', 2);
    await fixture.whenStable();

    const emitted: void[] = [];
    component.filterPendingAttendance.subscribe(() => emitted.push(undefined));

    const badge = fixture.nativeElement.querySelector('.sessions-header__badge--attendance');
    badge.click();

    expect(emitted).toHaveLength(1);
  });
});
