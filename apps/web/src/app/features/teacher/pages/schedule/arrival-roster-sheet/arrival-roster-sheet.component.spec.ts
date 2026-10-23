import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { AttendanceService, type RosterStudent } from '@core/attendance.service';

import {
  ArrivalRosterSheetComponent,
  type ArrivalRosterInput,
} from './arrival-roster-sheet.component';

const INPUT: ArrivalRosterInput = {
  eventId: 'e1',
  className: '國三數學 A',
  campusName: '文山',
  eventDate: '2027-03-05',
  startTime: '17:40',
  isToday: true,
  readOnly: false,
};

function student(id: string, name: string, over: Partial<RosterStudent> = {}): RosterStudent {
  return {
    studentId: id,
    studentName: name,
    grade: null,
    school: null,
    recordId: null,
    status: null,
    hasLeaveRequest: false,
    cancelDropsLeaveUntil: null,
    checkedInAt: null,
    ...over,
  };
}

const STUDENTS = [
  student('s1', '王小明', { checkedInAt: '2027-03-05T08:12:00Z', checkInSource: 'scan' }),
  student('s2', '李小華'),
  student('s3', '陳小美', { hasLeaveRequest: true }),
];

describe('ArrivalRosterSheetComponent（#1314 TS3 到班名單）', () => {
  let fixture: ComponentFixture<ArrivalRosterSheetComponent>;
  const rosterMock = vi.fn();
  const checkInMock = vi.fn();
  const closeMock = vi.fn();

  async function render(input: Partial<ArrivalRosterInput> = {}) {
    rosterMock.mockReset();
    checkInMock.mockReset();
    closeMock.mockReset();
    rosterMock.mockReturnValue(
      of({ eventId: 'e1', takenAt: null, attendanceMode: 'daily_checkin', students: STUDENTS }),
    );
    await TestBed.configureTestingModule({
      imports: [ArrivalRosterSheetComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: { ...INPUT, ...input } } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: AttendanceService, useValue: { roster: rosterMock, checkIn: checkInMock } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ArrivalRosterSheetComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
  const markButtons = () =>
    [...fixture.nativeElement.querySelectorAll('button')].filter((b: HTMLElement) =>
      b.textContent?.includes('他到了'),
    ) as HTMLButtonElement[];

  it('摘要與每列狀態：掃碼時間（台北）、還沒到、請假', async () => {
    await render();
    expect(text()).toContain('到 1／3 · 請假 1');
    expect(text()).toContain('16:12 掃碼到');
    expect(text()).toContain('還沒到');
    expect(text()).toContain('請假');
  });

  it('只有「今天、還沒到、沒請假」的人有「他到了」', async () => {
    await render();
    expect(markButtons()).toHaveLength(1);
  });

  it('過去的課、或行政負責（唯讀）→ 沒有「他到了」；過去的寫「沒有到班紀錄」', async () => {
    await render({ isToday: false });
    expect(markButtons()).toHaveLength(0);
    expect(text()).toContain('沒有到班紀錄');
    TestBed.resetTestingModule();
    await render({ readOnly: true });
    expect(markButtons()).toHaveLength(0);
  });

  it('按「他到了」→ 列變「到班（老師標記）」，關閉時告訴課表要重抓', async () => {
    await render();
    checkInMock.mockReturnValue(
      of({ checkedInAt: '2027-03-05T09:40:00Z', alreadyCheckedIn: false }),
    );
    markButtons()[0].click();
    fixture.detectChanges();
    expect(checkInMock).toHaveBeenCalledWith('e1', 's2');
    expect(text()).toContain('17:40 到班（老師標記）');
    expect(text()).toContain('到 2／3');
    (fixture.componentInstance as unknown as { close(): void }).close();
    expect(closeMock).toHaveBeenCalledWith(true);
  });

  // 審核席 #1812 二讀 B4：剛好在這之前掃了卡（alreadyCheckedIn）→ 照實寫「掃碼到」，不說成老師標記
  it('B4：後端回 alreadyCheckedIn → 列寫「掃碼到」，不寫「老師標記」', async () => {
    await render();
    checkInMock.mockReturnValue(
      of({ checkedInAt: '2027-03-05T09:30:00Z', alreadyCheckedIn: true, checkInSource: 'scan' }),
    );
    markButtons()[0]!.click();
    fixture.detectChanges();
    expect(text()).toContain('17:30 掃碼到');
    expect(text()).not.toContain('老師標記');
  });

  // #1100 #52：來源由伺服器記下，名單照實寫；欄位出現之前的舊紀錄（null）只寫時間，不猜
  it('來源：掃碼＝掃碼到、人工標記（含行政在儀表板標的）＝到班（人工標記）、舊紀錄只寫時間', async () => {
    rosterMock.mockReset();
    TestBed.resetTestingModule();
    const list = [
      student('a', '甲', { checkedInAt: '2027-03-05T08:12:00Z', checkInSource: 'scan' }),
      student('b', '乙', { checkedInAt: '2027-03-05T08:20:00Z', checkInSource: 'manual' }),
      student('c', '丙', { checkedInAt: '2027-03-05T08:30:00Z', checkInSource: null }),
    ];
    await TestBed.configureTestingModule({
      imports: [ArrivalRosterSheetComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: INPUT } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        {
          provide: AttendanceService,
          useValue: {
            roster: () =>
              of({ eventId: 'e1', takenAt: null, attendanceMode: 'daily_checkin', students: list }),
            checkIn: checkInMock,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ArrivalRosterSheetComponent);
    fixture.detectChanges();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('li small')].map(
      (el) => el.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toEqual(['16:12 掃碼到', '16:20 到班（人工標記）', '16:30']);
  });

  it('按「他到了」但已經有人人工標過 → 照後端回的來源寫，不說成我標的', async () => {
    await render();
    checkInMock.mockReturnValue(
      of({ checkedInAt: '2027-03-05T09:30:00Z', alreadyCheckedIn: true, checkInSource: 'manual' }),
    );
    markButtons()[0]!.click();
    fixture.detectChanges();
    expect(text()).toContain('17:30 到班（人工標記）');
    expect(text()).not.toContain('老師標記');
  });

  // B10：請求還在飛的時候再按一次，不送第二支
  it('B10：記到班的請求還沒回來時，再按不會送第二次', async () => {
    await render();
    checkInMock.mockReturnValue(NEVER);
    const c = fixture.componentInstance as unknown as { markArrived(s: RosterStudent): void };
    c.markArrived(STUDENTS[1]!);
    c.markArrived(STUDENTS[1]!);
    expect(checkInMock).toHaveBeenCalledTimes(1);
  });

  it('記失敗 → 講出來、列維持「還沒到」，不假裝成功', async () => {
    await render();
    checkInMock.mockReturnValue(throwError(() => new Error('boom')));
    markButtons()[0].click();
    fixture.detectChanges();
    expect(text()).toContain('沒記到 李小華 的到班');
    expect(markButtons()).toHaveLength(1);
  });

  it('今天已在別校掃過卡（409）→ 照實說，不叫他再按一次', async () => {
    await render();
    checkInMock.mockReturnValue(
      throwError(() => ({
        error: { code: 'CHECKED_IN_ELSEWHERE', error: '他今天已在景美分校掃過卡' },
      })),
    );
    markButtons()[0]!.click();
    fixture.detectChanges();
    expect(text()).toContain('李小華：他今天已在景美分校掃過卡，這裡記不了到班。');
    expect(text()).not.toContain('請再按一次');
  });

  it('名單讀取失敗 → 錯誤句，不畫空名單', async () => {
    rosterMock.mockReset();
    await TestBed.configureTestingModule({
      imports: [ArrivalRosterSheetComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: INPUT } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        {
          provide: AttendanceService,
          useValue: { roster: () => throwError(() => new Error('boom')), checkIn: checkInMock },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ArrivalRosterSheetComponent);
    fixture.detectChanges();
    expect(text()).toContain('讀取失敗');
    expect(text()).not.toContain('到 0／0');
  });
});
