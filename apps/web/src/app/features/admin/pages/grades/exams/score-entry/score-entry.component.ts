import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { AcademyScoreEditorComponent } from './academy-score-editor/academy-score-editor.component';
import { SchoolScoreEditorComponent } from './school-score-editor/school-score-editor.component';

import {
  AcademyExamsService,
  type AcademyExamDetail,
  type AcademyExamDetailSummary,
} from '@core/academy-exams.service';
import { SchoolExamsService, type SchoolExamDetail } from '@core/school-exams.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';

type ScoreEntryType = 'academy' | 'school';

interface ExamInfo {
  readonly name: string;
  readonly metaLine: string;
  readonly status: 'active' | 'closed';
}

interface SummaryStats {
  readonly recordedCount: number;
  readonly average: number | null;
  readonly highest: number | null;
  readonly lowest: number | null;
}

@Component({
  selector: 'app-score-entry',
  standalone: true,
  imports: [
    StatusDotComponent,
    ButtonModule,
    ToastModule,
    ConfirmDialogModule,
    PageBreadcrumbComponent,
    AcademyScoreEditorComponent,
    SchoolScoreEditorComponent,
  ],
  providers: [MessageService],
  templateUrl: './score-entry.component.html',
  styleUrl: './score-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScoreEntryComponent implements OnInit {
  readonly page = input<RouteObj>();

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly schoolExamsService = inject(SchoolExamsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly type = signal<ScoreEntryType>('academy');
  protected readonly examId = signal('');
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  private readonly schoolFilter = signal<{ campusId: string; grade: string | null } | null>(null);

  protected readonly academyExam = signal<AcademyExamDetail | null>(null);
  protected readonly schoolExam = signal<SchoolExamDetail | null>(null);
  protected readonly academyEditor = viewChild<AcademyScoreEditorComponent>('academyEditor');
  protected readonly schoolEditor = viewChild<SchoolScoreEditorComponent>('schoolEditor');

  protected readonly breadcrumbs: BreadcrumbItem[] = [
    { label: '考試管理', routerLink: '/admin/grades/exams' },
    { label: '成績登錄' },
  ];

  protected readonly examInfo = computed<ExamInfo | null>(() => {
    if (this.type() === 'academy') {
      const exam = this.academyExam();
      if (!exam) return null;
      const campuses = Array.from(
        new Set(exam.classes.map((c) => c.campusName).filter((n): n is string => !!n)),
      );
      const courses = Array.from(
        new Set(exam.classes.map((c) => c.courseName).filter((n): n is string => !!n)),
      );
      const classNames = exam.classes.map((c) => c.className).filter(Boolean);
      const hierarchy = [
        exam.campusName ?? campuses.join('、'),
        courses.join('、'),
        classNames.join('、'),
      ]
        .filter(Boolean)
        .join(' › ');
      const parts = [
        hierarchy,
        this.getAcademyTypeLabel(exam.examType),
        exam.subjectName,
        exam.examDate,
      ].filter(Boolean);
      return {
        name: exam.name,
        metaLine: parts.join(' · '),
        status: exam.status,
      };
    }
    const exam = this.schoolExam();
    if (!exam) return null;
    const filter = this.schoolFilter();
    const campusName = filter?.campusId
      ? (this.refData.campuses().find((c) => c.id === filter.campusId)?.name ?? null)
      : '全部分校';
    const gradeLabel = filter?.grade
      ? (GRADE_LEVEL_LABELS[filter.grade as GradeLevel] ?? filter.grade)
      : '全部年級';

    const dateLabel = exam.examDate ?? '日期未定';
    const schoolName = exam.schoolName || null;
    const subjectLabel = exam.subjectId && exam.subjectName ? `科目：${exam.subjectName}` : null;

    const parts = [schoolName, subjectLabel, dateLabel, campusName, gradeLabel].filter(Boolean);
    return {
      name: exam.label,
      metaLine: parts.join(' · '),
      status: exam.status,
    };
  });

  protected readonly summaryStats = computed<SummaryStats | null>(() => {
    if (this.type() === 'academy') {
      const s = this.academyExam()?.summary;
      if (!s) return null;
      return {
        recordedCount: s.recordedCount,
        average: s.averageScore,
        highest: s.highestScore,
        lowest: s.lowestScore,
      };
    }
    const exam = this.schoolExam();
    if (!exam) return null;
    return {
      recordedCount: exam.summary.totalRecordedCount,
      average: null,
      highest: null,
      lowest: null,
    };
  });

  protected readonly isClosed = computed(() => {
    const info = this.examInfo();
    return info?.status === 'closed';
  });

  protected readonly canSave = computed(() => {
    return this.dirty() && !this.saving() && !this.isClosed();
  });

  ngOnInit(): void {
    this.refData.loadSubjects();
    this.refData.loadCampuses();
    const params = this.route.snapshot.params;
    const type = params['type'] as ScoreEntryType;
    const id = params['id'] as string;

    if (type !== 'academy' && type !== 'school') {
      this.router.navigate(['/admin/grades/exams']);
      return;
    }

    this.type.set(type);
    this.examId.set(id);
    this.loadExam();
  }

  private loadExam(): void {
    this.loading.set(true);

    if (this.type() === 'academy') {
      this.academyExamsService
        .get(this.examId())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ data }) => {
            this.academyExam.set(data);
            this.loading.set(false);
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: '載入失敗',
              detail: '無法載入考試資料',
            });
            this.loading.set(false);
            this.router.navigate(['/admin/grades/exams']);
          },
        });
    } else {
      const filter = this.schoolFilter();
      this.schoolExamsService
        .get(this.examId(), {
          campusId: filter?.campusId || undefined,
          grade: filter?.grade ?? undefined,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ data }) => {
            this.schoolExam.set(data);
            this.loading.set(false);
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: '載入失敗',
              detail: '無法載入學校考試資料',
            });
            this.loading.set(false);
            this.router.navigate(['/admin/grades/exams']);
          },
        });
    }
  }

  private refreshSchoolSummary(): void {
    if (this.type() !== 'school') return;
    const filter = this.schoolFilter();
    this.schoolExamsService
      .get(this.examId(), {
        campusId: filter?.campusId || undefined,
        grade: filter?.grade ?? undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.schoolExam.set(data);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法更新學校考試統計',
          });
        },
      });
  }

  protected onDirtyChange(isDirty: boolean): void {
    this.dirty.set(isDirty);
  }

  protected onSavingChange(isSaving: boolean): void {
    this.saving.set(isSaving);
  }

  protected onSaved(): void {
    this.dirty.set(false);
    this.refreshSchoolSummary();
  }

  protected onSchoolFilterChange(filter: { campusId: string; grade: string | null }): void {
    const current = this.schoolFilter();
    if (current?.campusId === filter.campusId && current?.grade === filter.grade) {
      return;
    }
    this.schoolFilter.set(filter);
    this.refreshSchoolSummary();
  }

  protected saveScores(): void {
    const academyEd = this.academyEditor();
    if (academyEd) {
      academyEd.save();
      return;
    }
    const schoolEd = this.schoolEditor();
    if (schoolEd) {
      schoolEd.save();
    }
  }

  protected goBack(): void {
    this.router.navigate(['/admin/grades/exams']);
  }

  protected formatStat(value: number | null): string {
    if (value === null) return '—';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  protected getStatusLabel(status: 'active' | 'closed'): string {
    return status === 'active' ? '進行中' : '已結束';
  }

  /**
   * `active` 是**「進行中」**不是「啟用」—— 它正是「還在等成績登完」，所以是 `pending`
   * （中空、無色相）。原本塗成 success 綠等於說「這件事很好」，但這一頁自己的橫幅
   * 就在說「有 N 場**進行中**的考試尚未登錄成績」。
   *
   * `closed` 是 `inactive` 而不是 `done`：結束考試的確認訊息寫著「**結束後將無法再
   * 登錄分數**」—— 它是行政主動關閉，**不保證成績登完了**，可以沒登完就關。
   * 那是「不在等任何事了」，不是「已定案且是好結果」。
   */
  protected statusTone(status: 'active' | 'closed'): StatusTone {
    return status === 'active' ? 'pending' : 'inactive';
  }

  private getAcademyTypeLabel(type: string): string {
    const map: Record<string, string> = {
      quiz: '小考',
      mock_exam: '模擬考',
      placement_test: '分班考',
    };
    return map[type] ?? type;
  }

  /** canDeactivate guard support */
  canDeactivate(): boolean {
    if (!this.dirty()) return true;
    return window.confirm('有尚未儲存的成績變更，確定要離開嗎？');
  }
}
