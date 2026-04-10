import { RoutesCatalog } from './routes-catalog';
import { NavigationGroup } from './navigation-group';

describe('RoutesCatalog', () => {
  it('should expose student-specific labels for attendance and leave admin pages', () => {
    expect(RoutesCatalog.ADMIN_ATTENDANCE.label).toBe('課堂出勤紀錄');
    expect(RoutesCatalog.ADMIN_LEAVE.label).toBe('學生請假管理');
  });

  it('should place attendance under academic affairs before student affairs routes', () => {
    expect(RoutesCatalog.ADMIN_ATTENDANCE.group).toBe(NavigationGroup.ADMIN_ACADEMICS);
    expect(RoutesCatalog.ADMIN_ATTENDANCE.showInMenu).toBe(false);

    const attendanceIndex = RoutesCatalog.values.indexOf(RoutesCatalog.ADMIN_ATTENDANCE);
    const studentsIndex = RoutesCatalog.values.indexOf(RoutesCatalog.ADMIN_STUDENTS);

    expect(attendanceIndex).toBeGreaterThan(-1);
    expect(studentsIndex).toBeGreaterThan(-1);
    expect(attendanceIndex).toBeLessThan(studentsIndex);
  });

  it('should expose learning outcomes as its own admin board instead of student affairs', () => {
    expect(RoutesCatalog.ADMIN_GRADES.label).toBe('考務與成績');
    expect(RoutesCatalog.ADMIN_GRADES.group).toBe(NavigationGroup.ADMIN_LEARNING_CENTER);
    expect(RoutesCatalog.ADMIN_GRADES.showInMenu).toBe(false);
  });

  it('should expose exam subpages under the exams and scores board', () => {
    expect(RoutesCatalog.ADMIN_GRADES_ACADEMY_EXAMS.label).toBe('補習班考試');
    expect(RoutesCatalog.ADMIN_GRADES_TERM_ENTRY.label).toBe('段考登錄');
    expect(RoutesCatalog.ADMIN_GRADES_RECORDS.label).toBe('成績查閱');
    expect(RoutesCatalog.ADMIN_GRADES_ACADEMY_EXAMS.group).toBe(NavigationGroup.ADMIN_LEARNING_CENTER);
    expect(RoutesCatalog.ADMIN_GRADES_TERM_ENTRY.group).toBe(NavigationGroup.ADMIN_LEARNING_CENTER);
    expect(RoutesCatalog.ADMIN_GRADES_RECORDS.group).toBe(NavigationGroup.ADMIN_LEARNING_CENTER);
  });

  it('should centralize navigation board labels in smart enums', () => {
    expect(NavigationGroup.ADMIN_ACADEMICS.label).toBe('課務管理');
    expect(NavigationGroup.ADMIN_STUDENT_AFFAIRS.label).toBe('學務管理');
    expect(NavigationGroup.ADMIN_LEARNING_CENTER.label).toBe('考務與成績');
  });
});
