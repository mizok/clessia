import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import {
  SchoolExamsService,
  type SchoolScore,
  type SchoolScoreStatus,
  type SaveSchoolScoresInput,
} from '@core/school-exams.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { focusScoreRow, scoreKeyStep } from '../../score-keyboard.util';
import { isFailingScore } from '../../../../score-threshold.util';

export interface SchoolScoreRow {
  readonly subjectId: string;
  readonly subjectName: string;
  readonly score: number | null;
  readonly status: SchoolScoreStatus;
  readonly notes: string;
  readonly original: { score: number | null; status: SchoolScoreStatus; notes: string };
}

export interface ScoreEditDialogData {
  readonly examId: string;
  readonly examSubjectId: string | null;
  readonly examSubjectName: string | null;
  readonly disabled: boolean;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentGrade: string | null;
}

export interface ScoreEditDialogResult {
  readonly saved: boolean;
}

const GRADE_LABELS: Record<string, string> = {
  P1: '小一',
  P2: '小二',
  P3: '小三',
  P4: '小四',
  P5: '小五',
  P6: '小六',
  J1: '國一',
  J2: '國二',
  J3: '國三',
  S1: '高一',
  S2: '高二',
  S3: '高三',
};

const SCORE_STATUS_OPTIONS: Array<{ label: string; value: SchoolScoreStatus }> = [
  { label: '正常', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];

@Component({
  selector: 'app-score-edit-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    DrawerModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './score-edit-dialog.component.html',
  styleUrl: './score-edit-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScoreEditDialogComponent implements OnInit {
  private readonly schoolExamsService = inject(SchoolExamsService);
  private readonly host = inject(ElementRef);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<ScoreEditDialogData>);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly rows = signal<SchoolScoreRow[]>([]);

  protected subjectSheetVisible = false;
  protected readonly subjectSheetRow = signal<SchoolScoreRow | null>(null);

  protected readonly scoreStatusOptions = SCORE_STATUS_OPTIONS;
  protected readonly data = this.config.data;

  protected readonly isDirty = computed(() =>
    this.rows().some(
      (row) =>
        row.score !== row.original.score ||
        row.status !== row.original.status ||
        row.notes !== row.original.notes,
    ),
  );

  protected readonly dirtyCount = computed(
    () => this.rows().filter((row) => this.isRowDirty(row)).length,
  );

  ngOnInit(): void {
    this.refData.loadSubjects();
    this.loadRows();
  }

  protected formatGrade(grade: string | null): string {
    if (!grade) return '—';
    return GRADE_LABELS[grade] ?? grade;
  }

  /**
   * 這張表跟 `academy-score-editor` 是同一種東西（一列一個要打的分數），
   * 所以手感共用同一份（`score-keyboard.util`）。#161 只修了 academy 那份，
   * 這裡原封不動 —— 一列三欄，要按 3 次 Tab 才換一列，而 `↓` 會把分數減 1。
   */
  /** 不及格 —— 形狀訊號不只顏色。跟 academy 那份共用同一個門檻判斷 */
  protected isFailing(score: number | null): boolean {
    return isFailingScore(score);
  }

  protected onScoreKeydown(event: KeyboardEvent, index: number): void {
    const step = scoreKeyStep(event);
    if (step === 0) return;
    // 不擋的話 PrimeNG 會在換完焦點之後**還是**改掉原本那格
    event.preventDefault();
    focusScoreRow(this.host.nativeElement as HTMLElement, index + step, step, this.rows().length);
  }

  protected onScoreChange(row: SchoolScoreRow, value: number | null): void {
    this.updateRow(row.subjectId, {
      ...row,
      score: value,
    });
  }

  protected onStatusChange(row: SchoolScoreRow, value: SchoolScoreStatus): void {
    this.updateRow(row.subjectId, {
      ...row,
      status: value,
      score: value === 'absent' ? null : row.score,
    });
  }

  protected onNotesChange(row: SchoolScoreRow, value: string): void {
    this.updateRow(row.subjectId, {
      ...row,
      notes: value,
    });
  }

  protected openSubjectSheet(row: SchoolScoreRow): void {
    this.subjectSheetRow.set(row);
    this.subjectSheetVisible = true;
  }

  protected isAbsent(row: SchoolScoreRow): boolean {
    return row.status === 'absent';
  }

  protected isRowDirty(row: SchoolScoreRow): boolean {
    return (
      row.score !== row.original.score ||
      row.status !== row.original.status ||
      row.notes !== row.original.notes
    );
  }

  protected close(): void {
    if (!this.isDirty()) {
      this.ref.close();
      return;
    }

    this.confirmationService.confirm({
      message: '尚有未儲存的變更，確定要關閉嗎？',
      header: '確認關閉',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '關閉',
      rejectLabel: '取消',
      accept: () => this.ref.close(),
    });
  }

  protected save(): void {
    if (this.saving() || this.data?.disabled) return;

    const payload = this.buildSavePayload();
    if (payload.length === 0) {
      this.ref.close();
      return;
    }

    if (!this.data?.examId || !this.data.studentId) {
      this.ref.close();
      return;
    }

    this.saving.set(true);
    this.schoolExamsService
      .saveScores(this.data.examId, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ affected }) => {
          this.messageService.add({
            severity: 'success',
            summary: '儲存成功',
            detail: `已更新 ${affected} 筆成績`,
          });
          this.ref.close({ saved: true } satisfies ScoreEditDialogResult);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '儲存失敗',
            detail: '無法儲存成績，請稍後再試',
          });
          this.saving.set(false);
        },
      });
  }

  private loadRows(): void {
    if (!this.data?.examId || !this.data.studentId) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.schoolExamsService
      .getScores(this.data.examId, this.data.studentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.rows.set(this.buildScoreRows(data));
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: `無法載入 ${this.data?.studentName ?? '學生'} 的成績`,
          });
        },
      });
  }

  private buildScoreRows(existingScores: SchoolScore[]): SchoolScoreRow[] {
    const examSubjectId = this.data?.examSubjectId;
    const subjectRows = examSubjectId
      ? this.refData.subjects().filter((subject) => subject.id === examSubjectId)
      : this.refData.subjects();

    return subjectRows.map((subject) => {
      const existing = existingScores.find((score) => score.subjectId === subject.id);
      return {
        subjectId: subject.id,
        subjectName: subject.name,
        score: existing?.score ?? null,
        status: existing?.status ?? 'scored',
        notes: existing?.notes ?? '',
        original: {
          score: existing?.score ?? null,
          status: existing?.status ?? 'scored',
          notes: existing?.notes ?? '',
        },
      };
    });
  }

  private buildSavePayload(): SaveSchoolScoresInput[] {
    if (!this.data?.studentId) return [];

    const payload: SaveSchoolScoresInput[] = [];
    for (const row of this.rows()) {
      if (!this.isRowDirty(row)) continue;
      if (row.score === null && row.status === 'scored') continue;

      payload.push({
        studentId: this.data.studentId,
        subjectId: row.subjectId,
        score: row.score,
        status: row.status,
        notes: row.notes.trim() || null,
      });
    }

    return payload;
  }

  private updateRow(subjectId: string, nextRow: SchoolScoreRow): void {
    this.rows.update((rows) => rows.map((row) => (row.subjectId === subjectId ? nextRow : row)));
    const currentSheetRow = this.subjectSheetRow();
    if (currentSheetRow?.subjectId === subjectId) {
      this.subjectSheetRow.set(nextRow);
    }
  }
}
