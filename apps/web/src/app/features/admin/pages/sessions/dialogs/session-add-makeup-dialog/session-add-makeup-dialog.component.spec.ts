import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { type Session, SessionsService } from '@core/sessions.service';
import { SessionAddMakeupDialogComponent } from './session-add-makeup-dialog.component';

/**
 * #1314 S7：停課那堂「加開一堂補課」。先 POST /sessions 加開，成功再 PATCH makeup 指定補這堂；
 * 兩支不是交易，所以三種結局各一條。
 */
describe('SessionAddMakeupDialogComponent（#1314 S7）', () => {
  const cancelled = {
    id: 'cancelled-1',
    classId: 'class-1',
    className: '數學 A',
    sessionDate: '2026-10-02',
    startTime: '18:00',
    endTime: '19:30',
    teacherId: 'teacher-1',
    teacherName: '王老師',
    status: 'cancelled',
  } as unknown as Session;

  function setup(over: { create?: unknown; setMakeup?: unknown } = {}) {
    const sessions = {
      create: vi.fn(() => over.create ?? of({ data: { id: 'new-1' } })),
      setMakeup: vi.fn(() => over.setMakeup ?? of(undefined)),
    };
    const ref = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [SessionAddMakeupDialogComponent],
      providers: [
        { provide: SessionsService, useValue: sessions },
        { provide: DynamicDialogRef, useValue: ref },
        { provide: DynamicDialogConfig, useValue: { data: { session: cancelled } } },
      ],
    });
    const fixture = TestBed.createComponent(SessionAddMakeupDialogComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      form: { patchValue: (v: Record<string, unknown>) => void };
      submit: () => Promise<void>;
      submitError: () => string | null;
      isSubmitting: () => boolean;
    };
    c.form.patchValue({ date: new Date(2026, 9, 9) });
    return { fixture, c, sessions, ref };
  }

  it('寫出補的是哪堂；時段、老師、原因預設沿用停課那堂', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="add-makeup-target"]')?.textContent).toContain(
      '補 10/2 18:00 數學 A 的停課',
    );
    expect(el.textContent).toContain('由原老師上（王老師）');
  });

  it('送出：同班加開（原時段、原老師），再把新課指定成補這堂；關窗回 linked: true', async () => {
    const { c, sessions, ref } = setup();
    await c.submit();
    expect(sessions.create).toHaveBeenCalledWith({
      classId: 'class-1',
      sessionDate: '2026-10-09',
      startTime: '18:00',
      endTime: '19:30',
      teacherId: 'teacher-1',
      reason: '補 10/2 停課',
    });
    expect(sessions.setMakeup).toHaveBeenCalledWith('new-1', 'cancelled-1');
    expect(ref.close).toHaveBeenCalledWith({ date: '2026-10-09', linked: true });
  });

  it('不勾原老師：teacherId 送 null（未指派）', async () => {
    const { c, sessions } = setup();
    c.form.patchValue({ keepTeacher: false });
    await c.submit();
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ teacherId: null }));
  });

  it('加開失敗（撞堂 409）：錯誤留在對話框、不指定補課、不關窗', async () => {
    const { c, sessions, ref } = setup({
      create: throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error: '同班級於此時段已有課堂', code: 'CLASS_CONFLICT' },
          }),
      ),
    });
    await c.submit();
    expect(c.submitError()).toBe('同班級於此時段已有課堂');
    expect(sessions.setMakeup).not.toHaveBeenCalled();
    expect(ref.close).not.toHaveBeenCalled();
    expect(c.isSubmitting()).toBe(false);
  });

  it('加開成功但指定補課失敗：不刪課，關窗回 linked: false 讓課表說怎麼補', async () => {
    const { c, ref } = setup({ setMakeup: throwError(() => new Error('boom')) });
    await c.submit();
    expect(ref.close).toHaveBeenCalledWith({ date: '2026-10-09', linked: false });
  });

  it('按一下送出只走 form 的 submit 一次；送出中再送一次表單，create 仍只打一次', async () => {
    const pending = new Subject<{ data: { id: string } }>();
    const { fixture, c, sessions } = setup({ create: pending });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // 鈕另外綁 click 的話 submit 會被叫兩次（API 被守門擋成一次，看不出來）
    const submit = vi.spyOn(c, 'submit');
    el.querySelector<HTMLButtonElement>('[data-testid="op-submit"]')!.click();
    expect(submit).toHaveBeenCalledTimes(1);
    // 送出中（create 還沒回來）：Enter 之類的再送一次表單
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });

  it('結束早於開始：不送', async () => {
    const { c, sessions } = setup();
    c.form.patchValue({ end: new Date(2026, 0, 1, 17, 0) });
    await c.submit();
    expect(c.submitError()).toBe('開始時間需早於結束時間');
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
