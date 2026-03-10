import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import type { BatchActionResult, BatchAssignResult } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';
import { CalendarActionsService } from '../../services/calendar-actions.service';

export type MobileBatchMode = 'assign' | 'time' | 'cancel' | 'uncancel';

export interface MobileBatchDialogData {
  readonly sessionIds: string[];
  readonly selectedCount: number;
  readonly teachers: Staff[];
  readonly hasCancelledSelection: boolean;
  readonly initialMode: MobileBatchMode | null;
}

export interface MobileBatchDialogResult {
  readonly action: 'applied';
  readonly updated: number;
  readonly skipped: number;
  readonly mode: MobileBatchMode;
}

@Component({
  selector: 'app-mobile-batch-dialog',
  imports: [FormsModule, ButtonModule, SelectModule, InputTextModule],
  templateUrl: './mobile-batch-dialog.component.html',
  styleUrl: './mobile-batch-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBatchDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig<MobileBatchDialogData>);
  private readonly ref = inject(DynamicDialogRef);
  private readonly calendarActionsService = inject(CalendarActionsService);
  private readonly messageService = inject(MessageService);

  protected readonly teachers = signal<Staff[]>([]);
  protected readonly sessionIds = signal<string[]>([]);
  protected readonly selectedCount = signal(0);
  protected readonly hasCancelledSelection = signal(false);

  protected readonly batchMode = signal<MobileBatchMode | null>(null);
  protected readonly batchTeacherId = signal<string | null>(null);
  protected readonly batchStartTime = signal('09:00');
  protected readonly batchEndTime = signal('11:00');
  protected readonly batchCancelReason = signal('');
  protected readonly batchPreview = signal<BatchAssignResult | BatchActionResult | null>(null);
  protected readonly batchLoading = signal(false);

  protected readonly processableCount = computed(() => {
    const preview = this.batchPreview();
    if (!preview) return 0;
    if ('skippedConflicts' in preview) return preview.updated;
    return preview.processableIds.length;
  });

  protected readonly skippedCount = computed(() => {
    const preview = this.batchPreview();
    if (!preview) return 0;
    if ('skippedConflicts' in preview) return preview.skippedConflicts + preview.skippedNotEligible;
    return preview.skipped;
  });

  ngOnInit(): void {
    const data = this.config.data;
    if (!data) return;
    this.sessionIds.set([...data.sessionIds]);
    this.selectedCount.set(data.selectedCount);
    this.teachers.set(data.teachers);
    this.hasCancelledSelection.set(data.hasCancelledSelection);
    if (data.initialMode && (data.initialMode !== 'uncancel' || data.hasCancelledSelection)) {
      this.batchMode.set(data.initialMode);
    }
  }

  protected selectAction(mode: MobileBatchMode): void {
    this.batchMode.set(mode);
    this.batchPreview.set(null);
  }

  protected goBack(): void {
    this.batchMode.set(null);
    this.batchPreview.set(null);
    this.batchTeacherId.set(null);
    this.batchCancelReason.set('');
  }

  protected runPreview(): void {
    const ids = this.sessionIds();
    if (ids.length === 0) return;
    this.batchLoading.set(true);

    const obs = this.calendarActionsService.previewBatch(this.toBatchRequest());
    if (!obs) return;

    obs.subscribe({
      next: (result) => {
        this.batchPreview.set(result);
        this.batchLoading.set(false);
      },
      error: () => {
        this.batchLoading.set(false);
        this.messageService.add({ severity: 'error', summary: '預覽失敗', detail: '無法執行預覽' });
      },
    });
  }

  protected apply(): void {
    const ids = this.sessionIds();
    if (ids.length === 0) return;
    this.batchLoading.set(true);

    const obs = this.calendarActionsService.applyBatch(this.toBatchRequest());
    if (!obs) return;

    obs.subscribe({
      next: (result) => {
        this.batchLoading.set(false);
        const updated = 'updated' in result ? result.updated : 0;
        const skipped = this.skippedCount();
        const mode = this.batchMode() ?? 'cancel';
        this.ref.close({ action: 'applied', updated, skipped, mode } satisfies MobileBatchDialogResult);
      },
      error: () => {
        this.batchLoading.set(false);
        this.messageService.add({ severity: 'error', summary: '操作失敗', detail: '批次操作失敗' });
      },
    });
  }

  private toBatchRequest() {
    return {
      mode: this.batchMode(),
      sessionIds: this.sessionIds(),
      teacherId: this.batchTeacherId(),
      startTime: this.batchStartTime(),
      endTime: this.batchEndTime(),
      cancelReason: this.batchCancelReason(),
    } as const;
  }
}
