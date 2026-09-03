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

  function bars(el: HTMLElement) {
    return [...el.querySelectorAll<HTMLElement>('.day-timeline__bar')];
  }

  function heights(el: HTMLElement, modifier: 'taken' | 'untaken') {
    return [...el.querySelectorAll<HTMLElement>(`.day-timeline__seg--${modifier}`)].map(
      (seg) => parseFloat(seg.style.height) || 0,
    );
  }

  it('預設視窗畫 28 根（08–22，每半小時）', async () => {
    const el = await render([session()]);
    expect(bars(el)).toHaveLength(28);
  });

  /**
   * **這一條是換畫法的全部理由。** lane 式佈局每多一條就高 30px，實測 4 條時橘帶
   * 佔 48% 視窗、課表整段掉到摺線下。柱狀圖的高度必須與課量無關。
   */
  it('軌道高度不隨課量改變', async () => {
    const one = await render([session({ eventId: 'a' })]);
    const many = await render([
      session({ eventId: 'a', startTime: '09:00', endTime: '12:00' }),
      session({ eventId: 'b', startTime: '09:30', endTime: '12:00' }),
      session({ eventId: 'c', startTime: '10:00', endTime: '12:00' }),
      session({ eventId: 'd', startTime: '10:30', endTime: '12:00' }),
    ]);
    const heightOf = (el: HTMLElement) =>
      el.querySelector<HTMLElement>('.day-timeline__track')!.style.height;

    // 兩邊都不該用 inline height —— 高度由 SCSS 固定
    expect(heightOf(one)).toBe(heightOf(many));
  });

  it('沒有課時整條軸不渲染', async () => {
    const el = await render([]);
    expect(el.querySelector('.day-timeline')).toBeNull();
  });

  it('沒有任何一堂畫得出來時也不渲染', async () => {
    const el = await render([session({ startTime: null })]);
    expect(el.querySelector('.day-timeline')).toBeNull();
  });

  it('已點名與未點名分成兩段，各自有高度', async () => {
    const el = await render([
      session({ eventId: 'done', takenAt: '2026-08-30T02:00:00Z' }),
      session({ eventId: 'todo' }),
    ]);

    // 兩堂課時間完全重疊 → 那幾根各有一半實心一半中空
    expect(heights(el, 'taken').some((h) => h > 0)).toBe(true);
    expect(heights(el, 'untaken').some((h) => h > 0)).toBe(true);
  });

  // 滑鼠看到的 tooltip 與螢幕閱讀器聽到的要是同一句
  it('柱的 aria-label 講的是時段統計，與 title 一致', async () => {
    const el = await render([session()]);
    const nine = bars(el)[2]; // 08:00 起算的第 3 根 = 09:00
    const label = nine.getAttribute('aria-label');

    expect(label).toBe('09:00–09:30，1 堂課，其中 1 堂未點名');
    expect(nine.getAttribute('title')).toBe(label);
  });

  it('沒有課的時段也講得出來', async () => {
    const el = await render([session()]);
    expect(bars(el)[0].getAttribute('aria-label')).toBe('08:00–08:30，沒有課');
  });

  // 沒有單堂路由，連到清單頁會是假的 affordance —— 柱刻意不可互動
  it('柱不是連結也不是按鈕', async () => {
    const el = await render([session()]);
    expect(el.querySelector('.day-timeline__bar a, a .day-timeline__bar')).toBeNull();
    expect(bars(el)[0].tagName).toBe('SPAN');
  });

  // 尺度要說出來，否則只剩形狀、失去量級
  it('圖例講出當日最忙幾堂', async () => {
    const el = await render([
      session({ eventId: 'a', startTime: '09:00', endTime: '12:00' }),
      session({ eventId: 'b', startTime: '09:30', endTime: '12:00' }),
    ]);
    expect(el.textContent).toContain('最忙 2 堂');
  });

  // 畫不出來的要說出來，不是默默對齊
  it('沒有開始時間的課不落任何一根，但在圖例裡講出來', async () => {
    const el = await render([
      session({ eventId: 'a' }),
      session({ eventId: 'ghost', startTime: null }),
    ]);
    expect(el.textContent).toContain('另有 1 堂未排定時間');
    expect(el.textContent).toContain('最忙 1 堂');
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
