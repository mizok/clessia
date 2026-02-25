import { Component, computed, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MultiSelectModule } from 'primeng/multiselect';

import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import {
  ClassesService,
  type BatchAssignMode,
  type BatchAssignTeacherInput,
  type BatchAssignTeacherResult,
} from '@core/classes.service';
import type { Staff } from '@core/staff.service';

interface TimeRangeForm {
  startTime: string;
  endTime: string;
}

interface WeekdayOption {
  label: string;
  value: number;
}

@Component({
  selector: 'app-batch-assign-wizard',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    ToggleSwitchModule,
    MultiSelectModule,
    MessageModule,
    TooltipModule,
  ],
  templateUrl: './batch-assign-wizard.component.html',
  styleUrl: './batch-assign-wizard.component.scss',
})
export class BatchAssignWizardComponent {
  // ── Inputs ────────────────────────────────────────────────────────────
  readonly classId = input.required<string>();
  readonly className = input.required<string>();
  readonly teachers = input.required<Staff[]>();
  readonly campusId = input.required<string>();
  readonly subjectId = input.required<string>();

  // ── Outputs ───────────────────────────────────────────────────────────
  readonly completed = output<void>();
  readonly cancelled = output<void>();

  // ── DI ────────────────────────────────────────────────────────────────
  private readonly classesService = inject(ClassesService);
  private readonly messageService = inject(MessageService);

  // ── Wizard State ──────────────────────────────────────────────────────
  protected readonly activeStep = signal(0);
  protected readonly loading = signal(false);

  protected readonly stepLabels = [
    { value: 0, label: '選擇老師' },
    { value: 1, label: '選擇範圍' },
    { value: 2, label: '進階設定' },
    { value: 3, label: '預覽確認' },
  ];

  // Step 1: 選擇老師
  protected readonly selectedTeacherId = signal<string | null>(null);

  // Step 2: 選擇範圍
  protected readonly dateFrom = signal<Date | null>(null);
  protected readonly dateTo = signal<Date | null>(null);
  protected readonly includeAssigned = signal(false);

  // Step 3: 進階設定
  protected readonly selectedWeekdays = signal<number[]>([]);
  protected readonly timeRanges = signal<TimeRangeForm[]>([]);
  protected readonly conflictMode = signal<BatchAssignMode>('skip-conflicts');

  // Step 4: 預覽結果
  protected readonly previewResult = signal<BatchAssignTeacherResult | null>(null);

  // ── Quick Preview（Step 2 即時預覽）─────────────────────────────────
  protected readonly quickPreview = signal<BatchAssignTeacherResult | null>(null);
  protected readonly quickPreviewLoading = signal(false);
  private quickPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // debounced auto-fetch: 日期 + 老師 + includeAssigned 改變時自動 dryRun
    effect(() => {
      const from = this.dateFrom();
      const to = this.dateTo();
      const teacherId = this.selectedTeacherId();
      const includeAssigned = this.includeAssigned();

      // 清除上次 timer
      if (this.quickPreviewTimer) {
        clearTimeout(this.quickPreviewTimer);
        this.quickPreviewTimer = null;
      }

      // 需 3 個值都有效才觸發
      if (!from || !to || !teacherId) {
        this.quickPreview.set(null);
        return;
      }
      const fromStr = this.toDateString(from);
      const toStr = this.toDateString(to);
      if (fromStr > toStr) {
        this.quickPreview.set(null);
        return;
      }

      // 500ms debounce
      this.quickPreviewTimer = setTimeout(() => {
        this.fetchQuickPreview(fromStr, toStr, teacherId, includeAssigned);
      }, 500);
    });

