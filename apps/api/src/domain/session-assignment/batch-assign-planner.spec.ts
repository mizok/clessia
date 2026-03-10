import { describe, expect, it } from 'vitest';
import { planBatchAssign } from './batch-assign-planner';

describe('planBatchAssign', () => {
  it('skip-conflicts 應僅更新無衝突課堂', () => {
    const result = planBatchAssign({
      mode: 'skip-conflicts',
      includeAssigned: false,
      targetSessions: [
        {
          id: 's1',
          sessionDate: '2026-02-24',
          startTime: '18:00:00',
          endTime: '20:00:00',
          status: 'scheduled',
          assignmentStatus: 'unassigned',
        },
        {
          id: 's2',
          sessionDate: '2026-02-24',
          startTime: '20:00:00',
          endTime: '21:00:00',
          status: 'scheduled',
          assignmentStatus: 'unassigned',
        },
      ],
      teacherBusySlots: [
        {
          sessionId: 'busy-1',
          sessionDate: '2026-02-24',
          startTime: '18:30:00',
          endTime: '19:30:00',
        },
      ],
    });

    expect(result.updatedIds).toEqual(['s2']);
    expect(result.skippedConflicts).toBe(1);
    expect(result.conflicts).toHaveLength(1);
  });

  it('strict 在有衝突時應全部不更新', () => {
    const result = planBatchAssign({
      mode: 'strict',
      includeAssigned: false,
      targetSessions: [
        {
          id: 's1',
          sessionDate: '2026-02-24',
          startTime: '18:00:00',
          endTime: '20:00:00',
          status: 'scheduled',
          assignmentStatus: 'unassigned',
        },
      ],
      teacherBusySlots: [
        {
          sessionId: 'busy-1',
          sessionDate: '2026-02-24',
          startTime: '18:30:00',
          endTime: '19:30:00',
        },
      ],
    });

    expect(result.updatedIds).toEqual([]);
    expect(result.skippedConflicts).toBe(1);
  });

  it('force 應忽略衝突直接更新 eligible', () => {
    const result = planBatchAssign({
      mode: 'force',
      includeAssigned: false,
      targetSessions: [
        {
          id: 's1',
          sessionDate: '2026-02-24',
          startTime: '18:00:00',
          endTime: '20:00:00',
          status: 'scheduled',
          assignmentStatus: 'unassigned',
        },
      ],
      teacherBusySlots: [
        {
          sessionId: 'busy-1',
          sessionDate: '2026-02-24',
          startTime: '18:30:00',
          endTime: '19:30:00',
        },
      ],
    });

    expect(result.updatedIds).toEqual(['s1']);
    expect(result.skippedConflicts).toBe(0);
  });

  it('includeAssigned=false 時已指派課堂應被略過', () => {
    const result = planBatchAssign({
      mode: 'skip-conflicts',
      includeAssigned: false,
      targetSessions: [
        {
          id: 's1',
          sessionDate: '2026-02-24',
          startTime: '18:00:00',
          endTime: '20:00:00',
          status: 'scheduled',
          assignmentStatus: 'assigned',
        },
        {
          id: 's2',
          sessionDate: '2026-02-24',
          startTime: '20:00:00',
          endTime: '21:00:00',
          status: 'scheduled',
          assignmentStatus: 'unassigned',
        },
      ],
      teacherBusySlots: [],
    });

    expect(result.updatedIds).toEqual(['s2']);
    expect(result.skippedNotEligible).toBe(1);
  });

  it('includeAssigned=true 時已指派課堂也應被更新', () => {
    const result = planBatchAssign({
      mode: 'skip-conflicts',
      includeAssigned: true,
      targetSessions: [
        {
          id: 's1',
          sessionDate: '2026-02-24',
          startTime: '18:00:00',
          endTime: '20:00:00',
          status: 'scheduled',
          assignmentStatus: 'assigned',
        },
        {
          id: 's2',
          sessionDate: '2026-02-24',
          startTime: '20:00:00',
          endTime: '21:00:00',
          status: 'scheduled',
          assignmentStatus: 'unassigned',
        },
      ],
      teacherBusySlots: [],
    });

    expect(result.updatedIds).toEqual(['s1', 's2']);
    expect(result.skippedNotEligible).toBe(0);
  });
});
