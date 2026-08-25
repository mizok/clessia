import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { SessionsService, type Session } from '@core/sessions.service';

import {
  TeachingLogDialogComponent,
  type TeachingLogDialogData,
} from './teaching-log-dialog.component';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    sessionDate: '2026-08-01',
    startTime: '19:00',
    endTime: '21:00',
    status: 'completed',
    assignmentStatus: 'assigned',
    classId: 'c1',
    className: '國二數學 A',
    courseId: 'course-1',
    courseName: '國二數學',
    campusId: 'campus-1',
    campusName: '示範分校',
    teacherId: 't1',
    teacherName: '王小明',
    hasChanges: false,
    attendanceTakenAt: '2026-08-01T11:05:00.000Z',
    ...overrides,
  };
}

describe('TeachingLogDialogComponent', () => {
  let fixture: ComponentFixture<TeachingLogDialogComponent>;
  let component: TeachingLogDialogComponent;

  const listMock = vi.fn();
  const substitutedAwayMock = vi.fn();

  const data: TeachingLogDialogData = { staffId: 't1', staffName: '王小明' };

  async function setup(dialogData: TeachingLogDialogData = data) {
    listMock.mockReset();
    substitutedAwayMock.mockReset();
    listMock.mockReturnValue(of({ data: [session()], meta: {} }));
    substitutedAwayMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [TeachingLogDialogComponent],
      providers: [
        {
          provide: SessionsService,
          useValue: { list: listMock, substitutedAway: substitutedAwayMock },
        },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: dialogData } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeachingLogDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('以該老師與當月區間查詢課堂', async () => {
    await setup();

    const call = listMock.mock.calls[0][0];
    expect(call.teacherIds).toEqual(['t1']);
    // 區間是整個月：起日為 01、迄日不早於起日
    expect(call.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(call.to >= call.from).toBe(true);
  });

  it('同時查詢被代課的課堂', async () => {
    await setup();

    expect(substitutedAwayMock).toHaveBeenCalledWith(expect.objectContaining({ teacherId: 't1' }));
  });

  it('呈現時數摘要', async () => {
    await setup();

    expect(component['summary']().totalHours).toBe(2);
    expect(component['summary']().countedSessions).toBe(1);
  });

  it('切換月份會重新查詢兩邊', async () => {
    await setup();
    listMock.mockClear();
    substitutedAwayMock.mockClear();

    component['onMonthChange']('2026-07');

    expect(listMock.mock.calls[0][0].from).toBe('2026-07-01');
    expect(listMock.mock.calls[0][0].to).toBe('2026-07-31');
    expect(substitutedAwayMock).toHaveBeenCalledTimes(1);
  });

  it('課堂查詢失敗時顯示錯誤而不是空白畫面', async () => {
    listMock.mockReset();
    substitutedAwayMock.mockReset();
    listMock.mockReturnValue(throwError(() => new Error('boom')));
    substitutedAwayMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [TeachingLogDialogComponent],
      providers: [
        {
          provide: SessionsService,
          useValue: { list: listMock, substitutedAway: substitutedAwayMock },
        },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(TeachingLogDialogComponent);
    f.detectChanges();

    expect(f.componentInstance['loadError']()).toBe(true);
    expect(f.componentInstance['loading']()).toBe(false);
  });

  // 被代課那一區失敗時，主要的時數統計仍然有效 —— 不該因為附屬區塊掛掉就整頁失敗
  it('被代課查詢失敗不影響主要時數統計', async () => {
    listMock.mockReset();
    substitutedAwayMock.mockReset();
    listMock.mockReturnValue(of({ data: [session()], meta: {} }));
    substitutedAwayMock.mockReturnValue(throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [TeachingLogDialogComponent],
      providers: [
        {
          provide: SessionsService,
          useValue: { list: listMock, substitutedAway: substitutedAwayMock },
        },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(TeachingLogDialogComponent);
    f.detectChanges();

    expect(f.componentInstance['summary']().totalHours).toBe(2);
    expect(f.componentInstance['loadError']()).toBe(false);
    expect(f.componentInstance['substitutedAway']()).toEqual([]);
  });
});
