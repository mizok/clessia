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
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { PaginatorModule } from 'primeng/paginator';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import {
  SchoolExamsService,
  type SchoolExamDetail,
  type SchoolExamStudent,
  type SchoolExamStudentStatus,
} from '@core/school-exams.service';
import { type GradeLevel } from '@core/students.service';
import { ReferenceDataService } from '@core/reference-data.service';

import {
  ScoreEditDialogComponent,
  type ScoreEditDialogResult,
} from './score-edit-dialog/score-edit-dialog.component';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';

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
    StatusDotComponent,
    FormsModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    SelectModule,
    SelectButtonModule,
    ButtonModule,
    PaginatorModule,
  ],
  providers: [DialogService, MessageService],
  templateUrl: './school-score-editor.component.html',
  styleUrl: './school-score-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly gradeOptions = GRADE_OPTIONS;
  protected readonly studentStatusOptions = STUDENT_STATUS_OPTIONS;

  protected readonly campusId = signal<string>('');
  protected readonly statusFilter = signal<SchoolExamStudentStatus>('all');
  protected readonly searchTerm = signal('');
  protected readonly gradeFilter = signal<GradeLevel | null>(null);

  protected readonly students = signal<SchoolExamStudent[]>([]);
  protected readonly loadingStudents = signal(false);
  protected readonly totalStudents = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = 50;

  protected readonly campusOptions = computed(() =>
    this.refData.campuses().map((campus) => ({ label: campus.name, value: campus.id })),
  );

  private readonly searchTerm$ = new Subject<string>();
  private lastEmittedFilter: { campusId: string; grade: string | null } = {
    campusId: '',
    grade: null,
  };

  constructor() {
    effect(() => {
      const campuses = this.refData.campuses();
      if (campuses.length === 0) return;
      if (untracked(() => this.campusId())) return;
      this.campusId.set(campuses[0].id);
      untracked(() => this.loadStudents());
    });
  }

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.setupSearch();
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

  protected getProgressText(student: SchoolExamStudent): string {
    if (student.scoreCount === 0) return '待登錄';
    if (student.subjectCount > 0 && student.scoreCount >= student.subjectCount) return '已完成';
    return `${student.scoreCount}/${student.subjectCount}`;
  }

  /**
   * 進度三態：未開始 / 進行中 / 完成。**未開始與進行中都是 `pending`** ——
   * 區分由標籤自己扛著（「待登錄」／「3/5」／「已完成」），不需要色相。
   *
   * **沒有 `overdue`**：查不到段考成績登錄的期限（schema 沒有 deadline 欄位、
   * rules 也沒規定），所以沒有依據可以說它「積欠」。原本「一科都沒登」回 warn
   * 是在催人而沒有依據可催。
   */
  protected progressTone(student: SchoolExamStudent): StatusTone {
    const done = student.subjectCount > 0 && student.scoreCount >= student.subjectCount;
    return done ? 'done' : 'pending';
  }

  protected openStudentDialog(student: SchoolExamStudent): void {
    const ref = this.dialogService.open(ScoreEditDialogComponent, {
      width: 'min(640px, 95vw)',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      contentStyle: {
        'max-height': 'calc(var(--window-height, 800px) * 0.85)',
        overflow: 'auto',
      },
      data: {
        examId: this.examId(),
        examSubjectId: this.exam().subjectId,
        examSubjectName: this.exam().subjectName,
        disabled: this.disabled(),
        studentId: student.studentId,
        studentName: student.studentName,
        studentGrade: student.studentGrade,
      },
    });
    if (!ref) return;

    ref.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result: ScoreEditDialogResult | undefined) => {
        if (!result?.saved) return;
        this.dirtyChange.emit(false);
        this.savingChange.emit(false);
        this.saved.emit();
        this.loadStudents();
      });
  }

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

  save(): void {
    this.dirtyChange.emit(false);
  }

  private setupSearch(): void {
    this.searchTerm$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.page.set(1);
        this.loadStudents();
      });
  }
}
