import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EventSessionSummary } from '@core/attendance.service';
import { DayTimelineComponent } from './day-timeline.component';

function session(over: Partial<EventSessionSummary> = {}): EventSessionSummary {
  return {
    eventId: 'e1',
    sessionId: 's1',
    status: 'scheduled',
    isSubstitute: false,
    examCount: 0,
    classId: 'c1',
    className: '數學班 A',
    courseName: '數學 九年級',
    teacherName: '張品妍',
    campusId: null,
    campusName: null,
    eventDate: '2026-08-30',
    startTime: '09:00',
    endTime: '11:00',
    enrolledCount: 0,
    presentCount: 0,
    onLeaveCount: 0,
    absentCount: 0,
    takenAt: null,
    ...over,
  };
}

describe('DayTimelineComponent', () => {
  // configureTestingModule 只能在 TestBed 初始化前呼叫一次，所以放 beforeEach；
  // render 只負責建一個 fixture，這樣同一個 test 裡可以渲染兩次做比較。
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DayTimelineComponent] }).compileComponents();
  });

  async function render(sessions: EventSessionSummary[], date = '2026-08-30') {
    const fixture: ComponentFixture<DayTimelineComponent> =
      TestBed.createComponent(DayTimelineComponent);
    fixture.componentRef.setInput('sessions', sessions);
    fixture.componentRef.setInput('date', date);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function blocks(el: HTMLElement) {
    return [...el.querySelectorAll<HTMLElement>('.day-timeline__block')];
  }

  it('每一堂有時間的課都畫一個方塊', async () => {
    const el = await render([
      session({ eventId: 'a' }),
      session({ eventId: 'b', startTime: '14:00', endTime: '16:00' }),
    ]);
    expect(blocks(el)).toHaveLength(2);
  });

  it('沒有課時整條軸不渲染', async () => {
    const el = await render([]);
    expect(el.querySelector('.day-timeline')).toBeNull();
  });

  it('已點名是實心、未點名不是', async () => {
    const el = await render([
      session({ eventId: 'done', takenAt: '2026-08-30T02:00:00Z' }),
      session({ eventId: 'todo', startTime: '14:00', endTime: '16:00' }),
    ]);
    const taken = blocks(el).filter((b) => b.classList.contains('day-timeline__block--taken'));
    expect(taken).toHaveLength(1);
    expect(taken[0].getAttribute('aria-label')).toContain('已點名');
  });

  // 滑鼠看到的 tooltip 與螢幕閱讀器聽到的要是同一句
  it('方塊的 aria-label 與 title 一致且完整', async () => {
    const el = await render([session()]);
    const b = blocks(el)[0];
    const label = b.getAttribute('aria-label');
    expect(label).toBe('09:00–11:00 數學班 A · 張品妍 · 未點名');
    expect(b.getAttribute('title')).toBe(label);
  });

  // 沒有單堂路由，連到清單頁會是假的 affordance —— 方塊刻意不可互動
  it('方塊不是連結也不是按鈕', async () => {
    const el = await render([session()]);
    expect(el.querySelector('.day-timeline__block a, a .day-timeline__block')).toBeNull();
    expect(blocks(el)[0].tagName).toBe('SPAN');
  });

  it('同時段的課分成不同 lane，軌道跟著長高', async () => {
    const one = await render([session({ eventId: 'a' })]);
    const oneHeight = one.querySelector<HTMLElement>('.day-timeline__track')!.style.height;
    const two = await render([
      session({ eventId: 'a' }),
      session({ eventId: 'b', startTime: '10:00', endTime: '12:00' }),
    ]);
    const twoHeight = two.querySelector<HTMLElement>('.day-timeline__track')!.style.height;
    expect(parseInt(twoHeight, 10)).toBeGreaterThan(parseInt(oneHeight, 10));
  });

  // 畫不出來的要說出來，不是默默對齊
  it('沒有開始時間的課不畫，但在圖例裡講出來', async () => {
    const el = await render([session({ eventId: 'a' }), session({ eventId: 'ghost', startTime: null })]);
    expect(blocks(el)).toHaveLength(1);
    expect(el.textContent).toContain('另有 1 堂未排定時間');
  });

  it('全部都有時間時不會出現那句提醒', async () => {
    const el = await render([session()]);
    expect(el.textContent).not.toContain('未排定時間');
  });

  it('不是今天就不畫「現在」標記', async () => {
    const today = await render([session()], '2026-08-30');
    const other = await render([session()], '1999-01-01');
    // 今天的那條軸不保證有標記（要看此刻幾點），但別的日子一定沒有
    expect(other.querySelector('.day-timeline__now')).toBeNull();
    expect(today).toBeTruthy();
  });
});
