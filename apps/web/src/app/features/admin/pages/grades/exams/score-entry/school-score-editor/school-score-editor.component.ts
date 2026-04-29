import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';

import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DrawerModule } from 'primeng/drawer';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { PaginatorModule } from 'primeng/paginator';
import { MessageService, ConfirmationService } from 'primeng/api';

import {
  SchoolExamsService,
  type SchoolExamDetail,
  type SchoolExamStudent,
  type SchoolExamStudentStatus,
  type SchoolScore,
  type SchoolScoreStatus,
  type SaveSchoolScoresInput,
} from '@core/school-exams.service';
import { type GradeLevel } from '@core/students.service';
import { ReferenceDataService } from '@core/reference-data.service';

export interface SchoolScoreRow {
  subjectId: string;
  subjectName: string;
  score: number | null;
  status: SchoolScoreStatus;
  notes: string;
  original: { score: number | null; status: SchoolScoreStatus; notes: string };
}

interface DialogStudent {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  rows: SchoolScoreRow[];
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

const SCORE_STATUS_OPTIONS: Array<{ label: string; value: SchoolScoreStatus }> = [
  { label: '正常', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];

const STUDENT_STATUS_OPTIONS: Array<{ label: string; value: SchoolExamStudentStatus }> = [
  { label: '全部', value: 'all' },
  { label: '待登錄', value: 'pending' },
  { label: '已登錄', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];

@Component({
  selector: 'app-school-score-editor',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    SelectModule,
    SelectButtonModule,
    ButtonModule,
    DialogModule,
    DrawerModule,
    TagModule,
    ConfirmDialogModule,
    PaginatorModule,
  ],
  templateUrl: './school-score-editor.component.html',
  styleUrl: './school-score-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ConfirmationService],
})
export class SchoolScoreEditorComponent implements OnInit {
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

  readonly exam = input.required<SchoolExamDetail>();
  readonly examId = input.required<string>();
  readonly disabled = input(false);

  readonly dirtyChange = output<boolean>();
  readonly savingChange = output<boolean>();
  readonly saved = output<void>();
  readonly filterChange = output<{ campusId: string; grade: string | null }>();

  private readonly schoolExamsService = inject(SchoolExamsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly gradeOptions = GRADE_OPTIONS;
  protected readonly scoreStatusOptions = SCORE_STATUS_OPTIONS;
  protected readonly studentStatusOptions = STUDENT_STATUS_OPTIONS;

  // Filters
  protected readonly campusId = signal<string>('');
  protected readonly statusFilter = signal<SchoolExamStudentStatus>('all');
  protected readonly searchTerm = signal('');
  protected readonly gradeFilter = signal<GradeLevel | null>(null);

  // Student list
  protected readonly students = signal<SchoolExamStudent[]>([]);
  protected readonly loadingStudents = signal(false);
  protected readonly totalStudents = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = 50;

  // Dialog
  protected dialogVisible = false;
  protected readonly dialogStudent = signal<DialogStudent | null>(null);

  // Mobile bottom sheet (for individual subject in dialog)
  protected subjectSheetVisible = false;
  protected readonly subjectSheetRow = signal<SchoolScoreRow | null>(null);

  protected readonly subjects = computed(() => this.refData.subjects());

  protected readonly campusOptions = computed(() =>
    this.refData.campuses().map((c) => ({ label: c.name, value: c.id })),
  );

  private readonly searchTerm$ = new Subject<string>();

  protected readonly isDirty = computed(() => {
    const ds = this.dialogStudent();
    if (!ds) return false;
    return ds.rows.some(
      (r) =>
        r.score !== r.original.score ||
        r.status !== r.original.status ||
        r.notes !== r.original.notes,
    );
  });

  constructor() {
    effect(() => {
      const list = this.refData.campuses();
      if (list.length === 0) return;
      if (untracked(() => this.campusId())) return;
      this.campusId.set(list[0].id);
      untracked(() => this.loadStudents());
    });
  }

  ngOnInit(): void {
    this.refData.loadSubjects();
    this.refData.loadCampuses();
    this.setupSearch();
  }

  private setupSearch(): void {
    this.searchTerm$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.page.set(1);
        this.loadStudents();
      });
  }

  private lastEmittedFilter: { campusId: string; grade: string | null } = { campusId: '', grade: null };

  protected loadStudents(): void {
    this.loadingStudents.set(true);
    const currentFilter = { campusId: this.campusId(), grade: this.gradeFilter() };
    if (
      currentFilter.campusId !== this.lastEmittedFilter.campusId ||
      currentFilter.grade !== this.lastEmittedFilter.grade
    ) {
      this.lastEmittedFilter = currentFilter;
      this.filterChange.emit(currentFilter);
    }
    this.schoolExamsService
      .getStudents(this.examId(), {
        campusId: this.campusId() || undefined,
        status: this.statusFilter(),
        search: this.searchTerm() || undefined,
        grade: this.gradeFilter() ?? undefined,
        page: this.page(),
        pageSize: this.pageSize,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.students.set(res.data);
          this.totalStudents.set(res.meta.total);
          this.loadingStudents.set(false);
        },
        error: () => {
          this.loadingStudents.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學生列表',
          });
        },
      });
  }

  protected onSearchInput(value: string): void {
    this.searchTerm.set(value);
    this.searchTerm$.next(value);
  }

  protected onCampusChange(value: string): void {
    this.campusId.set(value);
    this.page.set(1);
    this.loadStudents();
  }

  protected onStatusFilterChange(value: SchoolExamStudentStatus): void {
    this.statusFilter.set(value);
    this.page.set(1);
    this.loadStudents();
  }

  protected onGradeFilterChange(value: GradeLevel | null): void {
    this.gradeFilter.set(value);
    this.page.set(1);
    this.loadStudents();
  }

  protected onPageChange(event: { page?: number }): void {
    this.page.set((event.page ?? 0) + 1);
    this.loadStudents();
  }

  protected formatGrade(grade: string | null): string {
    if (!grade) return '—';
    return SchoolScoreEditorComponent.GRADE_LABELS[grade] ?? grade;
  }

  protected getProgressText(s: SchoolExamStudent): string {
    if (s.scoreCount === 0) return '待登錄';
    if (s.subjectCount > 0 && s.scoreCount >= s.subjectCount) return '已完成';
    return `${s.scoreCount}/${s.subjectCount}`;
  }

  protected getProgressSeverity(
    s: SchoolExamStudent,
  ): 'success' | 'warn' | 'danger' | 'info' | 'secondary' | 'contrast' | undefined {
    if (s.scoreCount === 0) return 'warn';
    if (s.subjectCount > 0 && s.scoreCount >= s.subjectCount) return 'success';
    return 'info';
  }

  // --- Dialog ---

  protected openStudentDialog(s: SchoolExamStudent): void {
    const ds: DialogStudent = {
      studentId: s.studentId,
      studentName: s.studentName,
      studentGrade: s.studentGrade,
      rows: [],
      loading: true,
    };
    this.dialogStudent.set(ds);
    this.dialogVisible = true;

    this.schoolExamsService
      .getScores(this.examId(), s.studentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const rows = this.buildScoreRows(data);
          this.dialogStudent.set({ ...ds, rows, loading: false });
        },
        error: () => {
          this.dialogStudent.set({ ...ds, loading: false });
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: `無法載入 ${s.studentName} 的成績`,
          });
        },
      });
  }

  protected onDialogHide(): void {
    if (this.isDirty()) {
      this.dialogVisible = true;
      this.confirmationService.confirm({
        message: '尚有未儲存的變更，是否要儲存？',
        header: '確認',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: '儲存',
        rejectLabel: '不儲存',
        accept: () => {
          this.saveDialog();
        },
        reject: () => {
          this.dialogStudent.set(null);
          this.dialogVisible = false;
        },
      });
      return;
    }
    this.dialogStudent.set(null);
  }

  protected saveDialog(): void {
    const ds = this.dialogStudent();
    if (!ds) return;

    const allInputs: SaveSchoolScoresInput[] = [];
    for (const row of ds.rows) {
      if (!this.isRowDirty(row)) continue;
      if (row.score === null && row.status === 'scored') continue;

      allInputs.push({
        studentId: ds.studentId,
        subjectId: row.subjectId,
        score: row.score,
        status: row.status,
        notes: row.notes.trim() || null,
      });
    }

    if (allInputs.length === 0) {
      this.dialogVisible = false;
      this.dialogStudent.set(null);
      return;
    }

    this.savingChange.emit(true);
    this.schoolExamsService
      .saveScores(this.examId(), allInputs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ affected }) => {
          this.messageService.add({
            severity: 'success',
            summary: '儲存成功',
            detail: `已更新 ${affected} 筆成績`,
          });
          for (const row of ds.rows) {
            row.original = { score: row.score, status: row.status, notes: row.notes };
          }
          this.dialogStudent.set({ ...ds });
          this.savingChange.emit(false);
          this.dirtyChange.emit(false);
          this.saved.emit();
          this.dialogVisible = false;
          this.dialogStudent.set(null);
          this.loadStudents();
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

  // --- Score row helpers ---

  private buildScoreRows(existingScores: SchoolScore[]): SchoolScoreRow[] {
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

  protected onScoreChange(row: SchoolScoreRow, value: number | null): void {
    row.score = value;
    this.notifyChanged();
  }

  protected onStatusChange(row: SchoolScoreRow, value: SchoolScoreStatus): void {
    row.status = value;
    if (value === 'absent') {
      row.score = null;
    }
    this.notifyChanged();
  }

  protected onNotesChange(row: SchoolScoreRow, value: string): void {
    row.notes = value;
    this.notifyChanged();
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

  protected dirtyCount(): number {
    const ds = this.dialogStudent();
    if (!ds) return 0;
    return ds.rows.filter((r) => this.isRowDirty(r)).length;
  }

  private notifyChanged(): void {
    const ds = this.dialogStudent();
    if (ds) {
      this.dialogStudent.set({ ...ds });
    }
    this.emitDirty();
  }

  save(): void {
    this.saveDialog();
  }

  private emitDirty(): void {
    this.dirtyChange.emit(this.isDirty());
  }
}
