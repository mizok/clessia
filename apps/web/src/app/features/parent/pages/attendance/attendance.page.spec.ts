import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentAttendanceService,
  type ParentAttendanceDayRow,
  type ParentAttendanceDaysResponse,
} from '@core/parent-attendance.service';
import { SystemClockService, taipeiDateString } from '@core/system-clock.service';
import { ParentSessionsService, type ParentSession } from '@core/parent-sessions.service';
import { AttendancePage } from './attendance.page';

const PAGE = {
  label: '出缺席',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

function emptyResponse(): ParentAttendanceDaysResponse {
  return {
    data: [],
    meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
  };
}

/**
 * fixture 的日期一律相對今天算（#670）。
 *
 * 寫死的日期會在某一天掉出頁面預設的「近 10 天」——`buildDays` 是**用日期窗口
 * 重建整份列表**，窗外的紀錄不是排在後面，是整筆消失。於是測試在一個跟程式碼無關的
 * 時刻自己變紅，而下一個碰它的人看到的是「我的 PR 弄壞了測試」。
 *
 * 用本地時間欄位而不是 `toISOString()`：頁面的範圍計算走 date-fns 的本地時區，
 * UTC 會在台北凌晨差一天。
 */
/**
 * 假「現在」：台北 12:00（#1810 起頁面的今天與現在都來自 `SystemClockService`）。
 * 取執行當天的台北日期，所以日期仍是相對的（不會掉出近 10 天）；時刻固定在中午，
 * 「還沒上／上課中／沒有紀錄」的斷言才不會隨跑測試的時刻變。
 */
const FAKE_TODAY = taipeiDateString(Date.now());
const FAKE_NOW_MS = Date.parse(`${FAKE_TODAY}T04:00:00Z`);

function daysAgoIso(days: number): string {
  const d = new Date(`${FAKE_TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function record(overrides: Partial<ParentAttendanceDayRow> = {}): ParentAttendanceDayRow {
  return {
    id: 'r1',
    sessionId: 'r1',
    eventId: 'e1',
    eventDate: daysAgoIso(0),
    startTime: '09:00',
    endTime: '10:00',
    campusId: 'daily',
    campusName: '台北校',
    className: '數學班',
    sessionStatus: 'scheduled',
    status: 'present',
    note: null,
    leaveSubmittedBy: null,
    leaveReason: null,
    derived: null,
    teacherName: null,
    classroomName: null,
    ...overrides,
  };
}

describe('AttendancePage', () => {
  let fixture: ComponentFixture<AttendancePage>;
  let listMock: ReturnType<typeof vi.fn>;
  let activeChildId: ReturnType<typeof signal<string | null>>;
  let childScopeLoad: ReturnType<typeof vi.fn>;
  let activeChild: ReturnType<typeof signal<{ id: string; name: string } | null>>;
  let createLeaveMock: ReturnType<typeof vi.fn>;
  let checkinsMock: ReturnType<typeof vi.fn>;
  let todayMock: ReturnType<typeof vi.fn>;
  let toastMock: ReturnType<typeof vi.fn>;

  // jsdom 沒有 <dialog> 的 modal 行為：只補開關狀態與 close 事件（照 notifications.component.spec）
  const dialogProto = HTMLDialogElement.prototype;
  const originalDialog = { showModal: dialogProto.showModal, close: dialogProto.close };
  beforeEach(() => {
    dialogProto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  });
  afterEach(() => Object.assign(dialogProto, originalDialog));

  function createComponent(
    response: ParentAttendanceDaysResponse | (() => never) = emptyResponse(),
  ) {
    activeChildId = signal<string | null>(null);
    activeChild = signal<{ id: string; name: string } | null>(null);
    createLeaveMock = vi.fn(() => of({ data: { id: 'leave-1' } }));
    checkinsMock = vi.fn(() => of({ data: [], dailyCheckinCampusIds: ['daily'] }));
    todayMock = vi.fn(() => of({ data: [] as ParentSession[] }));
    toastMock = vi.fn();
    childScopeLoad = vi.fn();
    listMock = vi.fn(() =>
      typeof response === 'function' ? throwError(() => new Error('boom')) : of(response),
    );

    TestBed.configureTestingModule({
      imports: [AttendancePage],
      providers: [
        {
          provide: ChildScopeService,
          useValue: {
            activeChildId: activeChildId.asReadonly(),
            // **不能留 `[]`**：`activeChildId` 只會從 `children[0]` 來，
            // 所以「0 個孩子卻有 activeChildId」是現實中不存在的狀態，
            // 而 `app-child-scope-gate`（#749）會把它擋掉。
            children: () => [{ id: 'child-1', name: '測試孩子' }],
            activeChild: activeChild.asReadonly(),
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: childScopeLoad,
          },
        },
        {
          provide: ParentAttendanceService,
          useValue: { days: listMock, createLeave: createLeaveMock, checkins: checkinsMock },
        },
        { provide: ParentSessionsService, useValue: { list: todayMock } },
        { provide: SystemClockService, useValue: { nowEpochMs: () => FAKE_NOW_MS } },
        { provide: MessageService, useValue: { add: toastMock } },
        // 共用請假表單注入的管理端 service（嵌入時不會打）要有 HttpClient 才建得起來
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    fixture = TestBed.createComponent(AttendancePage);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as {
      onRangeChange: (mode: 'recent10' | 'recent30' | 'month') => void;
    };
  }

  /**
   * #1978：快速 A→B→A，B 的回應比第二次 A 晚回來 —— 畫面停在 A，不能顯示 B 的到班紀錄。
   * 每次呼叫各給一個 Subject，自己決定誰先回。
   */
  it('#1978 換孩子 A→B→A，B 晚到的回應不蓋掉現在的 A', () => {
    createComponent();
    const pending: Subject<ParentAttendanceDaysResponse>[] = [];
    listMock.mockImplementation(() => {
      const s = new Subject<ParentAttendanceDaysResponse>();
      pending.push(s);
      return s.asObservable();
    });
    for (const id of ['child-a', 'child-b', 'child-a']) {
      activeChildId.set(id);
      fixture.detectChanges();
    }
    expect(pending.length).toBe(3);

    const forA = { ...emptyResponse(), data: [record()] };
    pending[2].next(forA);
    pending[2].complete();
    pending[1].next({ ...emptyResponse(), data: [record(), record()] }); // B 晚到
    pending[1].complete();
    fixture.detectChanges();

    const comp = fixture.componentInstance as unknown as { records: () => unknown };
    expect(comp.records()).toBe(forA.data);
  });

  it('進頁呼叫 childScope.load()', () => {
    createComponent();
    expect(childScopeLoad).toHaveBeenCalledTimes(1);
  });

  it('沒有 activeChildId 時不打 API', () => {
    createComponent();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('activeChildId 出現後打 API：近 10 天＝含今天往前 10 天；到班時間同一段、今天的堂只查今天', () => {
    createComponent();
    activeChildId.set('child-1');
    fixture.detectChanges();

    // #1810：一支查完整個窗（不分頁），查詢的窗就是畫天數的窗
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith('child-1', daysAgoIso(9), daysAgoIso(0));
    expect(checkinsMock).toHaveBeenCalledWith('child-1', daysAgoIso(9), daysAgoIso(0));
    expect(todayMock).toHaveBeenCalledWith('child-1', daysAgoIso(0), daysAgoIso(0));
  });

  // 設計稿 §6 不變式：窗內回來的每一列都畫得出來（列數＝各天加總），沒有列被 buildDays 丟掉
  it('回來的每一列都落在某一天：畫出的列數＝回來的列數', () => {
    const rows = [0, 1, 4, 9].map((n) => record({ id: `r${n}`, eventDate: daysAgoIso(n) }));
    createComponent({ data: rows, meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 } });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.attendance__record').length).toBe(rows.length);
  });

  it('換孩子會重新查', () => {
    createComponent();
    activeChildId.set('child-1');
    fixture.detectChanges();
    listMock.mockClear();

    activeChildId.set('child-2');
    fixture.detectChanges();

    expect(listMock).toHaveBeenCalledWith('child-2', expect.any(String), expect.any(String));
  });

  it('一天一章，日期新到舊', () => {
    const newer = daysAgoIso(3);
    const older = daysAgoIso(12); // 近 30 天先畫 14 天，要落在裡面
    const comp = createComponent({
      // 刻意**舊的餵在前面** —— 照順序餵的話插入順序就已經是期望值
      data: [
        record({ id: 'r2', eventDate: older, status: 'absent', className: '英文班' }),
        record({ id: 'r1', eventDate: newer }),
      ],
      meta: { monthlyAbsentCount: 1, monthlyOnLeaveCount: 0 },
    });
    comp.onRangeChange('recent30');
    activeChildId.set('child-1');
    fixture.detectChanges();

    const dates = fixture.nativeElement.querySelectorAll('.attendance__day[data-date]');
    expect(Array.from(dates).map((el: unknown) => (el as HTMLElement).dataset['date'])).toEqual([
      newer,
      older,
    ]);
  });

  it('期間內每一天都有一章：沒紀錄的日子一行「今日無課」——避免跟載入失敗混淆', () => {
    createComponent({
      data: [record({ id: 'r1', eventDate: daysAgoIso(0) })],
      meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    // 近 10 天含今天，只有 1 天有紀錄，其餘 9 天都是「今日無課」
    const noClass = fixture.nativeElement.querySelectorAll('.attendance__day--empty');
    expect(noClass.length).toBe(9);
    expect(fixture.nativeElement.querySelector('.attendance__count').textContent).toContain(
      '共 10 天',
    );
  });

  describe('每日到班（#1075）', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const arrival = () => el().querySelector('.attendance__arrival')?.textContent?.trim();

    it('日到班分校的課：有刷卡寫「HH:mm 到班」', () => {
      createComponent({
        data: [record({ eventDate: daysAgoIso(1) })],
        meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
      });
      checkinsMock.mockReturnValue(
        of({ data: [{ date: daysAgoIso(1), time: '16:42' }], dailyCheckinCampusIds: ['daily'] }),
      );
      activeChildId.set('child-1');
      fixture.detectChanges();

      expect(arrival()).toBe('16:42 到班');
    });

    it('隨堂點名分校的課沒有到班行；到班時間讀失敗也照樣列出紀錄', () => {
      createComponent({
        data: [record({ eventDate: daysAgoIso(1), campusId: 'per-session' })],
        meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
      });
      activeChildId.set('child-1');
      fixture.detectChanges();
      expect(arrival()).toBeUndefined();

      checkinsMock.mockReturnValue(throwError(() => new Error('boom')));
      (el().querySelector('[aria-pressed="false"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el().textContent).not.toContain('載入失敗');
      expect(el().querySelectorAll('.attendance__record').length).toBe(1);
    });

    it('色面：孩子今天到了沒；副行只在有日到班分校時出現', () => {
      createComponent();
      activeChild.set({ id: 'child-1', name: '林子晴' });
      checkinsMock.mockReturnValue(
        of({ data: [{ date: daysAgoIso(0), time: '16:41' }], dailyCheckinCampusIds: ['daily'] }),
      );
      todayMock.mockReturnValue(
        of({
          data: [{ campusId: 'daily', startTime: '17:00', status: 'scheduled', attendance: null }],
        }),
      );
      activeChildId.set('child-1');
      fixture.detectChanges();

      const open = el().querySelector('app-page-open')!.textContent!;
      expect(open).toContain('林子晴');
      expect(open).toContain('今天 16:41 到班。');
      expect(open).toContain('日到班：刷卡一次，當天所有的課都算到了。');
    });

    it('今天的課都在隨堂點名分校：標題退回頁名、沒有副行', () => {
      createComponent();
      activeChild.set({ id: 'child-1', name: '林子晴' });
      checkinsMock.mockReturnValue(of({ data: [], dailyCheckinCampusIds: [] }));
      todayMock.mockReturnValue(
        of({
          data: [{ campusId: 'x', startTime: '17:00', status: 'scheduled', attendance: null }],
        }),
      );
      activeChildId.set('child-1');
      fixture.detectChanges();

      const open = el().querySelector('app-page-open')!.textContent!;
      expect(open).toContain('出缺席');
      expect(open).not.toContain('日到班');
    });

    it('近 30 天一次畫 14 天，「載入更多（還有 N 天）」再多 14 天', () => {
      const comp = createComponent();
      comp.onRangeChange('recent30');
      activeChildId.set('child-1');
      fixture.detectChanges();

      expect(el().querySelectorAll('.attendance__day').length).toBe(14);
      const more = el().querySelector('.attendance__load-more') as HTMLButtonElement;
      expect(more.textContent).toContain('還有 16 天');
      more.click();
      fixture.detectChanges();
      expect(el().querySelectorAll('.attendance__day').length).toBe(28);
    });
  });

  it('點課堂列內展開，再點一次收合', () => {
    createComponent({
      data: [record({ note: '準時到班' })],
      meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.attendance__record-detail')).toBeNull();

    (fixture.nativeElement.querySelector('.attendance__record') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.attendance__record-detail')?.textContent,
    ).toContain('準時到班');

    (fixture.nativeElement.querySelector('.attendance__record') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.attendance__record-detail')).toBeNull();
  });

  // #1695 第 4 張（設計稿 §5，計畫席 10-19 裁 (A)）
  it.each([
    ['parent', '看牙醫', '請假：看牙醫（家長送出）'],
    ['parent', null, '請假（家長送出）'],
    ['school', null, '請假（補習班登記）'],
  ] as const)('展開請假的堂：%s／%s →「%s」', (by, reason, text) => {
    createComponent({
      data: [
        record({
          status: 'on_leave',
          startTime: null,
          endTime: null,
          leaveSubmittedBy: by,
          leaveReason: reason,
        }),
      ],
      meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 1 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.attendance__record') as HTMLButtonElement).click();
    fixture.detectChanges();
    const detail = fixture.nativeElement.querySelector('.attendance__record-detail') as HTMLElement;
    expect(detail.textContent!.replace(/\s+/g, '')).toContain(text);
  });

  it('載入失敗顯示失敗狀態', () => {
    createComponent((() => {
      throw new Error('unused');
    }) as unknown as ParentAttendanceDaysResponse);
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
  it('錨點顯示本月缺席數，不把請假算進去', () => {
    createComponent({
      data: [record()],
      meta: { monthlyAbsentCount: 2, monthlyOnLeaveCount: 5 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    // 取數字那一格（dd）而不是整塊的 textContent —— 只比對那個數字本身，
    // 合計（7）會讓這條直接不等，不用靠「不包含 7」這種鈍的斷言
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="absent-stat"] dd')
        ?.textContent?.replace(/\s+/g, ''),
    ).toBe('2次');
  });

  it('錨點文案標明「本月」——列表區間可以不是本月，數字卻永遠是本月', () => {
    const comp = createComponent({
      data: [record()],
      meta: { monthlyAbsentCount: 3, monthlyOnLeaveCount: 0 },
    });
    comp.onRangeChange('recent30');
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="absent-stat"]').textContent,
    ).toContain('本月');
  });

  it('缺席 0 次照樣顯示錨點——0 是好消息，不是沒有資料', () => {
    createComponent({
      data: [record()],
      meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(
      fixture.nativeElement
        .querySelector('[data-testid="absent-stat"] dd')
        ?.textContent?.replace(/\s+/g, ''),
    ).toBe('0次');
  });

  it('載入成功後再失敗，錨點要收回去——留著舊數字等於用失敗換來一則好消息', () => {
    // 先成功載到一個真數字，錨點才有東西可以「留著」——
    // 第一次就失敗的話 monthlyAbsent 本來就是 null，那樣寫的測試對守衛沒有辨識力
    const comp = createComponent({
      data: [record()],
      meta: { monthlyAbsentCount: 4, monthlyOnLeaveCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="absent-stat"] dd')
        ?.textContent?.replace(/\s+/g, ''),
    ).toBe('4次');

    listMock.mockImplementation(() => throwError(() => new Error('boom')));
    comp.onRangeChange('recent30');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="absent-stat"]')).toBeNull();
  });

  it('還沒載到資料時不顯示錨點', () => {
    createComponent();
    expect(fixture.nativeElement.querySelector('[data-testid="absent-stat"]')).toBeNull();
  });
  describe('停課的課堂要標出來（#502）', () => {
    it('停課仍然掛著請假時，兩件事都說得出來', () => {
      createComponent({
        data: [record({ status: 'on_leave', sessionStatus: 'cancelled', className: '數學班' })],
        meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 1 },
      });
      activeChildId.set('child-1');
      fixture.detectChanges();

      // 列上照 A6 寫「停課」；展開裡仍說得出那一筆是一次請假（課後來停了）
      expect(fixture.nativeElement.querySelector('.attendance__status').textContent).toContain(
        '停課',
      );
      (fixture.nativeElement.querySelector('.attendance__record') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('.attendance__record-detail').textContent,
      ).toContain('請假');
    });

    it('正常的課堂不長出 chip', () => {
      createComponent({
        data: [record({ sessionStatus: 'scheduled' })],
        meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
      });
      activeChildId.set('child-1');
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('停課');
      expect(fixture.nativeElement.textContent).not.toContain('非課堂');
    });

    it('沒有課堂的紀錄標成「非課堂」—— 不能跟正常的課長得一樣', () => {
      createComponent({
        data: [record({ sessionStatus: null, className: null })],
        meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
      });
      activeChildId.set('child-1');
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('非課堂');
      expect(fixture.nativeElement.textContent).not.toContain('停課');
    });
  });

  /**
   * #749：**接線測試。** `app-child-scope-gate` 的規則與措辭有自己的測試，
   * 但那不代表這一頁真的包了它 —— **元件寫好了不等於接上了**。
   *
   * 斷言的是「頁面內容在 gate **裡面**」而不只是「gate 存在」：
   * 放一個空的 gate 在旁邊也會讓後者通過，而那什麼都擋不住。
   */
  it('頁面內容包在 app-child-scope-gate 裡（#749）', () => {
    createComponent();
    fixture.detectChanges();

    const gate = fixture.nativeElement.querySelector('app-child-scope-gate');

    expect(gate).toBeTruthy();
    expect(gate.querySelector('.attendance__content')).toBeTruthy();
  });

  /**
   * **#797：預設模式下 skeleton 分支結構性不可達。**
   *
   * 當時守衛是 `loading() && groups().length === 0`，而 `groups` 在 `recent10`（預設）
   * 會走 `fillMissingDays` —— **`records()` 還是空陣列時它就已經填出 11 天**，
   * 於是 `groups().length === 0` 永遠不成立。使用者在慢速網路上看到的是
   * **十一行「今日無課」**，而那是一句正面斷言：「這十一天都沒課」。
   *
   * 對照組 `parent/payments` 的守衛判的是**原始清單**（`invoices()`），所以它的
   * skeleton 出得來 —— 兩頁模板讀起來一模一樣，差別只在守衛裡那個 signal。
   *
   * 斷言照工單的狀態表：延遲中 `records().length === 0`（現在的 `days()` 同樣在空清單時就排滿整段期間，守衛照樣判 `records()`）。
   */
  it('載入中（原始清單還是空的）要渲染 skeleton，不能謊稱「今日無課」', () => {
    const pending = new Subject<ParentAttendanceDaysResponse>();
    activeChildId = signal<string | null>(null);
    childScopeLoad = vi.fn();
    listMock = vi.fn(() => pending.asObservable());

    TestBed.configureTestingModule({
      imports: [AttendancePage],
      providers: [
        {
          provide: ChildScopeService,
          useValue: {
            activeChildId: activeChildId.asReadonly(),
            children: () => [{ id: 'child-1', name: '測試孩子' }],
            activeChild: () => null,
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: childScopeLoad,
          },
        },
        {
          provide: ParentAttendanceService,
          useValue: {
            days: listMock,
            checkins: () => of({ data: [], dailyCheckinCampusIds: [] }),
          },
        },
        { provide: ParentSessionsService, useValue: { list: () => of({ data: [] }) } },
        { provide: SystemClockService, useValue: { nowEpochMs: () => FAKE_NOW_MS } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(AttendancePage);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();

    activeChildId.set('child-1');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.skeleton-list').length, '載入中要有 skeleton').toBe(1);
    expect(host.textContent ?? '').not.toContain('今日無課');

    // 資料回來之後才換成真的列
    pending.next(emptyResponse());
    pending.complete();
    fixture.detectChanges();
    expect(host.querySelectorAll('.skeleton-list').length).toBe(0);
  });
  // #1695 第 3 張：A6 p-attendance 的「幫孩子請假」
  describe('幫孩子請假', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const leaveButton = () =>
      [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('幫孩子請假'));

    function withChild() {
      createComponent();
      activeChild.set({ id: 'child-1', name: '測試孩子' });
      activeChildId.set('child-1');
      fixture.detectChanges();
    }

    it('沒有選中的孩子時不出現；有就出現在工具列', () => {
      createComponent();
      expect(leaveButton()).toBeUndefined();
      activeChild.set({ id: 'child-1', name: '測試孩子' });
      fixture.detectChanges();
      expect(leaveButton()).toBeDefined();
    });

    it('打開：對話框裡是共用表單，學生固定是目前的孩子（不出學生欄），副標寫孩子名', async () => {
      withChild();
      leaveButton()!.click();
      await Promise.resolve();
      fixture.detectChanges();
      const dialog = el().querySelector('dialog')!;
      expect(dialog.open).toBe(true);
      expect(dialog.textContent).toContain('登記請假');
      expect(dialog.textContent).toContain('測試孩子 · 這段時間的課都會標成請假');
      expect(dialog.querySelector('app-leave-form-dialog')).not.toBeNull();
      expect(dialog.querySelector('app-student-autocomplete')).toBeNull();
    });

    it('送出成功：打家長端 API、關掉、toast「已登記 {孩子} {M/D} 請假」、重抓目前期間', async () => {
      withChild();
      leaveButton()!.click();
      await Promise.resolve();
      fixture.detectChanges();
      listMock.mockClear();
      const form = fixture.debugElement.query((d) => d.name === 'app-leave-form-dialog')
        .componentInstance as { startDate: Date; endDate: Date; submit: () => void };
      form.startDate = new Date(2026, 9, 20);
      form.endDate = new Date(2026, 9, 21);
      form.submit();
      fixture.detectChanges();

      expect(createLeaveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'child-1',
          startDate: '2026-10-20',
          endDate: '2026-10-21',
          startTime: '17:00',
          endTime: '21:00',
        }),
      );
      expect(el().querySelector('dialog')!.open).toBe(false);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success', summary: '已登記 測試孩子 10/20 請假' }),
      );
      expect(listMock).toHaveBeenCalledWith('child-1', expect.any(String), expect.any(String));
    });

    it('取消：關掉、不打 API、不 toast', async () => {
      withChild();
      leaveButton()!.click();
      await Promise.resolve();
      fixture.detectChanges();
      [...el().querySelectorAll<HTMLButtonElement>('dialog button')]
        .find((b) => b.textContent?.includes('取消'))!
        .click();
      fixture.detectChanges();
      expect(el().querySelector('dialog')!.open).toBe(false);
      expect(createLeaveMock).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
    });
  });

  // #1810：沒點名的堂也列出來；展開帶「老師 · 教室」（#1809 併入）與推導的依據
  describe('列出還沒點名的堂（#1810）', () => {
    const open = (text: string) => {
      const btn = [...fixture.nativeElement.querySelectorAll('.attendance__record')].find(
        (b: HTMLElement) => b.textContent?.includes(text),
      ) as HTMLButtonElement;
      btn.click();
      fixture.detectChanges();
    };

    it('沒紀錄的過去堂寫「沒有紀錄」，不是缺席；日到班推導寫「出席」並在展開說依到班刷卡', () => {
      createComponent({
        data: [
          record({ id: 'a', className: '英文班', status: null, eventDate: daysAgoIso(1) }),
          record({
            id: 'b',
            className: '國文班',
            status: null,
            derived: 'checkin',
            eventDate: daysAgoIso(2),
          }),
        ],
        meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
      });
      activeChildId.set('child-1');
      fixture.detectChanges();
      const text = () => fixture.nativeElement.textContent as string;
      const statuses = [...fixture.nativeElement.querySelectorAll('.attendance__status')].map(
        (el: HTMLElement) => el.textContent?.trim(),
      );
      expect(statuses).toEqual(['沒有紀錄', '出席']);

      open('國文班');
      expect(text()).toContain('依到班刷卡');
    });

    it('展開寫「老師 · 教室」；缺哪個就不寫哪個', () => {
      createComponent({
        data: [
          record({ id: 'a', className: '英文班', teacherName: '王老師', classroomName: 'A 教室' }),
          record({ id: 'b', className: '國文班', teacherName: '李老師', startTime: '11:00' }),
        ],
        meta: { monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
      });
      activeChildId.set('child-1');
      fixture.detectChanges();

      open('英文班');
      expect(
        fixture.nativeElement.querySelector('.attendance__record-teacher')?.textContent?.trim(),
      ).toBe('王老師 · A 教室');
      open('國文班');
      expect(
        fixture.nativeElement.querySelector('.attendance__record-teacher')?.textContent?.trim(),
      ).toBe('李老師');
    });
  });

  // 審核席 #1819 二讀 Y3：選過去的月份，查詢的窗要跟畫的窗一致 —— 到那個月的月底，不是今天
  it('選過去的月份 → days() 收到那個月的 1 號到月底', () => {
    const comp = createComponent() as unknown as {
      onRangeChange: (mode: 'month') => void;
      onMonthChange: (month: string) => void;
    };
    activeChildId.set('child-1');
    fixture.detectChanges();
    const d = new Date(`${FAKE_TODAY.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const prev = d.toISOString().slice(0, 7);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);

    comp.onRangeChange('month');
    comp.onMonthChange(prev);
    fixture.detectChanges();

    expect(listMock).toHaveBeenLastCalledWith('child-1', `${prev}-01`, last);
  });
});
