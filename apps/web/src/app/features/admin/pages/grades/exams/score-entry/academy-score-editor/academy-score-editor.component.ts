import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';

import {
  AcademyExamsService,
  type AcademyExamDetail,
  type AcademyScore,
  type AcademyScoreStatus,
  type SaveAcademyScoresInput,
} from '@core/academy-exams.service';

export interface ScoreRow {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  score: number | null;
  status: AcademyScoreStatus;
  notes: string;
  /** 原始快照，用於 dirty check */
  original: {
    score: number | null;
    status: AcademyScoreStatus;
    notes: string;
  };
}

const STATUS_OPTIONS: Array<{ label: string; value: AcademyScoreStatus }> = [
  { label: '未登錄', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];

@Component({
  selector: 'app-academy-score-editor',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    ButtonModule,
  ],
  templateUrl: './academy-score-editor.component.html',
  styleUrl: './academy-score-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcademyScoreEditorComponent implements OnInit {
  private static readonly GRADE_LABELS: Record<string, string> = {
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

  readonly exam = input.required<AcademyExamDetail>();
  readonly examId = input.required<string>();
  readonly disabled = input(false);

  readonly dirtyChange = output<boolean>();
  readonly savingChange = output<boolean>();
  readonly saved = output<void>();

  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly loading = signal(true);
  protected readonly rows = signal<ScoreRow[]>([]);
  protected readonly classFilter = signal<string | null>(null);

  protected readonly classOptions = computed(() => {
    const exam = this.exam();
    if (!exam || exam.classes.length <= 1) return [];
    return [
      { label: '全部班級', value: null as string | null },
      ...exam.classes.map((c) => ({ label: c.className, value: c.classId as string | null })),
    ];
  });

  protected readonly filteredRows = computed(() => {
    const filter = this.classFilter();
    const all = this.rows();
    if (!filter) return all;
    // API returns class info per student — 目前 AcademyScore 不含 classId
    // 所以 classFilter 暫時只在前端做篩選 placeholder
    // TODO: 當 API 回傳 classId 時啟用篩選
    return all;
  });

  protected readonly isDirty = computed(() => {
    return this.rows().some((r) => this.isRowDirty(r));
  });

  ngOnInit(): void {
    this.loadScores();
  }

  private loadScores(): void {
    this.loading.set(true);
    this.academyExamsService
      .getScores(this.examId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.rows.set(this.toScoreRows(data));
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學生成績名單',
          });
          this.loading.set(false);
        },
      });
  }

  private toScoreRows(scores: AcademyScore[]): ScoreRow[] {
    return scores.map((s) => ({
      studentId: s.studentId,
      studentName: s.studentName,
      studentGrade: s.studentGrade,
      score: s.score,
      status: s.status,
      notes: s.notes ?? '',
      original: {
        score: s.score,
        status: s.status,
        notes: s.notes ?? '',
      },
    }));
  }

  protected onScoreChange(row: ScoreRow, value: number | null): void {
    row.score = value;
    this.notifyRowsChanged();
  }

  protected onStatusChange(row: ScoreRow, value: AcademyScoreStatus): void {
    row.status = value;
    if (value === 'absent') {
      row.score = null;
    }
    this.notifyRowsChanged();
  }

  protected onNotesChange(row: ScoreRow, value: string): void {
    row.notes = value;
    this.notifyRowsChanged();
  }

  /** Force signal re-evaluation by creating a new array ref */
  private notifyRowsChanged(): void {
    this.rows.set([...this.rows()]);
    this.emitDirty();
  }

  protected isAbsent(row: ScoreRow): boolean {
    return row.status === 'absent';
  }

  protected formatGrade(grade: string | null): string {
    if (!grade) return '—';
    return AcademyScoreEditorComponent.GRADE_LABELS[grade] ?? grade;
  }

  save(): void {
    const dirtyRows = this.rows().filter(
      (r) => this.isRowDirty(r) && (r.score !== null || r.status !== 'scored'),
    );
    if (dirtyRows.length === 0) return;

    const input: SaveAcademyScoresInput[] = dirtyRows.map((r) => ({
      studentId: r.studentId,
      score: r.score,
      status: r.status,
      notes: r.notes.trim() || null,
    }));

    this.savingChange.emit(true);
    this.academyExamsService
      .saveScores(this.examId(), input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ affected }) => {
          this.messageService.add({
            severity: 'success',
            summary: '儲存成功',
            detail: `已更新 ${affected} 筆成績`,
          });
          // 更新 original 快照
          for (const r of this.rows()) {
            r.original = { score: r.score, status: r.status, notes: r.notes };
          }
          this.savingChange.emit(false);
          this.emitDirty();
          this.saved.emit();
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '儲存失敗',
            detail: '無法儲存成績，請稍後再試',
          });
          this.savingChange.emit(false);
        },
      });
  }

  protected isRowDirty(row: ScoreRow): boolean {
    return (
      row.score !== row.original.score ||
      row.status !== row.original.status ||
      row.notes !== row.original.notes
    );
  }

  private emitDirty(): void {
    this.dirtyChange.emit(this.isDirty());
  }
}
