import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, of, throwError } from 'rxjs';
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
  /** #727：抽成具名的，測試才能斷言「關閉鈕真的關掉了對話框」 */
  const dialogRefMock = { close: vi.fn() };

  const data: TeachingLogDialogData = { staffId: 't1', staffName: '王小明' };

  async function setup(dialogData: TeachingLogDialogData = data) {
    listMock.mockReset();
    substitutedAwayMock.mockReset();
    dialogRefMock.close.mockClear();
    listMock.mockReturnValue(of({ data: [session()], meta: {} }));
    substitutedAwayMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [TeachingLogDialogComponent],
      providers: [
        {
          provide: SessionsService,
          useValue: { list: listMock, substitutedAway: substitutedAwayMock },
        },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: DynamicDialogConfig, useValue: { data: dialogData } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeachingLogDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  // #508：載入中原本整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 最終內容是「兩個統計方塊 + 一張表」的混合形狀，兩個統計值各用局部
  // &__metric-skeleton，表格部分重用全站既有的 .skeleton-list。
  it('載入中顯示統計方塊骨架與清單骨架，不是整塊被文字取代', async () => {
    listMock.mockReset();
    substitutedAwayMock.mockReset();
    dialogRefMock.close.mockClear();
    listMock.mockReturnValue(NEVER);
    substitutedAwayMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [TeachingLogDialogComponent],
      providers: [
        {
          provide: SessionsService,
          useValue: { list: listMock, substitutedAway: substitutedAwayMock },
        },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(TeachingLogDialogComponent);
    f.detectChanges();

    expect(f.nativeElement.querySelectorAll('.teaching-log__metric-skeleton').length).toBe(2);
    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
  });

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
    dialogRefMock.close.mockClear();
    listMock.mockReturnValue(throwError(() => new Error('boom')));
    substitutedAwayMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [TeachingLogDialogComponent],
      providers: [
        {
          provide: SessionsService,
          useValue: { list: listMock, substitutedAway: substitutedAwayMock },
        },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
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
    dialogRefMock.close.mockClear();
    listMock.mockReturnValue(of({ data: [session()], meta: {} }));
    substitutedAwayMock.mockReturnValue(throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [TeachingLogDialogComponent],
      providers: [
        {
          provide: SessionsService,
          useValue: { list: listMock, substitutedAway: substitutedAwayMock },
        },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(TeachingLogDialogComponent);
    f.detectChanges();

    expect(f.componentInstance['summary']().totalHours).toBe(2);
    expect(f.componentInstance['loadError']()).toBe(false);
    expect(f.componentInstance['substitutedAway']()).toEqual([]);
  });

  /**
   * #727：**這支對話框一顆按鈕都沒有。**
   *
   * 開啟設定（`staff.page.ts:432`）沒帶 `closable`，而 `DynamicDialogComponent`
   * 一律把 `[closable]="ddconfig.closable"` 綁給內層 `p-dialog` ——
   * **沒帶就是 `undefined`，把 `p-dialog` 自己的預設 `true` 蓋掉**，所以標頭的 ✕ 不渲染。
   * 模板底部也沒有 footer。使用者只能重新整理整頁。
   *
   * 跟 #714（家長詳情）同型，修法照同一個形狀：**內容區補一顆「關閉」**。
   */
  describe('#727 關閉入口', () => {
    const closeButton = (): HTMLButtonElement | undefined =>
      [...fixture.nativeElement.querySelectorAll('button')].find(
        (b) => (b as HTMLElement).textContent?.trim() === '關閉',
      ) as HTMLButtonElement | undefined;

    it('有一顆「關閉」，按下去會關掉對話框', async () => {
      await setup();

      const btn = closeButton();
      expect(btn).toBeTruthy();

      btn!.click();

      expect(dialogRefMock.close).toHaveBeenCalled();
    });

    /**
     * **載入中也要關得掉。** 這是唯讀的檢視對話框，沒有「送出到一半不能走」的狀態；
     * 關閉鈕如果被放進某個資料分支裡，**它會剛好在使用者最想離開的時候消失**
     * （載入很慢、或者根本載不出來）。
     */
    it('載入中／沒有資料時關閉鈕仍然在', async () => {
      listMock.mockReset();
      substitutedAwayMock.mockReset();
      listMock.mockReturnValue(NEVER);
      substitutedAwayMock.mockReturnValue(NEVER);

      await TestBed.configureTestingModule({
        imports: [TeachingLogDialogComponent],
        providers: [
          {
            provide: SessionsService,
            useValue: { list: listMock, substitutedAway: substitutedAwayMock },
          },
          { provide: DynamicDialogRef, useValue: dialogRefMock },
          { provide: DynamicDialogConfig, useValue: { data } },
        ],
      }).compileComponents();

      const loadingFixture = TestBed.createComponent(TeachingLogDialogComponent);
      loadingFixture.detectChanges();

      const btn = [...loadingFixture.nativeElement.querySelectorAll('button')].find(
        (b) => (b as HTMLElement).textContent?.trim() === '關閉',
      );
      expect(btn).toBeTruthy();
    });

    /**
     * **反向對照**：月份選擇器不是關閉入口，補了關閉鈕之後它也不該變成關閉入口。
     * （這一支原本「一顆按鈕都沒有」，所以很容易把唯一的互動元素接錯。）
     */
    it('換月份不會關掉對話框', async () => {
      await setup();

      (component as unknown as { onMonthChange: (v: string) => void }).onMonthChange('2026-07');

      expect(dialogRefMock.close).not.toHaveBeenCalled();
    });
  });
});
