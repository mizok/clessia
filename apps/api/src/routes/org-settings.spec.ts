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
      // 欄位不在的舊 org 用 14 —— 對齊 billing_rules 規則 7 的「發袋後兩三週」節奏
      invoiceDueDays: 14,
    });
  });

  it('org 有設定天數時照用', () => {
    const row = { id: 'org-1', name: '測試', attendance_mode: 'per_session', invoice_due_days: 21 };

    expect(toOrgSettingsResponse(row).invoiceDueDays).toBe(21);
  });

  it('maps daily_checkin mode correctly', () => {
    const row = { id: 'org-1', name: '測試', attendance_mode: 'daily_checkin' };
    expect(toOrgSettingsResponse(row).attendanceMode).toBe('daily_checkin');
  });
});
