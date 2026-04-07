import { RoutesCatalog } from './routes-catalog';

describe('RoutesCatalog', () => {
  it('should expose student-specific labels for attendance and leave admin pages', () => {
    expect(RoutesCatalog.ADMIN_ATTENDANCE.label).toBe('課堂出勤紀錄');
    expect(RoutesCatalog.ADMIN_LEAVE.label).toBe('學生請假管理');
  });

  it('should place attendance under academic affairs before student affairs routes', () => {
    expect(RoutesCatalog.ADMIN_ATTENDANCE.group).toBe('課務管理');

    const attendanceIndex = RoutesCatalog.values.indexOf(RoutesCatalog.ADMIN_ATTENDANCE);
    const studentsIndex = RoutesCatalog.values.indexOf(RoutesCatalog.ADMIN_STUDENTS);

    expect(attendanceIndex).toBeGreaterThan(-1);
    expect(studentsIndex).toBeGreaterThan(-1);
    expect(attendanceIndex).toBeLessThan(studentsIndex);
  });
});
