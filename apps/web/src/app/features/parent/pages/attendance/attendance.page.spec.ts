import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentAttendanceService,
  type ParentAttendanceListResponse,
  type ParentAttendanceRecord,
} from '@core/parent-attendance.service';
import { AttendancePage } from './attendance.page';

const PAGE = {
  label: '出缺席',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

function emptyResponse(): ParentAttendanceListResponse {
  return { data: [], meta: { total: 0, page: 1, pageSize: 50, monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 } };
}

function record(overrides: Partial<ParentAttendanceRecord> = {}): ParentAttendanceRecord {
  return {
    id: 'r1',
    eventId: 'e1',
    eventDate: '2026-09-01',
    startTime: '09:00',
    endTime: '10:00',
    campusName: '台北校',
    className: '數學班',
    sessionStatus: 'scheduled',
    status: 'present',
    note: null,
    ...overrides,
  };
}

describe('AttendancePage', () => {
  let fixture: ComponentFixture<AttendancePage>;
  let listMock: ReturnType<typeof vi.fn>;
  let activeChildId: ReturnType<typeof signal<string | null>>;
  let childScopeLoad: ReturnType<typeof vi.fn>;

  function createComponent(
    response: ParentAttendanceListResponse | (() => never) = emptyResponse(),
  ) {
    activeChildId = signal<string | null>(null);
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
            children: () => [],
            activeChild: () => null,
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: childScopeLoad,
          },
        },
        { provide: ParentAttendanceService, useValue: { list: listMock } },
      ],
    });

    fixture = TestBed.createComponent(AttendancePage);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as {
      onRangeChange: (mode: 'recent10' | 'recent30' | 'month' | null) => void;
    };
  }

  it('進頁呼叫 childScope.load()', () => {
    createComponent();
    expect(childScopeLoad).toHaveBeenCalledTimes(1);
  });

  it('沒有 activeChildId 時不打 API', () => {
    createComponent();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('activeChildId 出現後打 API，帶預設近 10 天的 dateFrom', () => {
    createComponent();
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ childId: 'child-1', page: 1, pageSize: 50 }),
    );
    expect(listMock.mock.calls[0][0].dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(listMock.mock.calls[0][0].dateTo).toBeUndefined();
  });

  it('換孩子會重新查', () => {
    createComponent();
    activeChildId.set('child-1');
    fixture.detectChanges();
    listMock.mockClear();

    activeChildId.set('child-2');
    fixture.detectChanges();

    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ childId: 'child-2' }));
  });

  it('依日期分組顯示，日期新到舊（近30天，不觸發補空避免干擾排序斷言）', () => {
    const comp = createComponent({
      data: [
        record({ id: 'r1', eventDate: '2026-09-01' }),
        record({ id: 'r2', eventDate: '2026-08-30', status: 'absent', className: '英文班' }),
      ],
      meta: { total: 2, page: 1, pageSize: 50, monthlyAbsentCount: 1, monthlyOnLeaveCount: 0 },
    });
    comp.onRangeChange('recent30');
    activeChildId.set('child-1');
    fixture.detectChanges();

    const dates = fixture.nativeElement.querySelectorAll('.attendance__day-date');
    expect(Array.from(dates).map((el: unknown) => (el as HTMLElement).textContent?.trim())).toEqual(
      ['2026-09-01', '2026-08-30'],
    );
  });

  it('近10天（預設模式）補回沒有紀錄的日期，顯示「今日無課」——避免跟載入失敗混淆', () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    createComponent({
      data: [record({ id: 'r1', eventDate: todayIso })],
      meta: { total: 1, page: 1, pageSize: 50, monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    // 近10天有11天（含今天），只有1天有紀錄，其餘10天都該顯示「今日無課」
    const noClass = fixture.nativeElement.querySelectorAll('.attendance__no-class');
    expect(noClass.length).toBe(10);
  });

  it('點課堂列內展開，再點一次收合', () => {
    createComponent({
      data: [record({ note: '準時到班' })],
      meta: { total: 1, page: 1, pageSize: 50, monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
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

  it('載入失敗顯示失敗狀態', () => {
    createComponent((() => {
      throw new Error('unused');
    }) as unknown as ParentAttendanceListResponse);
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
  it('錨點顯示本月缺席數，不把請假算進去', () => {
    createComponent({
      data: [record()],
      meta: { total: 1, page: 1, pageSize: 50, monthlyAbsentCount: 2, monthlyOnLeaveCount: 5 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    // 取 `.band-anchor__value` 而不是整顆的 textContent —— 只比對那個數字本身，
    // 合計（7）會讓這條直接不等，不用靠「不包含 7」這種鈍的斷言
    expect(
      fixture.nativeElement.querySelector('.band-anchor__value')?.textContent?.trim(),
    ).toBe('2');
  });

  it('錨點文案標明「本月」——列表區間可以不是本月，數字卻永遠是本月', () => {
    const comp = createComponent({
      data: [record()],
      meta: { total: 1, page: 1, pageSize: 50, monthlyAbsentCount: 3, monthlyOnLeaveCount: 0 },
    });
    comp.onRangeChange('recent30');
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-band-anchor').textContent).toContain('本月');
  });

  it('缺席 0 次照樣顯示錨點——0 是好消息，不是沒有資料', () => {
    createComponent({
      data: [record()],
      meta: { total: 1, page: 1, pageSize: 50, monthlyAbsentCount: 0, monthlyOnLeaveCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.band-anchor__value')?.textContent?.trim(),
    ).toBe('0');
  });

  it('載入成功後再失敗，錨點要收回去——留著舊數字等於用失敗換來一則好消息', () => {
    // 先成功載到一個真數字，錨點才有東西可以「留著」——
    // 第一次就失敗的話 monthlyAbsent 本來就是 null，那樣寫的測試對守衛沒有辨識力
    const comp = createComponent({
      data: [record()],
      meta: { total: 1, page: 1, pageSize: 50, monthlyAbsentCount: 4, monthlyOnLeaveCount: 0 },
    });
    activeChildId.set('child-1');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.band-anchor__value')?.textContent?.trim(),
    ).toBe('4');

    listMock.mockImplementation(() => throwError(() => new Error('boom')));
    comp.onRangeChange('recent30');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-band-anchor')).toBeNull();
  });

  it('還沒載到資料時不顯示錨點', () => {
    createComponent();
    expect(fixture.nativeElement.querySelector('app-band-anchor')).toBeNull();
  });
});
