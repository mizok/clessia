import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { endOfWeek, format, startOfWeek } from 'date-fns';
import { forkJoin } from 'rxjs';

import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { StudentsService } from '@core/students.service';
import { RouteObj, RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { summariseTeacherWeek } from './dashboard.util';

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly studentsService = inject(StudentsService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly today = format(new Date(), 'yyyy-MM-dd');
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly weekSessions = signal<EventSessionSummary[]>([]);
  protected readonly studentCount = signal(0);

  protected readonly stats = computed(() =>
    summariseTeacherWeek(this.weekSessions(), this.today, new Date()),
  );

  protected readonly todaySessions = computed(() =>
    this.weekSessions()
      .filter((s) => s.eventDate === this.today)
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')),
  );

  constructor() {
    const now = new Date();
    const from = startOfWeek(now, { weekStartsOn: 1 });
    const to = endOfWeek(now, { weekStartsOn: 1 });

    forkJoin({
      // 範圍由後端依角色強制成「我的課」「我的學生」，這裡不必也不能指定別人
      sessions: this.attendanceService.sessions({
        dateFrom: format(from, 'yyyy-MM-dd'),
        dateTo: format(to, 'yyyy-MM-dd'),
        pageSize: 100,
      }),
      students: this.studentsService.list({ taughtByMe: true, pageSize: 1 }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.weekSessions.set(res.sessions.data);
          this.studentCount.set(res.students.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  protected goToSchedule(): void {
    this.router.navigate([RoutesCatalog.TEACHER_SCHEDULE.absolutePath]);
  }

  protected goToStudents(): void {
    this.router.navigate([RoutesCatalog.TEACHER_STUDENTS.absolutePath]);
  }
}
