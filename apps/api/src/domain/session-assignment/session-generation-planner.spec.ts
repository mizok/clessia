import { describe, expect, it } from 'vitest';
import { buildSessionGenerationPlan } from './session-generation-planner';

describe('buildSessionGenerationPlan', () => {
  it('includeUnassigned=true 時，無老師時段應建立為 unassigned', () => {
    const plan = buildSessionGenerationPlan({
      orgId: 'org-1',
      classId: 'class-1',
      createdBy: 'user-1',
      from: '2026-02-02',
      to: '2026-02-02',
      includeUnassigned: true,
      schedules: [
        {
          id: 'sch-1',
          weekday: 1,
          startTime: '18:00:00',
          endTime: '20:00:00',
          teacherId: null,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
        },
      ],
      existingKeys: new Set(),
      excludeDates: new Set(),
    });

    expect(plan.preview).toHaveLength(1);
    expect(plan.preview[0].willBeUnassigned).toBe(true);
    expect(plan.summary.createdUnassigned).toBe(1);
    expect(plan.toInsert[0]?.assignment_status).toBe('unassigned');
    expect(plan.toInsert[0]?.created_by).toBe('user-1');
  });

  it('includeUnassigned=false 時，無老師時段應略過', () => {
    const plan = buildSessionGenerationPlan({
      orgId: 'org-1',
      classId: 'class-1',
      from: '2026-02-02',
      to: '2026-02-02',
      includeUnassigned: false,
      schedules: [
        {
          id: 'sch-1',
          weekday: 1,
          startTime: '18:00:00',
          endTime: '20:00:00',
          teacherId: null,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
        },
      ],
      existingKeys: new Set(),
      excludeDates: new Set(),
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.summary.skippedNoTeacher).toBe(1);
    expect(plan.preview[0]?.skipReason).toBe('no_teacher');
  });

  it('已存在課堂時應標記 exists 並計入 skippedExisting', () => {
    const plan = buildSessionGenerationPlan({
      orgId: 'org-1',
      classId: 'class-1',
      from: '2026-02-02',
      to: '2026-02-02',
      includeUnassigned: true,
      schedules: [
        {
          id: 'sch-1',
          weekday: 1,
          startTime: '18:00:00',
          endTime: '20:00:00',
          teacherId: 'teacher-1',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
        },
      ],
      existingKeys: new Set(['2026-02-02|18:00:00']),
      excludeDates: new Set(),
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.summary.skippedExisting).toBe(1);
    expect(plan.preview[0]?.exists).toBe(true);
    expect(plan.preview[0]?.skipReason).toBe('exists');
  });

  /**
   * #1100 #22：同一個時段可以前後接續（舊段止於 X−1、新段起於 X）。
   * classes.ts 的 preview／generate 原本就把 `effective_from` 傳進來，只是 planner 沒讀 ——
   * 這幾支鎖住「欄位加上之後行為照預期改變」。
   */
  describe('生效區間（#1100 #22）', () => {
    const slot = (
      id: string,
      effectiveFrom: string,
      effectiveTo: string | null,
      start = '18:00:00',
    ) => ({
      id,
      weekday: 1,
      startTime: start,
      endTime: '20:00:00',
      teacherId: 't-1',
      effectiveFrom,
      effectiveTo,
    });
    const plan = (schedules: ReturnType<typeof slot>[]) =>
      buildSessionGenerationPlan({
        orgId: 'org-1',
        classId: 'class-1',
        // 2026-02-02、02-09、02-16 都是週一
        from: '2026-02-02',
        to: '2026-02-16',
        includeUnassigned: false,
        schedules,
        existingKeys: new Set(),
        excludeDates: new Set(),
      });

    it('生效日之前的日期不產生（生效日當天要產生）', () => {
      const p = plan([slot('s', '2026-02-09', null)]);
      expect(p.toInsert.map((r) => r.session_date)).toEqual(['2026-02-09', '2026-02-16']);
    });

    it('舊段止於 X−1、新段起於 X：X 前後各由自己那段產生，不會同一天兩堂', () => {
      const p = plan([
        slot('old', '2026-01-01', '2026-02-08'),
        slot('new', '2026-02-09', null, '19:00:00'),
      ]);
      expect(p.toInsert.map((r) => [r.session_date, r.schedule_id])).toEqual([
        ['2026-02-02', 'old'],
        ['2026-02-09', 'new'],
        ['2026-02-16', 'new'],
      ]);
    });
  });
});
