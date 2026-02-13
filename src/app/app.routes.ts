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
        path: 'login',
        loadComponent: () =>
          import('@features/public/pages/login/login.component').then((m) => m.LoginComponent),
        canActivate: [guestGuard],
        data: { animation: 'Login' },
      },
      {
        path: 'trial',
        loadComponent: () =>
          import('@features/public/pages/trial/trial.component').then((m) => m.TrialComponent),
        data: { animation: 'Trial' },
      },
      {
        path: 'enrollment',
        loadComponent: () =>
          import('@features/public/pages/enrollment/enrollment.component').then(
            (m) => m.EnrollmentComponent,
          ),
        data: { animation: 'Enrollment' },
      },
      {
        path: 'qr-checkin',
        loadComponent: () =>
          import('@features/public/pages/qr-checkin/qr-checkin.component').then(
            (m) => m.QrCheckinComponent,
          ),
        data: { animation: 'QrCheckin' },
      },
      {
        path: 'forgot-password',
        loadComponent: () =>
          import('@features/public/pages/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
        canActivate: [guestGuard],
        data: { animation: 'ForgotPassword' },
      },
      {
        path: 'reset-password',
        loadComponent: () =>
          import('@features/public/pages/reset-password/reset-password.component').then(
            (m) => m.ResetPasswordComponent,
          ),
        canActivate: [guestGuard],
        data: { animation: 'ResetPassword' },
      },
      {
        path: 'change-password',
        loadComponent: () =>
          import('@features/public/pages/change-password/change-password.component').then(
            (m) => m.ChangePasswordComponent,
          ),
        data: { animation: 'ChangePassword' },
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
            data: { animation: 'AdminDashboard' },
          },
          {
            path: RoutesCatalog.ADMIN_CALENDAR.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/calendar/calendar.page').then((m) => m.CalendarPage),
            data: { animation: 'AdminCalendar' },
          },
          {
            path: RoutesCatalog.ADMIN_ATTENDANCE.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/attendance/attendance.page').then(
                (m) => m.AttendancePage,
              ),
            data: { animation: 'AdminAttendance' },
          },
          {
            path: RoutesCatalog.ADMIN_LEAVE.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/leave/leave.page').then((m) => m.LeavePage),
            data: { animation: 'AdminLeave' },
          },
          {
            path: RoutesCatalog.ADMIN_STUDENTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/students/students.page').then((m) => m.StudentsPage),
            data: { animation: 'AdminStudents' },
          },
          {
            path: RoutesCatalog.ADMIN_PARENTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/parents/parents.page').then((m) => m.ParentsPage),
            data: { animation: 'AdminParents' },
          },
          {
            path: RoutesCatalog.ADMIN_COURSES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/courses/courses.page').then((m) => m.CoursesPage),
            data: { animation: 'AdminCourses' },
          },
          {
            path: RoutesCatalog.ADMIN_SCHEDULE.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/schedule/schedule.page').then((m) => m.SchedulePage),
            data: { animation: 'AdminSchedule' },
          },
          {
            path: RoutesCatalog.ADMIN_PAYMENTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/payments/payments.page').then((m) => m.PaymentsPage),
            data: { animation: 'AdminPayments' },
          },
          {
            path: RoutesCatalog.ADMIN_REPORTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/reports/reports.page').then((m) => m.ReportsPage),
            data: { animation: 'AdminReports' },
          },
          {
            path: RoutesCatalog.ADMIN_CAMPUSES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/campuses/campuses.page').then((m) => m.CampusesPage),
            data: { animation: 'AdminCampuses' },
          },
          {
            path: RoutesCatalog.ADMIN_SETTINGS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/settings/settings.page').then((m) => m.SettingsPage),
            data: { animation: 'AdminSettings' },
          },
          {
            path: 'change-password',
            loadComponent: () =>
              import('@features/public/pages/change-password/change-password.component').then(
                (m) => m.ChangePasswordComponent,
              ),
            data: { animation: 'AdminChangePassword' },
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
            data: { animation: 'TeacherDashboard' },
          },
          {
            path: RoutesCatalog.TEACHER_SCHEDULE.relativePath,
            loadComponent: () =>
              import('@features/teacher/pages/schedule/schedule.page').then((m) => m.SchedulePage),
            data: { animation: 'TeacherSchedule' },
          },
          {
            path: RoutesCatalog.TEACHER_ATTENDANCE.relativePath,
            loadComponent: () =>
              import('@features/teacher/pages/attendance/attendance.page').then(
                (m) => m.AttendancePage,
              ),
            data: { animation: 'TeacherAttendance' },
          },
          {
            path: RoutesCatalog.TEACHER_STUDENTS.relativePath,
            loadComponent: () =>
              import('@features/teacher/pages/students/students.page').then(
                (m) => m.StudentsPage,
              ),
            data: { animation: 'TeacherStudents' },
          },
          {
            path: 'change-password',
            loadComponent: () =>
              import('@features/public/pages/change-password/change-password.component').then(
                (m) => m.ChangePasswordComponent,
              ),
            data: { animation: 'TeacherChangePassword' },
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
            data: { animation: 'ParentDashboard' },
          },
          {
            path: RoutesCatalog.PARENT_ATTENDANCE.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/attendance/attendance.page').then(
                (m) => m.AttendancePage,
              ),
            data: { animation: 'ParentAttendance' },
          },
          {
            path: RoutesCatalog.PARENT_PAYMENTS.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/payments/payments.page').then((m) => m.PaymentsPage),
            data: { animation: 'ParentPayments' },
          },
          {
            path: RoutesCatalog.PARENT_COMMUNICATION.relativePath,
            loadComponent: () =>
              import('@features/parent/pages/communication/communication.page').then(
                (m) => m.CommunicationPage,
              ),
            data: { animation: 'ParentCommunication' },
          },
          {
            path: 'change-password',
            loadComponent: () =>
              import('@features/public/pages/change-password/change-password.component').then(
                (m) => m.ChangePasswordComponent,
              ),
            data: { animation: 'ParentChangePassword' },
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
