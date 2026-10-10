import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import { ParentSessionsService, type ParentSession } from '@core/parent-sessions.service';
import { SystemClockService } from '@core/system-clock.service';
import { ScheduleComponent } from './schedule.component';

const PAGE = {
  label: '課表查看',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

// 固定時鐘：2026-10-08（週四）台北 17:30。fixture 的日期都是這個鐘的相對值，不吃真實時間（#670）
const TODAY = '2026-10-08';
const NOW = Date.parse('2026-10-08T09:30:00Z');

function session(over: Partial<ParentSession>): ParentSession {
  return {
    sessionId: 's',
    date: TODAY,
    startTime: '17:00:00',
    endTime: '18:30:00',
    status: 'scheduled',
    classId: 'c1',
    className: '國三數學 B 班',
    courseName: '國中數學',
    campusName: '文山旗艦校',
    teacherName: '游佩珊',
    isSubstitute: false,
    originalTeacherName: null,
    examCount: 0,
    changes: [],
    attendance: null,
    ...over,
  };
}

const SESSIONS: ParentSession[] = [
  session({
    sessionId: 'wed',
    date: '2026-10-07',
    startTime: '19:00:00',
    endTime: '20:30:00',
    className: '國三自然 B 班',
    examCount: 1,
    attendance: { status: 'present', checkedInAt: '2026-10-07T08:52:00Z' },
  }),
  session({ sessionId: 'live' }),
  session({
    sessionId: 'fri',
    date: '2026-10-09',
    startTime: '19:00:00',
    endTime: '20:30:00',
    className: '國三英文 A 班',
    isSubstitute: true,
    teacherName: '蕭立恆',
    originalTeacherName: '簡志明',
    changes: [
      {
        changeType: 'substitute',
        originalDate: null,
        originalStartTime: null,
        originalEndTime: null,
        newDate: null,
        newStartTime: null,
        newEndTime: null,
      },
    ],
  }),
  session({
    sessionId: 'off',
    date: '2026-10-10',
    status: 'cancelled',
    className: '國三國文 A 班',
  }),
];

describe('家長端課表 ScheduleComponent', () => {
  let fixture: ComponentFixture<ScheduleComponent>;
  const activeChildId = signal('kid-1');
  const list = vi.fn((..._a: unknown[]) => of({ data: SESSIONS }));
  const homework = vi.fn((..._a: unknown[]) =>
    of({
      // 別班同一天的排最前面：只比日期不比班級的實作會先撈到它
      data: [
        { id: 'x', classId: 'other', className: '別班', logDate: TODAY, homework: '別班的作業' },
        {
          id: 'l1',
          classId: 'c1',
          className: '國三數學 B 班',
          logDate: TODAY,
          homework: '講義 p.42–45',
        },
        {
          id: 'l0',
          classId: 'c1',
          className: '國三數學 B 班',
          logDate: '2026-10-01',
          homework: '習作第 8 回',
        },
      ],
    }),
  );

  beforeEach(async () => {
    list.mockClear();
    homework.mockClear();
    // jsdom 沒有 <dialog>.showModal
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    activeChildId.set('kid-1');
    const child = { id: 'kid-1', name: '林子晴', grade: 'J3', school: null };
    const other = { id: 'kid-2', name: '王柏翰', grade: 'P5', school: null };
    await TestBed.configureTestingModule({
      imports: [ScheduleComponent],
      providers: [
        provideRouter([]),
        { provide: ParentSessionsService, useValue: { list, homework } },
        {
          provide: SystemClockService,
          useValue: { todayTaipei: signal(TODAY), nowEpochMs: signal(NOW) },
        },
        {
          provide: ChildScopeService,
          useValue: {
            children: signal([child, other]),
            status: signal('ready'),
            activeChildId,
            activeChild: computed(() => (activeChildId() === 'kid-1' ? child : other)),
            loading: signal(false),
            canSwitch: signal(true),
            load: vi.fn(),
            setActiveChild: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ScheduleComponent);
    fixture.componentRef.setInput('page', PAGE);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const host = () => fixture.nativeElement as HTMLElement;
  const cards = () => [...host().querySelectorAll<HTMLElement>('[data-part="session"]')];
  const card = (phase: string) => cards().find((c) => c.dataset['phase'] === phase)!;

  it('開頁查本週＋下週（週一到下下週日），帶孩子 id', () => {
    expect(list).toHaveBeenCalledWith('kid-1', '2026-10-05', '2026-10-18');
  });

  it('開場句：上課中就寫「正在上」那班，並寫幾點下課、本週幾堂（停課不算）', () => {
    const title = host().querySelector('h1')!.textContent!.replace(/\s+/g, ' ');
    expect(title).toContain('林子晴 正在上');
    expect(title).toContain('國三數學 B 班。');
    // 本週：週三、週四（上課中）、週五，停課的週六不算 → 3 堂
    expect(host().textContent).toContain('18:30 下課 · 本週 3 堂');
  });

  it('週曆七天都在；卡片依狀態標記：上課中、代課、小考、停課（刪除線）', () => {
    expect(host().querySelectorAll('[data-part="day"]')).toHaveLength(7);
    expect(card('live').textContent).toContain('上課中');
    const fri = cards().find((c) => c.textContent?.includes('國三英文 A 班'))!;
    expect(fri.textContent).toContain('代課');
    const wed = cards().find((c) => c.textContent?.includes('國三自然 B 班'))!;
    expect(wed.textContent).toContain('小考');
    expect(card('off').querySelector('.line-through')).not.toBeNull();
  });

  it('下一週：只查那一週（週一到週日）；回本週重查本週＋下週、週標籤寫（本週）', () => {
    (host().querySelector('[aria-label="下一週"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(list).toHaveBeenLastCalledWith('kid-1', '2026-10-12', '2026-10-18');
    expect(host().querySelector('[data-part="week-label"]')!.textContent).toContain('10/12～10/18');
    expect(host().querySelector('[data-part="week-label"]')!.textContent).not.toContain('本週');
    [...host().querySelectorAll('button')].find((b) => b.textContent?.includes('回本週'))!.click();
    fixture.detectChanges();
    expect(list).toHaveBeenLastCalledWith('kid-1', '2026-10-05', '2026-10-18');
    expect(host().querySelector('[data-part="week-label"]')!.textContent).toContain('（本週）');
  });

  it('沒有任何課的一週：寫「這週沒有課」，不是七個「沒課」', async () => {
    list.mockReturnValueOnce(of({ data: [] }));
    (host().querySelector('[aria-label="下一週"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host().querySelector('[data-part="week-empty"]')!.textContent).toContain('這週沒有課');
    expect(host().querySelectorAll('[data-part="day"]')).toHaveLength(0);
  });

  it('點已上過的課：詳情寫到班時間（台北）、這堂的作業只取同班同日、之前的作業照日期倒序', () => {
    const wed = cards().find((c) => c.textContent?.includes('國三自然 B 班'))!;
    wed.click();
    fixture.detectChanges();
    expect(host().querySelector('[data-part="attendance"]')!.textContent).toContain(
      '到了 · 16:52 到班',
    );
    expect(host().querySelector('[data-part="exam"]')!.textContent).toContain('這天有 1 場小考');
    expect(homework).toHaveBeenCalled();

    // 上課中那堂：作業取 c1＋今天，不拿到別班同一天的
    card('live').click();
    fixture.detectChanges();
    const hw = host().querySelector('[data-part="homework"]')!.textContent!;
    expect(hw).toContain('講義 p.42–45');
    expect(hw).not.toContain('別班的作業');
    expect(host().querySelector('[data-part="homework-history"]')!.textContent).toContain(
      '習作第 8 回',
    );
  });

  it('還沒上的課與停課：不顯示作業區、不去查作業；代課寫原任課老師；停課寫「不用到班」', () => {
    homework.mockClear();
    cards()
      .find((c) => c.textContent?.includes('國三英文 A 班'))!
      .click();
    fixture.detectChanges();
    expect(host().querySelector('[data-part="homework"]')).toBeNull();
    expect(host().querySelector('dialog')!.textContent).toContain('代課，原任課 簡志明');
    expect(host().querySelector('[data-part="changes"]')!.textContent).toContain(
      '本堂由 蕭立恆 老師代課',
    );
    card('off').click();
    fixture.detectChanges();
    expect(host().querySelector('[data-part="attendance"]')!.textContent).toContain(
      '停課，不用到班',
    );
    expect(homework).not.toHaveBeenCalled();
  });

  // 這兩條是 #1523 讀 diff 抓到的：回應要綁孩子／週，不能「後回來的就贏」
  describe('切孩子、切週的資料歸屬', () => {
    const flush = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('在別週切孩子：Hero 不能留著前一個孩子的「下一堂」，等新孩子的資料回來才換', async () => {
      list.mockReturnValueOnce(
        of({
          data: [session({ sessionId: 'k1w2', date: '2026-10-13', className: '林子晴的第二週課' })],
        }) as never,
      );
      (host().querySelector('[aria-label="下一週"]') as HTMLButtonElement).click();
      await flush();
      expect(host().querySelector('h1')!.textContent).toContain('林子晴 正在上');
      expect(host().textContent).toContain('林子晴的第二週課');

      const heroOfKid2 = new Subject<{ data: ParentSession[] }>();
      list.mockImplementation(((childId: string, from: string) =>
        childId === 'kid-2' && from === '2026-10-05' ? heroOfKid2 : of({ data: [] })) as never);
      activeChildId.set('kid-2');
      await flush();

      const title = host().querySelector('h1')!.textContent!;
      // 新孩子的本週資料還沒回來：不能把「還沒讀到」說成「沒有課」，也不能留著舊孩子的標題
      expect(title).toContain('王柏翰');
      expect(title).toContain('載入中');
      expect(title).not.toContain('沒有課');
      expect(host().querySelector('h1 + p')!.textContent!.trim()).toBe('');
      // 標題不能還是林子晴那一班
      expect(title).not.toContain('國三數學 B 班');
      expect(title).not.toContain('林子晴');
      expect(host().textContent).not.toContain('林子晴的第二週課'); // 週曆也不能留著舊孩子的課

      heroOfKid2.next({
        data: [session({ sessionId: 'k2', className: '國小英文班', classId: 'c9' })],
      });
      heroOfKid2.complete(); // HTTP 回應會自己 complete；forkJoin 等它
      await flush();
      expect(host().querySelector('h1')!.textContent).toContain('王柏翰 正在上');
    });

    it('連按下一週：先送出的慢回應晚到，不能蓋掉最後選的那一週', async () => {
      const slow = new Subject<{ data: ParentSession[] }>();
      const fast = new Subject<{ data: ParentSession[] }>();
      list.mockReset();
      list.mockReturnValueOnce(slow as never).mockReturnValueOnce(fast as never);
      const next = host().querySelector('[aria-label="下一週"]') as HTMLButtonElement;
      next.click();
      await flush();
      next.click();
      await flush();
      expect(host().querySelector('[data-part="week-label"]')!.textContent).toContain(
        '10/19～10/25',
      );

      fast.next({
        data: [session({ sessionId: 'w3', date: '2026-10-20', className: '第三週的課' })],
      });
      fast.complete();
      slow.next({
        data: [session({ sessionId: 'w2', date: '2026-10-13', className: '第二週的課' })],
      });
      slow.complete();
      await flush();
      expect(host().textContent).toContain('第三週的課');
      expect(host().textContent).not.toContain('第二週的課');
    });

    it('再翻到沒回來的下一週：畫面不能還顯示上一週的課', async () => {
      list.mockReset();
      list.mockReturnValueOnce(
        of({
          data: [session({ sessionId: 'w2', date: '2026-10-13', className: '第二週的課' })],
        }) as never,
      );
      const next = host().querySelector('[aria-label="下一週"]') as HTMLButtonElement;
      next.click();
      await flush();
      expect(host().textContent).toContain('第二週的課');

      list.mockReturnValueOnce(new Subject() as never); // 第三週還沒回來
      next.click();
      await flush();
      expect(host().textContent).not.toContain('第二週的課');
    });

    it('讀取失敗：標題不寫「載入中」也不寫「沒有課」（兩個都是假話），body 有失敗訊息', async () => {
      list.mockImplementation((() => throwError(() => new Error('boom'))) as never);
      activeChildId.set('kid-2');
      await flush();
      const title = host().querySelector('h1')!.textContent!;
      expect(title).toContain('王柏翰');
      expect(title).not.toContain('載入中');
      expect(title).not.toContain('沒有課');
      expect(host().textContent).toContain('載入失敗');
    });
  });
});
