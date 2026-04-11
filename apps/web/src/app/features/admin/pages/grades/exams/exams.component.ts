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
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService, type MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

// Shared
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/components/confirm-dialog/confirm-dialog.component';

// Services
import {
  AcademyExamsService,
  type AcademyExam,
  type AcademyExamStatus,
  type AcademyExamType,
} from '@core/academy-exams.service';
import {
  TermExamsService,
  type TermExam,
  type TermExamStatus,
} from '@core/term-exams.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

type ExamKind = 'academy' | 'term';
type ExamTypeFilter = 'all' | ExamKind;
type StatusFilter = 'all' | 'active' | 'closed';

export interface AcademyExamRow {
  readonly kind: 'academy';
  readonly id: string;
  readonly name: string;
  readonly examDate: string;
  readonly status: AcademyExamStatus;
  readonly examType: AcademyExamType;
  readonly scope: string;
  readonly campusId: string | null;
  readonly subjectId: string | null;
  readonly scoreCount: number;
  readonly raw: AcademyExam;
}

export interface TermExamRow {
  readonly kind: 'term';
  readonly id: string;
  readonly name: string;
  readonly examDate: string | null;
  readonly status: TermExamStatus;
  readonly scope: string;
  readonly scoreCount: number;
  readonly raw: TermExam;
}

export type ExamRow = AcademyExamRow | TermExamRow;

const ACADEMY_EXAM_TYPE_LABELS: Record<AcademyExamType, string> = {
  quiz: '小考',
  mock_exam: '模擬考',
  placement_test: '分班考',
};

const EXAM_TYPE_OPTIONS: Array<{ label: string; value: ExamTypeFilter }> = [
  { label: '全部', value: 'all' },
  { label: '補習班考試', value: 'academy' },
  { label: '段考', value: 'term' },
];

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: '全部狀態', value: 'all' },
  { label: '進行中', value: 'active' },
  { label: '已結束', value: 'closed' },
];

const PAGE_SIZE = 10;

