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
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { AcademyScoreEditorComponent } from './academy-score-editor/academy-score-editor.component';

import {
  AcademyExamsService,
  type AcademyExamDetail,
  type AcademyExamDetailSummary,
} from '@core/academy-exams.service';
import {
  TermExamsService,
  type TermExamDetail,
} from '@core/term-exams.service';
import { ReferenceDataService } from '@core/reference-data.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

type ScoreEntryType = 'academy' | 'term';

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
    ButtonModule,
    ToastModule,
    TagModule,
    ConfirmDialogModule,
    PageBreadcrumbComponent,
    AcademyScoreEditorComponent,
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
  private readonly termExamsService = inject(TermExamsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly type = signal<ScoreEntryType>('academy');
  protected readonly examId = signal('');
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);

  protected readonly academyExam = signal<AcademyExamDetail | null>(null);
  protected readonly termExam = signal<TermExamDetail | null>(null);
  protected readonly academyEditor = viewChild<AcademyScoreEditorComponent>('academyEditor');

  protected readonly breadcrumbs: BreadcrumbItem[] = [
    { label: '考試管理', routerLink: '/admin/grades/exams' },
    { label: '成績登錄' },
  ];

  protected readonly examInfo = computed<ExamInfo | null>(() => {
    if (this.type() === 'academy') {
      const exam = this.academyExam();
      if (!exam) return null;
      const parts = [
        this.getAcademyTypeLabel(exam.examType),
        exam.subjectName,
        exam.examDate,
        exam.classes.map((c) => c.className).join('、'),
      ].filter(Boolean);
      return {
        name: exam.name,
        metaLine: parts.join(' · '),
        status: exam.status,
      };
    }
    const exam = this.termExam();
    if (!exam) return null;
    return {
      name: exam.label,
      metaLine: [exam.examDate ?? '日期未定'].filter(Boolean).join(' · '),
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
    const exam = this.termExam();
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
    const params = this.route.snapshot.params;
    const type = params['type'] as ScoreEntryType;
    const id = params['id'] as string;

    if (type !== 'academy' && type !== 'term') {
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
      this.termExamsService
        .get(this.examId())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ data }) => {
            this.termExam.set(data);
            this.loading.set(false);
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: '載入失敗',
              detail: '無法載入段考資料',
            });
            this.loading.set(false);
            this.router.navigate(['/admin/grades/exams']);
          },
        });
    }
  }

  protected onDirtyChange(isDirty: boolean): void {
    this.dirty.set(isDirty);
  }

  protected onSavingChange(isSaving: boolean): void {
    this.saving.set(isSaving);
  }

  protected onSaved(): void {
    this.dirty.set(false);
    this.loadExam(); // refresh summary stats
  }

  protected saveScores(): void {
    const editor = this.academyEditor();
    if (editor) {
      editor.save();
    }
    // Term editor will be added in Task 12
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

  protected getStatusSeverity(status: 'active' | 'closed'): 'success' | 'secondary' {
    return status === 'active' ? 'success' : 'secondary';
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
