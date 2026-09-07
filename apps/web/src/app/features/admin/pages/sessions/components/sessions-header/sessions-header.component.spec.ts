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

  /**
   * #640：預設狀態篩選會把已停課的課堂濾掉，而主畫面原本**零訊號** ——
   * 停完課那堂就消失，可用性測試席以為自己按錯了。
   */
  it('有課堂被狀態篩選隱藏時顯示可點的 badge', async () => {
    fixture.componentRef.setInput('hiddenCancelledCount', 7);
    await fixture.whenStable();

    const badge = fixture.nativeElement.querySelector('.sessions-header__badge--hidden');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('7');
    expect(badge.textContent).toContain('已隱藏');
  });

  /**
   * **對照組，而且它是那個 count 存在的理由**：沒有數字的話這顆 badge 只能永遠顯示，
   * 而永遠顯示的訊號多數時候在說一件沒發生的事，一週內就會被學會忽略。
   */
  it('沒有東西被隱藏時不顯示（不是永遠掛著）', async () => {
    fixture.componentRef.setInput('hiddenCancelledCount', 0);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.sessions-header__badge--hidden')).toBeNull();
  });

  it('點下去會發出 revealCancelled', async () => {
    fixture.componentRef.setInput('hiddenCancelledCount', 3);
    await fixture.whenStable();
    const spy = vi.fn();
    component.revealCancelled.subscribe(spy);

    fixture.nativeElement.querySelector('.sessions-header__badge--hidden').click();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
