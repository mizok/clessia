import type { Class } from '@core/classes.service';

import { classNeedsIntervention } from './class-intervention.util';

/** 一個「完全正常」的班：有時段、有未來課堂、都指派了老師、沒有衝突 */
const cls = (overrides: Partial<Class> = {}): Class =>
  ({
    id: 'c1',
    isActive: true,
    scheduleCount: 2,
    hasUpcomingSessions: true,
    upcomingCancelledCount: 0,
    upcomingUnassignedCount: 0,
    upcomingClassConflictCount: 0,
    upcomingTeacherConflictCount: 0,
    ...overrides,
  }) as Class;

describe('classNeedsIntervention', () => {
  it('完全正常的班不需介入', () => {
    expect(classNeedsIntervention(cls())).toBe(false);
  });

  it('沒有時段', () => {
    expect(classNeedsIntervention(cls({ scheduleCount: 0 }))).toBe(true);
    expect(classNeedsIntervention(cls({ scheduleCount: undefined }))).toBe(true);
  });

  it('有時段但沒有未來課堂', () => {
    expect(classNeedsIntervention(cls({ hasUpcomingSessions: false }))).toBe(true);
  });

  // 未來的課都被停掉＝已經有人處理過（颱風停課之類），不是「家長看不到下一堂」的疏漏
  it('沒有未來課堂但是因為整批停課：不算', () => {
    expect(
      classNeedsIntervention(cls({ hasUpcomingSessions: false, upcomingCancelledCount: 3 })),
    ).toBe(false);
  });

  it('有未來課堂還沒指派老師', () => {
    expect(classNeedsIntervention(cls({ upcomingUnassignedCount: 1 }))).toBe(true);
  });

  it('班級衝突、老師衝突各自成立', () => {
    expect(classNeedsIntervention(cls({ upcomingClassConflictCount: 1 }))).toBe(true);
    expect(classNeedsIntervention(cls({ upcomingTeacherConflictCount: 1 }))).toBe(true);
  });

  it('停用的班一律不算（即使什麼都沒有）', () => {
    expect(classNeedsIntervention(cls({ isActive: false, scheduleCount: 0 }))).toBe(false);
  });
});
