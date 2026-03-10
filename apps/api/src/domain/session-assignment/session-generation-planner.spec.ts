import { describe, expect, it } from 'vitest';
import { buildSessionGenerationPlan } from './session-generation-planner';

describe('buildSessionGenerationPlan', () => {
  it('includeUnassigned=true 時，無老師時段應建立為 unassigned', () => {
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
          teacherId: null,
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
});