@Component({
  selector: 'app-exams',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    ButtonModule,
    SelectModule,
    SelectButtonModule,
    TagModule,
    ToastModule,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
    EmptyStateComponent,
    PopupMenuComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './exams.component.html',
  styleUrl: './exams.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExamsComponent implements OnInit {
  readonly page = input<RouteObj>();

  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly termExamsService = inject(TermExamsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly examTypeOptions = EXAM_TYPE_OPTIONS;
  protected readonly statusOptions = STATUS_OPTIONS;

  // Reference data
  protected readonly campuses = computed(() => this.refData.campuses());
  protected readonly subjects = computed(() => this.refData.subjects());
  protected readonly campusOptions = computed(() => [
    { label: '全部校區', value: null as string | null },
    ...this.campuses().map((c) => ({ label: c.name, value: c.id as string | null })),
  ]);
  protected readonly subjectOptions = computed(() => [
    { label: '全部科目', value: null as string | null },
    ...this.subjects().map((s) => ({ label: s.name, value: s.id as string | null })),
  ]);

  // Data
  protected readonly academyExams = signal<AcademyExam[]>([]);
  protected readonly termExams = signal<TermExam[]>([]);
  protected readonly loading = signal(true);

  // Filters
  protected readonly examType = signal<ExamTypeFilter>('all');
  protected readonly campusId = signal<string | null>(null);
  protected readonly subjectId = signal<string | null>(null);
  protected readonly statusFilter = signal<StatusFilter>('all');

  // Pagination
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = PAGE_SIZE;

  // Merged rows (全部合併、篩選、排序)
  protected readonly mergedExams = computed<ExamRow[]>(() => {
    const typeFilter = this.examType();
    const campus = this.campusId();
    const subject = this.subjectId();
    const status = this.statusFilter();

    const rows: ExamRow[] = [];

    // Academy 段
    if (typeFilter !== 'term') {
      for (const exam of this.academyExams()) {
        if (campus && exam.campusId !== campus) continue;
        if (subject && exam.subjectId !== subject) continue;
        if (status !== 'all' && exam.status !== status) continue;
        rows.push({
          kind: 'academy',
          id: exam.id,
          name: exam.name,
          examDate: exam.examDate,
          status: exam.status,
          examType: exam.examType,
          scope: exam.scopeNote?.trim() || '—',
          campusId: exam.campusId,
          subjectId: exam.subjectId,
          scoreCount: exam.scoreCount,
          raw: exam,
        });
      }
    }

    // Term 段（campus / subject 不適用 → 設定時直接過濾）
    if (typeFilter !== 'academy' && !campus && !subject) {
      for (const exam of this.termExams()) {
        if (status !== 'all' && exam.status !== status) continue;
        rows.push({
          kind: 'term',
          id: exam.id,
          name: exam.label,
          examDate: exam.examDate,
          status: exam.status,
          scope: '全科目',
          scoreCount: exam.scoreCount,
          raw: exam,
        });
      }
    }

    // 排序：日期新→舊；null 擺最後；同日期 active 優先
    const toTime = (date: string | null): number => (date ? new Date(date).getTime() : -Infinity);
    rows.sort((a, b) => {
      const diff = toTime(b.examDate) - toTime(a.examDate);
      if (diff !== 0) return diff;
      if (a.status === b.status) return 0;
      return a.status === 'active' ? -1 : 1;
    });

    return rows;
  });

  protected readonly pagedExams = computed<ExamRow[]>(() => {
    const all = this.mergedExams();
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return all.slice(start, start + this.PAGE_SIZE);
  });

  protected readonly totalRows = computed(() => this.mergedExams().length);

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.totalRows(),
  }));

  // 待辦提醒：active 且 scoreCount = 0
  protected readonly todoCount = computed(() => {
    const pendingAcademy = this.academyExams().filter(
      (e) => e.status === 'active' && e.scoreCount === 0,
    ).length;
    const pendingTerm = this.termExams().filter(
      (e) => e.status === 'active' && e.scoreCount === 0,
    ).length;
    return pendingAcademy + pendingTerm;
  });

  // Action menu
  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedRow = signal<ExamRow | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const row = this.selectedRow();
    if (!row) return [];
    const items: MenuItem[] = [
      {
        label: '進入成績登錄',
        icon: 'pi pi-pencil',
        command: () => this.enterScoreEntry(row),
      },
      {
        label: '編輯基本資料',
        icon: 'pi pi-cog',
        disabled: row.status === 'closed',
        command: () => this.editExam(row),
      },
    ];
    if (row.status === 'active') {
      items.push({
        label: '結束考試',
        icon: 'pi pi-check-circle',
        command: () => this.confirmCloseExam(row),
      });
    } else {
      items.push({
        label: '重新開啟',
        icon: 'pi pi-undo',
        command: () => this.reopenExam(row),
      });
    }
    items.push({ separator: true });
    items.push({
      label: '刪除',
      icon: 'pi pi-trash',
      styleClass: 'p-menuitem--danger',
      disabled: row.scoreCount > 0,
      command: () => this.confirmDeleteExam(row),
    });
    return items;
  });

  // Create-exam 按鈕選項
  protected readonly createExamMenu = viewChild.required<PopupMenuComponent>('createExamMenu');
  protected readonly createMenuItems: MenuItem[] = [
    {
      label: '新增補習班考試',
      icon: 'pi pi-book',
      command: () => this.openCreateAcademyDialog(),
    },
    {
      label: '新增段考',
      icon: 'pi pi-calendar',
      command: () => this.openCreateTermDialog(),
    },
  ];

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.refData.loadSubjects();
    this.loadExams();
  }

  // ── Loaders ───────────────────────────────────────────────────────────
  protected loadExams(): void {
    this.loading.set(true);
    forkJoin({
      academy: this.academyExamsService.list({ pageSize: 200 }),
      term: this.termExamsService.list({ pageSize: 200 }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ academy, term }) => {
          this.academyExams.set(academy.data);
          this.termExams.set(term.data);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入考試列表',
          });
          this.loading.set(false);
        },
      });
  }

  // ── Filter handlers ───────────────────────────────────────────────────
  protected onExamTypeChange(value: ExamTypeFilter | null): void {
    // SelectButton 允許清空，但我們強制至少一個值
    this.examType.set(value ?? 'all');
    this.currentPage.set(1);
  }

  protected onCampusChange(value: string | null): void {
    this.campusId.set(value);
    this.currentPage.set(1);
  }

  protected onSubjectChange(value: string | null): void {
    this.subjectId.set(value);
    this.currentPage.set(1);
  }

  protected onStatusChange(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.currentPage.set(1);
  }

  protected clearFilters(): void {
    this.examType.set('all');
    this.campusId.set(null);
    this.subjectId.set(null);
    this.statusFilter.set('all');
    this.currentPage.set(1);
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
  }

  // ── Row helpers ───────────────────────────────────────────────────────
  protected getKindLabel(kind: ExamKind): string {
    return kind === 'academy' ? '補習班考試' : '段考';
  }

  protected getKindSeverity(kind: ExamKind): 'info' | 'contrast' {
    return kind === 'academy' ? 'info' : 'contrast';
  }

  protected getAcademyTypeLabel(type: AcademyExamType): string {
    return ACADEMY_EXAM_TYPE_LABELS[type];
  }

  protected getStatusLabel(status: AcademyExamStatus | TermExamStatus): string {
    return status === 'active' ? '進行中' : '已結束';
  }

  protected getStatusSeverity(
    status: AcademyExamStatus | TermExamStatus,
  ): 'success' | 'secondary' {
    return status === 'active' ? 'success' : 'secondary';
  }

  protected getCampusName(row: ExamRow): string | null {
    if (row.kind !== 'academy' || !row.campusId) return null;
    return this.campuses().find((c) => c.id === row.campusId)?.name ?? null;
  }

  protected getSubjectName(row: ExamRow): string | null {
    if (row.kind !== 'academy' || !row.subjectId) return null;
    return this.subjects().find((s) => s.id === row.subjectId)?.name ?? null;
  }

  protected formatDate(date: string | null): string {
    if (!date) return '—';
    return date;
  }

  // ── Actions ───────────────────────────────────────────────────────────
  protected openActionMenu(event: MouseEvent, row: ExamRow): void {
    event.stopPropagation();
    this.selectedRow.set(row);
    this.actionMenu().toggle(event);
  }

  protected openCreateMenu(event: MouseEvent): void {
    this.createExamMenu().toggle(event);
  }

  protected onRowNameClick(row: ExamRow): void {
    this.enterScoreEntry(row);
  }

  protected enterScoreEntry(row: ExamRow): void {
    this.router.navigate(['/admin/grades/exams', row.kind, row.id, 'scores']);
  }

  protected editExam(row: ExamRow): void {
    // Task 9 會補上 dialog；此處先給 placeholder toast，避免 runtime 壞掉
    this.messageService.add({
      severity: 'info',
      summary: '編輯功能',
      detail: `[Task 9] 編輯 ${row.name}`,
    });
  }

  protected openCreateAcademyDialog(): void {
    this.messageService.add({
      severity: 'info',
      summary: '新增考試',
      detail: '[Task 9] 補習班考試建立 dialog',
    });
  }

  protected openCreateTermDialog(): void {
    this.messageService.add({
      severity: 'info',
      summary: '新增考試',
      detail: '[Task 9] 段考建立 dialog',
    });
  }

  protected confirmCloseExam(row: ExamRow): void {
    this.openConfirmDialog(
      '結束考試',
      {
        message: `確定要結束「${row.name}」嗎？結束後將無法再登錄分數。`,
        acceptLabel: '結束考試',
        acceptSeverity: 'warn',
      },
      () => this.closeExam(row),
    );
  }

  private closeExam(row: ExamRow): void {
    const call$ =
      row.kind === 'academy'
        ? this.academyExamsService.close(row.id)
        : this.termExamsService.close(row.id);
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已結束',
          detail: `「${row.name}」已結束`,
        });
        this.loadExams();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '操作失敗',
          detail: '無法結束考試',
        });
      },
    });
  }

  protected reopenExam(row: ExamRow): void {
    const call$ =
      row.kind === 'academy'
        ? this.academyExamsService.reopen(row.id)
        : this.termExamsService.reopen(row.id);
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已重新開啟',
          detail: `「${row.name}」已恢復為進行中`,
        });
        this.loadExams();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '操作失敗',
          detail: '無法重新開啟考試',
        });
      },
    });
  }

  protected confirmDeleteExam(row: ExamRow): void {
    this.openConfirmDialog(
      '刪除考試',
      {
        message: `確定要刪除「${row.name}」嗎？此動作無法復原。`,
        acceptLabel: '刪除',
        acceptSeverity: 'danger',
      },
      () => this.deleteExam(row),
    );
  }

  private deleteExam(row: ExamRow): void {
    const call$ =
      row.kind === 'academy'
        ? this.academyExamsService.delete(row.id)
        : this.termExamsService.delete(row.id);
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已刪除',
          detail: `「${row.name}」已刪除`,
        });
        this.loadExams();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: '無法刪除考試（可能已有成績紀錄）',
        });
      },
    });
  }

  private openConfirmDialog(
    header: string,
    data: ConfirmDialogData,
    onAccept: () => void,
  ): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: '420px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data,
    });
    if (!ref) return;
    ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) onAccept();
    });
  }
}
