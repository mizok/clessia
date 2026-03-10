import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { Popover, PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { type ScheduleChange, type Session, SessionsService } from '@core/sessions.service';
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
    PopoverModule,
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

  private readonly sessionsService = inject(SessionsService);
  private readonly changesPopover = viewChild<Popover>('changesPopover');

  protected readonly popoverChanges = signal<ScheduleChange[]>([]);
  protected readonly popoverLoading = signal(false);

  readonly selectedIdsChange = output<string[]>();
  readonly contextMenuRequested = output<SessionListMenuRequest>();

  private readonly first = signal(0);
  private readonly rows = signal(20);

  private readonly paginatedFirst = computed(() => {
    const total = this.sessions().length;
    const rows = this.rows();
    const first = this.first();
    if (total === 0) return 0;
    if (first < total) return first;
    return Math.floor((total - 1) / rows) * rows;
  });

  protected readonly sessionCountLabel = computed(() => {
    const total = this.sessions().length;
    if (total === 0) return '';
    const cancelled = this.sessions().filter(s => s.status === 'cancelled').length;
    const unassigned = this.sessions().filter(
      s => s.assignmentStatus === 'unassigned' && s.status === 'scheduled'
    ).length;
    const parts = [`共 ${total} 堂`];
    if (unassigned > 0) parts.push(`${unassigned} 堂未指派`);
    if (cancelled > 0) parts.push(`${cancelled} 堂已停課`);
    return parts.join('・');
  });

  protected readonly listPagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: this.paginatedFirst(),
    rows: this.rows(),
    totalRecords: this.sessions().length,
    rowsPerPageOptions: [20, 50, 100],
  }));

  protected readonly paginatedSessions = computed(() => {
    const all = this.sessions();
    const first = this.paginatedFirst();
    const rows = this.rows();
    return all.slice(first, first + rows);
  });

  protected readonly allPageSelected = computed(() => {
    const page = this.paginatedSessions();
    if (page.length === 0) return false;
    const ids = this.selectedIds();
    return page.every((session) => ids.has(session.id));
  });

  protected onListPage(event: ResponsiveTablePageEvent): void {
    this.first.set(event.first);
    this.rows.set(event.rows);
  }

  protected toggleSelectAll(): void {
    const page = this.paginatedSessions();
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
    return '已排課';
  }

  protected sessionStatusSeverity(session: Session): 'info' | 'secondary' | 'success' {
    if (session.status === 'cancelled') return 'secondary';
    if (session.status === 'completed') return 'success';
    return 'info';
  }

  protected openChangesPopover(event: MouseEvent, session: Session): void {
    event.stopPropagation();
    const popover = this.changesPopover();
    if (!popover) return;
    popover.toggle(event);
    this.popoverChanges.set([]);
    this.popoverLoading.set(true);
    this.sessionsService.getChanges(session.id).subscribe({
      next: (res) => {
        this.popoverChanges.set(res.data);
        this.popoverLoading.set(false);
      },
      error: () => this.popoverLoading.set(false),
    });
  }

  protected changeTypeLabel(type: string): string {
    const map: Record<string, string> = {
      cancellation: '停課',
      substitute: '代課',
      reschedule: '調課',
      uncancel: '取消停課',
    };
    return map[type] ?? type;
  }

  protected changeTypeSeverity(
    type: string,
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    const map: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'> =
      { cancellation: 'danger', substitute: 'warn', reschedule: 'info', uncancel: 'success' };
    return map[type] ?? 'info';
  }

  private emitSelected(selected: ReadonlySet<string>): void {
    this.selectedIdsChange.emit([...selected]);
  }
}
