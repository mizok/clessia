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
            path: RoutesCatalog.ADMIN_SESSIONS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/sessions/sessions.page').then((m) => m.SessionsPage),
            data: { page: RoutesCatalog.ADMIN_SESSIONS },
          },
          {
            path: RoutesCatalog.ADMIN_ATTENDANCE.relativePath,
            redirectTo: RoutesCatalog.ADMIN_SESSIONS.relativePath,
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
            children: [
              {
                path: '',
                redirectTo: 'exams',
                pathMatch: 'full',
              },
              {
                path: 'exams',
                loadComponent: () =>
                  import('@features/admin/pages/grades/exams/exams.component').then(
                    (m) => m.ExamsComponent,
                  ),
                data: { page: RoutesCatalog.ADMIN_GRADES_EXAMS },
              },
              {
                path: 'exams/:type/:id/scores',
                loadComponent: () =>
                  import(
                    '@features/admin/pages/grades/exams/score-entry/score-entry.component'
                  ).then((m) => m.ScoreEntryComponent),
                data: { page: RoutesCatalog.ADMIN_GRADES_SCORE_ENTRY },
                canDeactivate: [
                  (component: { canDeactivate: () => boolean }) => component.canDeactivate(),
                ],
              },
              {
                path: 'overview',
                children: [
                  {
                    path: '',
                    loadComponent: () =>
                      import('@features/admin/pages/grades/overview/overview.component').then(
                        (m) => m.OverviewComponent,
                      ),
                    data: { page: RoutesCatalog.ADMIN_GRADES_OVERVIEW },
                  },
                  {
                    path: 'student',
                    loadComponent: () =>
                      import(
                        '@features/admin/pages/grades/overview/student-view/student-view.component'
                      ).then((m) => m.StudentViewComponent),
                    data: { page: RoutesCatalog.ADMIN_GRADES_OVERVIEW_STUDENT },
                  },
                  {
                    path: 'class',
                    loadComponent: () =>
                      import(
                        '@features/admin/pages/grades/overview/class-view/class-view.component'
                      ).then((m) => m.ClassViewComponent),
                    data: { page: RoutesCatalog.ADMIN_GRADES_OVERVIEW_CLASS },
                  },
                ],
              },
              // 舊路由 redirect
              { path: 'academy-exams', redirectTo: 'exams', pathMatch: 'full' },
              { path: 'school-exam-entry', redirectTo: 'exams', pathMatch: 'full' },
              { path: 'score-records', redirectTo: 'overview', pathMatch: 'full' },
            ],
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
            path: RoutesCatalog.ADMIN_STUDENT_DETAIL.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/students/detail/student-detail.page').then(
                (m) => m.StudentDetailPage,
              ),
            data: { page: RoutesCatalog.ADMIN_STUDENT_DETAIL },
          },
          {
            path: RoutesCatalog.ADMIN_PARENTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/parents/parents.page').then((m) => m.ParentsPage),
            data: { page: RoutesCatalog.ADMIN_PARENTS },
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
            path: RoutesCatalog.ADMIN_SCHOOLS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/schools/schools.page').then((m) => m.SchoolsPage),
            data: { page: RoutesCatalog.ADMIN_SCHOOLS },
          },
          {
            path: RoutesCatalog.ADMIN_SUBJECTS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/subjects/subjects.page').then((m) => m.SubjectsPage),
            data: { page: RoutesCatalog.ADMIN_SUBJECTS },
          },
          {
            path: RoutesCatalog.ADMIN_SETTINGS.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/settings/settings.page').then((m) => m.SettingsPage),
            data: { page: RoutesCatalog.ADMIN_SETTINGS },
          },
          {
            path: RoutesCatalog.ADMIN_COURSES.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/courses/courses.page').then((m) => m.CoursesPage),
            data: { page: RoutesCatalog.ADMIN_COURSES },
          },
          {
            path: RoutesCatalog.ADMIN_CLASS_DETAIL.relativePath,
            loadComponent: () =>
              import('@features/admin/pages/courses/class-detail/class-detail.page').then(
                (m) => m.ClassDetailPage,
              ),
            data: { page: RoutesCatalog.ADMIN_CLASS_DETAIL },
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
