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
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';

import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';

import {
  TermExamsService,
  type TermExamDetail,
  type TermScore,
  type TermScoreStatus,
  type RecentStudent,
  type SaveTermScoresInput,
} from '@core/term-exams.service';
import { StudentsService, type Student, type GradeLevel } from '@core/students.service';
import { ReferenceDataService } from '@core/reference-data.service';

export interface TermScoreRow {
  subjectId: string;
  subjectName: string;
  score: number | null;
  status: TermScoreStatus;
  notes: string;
  original: { score: number | null; status: TermScoreStatus; notes: string };
}

interface ExpandedStudent {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  rows: TermScoreRow[];
  loading: boolean;
}

const GRADE_OPTIONS: Array<{ label: string; value: GradeLevel }> = [
  { label: '小一', value: 'P1' },
  { label: '小二', value: 'P2' },
  { label: '小三', value: 'P3' },
  { label: '小四', value: 'P4' },
  { label: '小五', value: 'P5' },
  { label: '小六', value: 'P6' },
  { label: '國一', value: 'J1' },
  { label: '國二', value: 'J2' },
  { label: '國三', value: 'J3' },
  { label: '高一', value: 'S1' },
  { label: '高二', value: 'S2' },
  { label: '高三', value: 'S3' },
];

const STATUS_OPTIONS: Array<{ label: string; value: TermScoreStatus }> = [
  { label: '未登錄', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];

@Component({
  selector: 'app-term-score-editor',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    ButtonModule,
  ],
  templateUrl: './term-score-editor.component.html',
  styleUrl: './term-score-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermScoreEditorComponent implements OnInit {
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

  readonly exam = input.required<TermExamDetail>();
  readonly examId = input.required<string>();
  readonly disabled = input(false);

  readonly dirtyChange = output<boolean>();
  readonly savingChange = output<boolean>();
  readonly saved = output<void>();

  private readonly termExamsService = inject(TermExamsService);
  private readonly studentsService = inject(StudentsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly gradeOptions = GRADE_OPTIONS;
  protected readonly statusOptions = STATUS_OPTIONS;

  protected readonly searchTerm = signal('');
  protected readonly gradeFilter = signal<GradeLevel | null>(null);
  protected readonly recentStudents = signal<RecentStudent[]>([]);
  protected readonly searchResults = signal<Student[]>([]);
  protected readonly expandedStudents = signal<ExpandedStudent[]>([]);
  protected readonly loadingRecent = signal(true);
  protected readonly loadingSearch = signal(false);

  protected readonly subjects = computed(() => this.refData.subjects());

  private readonly searchTerm$ = new Subject<string>();

  protected readonly isDirty = computed(() => {
    return this.expandedStudents().some((s) =>
      s.rows.some(
        (r) =>
          r.score !== r.original.score ||
          r.status !== r.original.status ||
          r.notes !== r.original.notes,
      ),
    );
  });

  ngOnInit(): void {
    this.refData.loadSubjects();
    this.loadRecentStudents();
    this.setupSearch();
  }

  private loadRecentStudents(): void {
    this.loadingRecent.set(true);
    this.termExamsService
      .getRecentStudents(this.examId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.recentStudents.set(data);
          this.loadingRecent.set(false);
        },
        error: () => {
          this.loadingRecent.set(false);
        },
      });
  }

  private setupSearch(): void {
    this.searchTerm$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          if (term.length < 2) {
            return of(null);
          }
          this.loadingSearch.set(true);
          return this.studentsService.list({
            search: term,
            searchScope: 'student_name',
            grade: this.gradeFilter() ?? undefined,
            isActive: true,
            pageSize: 20,
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          if (res === null) {
            this.searchResults.set([]);
          } else {
            this.searchResults.set(res.data);
          }
          this.loadingSearch.set(false);
        },
        error: () => {
          this.loadingSearch.set(false);
        },
      });
  }

  protected onSearchInput(value: string): void {
    this.searchTerm.set(value);
    this.searchTerm$.next(value);
  }

  protected onGradeFilterChange(value: GradeLevel | null): void {
    this.gradeFilter.set(value);
    // Re-trigger search with new grade
    if (this.searchTerm().length >= 2) {
      this.searchTerm$.next(this.searchTerm());
    }
  }

  protected isExpanded(studentId: string): boolean {
    return this.expandedStudents().some((s) => s.studentId === studentId);
  }

  protected formatGrade(grade: string | null): string {
    if (!grade) return '—';
    return TermScoreEditorComponent.GRADE_LABELS[grade] ?? grade;
  }

  protected toggleStudent(studentId: string, studentName: string, studentGrade: string | null): void {
    const existing = this.expandedStudents().find((s) => s.studentId === studentId);
    if (existing) {
      this.expandedStudents.update((list) =>
        list.filter((s) => s.studentId !== studentId),
      );
      this.emitDirty();
      return;
    }

    const entry: ExpandedStudent = {
      studentId,
      studentName,
      studentGrade,
      rows: [],
      loading: true,
    };
    this.expandedStudents.update((list) => [...list, entry]);

    // Load scores for this student
    this.termExamsService
      .getScores(this.examId(), studentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const rows = this.buildScoreRows(data);
          this.expandedStudents.update((list) =>
            list.map((s) =>
              s.studentId === studentId ? { ...s, rows, loading: false } : s,
            ),
          );
        },
        error: () => {
          this.expandedStudents.update((list) =>
            list.map((s) =>
              s.studentId === studentId ? { ...s, loading: false } : s,
            ),
          );
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: `無法載入 ${studentName} 的成績`,
          });
        },
      });
  }

  private buildScoreRows(existingScores: TermScore[]): TermScoreRow[] {
    const subjects = this.subjects();
    return subjects.map((sub) => {
      const existing = existingScores.find((s) => s.subjectId === sub.id);
      return {
        subjectId: sub.id,
        subjectName: sub.name,
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

  protected onScoreChange(row: TermScoreRow, value: number | null): void {
    row.score = value;
    this.notifyChanged();
  }

  protected onStatusChange(row: TermScoreRow, value: TermScoreStatus): void {
    row.status = value;
    if (value === 'absent') {
      row.score = null;
    }
    this.notifyChanged();
  }

  protected onNotesChange(row: TermScoreRow, value: string): void {
    row.notes = value;
    this.notifyChanged();
  }

  protected isAbsent(row: TermScoreRow): boolean {
    return row.status === 'absent';
  }

  protected isRowDirty(row: TermScoreRow): boolean {
    return (
      row.score !== row.original.score ||
      row.status !== row.original.status ||
      row.notes !== row.original.notes
    );
  }

  private notifyChanged(): void {
    this.expandedStudents.update((list) => [...list]);
    this.emitDirty();
  }

  save(): void {
    const allInputs: SaveTermScoresInput[] = [];

    for (const student of this.expandedStudents()) {
      for (const row of student.rows) {
        const isDirty = this.isRowDirty(row);
        if (!isDirty) continue;
        if (row.score === null && row.status === 'scored') continue; // empty scored = skip

        allInputs.push({
          studentId: student.studentId,
          subjectId: row.subjectId,
          score: row.score,
          status: row.status,
          notes: row.notes.trim() || null,
        });
      }
    }

    if (allInputs.length === 0) return;

    this.savingChange.emit(true);
    this.termExamsService
      .saveScores(this.examId(), allInputs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ affected }) => {
          this.messageService.add({
            severity: 'success',
            summary: '儲存成功',
            detail: `已更新 ${affected} 筆成績`,
          });
          // Update originals
          for (const student of this.expandedStudents()) {
            for (const row of student.rows) {
              row.original = { score: row.score, status: row.status, notes: row.notes };
            }
          }
          this.savingChange.emit(false);
          this.emitDirty();
          this.saved.emit();
          this.loadRecentStudents(); // refresh recent list
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

  private emitDirty(): void {
    this.dirtyChange.emit(this.isDirty());
  }
}
