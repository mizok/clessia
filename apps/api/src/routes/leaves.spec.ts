import { describe, it, expect } from 'vitest';
import { toLeaveResponse } from './leaves';

describe('toLeaveResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'lr-1',
      org_id: 'org-1',
      student_id: 'stu-1',
      student_name: '王小明',
      start_date: '2026-04-01',
      end_date: '2026-04-01',
      reason: '身體不適',
      submitted_by: 'user-1',
      submitted_by_role: 'admin',
      submitted_by_name: '張老師',
      created_at: '2026-04-01T00:00:00Z',
    };
    const result = toLeaveResponse(row);
    expect(result.id).toBe('lr-1');
    expect(result.studentName).toBe('王小明');
    expect(result.submittedByRole).toBe('admin');
  });
});
