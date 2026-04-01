import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { type Session } from '@core/sessions.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { LeaveService } from '@core/leave.service';
import { GRADE_LEVEL_LABELS } from '@core/students.service';

type LeaveFilterValue = 'all' | 'on_leave' | 'present';

interface RosterRow {
  studentId: string;
  studentName: string;
  studentGrade: string;
  studentSchool: string;
  isOnLeave: boolean;
  leaveReason: string | null;
  leaveStartTime: string | null;
  leaveEndTime: string | null;
}

@Component({
  selector: 'app-session-leave-roster-dialog',
  standalone: true,
  imports: [ButtonModule, InputTextModule, SkeletonModule, TagModule],
  templateUrl: './session-leave-roster-dialog.component.html',
  styleUrl: './session-leave-roster-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionLeaveRosterDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly leaveService = inject(LeaveService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly roster = signal<RosterRow[]>([]);
  protected readonly session = signal<Session | null>(null);

  protected readonly nameFilter = signal('');
  protected readonly leaveFilter = signal<LeaveFilterValue>('all');
  protected readonly currentPage = signal(1);
  protected readonly pageSize = 10;

  protected readonly leaveOptions: { label: string; value: LeaveFilterValue }[] = [
    { label: '全部', value: 'all' },
    { label: '請假', value: 'on_leave' },
    { label: '出席', value: 'present' },
  ];

  protected readonly filteredRoster = computed(() => {
    const name = this.nameFilter().trim().toLowerCase();
    const leave = this.leaveFilter();
    return this.roster().filter((r) => {
      const nameMatch = !name || r.studentName.toLowerCase().includes(name);
      const leaveMatch =
        leave === 'all' ||
        (leave === 'on_leave' && r.isOnLeave) ||
        (leave === 'present' && !r.isOnLeave);
      return nameMatch && leaveMatch;
    });
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredRoster().length / this.pageSize)),
  );

  protected readonly pagedRoster = computed(() => {
    const page = this.currentPage();
    const start = (page - 1) * this.pageSize;
    return this.filteredRoster().slice(start, start + this.pageSize);
  });

  protected gradeLabel(grade: string): string {
    return GRADE_LEVEL_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }

  protected get onLeaveCount(): number {
    return this.roster().filter((r) => r.isOnLeave).length;
  }

  protected setNameFilter(value: string): void {
    this.nameFilter.set(value);
    this.currentPage.set(1);
  }

  protected setLeaveFilter(value: LeaveFilterValue): void {
    this.leaveFilter.set(value);
    this.currentPage.set(1);
  }

  protected prevPage(): void {
    if (this.currentPage() > 1) this.currentPage.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.currentPage() < this.totalPages()) this.currentPage.update((p) => p + 1);
  }

  ngOnInit(): void {
    const s: Session | undefined = this.config.data?.session;
    if (!s) {
      this.loading.set(false);
      return;
    }
    this.session.set(s);
    this.loadRoster(s);
  }

  private loadRoster(s: Session): void {
    forkJoin({
      enrollments: this.enrollmentsService.list({ classId: s.classId, pageSize: 100 }),
      leaves: this.leaveService.list({ coverDate: s.sessionDate, pageSize: 100 }),
    }).subscribe({
      next: ({ enrollments, leaves }) => {
        const leaveMap = new Map(leaves.data.map((l) => [l.studentId, l]));

        const rows: RosterRow[] = enrollments.data
          .filter((e) => e.status === 'active' || e.status === 'pending_payment')
          .map((e) => {
            const leave = leaveMap.get(e.studentId);
            return {
              studentId: e.studentId,
              studentName: e.studentName,
              studentGrade: e.studentGrade,
              studentSchool: e.studentSchool,
              isOnLeave: !!leave,
              leaveReason: leave?.reason ?? null,
              leaveStartTime: leave?.startTime ?? null,
              leaveEndTime: leave?.endTime ?? null,
            };
          })
          .sort((a, b) => {
            if (a.isOnLeave !== b.isOnLeave) return a.isOnLeave ? -1 : 1;
            return a.studentName.localeCompare(b.studentName, 'zh-TW');
          });

        this.roster.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('[LeaveRoster] API error', err);
        this.error.set('載入資料失敗，請重新整理後再試');
        this.loading.set(false);
      },
    });
  }

  protected close(): void {
    this.ref.close();
  }
}
