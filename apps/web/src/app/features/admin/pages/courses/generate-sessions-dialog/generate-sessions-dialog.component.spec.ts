import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { BrowserStateService } from '@core/browser-state.service';
import { SystemClockService } from '@core/system-clock.service';
import { ClassesService } from '@core/classes.service';
import { GenerateSessionsDialogComponent } from './generate-sessions-dialog.component';

describe('GenerateSessionsDialogComponent', () => {
  let fixture: ComponentFixture<GenerateSessionsDialogComponent>;
  let component: GenerateSessionsDialogComponent;
  const dialogRefMock = {
    close: vi.fn(),
  };

  const classesServiceMock = {
    previewSessions: vi.fn(() =>
      of({
        data: [
          {
            sessionDate: '2026-03-16',
            startTime: '18:00:00',
            endTime: '20:00:00',
            teacherId: 'teacher-1',
            teacherName: '張老師',
            weekday: 1,
            exists: false,
          },
        ],
      }),
    ),
    generateSessions: vi.fn(),
    schoolCalendar: vi.fn((_id: string, _from: string, _to: string) =>
      of({ data: [] as unknown[], meta: { studentCount: 3 } }),
    ),
  };

  beforeEach(async () => {
    classesServiceMock.previewSessions.mockClear();
    classesServiceMock.generateSessions.mockReset();
    classesServiceMock.schoolCalendar.mockClear();
    dialogRefMock.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [GenerateSessionsDialogComponent],
      providers: [
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-03-01' } },
        {
          provide: BrowserStateService,
          useValue: {
            isMobile: () => false,
          },
        },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              cls: {
                id: 'class-1',
                campusId: 'campus-1',
                courseId: 'course-1',
                campusName: '示範分校',
                courseName: '數學課',
                name: '班級 A',
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GenerateSessionsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // #2361：內容照 A6 class.html genDialog —— 原生日期、一天一列的勾選清單、兩段主鈕、toast＋關窗
  const sess = (date: string, start: string, exists = false, teacher = '張老師') => ({
    sessionDate: date,
    startTime: `${start}:00`,
    endTime: `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}${start.slice(2)}:00`,
    teacherId: 't1',
    teacherName: teacher,
    weekday: 1,
    exists,
  });
  const el = () => fixture.nativeElement as HTMLElement;
  const setDate = (id: string, v: string) => {
    const input = el().querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = v;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const next = () => {
    el().querySelector<HTMLButtonElement>('[data-testid="gen-next"]')!.click();
    fixture.detectChanges();
  };
  const toPreview = (data: unknown[]) => {
    classesServiceMock.previewSessions.mockReturnValueOnce(of({ data }) as never);
    setDate('gen-from', '2026-03-16');
    setDate('gen-to', '2026-03-31');
    next();
  };

  it('預覽：送日期、不帶排除；一天一列（同一天兩個時段合一列）；已存在的不列、合計句提一下', () => {
    toPreview([
      sess('2026-03-16', '18:00'),
      sess('2026-03-16', '20:00'),
      sess('2026-03-23', '18:00'),
      sess('2026-03-30', '18:00', true),
    ]);

    expect(classesServiceMock.previewSessions).toHaveBeenCalledWith(
      'class-1',
      '2026-03-16',
      '2026-03-31',
      [],
    );
    const rows = [...el().querySelectorAll('[data-testid="gen-preview"] label')].map((l) =>
      l.textContent!.trim(),
    );
    expect(rows).toEqual([
      '3/16（一） 18:00–19:00、20:00–21:00 · 張老師',
      '3/23（一） 18:00–19:00 · 張老師',
    ]);
    expect(el().querySelector('[data-testid="gen-sum"]')!.textContent).toContain(
      '將產生 3 堂（排除 0 堂）。',
    );
    expect(el().querySelector('[data-testid="gen-sum"]')!.textContent).toContain(
      '另有 1 堂已存在，會略過。',
    );
    expect(el().querySelector('[data-testid="gen-next"]')!.textContent).toContain('確認產生 3 堂');
  });

  it('取消勾選一天就排除那一天：確認時帶 excludeDates；沒有待指派 → toast＋關窗', () => {
    toPreview([sess('2026-03-16', '18:00'), sess('2026-03-23', '18:00')]);
    el().querySelectorAll<HTMLInputElement>('[data-testid="gen-preview"] input')[0]!.click();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="gen-sum"]')!.textContent).toContain(
      '將產生 1 堂（排除 1 堂）。',
    );

    classesServiceMock.generateSessions.mockReturnValueOnce(
      of({
        createdAssigned: 1,
        createdUnassigned: 0,
        skippedExisting: 0,
        skippedNoTeacher: 0,
        totalPlanned: 1,
      }) as never,
    );
    next();
    expect(classesServiceMock.generateSessions).toHaveBeenCalledWith(
      'class-1',
      '2026-03-16',
      '2026-03-31',
      ['2026-03-16'],
    );
    expect(dialogRefMock.close).toHaveBeenCalledWith('refresh');
  });

  it('有待指派老師的堂：留在結果頁，「前往指派老師」帶篩選跳課表（舊有新無，R2）', () => {
    toPreview([sess('2026-03-16', '18:00')]);
    classesServiceMock.generateSessions.mockReturnValueOnce(
      of({
        createdAssigned: 0,
        createdUnassigned: 1,
        skippedExisting: 0,
        skippedNoTeacher: 0,
        totalPlanned: 1,
      }) as never,
    );
    next();

    expect(dialogRefMock.close).not.toHaveBeenCalled();
    expect(el().textContent).toContain('其中 1 堂待指派老師');
    expect(el().textContent).toContain('前往指派老師');
  });

  it('預覽之後改日期：回到第一段（主鈕變回「預覽課堂」）', () => {
    toPreview([sess('2026-03-16', '18:00')]);
    setDate('gen-to', '2026-03-20');

    expect(el().querySelector('[data-testid="gen-preview"]')).toBeNull();
    expect(el().querySelector('[data-testid="gen-next"]')!.textContent).toContain('預覽課堂');
  });

  it('結束早於開始：不打 API，左邊寫原因；全部排除：不送、寫原因', () => {
    setDate('gen-from', '2026-03-31');
    setDate('gen-to', '2026-03-16');
    next();
    expect(classesServiceMock.previewSessions).not.toHaveBeenCalled();
    expect(el().querySelector('.form-dialog__why')!.textContent).toContain(
      '結束日期要晚於開始日期',
    );

    toPreview([sess('2026-03-16', '18:00')]);
    el().querySelector<HTMLInputElement>('[data-testid="gen-preview"] input')!.click();
    fixture.detectChanges();
    next();
    expect(classesServiceMock.generateSessions).not.toHaveBeenCalled();
    expect(el().querySelector('.form-dialog__why')!.textContent).toContain(
      '全部都排除了，沒有要產生的課堂',
    );
  });

  it('closes with refresh after generation result when user dismisses the dialog', () => {
    (
      component as unknown as {
        generationResult: { set: (value: unknown) => void };
        cancel: () => void;
      }
    ).generationResult.set({
      createdAssigned: 1,
      createdUnassigned: 0,
      skippedExisting: 0,
      skippedNoTeacher: 0,
      totalPlanned: 1,
    });

    (component as unknown as { cancel: () => void }).cancel();

    expect(dialogRefMock.close).toHaveBeenCalledWith('refresh');
  });

  describe('學校行事曆疊圖（#1160 PR4）', () => {
    const cal = (
      kind: string,
      startDate: string,
      endDate: string,
      schoolId: string,
      n: number,
    ) => ({
      kind,
      startDate,
      endDate,
      note: null,
      schoolId,
      schoolName: schoolId === 's1' ? '明湖國中' : '麗山國中',
      studentCount: n,
    });
    const summary = () =>
      el().querySelector('[data-testid="gen-calendar-summary"]')?.textContent?.trim();
    const marks = () =>
      [...el().querySelectorAll('[data-part="gen-calendar-mark"]')].map((m) =>
        m.textContent!.trim(),
      );

    it('預覽時同區間打疊圖；那天有事件就加副標、上方寫摘要；不自動取消勾選', () => {
      classesServiceMock.schoolCalendar.mockReturnValueOnce(
        of({
          data: [
            cal('no_class', '2026-03-16', '2026-03-16', 's1', 2),
            cal('no_class', '2026-03-10', '2026-03-17', 's2', 1),
          ],
          meta: { studentCount: 5 },
        }) as never,
      );
      toPreview([sess('2026-03-16', '18:00'), sess('2026-03-23', '18:00')]);

      expect(classesServiceMock.schoolCalendar).toHaveBeenCalledWith(
        'class-1',
        '2026-03-16',
        '2026-03-31',
      );
      expect(marks()).toEqual(['停課：明湖國中、麗山國中（共 3 位學生）']);
      expect(summary()).toBe('這段期間有 2 所學校的行事曆標記，共 1 天（只顯示這班學生的學校）');
      expect(el().querySelector('[data-testid="gen-sum"]')!.textContent).toContain('排除 0 堂');
    });

    it('這班沒有學生：寫原因、不疊', () => {
      classesServiceMock.schoolCalendar.mockReturnValueOnce(
        of({ data: [], meta: { studentCount: 0 } }) as never,
      );
      toPreview([sess('2026-03-16', '18:00')]);
      expect(summary()).toBe('這班還沒有學生，看不到學校行事曆');
      expect(marks()).toEqual([]);
    });

    it('改日期重新預覽：上一輪晚到的回應不蓋掉新的', () => {
      const first = new Subject<unknown>();
      const second = new Subject<unknown>();
      classesServiceMock.schoolCalendar
        .mockReturnValueOnce(first as never)
        .mockReturnValueOnce(second as never);
      toPreview([sess('2026-03-16', '18:00')]);
      setDate('gen-to', '2026-03-30');
      classesServiceMock.previewSessions.mockReturnValueOnce(
        of({ data: [sess('2026-03-16', '18:00')] }) as never,
      );
      next();

      second.next({ data: [], meta: { studentCount: 0 } });
      first.next({
        data: [cal('no_class', '2026-03-16', '2026-03-16', 's1', 2)],
        meta: { studentCount: 5 },
      });
      fixture.detectChanges();
      expect(summary()).toBe('這班還沒有學生，看不到學校行事曆');
      expect(marks()).toEqual([]);
    });

    it('讀取失敗：只影響摘要那一行，照樣能產生', () => {
      classesServiceMock.schoolCalendar.mockReturnValueOnce(
        throwError(() => new Error('x')) as never,
      );
      toPreview([sess('2026-03-16', '18:00')]);
      expect(summary()).toBe('學校行事曆讀取失敗');
      expect(el().querySelector('[data-testid="gen-sum"]')!.textContent).toContain('將產生 1 堂');
    });
  });
});
