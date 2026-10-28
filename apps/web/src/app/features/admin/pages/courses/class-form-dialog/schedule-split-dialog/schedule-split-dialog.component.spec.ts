import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { ClassesService } from '@core/classes.service';
import { ScheduleSplitDialogComponent } from './schedule-split-dialog.component';

// #1100 #22：一定先預覽（dryRun）才送得出去；改了欄位預覽就作廢
describe('ScheduleSplitDialogComponent', () => {
  const result = (dryRun: boolean) => ({
    dryRun,
    newSchedule: null,
    removedCount: 2,
    createdCount: 2,
    kept: [{ id: 's9', sessionDate: '2099-02-04', startTime: '09:00:00', reasons: ['attendance'] }],
  });
  const split = vi.fn((_c: string, _s: string, input: { dryRun?: boolean }) =>
    of({ data: result(!!input.dryRun) }),
  );
  const close = vi.fn();

  const create = () => {
    TestBed.configureTestingModule({
      imports: [ScheduleSplitDialogComponent],
      providers: [
        { provide: ClassesService, useValue: { splitSchedule: split } },
        { provide: DynamicDialogRef, useValue: { close } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              classId: 'class-1',
              classroomOptions: [{ label: '不指定', value: null }],
              teacherOptions: [
                { label: '王老師', value: 't-1' },
                { label: '李老師', value: 't-2' },
              ],
              schedule: {
                id: 'sch-1',
                classId: 'class-1',
                weekday: 1,
                startTime: '09:00:00',
                endTime: '11:00:00',
                teacherId: 't-1',
                teacherName: '王老師',
                effectiveFrom: '2026-01-01',
                effectiveTo: null,
                classroomId: null,
                classroomName: null,
              },
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ScheduleSplitDialogComponent);
    fixture.detectChanges();
    lastFixture = fixture;
    return fixture.componentInstance as any;
  };
  let lastFixture: ReturnType<typeof TestBed.createComponent<ScheduleSplitDialogComponent>>;

  beforeEach(() => {
    split.mockClear();
    close.mockClear();
  });

  it('預覽送 dryRun、沿用舊老師；確定才真的送，關閉時回傳結果', () => {
    const c = create();
    c.update('fromDate', '2099-02-01');
    c.update('weekday', 3);
    c.runPreview();
    expect(split).toHaveBeenLastCalledWith(
      'class-1',
      'sch-1',
      expect.objectContaining({
        fromDate: '2099-02-01',
        weekday: 3,
        teacherId: 't-1',
        dryRun: true,
      }),
    );
    expect(c.keptLine(c.preview().kept[0])).toBe('2/4 09:00：已點名');
    expect(close).not.toHaveBeenCalled();

    c.confirm();
    expect(split).toHaveBeenLastCalledWith(
      'class-1',
      'sch-1',
      expect.objectContaining({ dryRun: false }),
    );
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it('改了欄位，預覽作廢；生效日早於今天不送', () => {
    const c = create();
    c.update('fromDate', '2099-02-01');
    c.runPreview();
    c.update('startTime', '10:00');
    expect(c.preview()).toBeNull();

    c.update('fromDate', '2020-01-01');
    expect(c.invalid()).toContain('生效日最早');
    c.runPreview();
    expect(split).toHaveBeenCalledTimes(1);
  });

  // #2049 (e)：換老師走這裡（有生效日、留任期），換了要當場說前任會怎樣
  it('換老師：送新老師、顯示前任卸任的說明；沒換不顯示', () => {
    const c = create();
    const note = () => lastFixture.nativeElement.querySelector('[data-teacher-change-note]');
    expect(note()).toBeNull();

    c.update('teacherId', 't-2');
    lastFixture.detectChanges();
    expect(note()?.textContent).toContain('王老師從這天起卸任');

    c.update('fromDate', '2099-02-01');
    c.runPreview();
    expect(split).toHaveBeenLastCalledWith(
      'class-1',
      'sch-1',
      expect.objectContaining({ teacherId: 't-2' }),
    );
  });
});
