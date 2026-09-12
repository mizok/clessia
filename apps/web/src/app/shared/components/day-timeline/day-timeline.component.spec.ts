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
    usesContactBook: false,
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

  /**
   * #686：停課的課堂被算進「未點名」。實機上兩堂課（一堂停課）時圖例寫「未點名 2」，
   * 而同一頁的橘帶說「其中 1 堂還沒點名」—— **同一頁兩個數字打架**。
   *
   * 單元測試抓不到這一條：它是在儀表板實機看才浮出來的，
   * 而修好儀表板那三處之後這一處仍然是錯的。
   */
  it('停課的課堂不算未點名，而且軸上說得出少了幾堂（#686）', async () => {
    const el = await render([
      session({ eventId: 'a', startTime: '09:00', endTime: '10:00' }),
      session({ eventId: 'b', startTime: '15:00', endTime: '16:00', status: 'cancelled' }),
    ]);

    expect(el.textContent).toContain('未點名 1');
    expect(el.textContent).not.toContain('未點名 2');
    // **軸上少的那一堂要說出來**，否則清單兩列、軸上一根，沒有人知道為什麼
    expect(el.textContent).toContain('另有 1 堂已停課');
  });

  // 尺度要說出來，否則只剩形狀、失去量級
  it('圖例講出當日最忙幾堂', async () => {
    const el = await render([
      session({ eventId: 'a', startTime: '09:00', endTime: '12:00' }),
      session({ eventId: 'b', startTime: '09:30', endTime: '12:00' }),
    ]);
    // #647：三個數字並列而量綱不同（已點名 N / 未點名 N 是**堂數**，
    // 最忙 N 是**同時堂數**）。加「同時」兩個字把量綱說清楚 ——
    // 使用者的困惑正是「多根柱子 vs 圖例說 1 堂」。
    expect(el.textContent).toContain('最忙同時 2 堂');
  });

  // 畫不出來的要說出來，不是默默對齊
  it('沒有開始時間的課不落任何一根，但在圖例裡講出來', async () => {
    const el = await render([
      session({ eventId: 'a' }),
      session({ eventId: 'ghost', startTime: null }),
    ]);
    expect(el.textContent).toContain('另有 1 堂未排定時間');
    expect(el.textContent).toContain('最忙同時 1 堂');
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

  /**
   * #647：一堂 90 分鐘的課跨 3 根，而柱與柱之間 2px 的縫讓它**讀起來像 3 件事** ——
   * 旁邊的圖例正好寫「1 堂」。實走量過：把 gap 設成 0 之後那 3 根合成一塊連續區塊。
   *
   * 這條盯的是「**相鄰的柱之間沒有間隙**」，不是某個特定的 gap 值。
   */
  it('柱與柱之間沒有間隙 —— 一堂課跨多根時要讀成一塊', async () => {
    const el = await render([session({ startTime: '17:00', endTime: '18:30' })]);
    const bar = el.querySelector<HTMLElement>('.day-timeline__bars');

    expect(bar).not.toBeNull();
    // jsdom 回的是 `'0'` 不是 `'0px'` —— 斷言「不是 2px 的縫」而不是某個字面值
    expect(['0', '0px', '']).toContain(getComputedStyle(bar as HTMLElement).gap);
  });

  /**
   * **這一項在今天的本機展示資料上驗不出來** —— 那天 `untaken` 全是 0。
   * 是用模擬（全部未點名）才撞到的：`--untaken` 是 `border: 2px` 的中空盒，
   * **有自己的左右框**，所以 gap 歸零之後未點名那段仍然一格一格。
   * 而未點名正是儀表板上最該被看見的狀態。
   *
   * 判準是「**前一根也有未點名**」而不是「前一根有沒有課」——
   * 一根可以「有課但未點名 = 0」，用後者的話 run 的第一根會被錯誤地拿掉左框
   * （CSS 兄弟選擇器只表達得出後者，所以這件事必須在元件裡算）。
   */
  it('相鄰的未點名柱要接成一段，不是一格一格', async () => {
    const el = await render([
      session({ eventId: 'a', startTime: '17:00', endTime: '18:30', takenAt: null }),
    ]);
    const joined = [...el.querySelectorAll('.day-timeline__seg--untaken')].map((seg) =>
      seg.classList.contains('day-timeline__seg--join-left'),
    );

    // 17:00 那根是 run 的第一根（前一根沒有未點名）→ 保留左框
    // 17:30 / 18:00 接在後面 → 去掉左框
    expect(joined.filter(Boolean)).toHaveLength(2);

    // **兩邊都要**：分隔線是兩條框疊起來的，只去左框的話線還在（實測過那個錯法）。
    // 3 根的 run → 前兩根要去右框。
    const joinedRight = [...el.querySelectorAll('.day-timeline__seg--untaken')].map((seg) =>
      seg.classList.contains('day-timeline__seg--join-right'),
    );
    expect(joinedRight.filter(Boolean)).toHaveLength(2);
  });

  /** 對照組：前一根「有課但未點名 = 0」時**不能**接 —— 那是 run 的開頭 */
  it('前一根有課但未點名為 0 時不接（run 的開頭要保留左框）', async () => {
    const el = await render([
      session({ eventId: 'a', startTime: '17:00', endTime: '17:30', takenAt: '2026-08-30T09:00:00Z' }),
      session({ eventId: 'b', startTime: '17:30', endTime: '18:00', takenAt: null }),
    ]);
    const joined = [...el.querySelectorAll('.day-timeline__seg--untaken')].map((seg) =>
      seg.classList.contains('day-timeline__seg--join-left'),
    );

    expect(joined.filter(Boolean)).toHaveLength(0);
  });
});
