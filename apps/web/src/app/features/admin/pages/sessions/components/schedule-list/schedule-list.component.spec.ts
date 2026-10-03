import { TestBed } from '@angular/core/testing';
import type { Session } from '@core/sessions.service';
import { ScheduleListComponent } from './schedule-list.component';

describe('ScheduleListComponent —— 手機長按（#1174 G3）', () => {
  const s = {
    id: 's1',
    className: '數學A',
    sessionDate: '2026-10-07',
    startTime: '17:00',
    endTime: '18:00',
    teacherName: '林',
    status: 'scheduled',
    campusName: '總校',
  } as Session;

  function setup() {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(ScheduleListComponent);
    fixture.componentRef.setInput('groups', [{ start: '17:00', sessions: [s] }]);
    fixture.componentRef.setInput('now', new Date(2026, 9, 7, 9));
    fixture.detectChanges();
    const long = vi.fn();
    const menu = vi.fn();
    fixture.componentInstance.longPress.subscribe(long);
    fixture.componentInstance.menu.subscribe(menu);
    const main = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[aria-label$="看看能做什麼"]',
    )!;
    const press = (pointerType: string) =>
      main.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType }));
    return { main, press, long, menu };
  }

  afterEach(() => vi.useRealTimers());

  it('手指按住 500ms：勾起這堂；放開後那一下 click 不開選單', () => {
    const { main, press, long, menu } = setup();
    press('touch');
    vi.advanceTimersByTime(500);
    expect(long).toHaveBeenCalledWith('s1');
    main.click();
    expect(menu).not.toHaveBeenCalled();
    main.click(); // 下一次普通點按照常開選單
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('按不到 500ms 就放開、或捲動（pointercancel）：照常是點一下', () => {
    const { main, press, long, menu } = setup();
    press('touch');
    vi.advanceTimersByTime(300);
    main.dispatchEvent(new Event('pointercancel'));
    vi.advanceTimersByTime(500);
    expect(long).not.toHaveBeenCalled();
    main.click();
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('滑鼠沒有長按', () => {
    const { press, long } = setup();
    press('mouse');
    vi.advanceTimersByTime(1000);
    expect(long).not.toHaveBeenCalled();
  });
});
