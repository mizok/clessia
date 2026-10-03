import { TestBed } from '@angular/core/testing';
import type { Session, SessionLatestChange } from '@core/sessions.service';
import { SessionTagsComponent } from './session-tags.component';

describe('SessionTagsComponent —— 異動文案吃 latestChange（#1194）', () => {
  const change = (c: Partial<SessionLatestChange>): SessionLatestChange => ({
    type: 'time_change',
    reason: null,
    originalTeacherName: null,
    originalDate: null,
    originalStartTime: null,
    originalEndTime: null,
    createdAt: '2026-10-01T00:00:00Z',
    ...c,
  });

  function text(patch: Partial<Session>): string {
    const fixture = TestBed.createComponent(SessionTagsComponent);
    fixture.componentRef.setInput('session', {
      id: 's1',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      hasChanges: true,
      ...patch,
    } as Session);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ').trim();
  }

  it('代課寫原老師；沒有原老師名就只寫代課', () => {
    expect(text({ latestChange: change({ type: 'substitute', originalTeacherName: '王' }) })).toBe(
      '代課 · 原 王',
    );
    expect(text({ latestChange: change({ type: 'substitute' }) })).toBe('代課');
  });

  it('調課寫從哪天幾點移來（月日不補零）', () => {
    const c = change({
      type: 'reschedule',
      originalDate: '2026-09-02',
      originalStartTime: '16:00',
    });
    expect(text({ latestChange: c })).toBe('調課 · 從 9/2 16:00 移來');
  });

  it('停課帶原因；其餘類型與舊資料（沒有 latestChange）仍標有異動', () => {
    const c = change({ type: 'cancellation', reason: '颱風' });
    expect(text({ status: 'cancelled', latestChange: c })).toBe('停課 · 颱風');
    expect(text({ latestChange: change({ type: 'time_change' }) })).toBe('有異動');
    expect(text({})).toBe('有異動');
    expect(text({ hasChanges: false })).toBe('');
  });

  it('補課那堂不重複標：補課標籤已經說了', () => {
    const makeupFor = { id: 'x', sessionDate: '2026-10-01', status: 'cancelled' } as const;
    expect(text({ makeupFor, latestChange: change({ type: 'makeup' }) })).toBe('補課');
  });
});
