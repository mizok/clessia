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

  it('should expose exam management and score overview under the exams and scores board', () => {
    expect(RoutesCatalog.ADMIN_GRADES_EXAMS.label).toBe('考試管理');
    expect(RoutesCatalog.ADMIN_GRADES_OVERVIEW.label).toBe('成績總覽');
    expect(RoutesCatalog.ADMIN_GRADES_EXAMS.group).toBe(NavigationGroup.ADMIN_LEARNING_CENTER);
    expect(RoutesCatalog.ADMIN_GRADES_OVERVIEW.group).toBe(NavigationGroup.ADMIN_LEARNING_CENTER);
    expect(RoutesCatalog.ADMIN_GRADES_EXAMS.showInMenu).toBe(true);
    expect(RoutesCatalog.ADMIN_GRADES_OVERVIEW.showInMenu).toBe(true);
  });

  it('should register score entry as a non-menu sub-page under grades', () => {
    expect(RoutesCatalog.ADMIN_GRADES_SCORE_ENTRY.label).toBe('成績登錄');
    expect(RoutesCatalog.ADMIN_GRADES_SCORE_ENTRY.showInMenu).toBe(false);
    expect(RoutesCatalog.ADMIN_GRADES_SCORE_ENTRY.relativePath).toBe('grades/exams/:type/:id/scores');
  });

  it('should centralize navigation board labels in smart enums', () => {
    expect(NavigationGroup.ADMIN_ACADEMICS.label).toBe('課務管理');
    expect(NavigationGroup.ADMIN_STUDENT_AFFAIRS.label).toBe('學務管理');
    expect(NavigationGroup.ADMIN_LEARNING_CENTER.label).toBe('考務與成績');
  });
});
