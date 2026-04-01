import { RoutesCatalog } from './routes-catalog';

describe('RoutesCatalog', () => {
  it('should expose student-specific labels for attendance and leave admin pages', () => {
    expect(RoutesCatalog.ADMIN_ATTENDANCE.label).toBe('課堂出勤紀錄');
    expect(RoutesCatalog.ADMIN_LEAVE.label).toBe('學生請假紀錄');
  });
});
