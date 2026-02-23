import { Routes } from '@angular/router';
import { authGuard } from '@core/auth.guard';
import { roleGuard } from '@core/role.guard';
import { guestGuard } from '@core/guest.guard';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('@features/public/public-shell.component').then((m) => m.PublicShellComponent),
    children: [
      {
        path: RoutesCatalog.PUBLIC_LOGIN.relativePath,
        loadComponent: () =>
          import('@features/public/pages/login/login.component').then((m) => m.LoginComponent),
        canActivate: [guestGuard],
      },
      {
        path: RoutesCatalog.PUBLIC_TRIAL.relativePath,
        loadComponent: () =>
          import('@features/public/pages/trial/trial.component').then((m) => m.TrialComponent),
      },
      {
        path: RoutesCatalog.PUBLIC_ENROLLMENT.relativePath,
        loadComponent: () =>
          import('@features/public/pages/enrollment/enrollment.component').then(
            (m) => m.EnrollmentComponent,
          ),
      },
      {
        path: RoutesCatalog.PUBLIC_CHECKIN.relativePath,
        loadComponent: () =>
          import('@features/public/pages/qr-checkin/qr-checkin.component').then(
            (m) => m.QrCheckinComponent,
          ),
      },
      {
        path: RoutesCatalog.PUBLIC_FORGOT_PASSWORD.relativePath,
        loadComponent: () =>
          import('@features/public/pages/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
        canActivate: [guestGuard],
      },
      {
        path: RoutesCatalog.PUBLIC_RESET_PASSWORD.relativePath,
        loadComponent: () =>
          import('@features/public/pages/reset-password/reset-password.component').then(
            (m) => m.ResetPasswordComponent,
          ),
        canActivate: [guestGuard],
      },
      {
        path: RoutesCatalog.PUBLIC_CHANGE_PASSWORD.relativePath,
        loadComponent: () =>
          import('@features/public/pages/change-password/change-password.component').then(
            (m) => m.ChangePasswordComponent,
          ),
      },
      { path: '', redirectTo: 'login', pathMatch: 'full' },
    ],
  },
  // Authenticated Shell (Admin / Teacher / Parent)
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('@shared/components/layout/shell-layout/shell-layout.component').then(
        (m) => m.ShellLayoutComponent,
      ),
    children: [
      // Admin
      {
        path: RoutesCatalog.ADMIN_ROOT.relativePath,
        canActivate: [roleGuard('admin')],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('@shared/components/sidebar/sidebar.component').then(
                (m) => m.SidebarComponent,
              ),
            outlet: 'sidebar',
          },
          {
            path: '',
            loadComponent: () =>
              import('@shared/components/bottom-bar/bottom-bar.component').then(
                (m) => m.BottomBarComponent,
              ),
            outlet: 'bottom-bar',
          },
          {
            path: RoutesCatalog.ADMIN_DASHBOARD.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/dashboard/dashboard.component').then(
                (m) => m.DashboardComponent,
              ),
            data: { page: RoutesCatalog.ADMIN_DASHBOARD },
          },
          {
            path: RoutesCatalog.ADMIN_CALENDAR.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/calendar/calendar.page').then((m) => m.CalendarPage),
            data: { page: RoutesCatalog.ADMIN_CALENDAR },
          },
          {
            path: RoutesCatalog.ADMIN_ATTENDANCE.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/attendance/attendance.page').then(
                (m) => m.AttendancePage,
              ),
            data: { page: RoutesCatalog.ADMIN_ATTENDANCE },
          },
          {
            path: RoutesCatalog.ADMIN_LEAVE.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/leave/leave.page').then((m) => m.LeavePage),
            data: { page: RoutesCatalog.ADMIN_LEAVE },
          },
          {
            path: RoutesCatalog.ADMIN_MEALS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/meals/meals.component').then((m) => m.MealsComponent),
            data: { page: RoutesCatalog.ADMIN_MEALS },
          },
          {
            path: RoutesCatalog.ADMIN_GRADES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/grades/grades.component').then((m) => m.GradesComponent),
            data: { page: RoutesCatalog.ADMIN_GRADES },
          },
          {
            path: RoutesCatalog.ADMIN_SESSIONS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/sessions/sessions.component').then(
                (m) => m.SessionsComponent,
              ),
            data: { page: RoutesCatalog.ADMIN_SESSIONS },
          },
          {
            path: RoutesCatalog.ADMIN_CHANGES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/changes/changes.component').then(
                (m) => m.ChangesComponent,
              ),
            data: { page: RoutesCatalog.ADMIN_CHANGES },
          },
          {
            path: RoutesCatalog.ADMIN_TASKS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/tasks/tasks.component').then((m) => m.TasksComponent),
            data: { page: RoutesCatalog.ADMIN_TASKS },
          },
          {
            path: RoutesCatalog.ADMIN_NOTIFICATIONS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/notifications/notifications.component').then(
                (m) => m.NotificationsComponent,
              ),
            data: { page: RoutesCatalog.ADMIN_NOTIFICATIONS },
          },
          {
            path: RoutesCatalog.ADMIN_STUDENTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/students/students.page').then((m) => m.StudentsPage),
            data: { page: RoutesCatalog.ADMIN_STUDENTS },
          },
          {
            path: RoutesCatalog.ADMIN_PARENTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/parents/parents.page').then((m) => m.ParentsPage),
            data: { page: RoutesCatalog.ADMIN_PARENTS },
          },
          {
            path: RoutesCatalog.ADMIN_COURSES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/courses/courses.page').then((m) => m.CoursesPage),
            data: { page: RoutesCatalog.ADMIN_COURSES },
          },
          {
            path: RoutesCatalog.ADMIN_SCHEDULE.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/schedule/schedule.page').then((m) => m.SchedulePage),
            data: { page: RoutesCatalog.ADMIN_SCHEDULE },
          },
          {
            path: RoutesCatalog.ADMIN_PAYMENTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/payments/payments.page').then((m) => m.PaymentsPage),
            data: { page: RoutesCatalog.ADMIN_PAYMENTS },
          },
          {
            path: RoutesCatalog.ADMIN_REPORTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/reports/reports.page').then((m) => m.ReportsPage),
            data: { page: RoutesCatalog.ADMIN_REPORTS },
          },
          {
            path: RoutesCatalog.ADMIN_CAMPUSES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/campuses/campuses.page').then((m) => m.CampusesPage),
            data: { page: RoutesCatalog.ADMIN_CAMPUSES },
          },
          {
            path: RoutesCatalog.ADMIN_SETTINGS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/settings/settings.page').then((m) => m.SettingsPage),
            data: { page: RoutesCatalog.ADMIN_SETTINGS },
          },
          {
            path: RoutesCatalog.ADMIN_CLASSES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/classes/classes.page').then((m) => m.ClassesPage),
            data: { page: RoutesCatalog.ADMIN_CLASSES },
          },
          {
            path: RoutesCatalog.ADMIN_ENROLLMENT.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/enrollment/enrollment.component').then(
                (m) => m.EnrollmentComponent,
              ),
            data: { page: RoutesCatalog.ADMIN_ENROLLMENT },
          },
          {
            path: RoutesCatalog.ADMIN_FEE_TEMPLATES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/fee-templates/fee-templates.component').then(
                (m) => m.FeeTemplatesComponent,
              ),
            data: { page: RoutesCatalog.ADMIN_FEE_TEMPLATES },
          },
          {
            path: RoutesCatalog.ADMIN_STAFF.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/staff/staff.page').then((m) => m.StaffPage),
            data: { page: RoutesCatalog.ADMIN_STAFF },
          },
          {
            path: RoutesCatalog.ADMIN_CHANGE_PASSWORD.relativePath,
            loadComponent: () =>
              import('@features/public/pages/change-password/change-password.component').then(
                (m) => m.ChangePasswordComponent,
              ),
            data: { page: RoutesCatalog.ADMIN_CHANGE_PASSWORD },
          },
          {
            path: '',
            redirectTo: RoutesCatalog.ADMIN_DASHBOARD.relativePath,
            pathMatch: 'full',
          },
        ],
      },

      // Teacher
      {
        path: RoutesCatalog.TEACHER_ROOT.relativePath,
        canActivate: [roleGuard('teacher')],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('@shared/components/sidebar/sidebar.component').then(
                (m) => m.SidebarComponent,
              ),
            outlet: 'sidebar',
          },
          {
            path: '',
            loadComponent: () =>
              import('@shared/components/bottom-bar/bottom-bar.component').then(
                (m) => m.BottomBarComponent,
              ),
            outlet: 'bottom-bar',
          },
          {
            path: RoutesCatalog.TEACHER_DASHBOARD.relativePath,
            loadComponent: () =>
              import('@features/teacher/pages/dashboard/dashboard.component').then(
                (m) => m.DashboardComponent,
              ),
            data: { page: RoutesCatalog.TEACHER_DASHBOARD },
          },
          {
            path: RoutesCatalog.TEACHER_NOTIFICATIONS.relativePath,
            loadComponent: () =>
              import('@features/teacher/pages/notifications/notifications.component').then(
                (m) => m.NotificationsComponent,
              ),
            data: { page: RoutesCatalog.TEACHER_NOTIFICATIONS },
          },
          {
            path: RoutesCatalog.TEACHER_SCHEDULE.relativePath,
            loadComponent: () =>
              import('@features/teacher/pages/schedule/schedule.page').then((m) => m.SchedulePage),
            data: { page: RoutesCatalog.TEACHER_SCHEDULE },
          },
          {
            path: RoutesCatalog.TEACHER_ATTENDANCE.relativePath,
            loadComponent: () =>
              import('@features/teacher/pages/attendance/attendance.page').then(
                (m) => m.AttendancePage,
              ),
            data: { page: RoutesCatalog.TEACHER_ATTENDANCE },
          },
          {
            path: RoutesCatalog.TEACHER_STUDENTS.relativePath,
            loadComponent: () =>
              import('@features/teacher/pages/students/students.page').then(
                (m) => m.StudentsPage,
              ),
            data: { page: RoutesCatalog.TEACHER_STUDENTS },
          },
          {
            path: RoutesCatalog.TEACHER_CHANGE_PASSWORD.relativePath,
            loadComponent: () =>
              import('@features/public/pages/change-password/change-password.component').then(
                (m) => m.ChangePasswordComponent,
              ),
            data: { page: RoutesCatalog.TEACHER_CHANGE_PASSWORD },
          },
          {
            path: '',
            redirectTo: RoutesCatalog.TEACHER_SCHEDULE.relativePath,
            pathMatch: 'full',
          },
        ],
      },

      // Parent
      {
        path: RoutesCatalog.PARENT_ROOT.relativePath,
        canActivate: [roleGuard('parent')],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('@shared/components/sidebar/sidebar.component').then(
                (m) => m.SidebarComponent,
              ),
            outlet: 'sidebar',
          },
          {
            path: '',
            loadComponent: () =>
              import('@shared/components/bottom-bar/bottom-bar.component').then(
                (m) => m.BottomBarComponent,
              ),
            outlet: 'bottom-bar',
          },
          {
            path: RoutesCatalog.PARENT_DASHBOARD.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
            data: { page: RoutesCatalog.PARENT_DASHBOARD },
          },
          {
            path: RoutesCatalog.PARENT_ATTENDANCE.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/attendance/attendance.page').then(
                (m) => m.AttendancePage,
              ),
            data: { page: RoutesCatalog.PARENT_ATTENDANCE },
          },
          {
            path: RoutesCatalog.PARENT_SCHEDULE.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/schedule/schedule.component').then(
                (m) => m.ScheduleComponent,
              ),
            data: { page: RoutesCatalog.PARENT_SCHEDULE },
          },
          {
            path: RoutesCatalog.PARENT_GRADES.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/grades/grades.component').then(
                (m) => m.GradesComponent,
              ),
            data: { page: RoutesCatalog.PARENT_GRADES },
          },
          {
            path: RoutesCatalog.PARENT_MEALS.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/meals/meals.component').then(
                (m) => m.MealsComponent,
              ),
            data: { page: RoutesCatalog.PARENT_MEALS },
          },
          {
            path: RoutesCatalog.PARENT_TRIAL.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/trial/trial.component').then(
                (m) => m.TrialComponent,
              ),
            data: { page: RoutesCatalog.PARENT_TRIAL },
          },
          {
            path: RoutesCatalog.PARENT_ENROLLMENT.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/enrollment/enrollment.component').then(
                (m) => m.EnrollmentComponent,
              ),
            data: { page: RoutesCatalog.PARENT_ENROLLMENT },
          },
          {
            path: RoutesCatalog.PARENT_ADD_COURSE.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/add-course/add-course.component').then(
                (m) => m.AddCourseComponent,
              ),
            data: { page: RoutesCatalog.PARENT_ADD_COURSE },
          },
          {
            path: RoutesCatalog.PARENT_PAYMENTS.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/payments/payments.page').then((m) => m.PaymentsPage),
            data: { page: RoutesCatalog.PARENT_PAYMENTS },
          },
          {
            path: RoutesCatalog.PARENT_RENEWAL.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/renewal/renewal.component').then(
                (m) => m.RenewalComponent,
              ),
            data: { page: RoutesCatalog.PARENT_RENEWAL },
          },
          {
            path: RoutesCatalog.PARENT_NOTIFICATIONS.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/notifications/notifications.component').then(
                (m) => m.NotificationsComponent,
              ),
            data: { page: RoutesCatalog.PARENT_NOTIFICATIONS },
          },
          {
            path: RoutesCatalog.PARENT_CHANGE_PASSWORD.relativePath,
            loadComponent: () =>
              import('@features/public/pages/change-password/change-password.component').then(
                (m) => m.ChangePasswordComponent,
              ),
            data: { page: RoutesCatalog.PARENT_CHANGE_PASSWORD },
          },
          {
            path: '',
            redirectTo: RoutesCatalog.PARENT_DASHBOARD.relativePath,
            pathMatch: 'full',
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
