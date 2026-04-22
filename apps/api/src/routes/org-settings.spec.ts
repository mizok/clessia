import { describe, it, expect } from 'vitest';
import { toOrgSettingsResponse } from './org-settings';

describe('toOrgSettingsResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'org-1',
      name: '測試補習班',
      attendance_mode: 'per_session',
    };
    const result = toOrgSettingsResponse(row);
    expect(result).toEqual({
      id: 'org-1',
      name: '測試補習班',
      attendanceMode: 'per_session',
      attendanceResponsible: 'admin',
      attendanceRetroactiveDays: 0,
    });
  });

  it('maps daily_checkin mode correctly', () => {
    const row = { id: 'org-1', name: '測試', attendance_mode: 'daily_checkin' };
    expect(toOrgSettingsResponse(row).attendanceMode).toBe('daily_checkin');
  });
});
