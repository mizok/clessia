import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig, DialogService } from 'primeng/dynamicdialog';
import { SessionsService, Session, SessionQueryParams } from '@core/sessions.service';
import { Class } from '@core/classes.service';
import { Staff } from '@core/staff.service';
import { BatchAssignWizardComponent } from '../batch-assign-wizard/batch-assign-wizard.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { format } from 'date-fns';

@Component({
  selector: 'app-session-list-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, ToggleSwitch, TagModule, EmptyStateComponent],
  templateUrl: './session-list-dialog.component.html',
  styleUrl: './session-list-dialog.component.scss',
})
export class SessionListDialogComponent implements OnInit {
  private readonly sessionsService = inject(SessionsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly cls = signal<Class | null>(this.config.data?.cls ?? null);
  protected readonly staff = signal<Staff[]>(this.config.data?.staff ?? []);

  protected readonly sessions = signal<Session[]>([]);
  protected readonly includePast = signal(false);
  protected readonly page = signal(1);
  protected readonly hasMore = signal(true);
  private readonly PAGE_SIZE = 20;

  protected readonly breadcrumb = computed(() => {
    const c = this.cls();
    if (!c) return '';
    return `${c.campusName ?? ''} › ${c.courseName ?? ''}`;
  });

  protected readonly batchAssignSubjectId = computed(() => {
    return this.config.data?.subjectId ?? '';
  });

  ngOnInit(): void {
    if (this.cls()) {
      this.loadSessions(true);
    }
  }

  protected loadSessions(isInitial: boolean): void {
    const c = this.cls();
    if (!c) return;

    this.loading.set(true);
    const params: SessionQueryParams = {
      classId: c.id,
      page: this.page(),
      pageSize: this.PAGE_SIZE,
    };

    if (!this.includePast()) {
      params.from = format(new Date(), 'yyyy-MM-dd');
    }

    this.sessionsService.list(params).subscribe({
      next: (res) => {
        if (isInitial) {
          this.sessions.set(res.data);
        } else {
          this.sessions.update((prev) => [...prev, ...res.data]);
        }
        this.hasMore.set(res.data.length === this.PAGE_SIZE);
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '載入失敗',
          detail: '無法取得課堂列表',
        });
        this.loading.set(false);
      },
    });
  }

  protected togglePast(): void {
    this.includePast.set(!this.includePast());
    this.page.set(1);
    this.loadSessions(true);
  }

  protected loadMore(): void {
    if (!this.hasMore() || this.loading()) return;
    this.page.update((p) => p + 1);
    this.loadSessions(false);
  }

  protected openBatchAssign(): void {
    const c = this.cls();
    if (!c) return;

    // Use a nested dialog or the same window? The original UI opened a Dialog on top.
    // DynamicDialog can open another dialog.
    const ref = this.dialogService.open(BatchAssignWizardComponent, {
      header: '批次指派老師',
      width: '600px',
      modal: true,
      showHeader: false,
      data: {
        classId: c.id,
        className: c.name,
        teachers: this.staff(),
        campusId: c.campusId,
        subjectId: this.batchAssignSubjectId(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result) => {
        if (result) {
          this.page.set(1);
          this.loadSessions(true);
        }
      });
  }

  protected close(): void {
    this.ref.close();
  }
}
