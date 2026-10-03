import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
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
    ToastModule,
    PageOpenComponent,
    RouterLink,
    AcademyScoreEditorComponent,
    SchoolScoreEditorComponent,
  ],
  providers: [MessageService],
  templateUrl: './score-entry.component.html',
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

  /**
   * 有未儲存變更時，重新整理／關分頁／改網址也要攔（#1020）。站內導頁由 `canDeactivate`
   * 管，這條管「離開整個頁面」；瀏覽器自己出確認框，文案不可自訂。
   */
  private readonly warnOnUnload = effect((onCleanup) => {
    if (!this.dirty()) return;
    const handler = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    onCleanup(() => window.removeEventListener('beforeunload', handler));
  });
  private readonly schoolFilter = signal<{ campusId: string; grade: string | null } | null>(null);

  protected readonly academyExam = signal<AcademyExamDetail | null>(null);
  protected readonly schoolExam = signal<SchoolExamDetail | null>(null);
  protected readonly academyEditor = viewChild<AcademyScoreEditorComponent>('academyEditor');
  protected readonly schoolEditor = viewChild<SchoolScoreEditorComponent>('schoolEditor');

  private readonly leaveDialog = viewChild<ElementRef<HTMLDialogElement>>('leaveDialog');
  /** 站內導頁被攔下時，等使用者在對話框裡選（Q3）；`saveThenLeave` = 選了「儲存後離開」、正在等存檔結果 */
  private leaveDecision: ((leave: boolean) => void) | null = null;
  private saveThenLeave = false;

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
    // 「儲存後離開」：存完才放行。成功時 onSaved 會先把 dirty 清掉；失敗則 dirty 還在 → 留下來
    if (!isSaving && this.saveThenLeave) {
      setTimeout(() => this.settleLeave(!this.dirty()));
    }
  }

  protected onSaved(): void {
    this.dirty.set(false);
    // 兩種考試都要重抓統計。原本只叫了 `refreshSchoolSummary()`，
    // **academy 那條路從來沒接上** —— 函式名就寫著 School，但 onSaved 是兩種共用的。
    // 症狀是存檔成功、列表頁的「已登錄」也對了，只有這一頁的統計列停在 0 / — / — / —。
    if (this.type() === 'academy') {
      this.refreshAcademySummary();
    } else {
      this.refreshSchoolSummary();
    }
  }

  /**
   * 存檔後重抓考試統計。**刻意不重用初始載入那段**：它會 `loading.set(true)`
   * 把整個編輯器換成骨架屏（使用者剛打完的畫面會閃掉），失敗時還會導回列表頁。
   * 存檔後的重抓失敗只是統計沒更新，不該把人踢走。
   */
  private refreshAcademySummary(): void {
    if (this.type() !== 'academy') return;
    this.academyExamsService
      .get(this.examId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.academyExam.set(data);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法更新考試統計',
          });
        },
      });
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

  private getAcademyTypeLabel(type: string): string {
    const map: Record<string, string> = {
      quiz: '小考',
      mock_exam: '模擬考',
      placement_test: '分班考',
    };
    return map[type] ?? type;
  }

  /** canDeactivate guard：有沒存的變更時開頁內對話框（Q3，取代 window.confirm） */
  canDeactivate(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    this.leaveDialog()?.nativeElement.showModal();
    return new Promise((resolve) => (this.leaveDecision = resolve));
  }

  protected resolveLeave(choice: 'stay' | 'discard' | 'save'): void {
    this.leaveDialog()?.nativeElement.close();
    if (choice === 'save') {
      this.saveThenLeave = true;
      this.saveScores();
      return;
    }
    this.settleLeave(choice === 'discard');
  }

  private settleLeave(leave: boolean): void {
    this.saveThenLeave = false;
    if (leave) this.dirty.set(false); // 放行後 beforeunload 不該再攔
    this.leaveDecision?.(leave);
    this.leaveDecision = null;
  }
}
