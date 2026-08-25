import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { type Session } from '@core/sessions.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';

export interface SessionListMenuRequest {
  readonly event: MouseEvent;
  readonly session: Session;
}

@Component({
  selector: 'app-session-list',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    SkeletonModule,
    TagModule,
    ResponsiveTableComponent,
    RtColCellDirective,
    RtColDefDirective,
    RtRowDirective,
  ],
  templateUrl: './session-list.component.html',
  styleUrl: './session-list.component.scss',
})
export class SessionListComponent {
  readonly sessions = input<readonly Session[]>([]);
  readonly loading = input(false);
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  readonly total = input(0);
  readonly pageSize = input(50);
  readonly currentPage = input(1);

  readonly selectedIdsChange = output<string[]>();
  readonly contextMenuRequested = output<SessionListMenuRequest>();
  readonly pageChange = output<number>();

  protected readonly sessionCountLabel = computed(() => {
    const visibleCount = this.sessions().length;
    const total = this.total();
    if (visibleCount === 0 && total === 0) return '';
    const cancelled = this.sessions().filter((s) => s.status === 'cancelled').length;
    const unassigned = this.sessions().filter(
      (s) => s.assignmentStatus === 'unassigned' && s.status === 'scheduled',
    ).length;
    const parts = [
      total > visibleCount ? `本頁 ${visibleCount} 堂，共 ${total} 堂` : `共 ${visibleCount} 堂`,
    ];
    if (unassigned > 0) parts.push(`${unassigned} 堂未指派`);
    if (cancelled > 0) parts.push(`${cancelled} 堂已停課`);
    return parts.join('・');
  });

  protected readonly listPagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.pageSize(), 0),
    rows: this.pageSize(),
    totalRecords: this.total(),
  }));

  protected readonly allPageSelected = computed(() => {
    const page = this.sessions();
    if (page.length === 0) return false;
    const ids = this.selectedIds();
    return page.every((session) => ids.has(session.id));
  });

  protected onListPage(event: ResponsiveTablePageEvent): void {
    this.pageChange.emit((event.page ?? 0) + 1);
  }

  protected toggleSelectAll(): void {
    const page = this.sessions();
    const updated = new Set(this.selectedIds());
    if (this.allPageSelected()) {
      page.forEach((session) => updated.delete(session.id));
    } else {
      page.forEach((session) => updated.add(session.id));
    }
    this.emitSelected(updated);
  }

  protected toggleSelect(sessionId: string): void {
    const updated = new Set(this.selectedIds());
    if (updated.has(sessionId)) {
      updated.delete(sessionId);
    } else {
      updated.add(sessionId);
    }
    this.emitSelected(updated);
  }

  protected openContextMenu(event: MouseEvent, session: Session): void {
    this.contextMenuRequested.emit({ event, session });
  }

  protected getDayLabel(date: string): string {
    const labels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    return labels[new Date(date).getDay()];
  }

  protected sessionStatusLabel(session: Session): string {
    if (session.status === 'cancelled') return '已停課';
    if (session.status === 'completed') return '已完成';
    return '正常';
  }

  protected sessionStatusSeverity(session: Session): 'info' | 'secondary' | 'success' {
    if (session.status === 'cancelled') return 'secondary';
    if (session.status === 'completed') return 'success';
    return 'info';
  }

  private isFutureSession(session: Session): boolean {
    return session.sessionDate > new Date().toISOString().slice(0, 10);
  }

  protected attendanceStatusLabel(session: Session): string {
    if (session.status === 'cancelled') return '不適用';
    if (this.isFutureSession(session)) return '未開放點名';
    if (session.attendanceTakenAt) return '已點名';

    const enrolledCount = session.attendanceEnrolledCount;
    return typeof enrolledCount === 'number' && enrolledCount > 0
      ? `未點名 ${enrolledCount} 人`
      : '未點名';
  }

  protected attendanceStatusSeverity(session: Session): 'success' | 'info' | 'secondary' | 'warn' {
    if (session.status === 'cancelled') return 'secondary';
    if (this.isFutureSession(session)) return 'secondary';
    if (session.attendanceTakenAt) return 'success';
    if (session.status === 'completed') return 'warn';
    return 'info';
  }

  protected attendanceStatusSummary(session: Session): string {
    if (session.status === 'cancelled') return '';
    if (this.isFutureSession(session)) return '';
    const presentCount = session.attendancePresentCount ?? 0;
    const onLeaveCount = session.attendanceOnLeaveCount ?? 0;
    const absentCount = session.attendanceAbsentCount ?? 0;
    const hasRecordedStatuses = presentCount > 0 || onLeaveCount > 0 || absentCount > 0;

    if (session.attendanceTakenAt || hasRecordedStatuses) {
      return `到 ${presentCount} ・ 請 ${onLeaveCount} ・ 缺 ${absentCount}`;
    }

    const enrolledCount = session.attendanceEnrolledCount;
    return typeof enrolledCount === 'number' && enrolledCount > 0
      ? `${enrolledCount} 人待點名`
      : '';
  }

  private emitSelected(selected: ReadonlySet<string>): void {
    this.selectedIdsChange.emit([...selected]);
  }
}
