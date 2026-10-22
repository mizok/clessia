import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { EnrollmentsService } from '@core/enrollments.service';
import { LeaveService, type BatchLeaveResult } from '@core/leave.service';
import { SessionsService } from '@core/sessions.service';
import { SystemClockService } from '@core/system-clock.service';
import { LeaveBatchDialogComponent } from './leave-batch-dialog.component';

/** #1100 #32：批次請假對話框（A6 leave.html batchLeave；有人失敗不關窗、只重送失敗的） */
describe('LeaveBatchDialogComponent', () => {
  let fixture: ComponentFixture<LeaveBatchDialogComponent>;
  let c: any;
  const ref = { close: vi.fn() };
  const sessions = {
    list: vi.fn((_p?: unknown) =>
      of({
        data: [
          {
            id: 'ses-1',
            sessionDate: '2026-10-24',
            startTime: '09:00',
            classId: 'cls-1',
            className: '國一英文 A 班',
            status: 'scheduled',
          },
          {
            id: 'ses-x',
            sessionDate: '2026-10-25',
            startTime: '09:00',
            classId: 'cls-2',
            className: '停掉的',
            status: 'cancelled',
          },
        ],
        meta: {},
      }),
    ),
  };
  const enrollments = {
    list: vi.fn((_p?: unknown) =>
      of({
        data: [
          { studentId: 's1', studentName: '王小明' },
          { studentId: 's2', studentName: '林子晴' },
          { studentId: 's1', studentName: '王小明' }, // 換方案的第二筆在學報名
        ],
        meta: {},
      }),
    ),
  };
  const result = (failed: string[], ids: string[]): BatchLeaveResult => ({
    created: ids.length - failed.length,
    failed: failed.length,
    results: ids.map((studentId) =>
      failed.includes(studentId)
        ? { studentId, status: 'failed', error: '該學生在 10/24 已有請假紀錄' }
        : { studentId, status: 'success', leaveId: `lv-${studentId}` },
    ),
  });
  const leave = { batch: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [LeaveBatchDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: ref },
        { provide: DynamicDialogConfig, useValue: { data: { campusId: 'campus-1' } } },
        { provide: SessionsService, useValue: sessions },
        { provide: EnrollmentsService, useValue: enrollments },
        { provide: LeaveService, useValue: leave },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-23' } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LeaveBatchDialogComponent);
    c = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('課堂選單：今天起 14 天、這個分校、沒停課的', () => {
    expect(sessions.list).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-10-23', to: '2026-11-06', campusIds: ['campus-1'] }),
    );
    expect(c.sessionOptions().map((o: { value: string }) => o.value)).toEqual(['ses-1']);
  });

  it('選了課才列這班在學的學生（同一位只列一次）；沒選就按全選會說為什麼', () => {
    c.toggleAll();
    expect(c.nudged()).toBe(true);

    c.onSessionChange('ses-1');
    expect(enrollments.list).toHaveBeenCalledWith(
      expect.objectContaining({ classId: 'cls-1', status: 'active' }),
    );
    expect(c.students().map((s: { id: string }) => s.id)).toEqual(['s1', 's2']);
    c.toggleAll();
    expect([...c.selected()]).toEqual(['s1', 's2']);
  });

  it('全部成功：送出這一堂與勾的學生、原因去空白；關窗回傳建了幾張', () => {
    leave.batch.mockReturnValue(of(result([], ['s1', 's2'])));
    c.onSessionChange('ses-1');
    c.toggleAll();
    c.reason.set('  校外教學 ');
    c.submit();
    expect(leave.batch).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      studentIds: ['s1', 's2'],
      reason: '校外教學',
    });
    expect(ref.close).toHaveBeenCalledWith({ created: 2 });
  });

  it('有人失敗：不關窗、列出沒成功的與原因（成功的不列）；勾選只留他，重送只送他；最後回傳總共幾張', () => {
    leave.batch.mockReturnValueOnce(of(result(['s2'], ['s1', 's2'])));
    c.onSessionChange('ses-1');
    c.toggleAll();
    c.submit();
    fixture.detectChanges();

    expect(ref.close).not.toHaveBeenCalled();
    const box = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="batch-failures"]',
    )!;
    expect(box.textContent).toContain('已幫 1 位請假');
    expect(box.textContent).toContain('林子晴：該學生在 10/24 已有請假紀錄');
    expect(box.textContent).not.toContain('王小明');
    expect([...c.selected()]).toEqual(['s2']);

    leave.batch.mockReturnValueOnce(of(result([], ['s2'])));
    c.submit();
    expect(leave.batch).toHaveBeenLastCalledWith(expect.objectContaining({ studentIds: ['s2'] }));
    expect(ref.close).toHaveBeenCalledWith({ created: 2 });
  });

  it('有人失敗後直接關窗：仍回傳建了幾張（列表要重抓）', () => {
    leave.batch.mockReturnValueOnce(of(result(['s2'], ['s1', 's2'])));
    c.onSessionChange('ses-1');
    c.toggleAll();
    c.submit();
    c.close();
    expect(ref.close).toHaveBeenCalledWith({ created: 1 });
  });

  it('沒選課或沒勾人：不送，旁邊寫還差什麼', () => {
    c.submit();
    expect(leave.batch).not.toHaveBeenCalled();
    expect(c.missingHint()).toBe('還沒選課堂');
    c.onSessionChange('ses-1');
    expect(c.missingHint()).toBe('至少勾一位學生');
  });
});
