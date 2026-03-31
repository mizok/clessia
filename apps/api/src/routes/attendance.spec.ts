import { describe, it, expect } from 'vitest';
import { toAttendanceResponse } from './attendance';

describe('toAttendanceResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'ar-1',
      org_id: 'org-1',
      student_id: 'stu-1',
      student_name: '王小明',
      event_id: 'ev-1',
      event_date: '2026-04-01',
      start_time: '14:00',
      end_time: '16:00',
      campus_name: '中正分校',
      class_name: '國一數學A班',
      status: 'present',
      note: null,
      recorded_by: null,
      recorded_by_role: null,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    };
    const result = toAttendanceResponse(row);
    expect(result.id).toBe('ar-1');
    expect(result.studentName).toBe('王小明');
    expect(result.status).toBe('present');
    expect(result.eventDate).toBe('2026-04-01');
  });
});