    // Cleanup timer on destroy
    this.destroyRef.onDestroy(() => {
      if (this.quickPreviewTimer) {
        clearTimeout(this.quickPreviewTimer);
      }
    });
  }

  private fetchQuickPreview(
    from: string,
    to: string,
    teacherId: string,
    includeAssigned: boolean,
  ): void {
    this.quickPreviewLoading.set(true);
    const payload: BatchAssignTeacherInput = {
      from,
      to,
      toTeacherId: teacherId,
      mode: 'skip-conflicts',
      includeAssigned,
      dryRun: true,
    };
    this.classesService.batchAssignTeacher(this.classId(), payload).subscribe({
      next: (result) => {
        this.quickPreview.set(result);
        this.quickPreviewLoading.set(false);
      },
      error: () => {
        this.quickPreview.set(null);
        this.quickPreviewLoading.set(false);
      },
    });
  }

  protected readonly quickPreviewTotal = computed(() => {
    const qp = this.quickPreview();
    if (!qp) return 0;
    return qp.updated + qp.skippedConflicts + qp.skippedNotEligible;
  });

  // ── Options ───────────────────────────────────────────────────────────
  protected readonly teacherOptions = computed(() => {
    const campus = this.campusId();
    const subject = this.subjectId();
    return this.teachers()
      .filter(
        (s) =>
          s.roles.includes('teacher') &&
          s.isActive &&
          s.campusIds.includes(campus) &&
          s.subjectIds.includes(subject),
      )
      .map((s) => ({ label: s.displayName, value: s.id }));
  });

  protected readonly weekdayOptions: WeekdayOption[] = [
    { label: '一', value: 1 },
    { label: '二', value: 2 },
    { label: '三', value: 3 },
    { label: '四', value: 4 },
    { label: '五', value: 5 },
    { label: '六', value: 6 },
    { label: '日', value: 7 },
  ];

  protected readonly conflictModeOptions = [
    { label: '遇到時間衝突就跳過（建議）', value: 'skip-conflicts' as BatchAssignMode },
    { label: '有任何衝突就全部不執行', value: 'strict' as BatchAssignMode },
    { label: '忽略衝突直接指派', value: 'force' as BatchAssignMode },
  ];

  // ── Computed ──────────────────────────────────────────────────────────
  protected readonly selectedTeacherName = computed(() => {
    const id = this.selectedTeacherId();
    if (!id) return '';
    const teacher = this.teachers().find((t) => t.id === id);
    return teacher?.displayName ?? '';
  });

  protected readonly canProceed = computed(() => {
    switch (this.activeStep()) {
      case 0:
        return !!this.selectedTeacherId();
      case 1:
        return !!this.dateFrom() && !!this.dateTo() && this.dateFromStr() <= this.dateToStr();
      case 2:
        return true; // 進階設定皆為可選
      case 3:
        return !!this.previewResult() && !this.previewResult()!.dryRun === false;
      default:
        return false;
    }
  });

  protected readonly canApply = computed(() => {
    const preview = this.previewResult();
    if (!preview) return false;
    if (this.conflictMode() === 'strict' && preview.conflicts.length > 0) return false;
    return preview.updated > 0;
  });

  // ── Step Navigation ───────────────────────────────────────────────────
  protected goNext(): void {
    const step = this.activeStep();
    if (step === 2) {
      // 從進階設定到預覽 → 自動觸發 dryRun
      this.runPreview();
    } else if (step < 3) {
      this.activeStep.set(step + 1);
    }
  }

  protected goPrev(): void {
    const step = this.activeStep();
    if (step > 0) {
      if (step === 3) {
        this.previewResult.set(null);
      }
      this.activeStep.set(step - 1);
    }
  }

  // ── Time Range Helpers ────────────────────────────────────────────────
  protected addTimeRange(): void {
    this.timeRanges.update((list) => [...list, { startTime: '', endTime: '' }]);
  }

  protected removeTimeRange(index: number): void {
    this.timeRanges.update((list) => list.filter((_, i) => i !== index));
  }

  protected updateTimeRange(index: number, field: 'startTime' | 'endTime', value: string): void {
    this.timeRanges.update((list) =>
      list.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  // ── API Calls ─────────────────────────────────────────────────────────
  private runPreview(): void {
    const payload = this.buildPayload(true);
    if (!payload) return;

    this.loading.set(true);
    this.classesService.batchAssignTeacher(this.classId(), payload).subscribe({
      next: (result) => {
        this.previewResult.set(result);
        this.activeStep.set(3);
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '預覽失敗',
          detail: '無法取得預覽結果，請稍後再試。',
        });
        this.loading.set(false);
      },
    });
  }

  protected confirm(): void {
    const payload = this.buildPayload(false);
    if (!payload) return;

    this.loading.set(true);
    this.classesService.batchAssignTeacher(this.classId(), payload).subscribe({
      next: (result) => {
        this.messageService.add({
          severity: 'success',
          summary: '批次指派完成',
          detail: `成功指派 ${result.updated} 堂課。`,
        });
        this.loading.set(false);
        this.completed.emit();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '指派失敗',
          detail: '批次指派過程中發生錯誤，請稍後再試。',
        });
        this.loading.set(false);
      },
    });
  }

  // ── Payload Builder ───────────────────────────────────────────────────
  private buildPayload(dryRun: boolean): BatchAssignTeacherInput | null {
    const teacherId = this.selectedTeacherId();
    const from = this.dateFrom();
    const to = this.dateTo();
    if (!teacherId || !from || !to) return null;

    const filledRanges = this.timeRanges().filter((r) => !!r.startTime || !!r.endTime);
    const normalizedRanges = filledRanges.map((r) => ({
      startTime: this.normalizeTime(r.startTime),
      endTime: this.normalizeTime(r.endTime),
    }));

    const hasInvalidRange = normalizedRanges.some(
      (r) => !r.startTime || !r.endTime || r.startTime >= r.endTime,
    );
    if (hasInvalidRange) {
      this.messageService.add({
        severity: 'warn',
        summary: '時段區間錯誤',
        detail: '請確認每個時段都填寫完整，且開始時間早於結束時間。',
      });
      return null;
    }

    return {
      from: this.dateFromStr(),
      to: this.dateToStr(),
      toTeacherId: teacherId,
      mode: this.conflictMode(),
      includeAssigned: this.includeAssigned(),
      weekday: this.selectedWeekdays().length > 0 ? this.selectedWeekdays() : undefined,
      timeRanges: normalizedRanges.length > 0 ? normalizedRanges : undefined,
      dryRun,
    };
  }

  // ── Utilities ─────────────────────────────────────────────────────────
  private dateFromStr(): string {
    return this.toDateString(this.dateFrom()!);
  }

  private dateToStr(): string {
    return this.toDateString(this.dateTo()!);
  }

  private toDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private normalizeTime(value: string): string {
    if (!value) return '';
    return value.length === 5 ? `${value}:00` : value;
  }
}
