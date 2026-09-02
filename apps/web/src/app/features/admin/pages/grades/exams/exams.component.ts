import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
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
import { format, subMonths } from 'date-fns';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
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

// Dialogs
import { AcademyExamFormDialogComponent } from './academy-exam-form-dialog/academy-exam-form-dialog.component';
import type { AcademyExamFormDialogResult } from './academy-exam-form-dialog/academy-exam-form-dialog.component';
import { SchoolExamFormDialogComponent } from './school-exam-form-dialog/school-exam-form-dialog.component';
import type { SchoolExamFormDialogResult } from './school-exam-form-dialog/school-exam-form-dialog.component';
import {
  ExamsFilterDialogComponent,
  type ExamsFilterDialogResult,
} from './exams-filter-dialog/exams-filter-dialog.component';

// Services
import {
  AcademyExamsService,
  type AcademyExam,
  type AcademyExamStatus,
  type AcademyExamType,
} from '@core/academy-exams.service';
import {
  SchoolExamsService,
  type SchoolExamListParams,
  type SchoolExam,
  type SchoolExamStatus,
  schoolExamTypeLabel,
} from '@core/school-exams.service';
import { SchoolsService, type School } from '@core/schools.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';

type ExamKind = 'academy' | 'school';
type ExamTypeFilter = ExamKind;
type StatusFilter = 'all' | 'todo' | 'active' | 'closed';
type TimeRange = 'all' | '1m' | '3m' | '6m';

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

export interface SchoolExamRow {
  readonly kind: 'school';
  readonly id: string;
  readonly name: string;
  readonly examDate: string | null;
  readonly status: SchoolExamStatus;
  readonly scope: string;
  readonly scoreCount: number;
  readonly schoolId: string;
  readonly subjectId: string | null;
  readonly subjectName: string | null;
  readonly raw: SchoolExam;
}

export type ExamRow = AcademyExamRow | SchoolExamRow;

const ACADEMY_EXAM_TYPE_LABELS: Record<AcademyExamType, string> = {
  quiz: '小考',
  mock_exam: '模擬考',
  placement_test: '分班考',
};

const EXAM_TYPE_OPTIONS: Array<{ label: string; value: ExamTypeFilter }> = [
  { label: '補習班考試', value: 'academy' },
  { label: '學校考試', value: 'school' },
];

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: '全部狀態', value: 'all' },
  { label: '待登錄', value: 'todo' },
  { label: '進行中', value: 'active' },
  { label: '已結束', value: 'closed' },
];

const TIME_RANGE_OPTIONS: Array<{ label: string; value: TimeRange }> = [
  { label: '近1月', value: '1m' },
  { label: '近3月', value: '3m' },
  { label: '近半年', value: '6m' },
  { label: '全部', value: 'all' },
];

const PAGE_SIZE = 8;

@Component({
  selector: 'app-exams',
  standalone: true,
  imports: [
    StatusDotComponent,
    DataChipComponent,
    FormsModule,
    RouterModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
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
  private readonly schoolExamsService = inject(SchoolExamsService);
  private readonly schoolsService = inject(SchoolsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly examTypeOptions = EXAM_TYPE_OPTIONS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly timeRangeOptions = TIME_RANGE_OPTIONS;

  // Reference data
  protected readonly campuses = computed(() => this.refData.campuses());
  protected readonly subjects = computed(() => this.refData.subjects());
  protected readonly schools = signal<School[]>([]);
  protected readonly campusOptions = computed(() => [
    { label: '全部校區', value: null as string | null },
    ...this.campuses().map((c) => ({ label: c.name, value: c.id as string | null })),
  ]);
  protected readonly schoolOptions = computed(() => [
    { label: '全部學校', value: null as string | null },
    ...this.schools().map((school) => ({ label: school.name, value: school.id as string | null })),
  ]);
  protected readonly subjectOptions = computed(() => [
    { label: '全部科目', value: null as string | null },
    ...this.subjects().map((s) => ({ label: s.name, value: s.id as string | null })),
  ]);

  // Data
  protected readonly currentRows = signal<ExamRow[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly academyTodoCount = signal(0);
  protected readonly schoolTodoCount = signal(0);

  // Filters
  protected readonly examType = signal<ExamTypeFilter>('academy');
  protected readonly campusId = signal<string | null>(null);
  protected readonly schoolId = signal<string | null>(null);
  protected readonly subjectId = signal<string | null>(null);
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly searchText = signal('');
  protected readonly timeRange = signal<TimeRange>('all');

  protected readonly filterBadge = computed(() => {
    let count = 0;
    if (this.timeRange() !== 'all') count++;
    if (this.examType() === 'academy' && this.campusId()) count++;
    if (this.examType() === 'school' && this.schoolId()) count++;
    if (this.subjectId()) count++;
    if (this.statusFilter() !== 'all') count++;
    return count > 0 ? `篩選 (${count})` : '篩選';
  });

  // Pagination
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = PAGE_SIZE;
  private readonly reloadToken = signal(0);
  private latestListRequestId = 0;

  private readonly listQuery = computed(() => ({
    examType: this.examType(),
    campusId: this.campusId(),
    schoolId: this.schoolId(),
    subjectId: this.subjectId(),
    status: this.statusFilter(),
    searchText: this.searchText().trim(),
    timeRange: this.timeRange(),
    page: this.currentPage(),
    pageSize: this.PAGE_SIZE,
    reloadToken: this.reloadToken(),
  }));

  protected readonly totalRows = computed(() => this.total());

  protected readonly hasActiveFilters = computed(
    () =>
      (this.examType() === 'academy' ? this.campusId() !== null : this.schoolId() !== null) ||
      this.subjectId() !== null ||
      this.statusFilter() !== 'all' ||
      this.searchText().trim() !== '' ||
      this.timeRange() !== 'all',
  );

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.totalRows(),
  }));

  // 待辦提醒：active 且 scoreCount = 0
  protected readonly todoCount = computed(() => {
    return this.examType() === 'academy' ? this.academyTodoCount() : this.schoolTodoCount();
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
      label: '新增學校考試',
      icon: 'pi pi-calendar',
      command: () => this.openCreateSchoolDialog(),
    },
  ];

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  constructor() {
    effect(() => {
      const query = this.listQuery();
      this.loadExamRows(query);
    });
  }

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.refData.loadSubjects();
    this.loadSchools();
    this.loadTodoCounts();
  }

  // ── Loaders ───────────────────────────────────────────────────────────
  private loadSchools(): void {
    this.schoolsService
      .list({ isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.schools.set(res.data);
        },
        error: () => {
          this.messageService.add({
            severity: 'warn',
            summary: '學校清單載入失敗',
            detail: '請稍後重試',
          });
        },
      });
  }

  private loadTodoCounts(): void {
    this.academyExamsService
      .getTodoCount()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.academyTodoCount.set(res.count),
        error: () => this.academyTodoCount.set(0),
      });

    this.schoolExamsService
      .getTodoCount()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.schoolTodoCount.set(res.count),
        error: () => this.schoolTodoCount.set(0),
      });
  }

  private loadExamRows(query: {
    examType: ExamTypeFilter;
    campusId: string | null;
    schoolId: string | null;
    subjectId: string | null;
    status: StatusFilter;
    searchText: string;
    timeRange: TimeRange;
    page: number;
    pageSize: number;
    reloadToken: number;
  }): void {
    const requestId = ++this.latestListRequestId;
    this.loading.set(true);

    const dateFrom = this.resolveDateFrom(query.timeRange);
    const status = query.status !== 'all' && query.status !== 'todo' ? query.status : undefined;
    const todo = query.status === 'todo' ? true : undefined;

    if (query.examType === 'academy') {
      this.academyExamsService
        .list({
          search: query.searchText || undefined,
          status,
          campusId: query.campusId ?? undefined,
          subjectId: query.subjectId ?? undefined,
          dateFrom,
          todo,
          page: query.page,
          pageSize: query.pageSize,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            if (requestId !== this.latestListRequestId) return;
            this.currentRows.set(
              res.data.map((exam) => ({
                kind: 'academy' as const,
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
              })),
            );
            this.total.set(res.meta.total);
            this.loading.set(false);
          },
          error: () => {
            if (requestId !== this.latestListRequestId) return;
            this.currentRows.set([]);
            this.total.set(0);
            this.messageService.add({
              severity: 'error',
              summary: '載入失敗',
              detail: '無法載入補習班考試列表',
            });
            this.loading.set(false);
          },
        });
      return;
    }

    const schoolParams: SchoolExamListParams = {
      search: query.searchText || undefined,
      status: status as SchoolExamStatus | undefined,
      schoolId: query.schoolId ?? undefined,
      subjectId: query.subjectId ?? undefined,
      dateFrom,
      todo,
      page: query.page,
      pageSize: query.pageSize,
    };
    this.schoolExamsService
      .list(schoolParams)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (requestId !== this.latestListRequestId) return;
          this.currentRows.set(
            res.data.map((exam) => ({
              kind: 'school' as const,
              id: exam.id,
              name: exam.label,
              examDate: exam.examDate,
              status: exam.status,
              scope: exam.schoolName
                ? `${exam.schoolName} · ${exam.subjectId ? (exam.subjectName ?? '指定科目') : '全科目'}`
                : exam.subjectId
                  ? (exam.subjectName ?? '指定科目')
                  : '全科目',
              scoreCount: exam.scoreCount,
              schoolId: exam.schoolId,
              subjectId: exam.subjectId ?? null,
              subjectName: exam.subjectName ?? null,
              raw: exam,
            })),
          );
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          if (requestId !== this.latestListRequestId) return;
          this.currentRows.set([]);
          this.total.set(0);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學校考試列表',
          });
          this.loading.set(false);
        },
      });
  }

  // ── Filter handlers ───────────────────────────────────────────────────
  protected onExamTypeChange(value: ExamTypeFilter | null): void {
    this.examType.set(value ?? 'academy');
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

  protected onSchoolChange(value: string | null): void {
    this.schoolId.set(value);
    this.currentPage.set(1);
  }

  protected onStatusChange(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.currentPage.set(1);
  }

  protected onTodoBannerClick(tab: ExamKind): void {
    this.examType.set(tab);
    this.statusFilter.set('todo');
    this.currentPage.set(1);
  }

  protected onSearchChange(value: string): void {
    this.searchText.set(value);
    this.currentPage.set(1);
  }

  protected onTimeRangeChange(value: TimeRange | null): void {
    this.timeRange.set(value ?? 'all');
    this.currentPage.set(1);
  }

  protected clearFilters(): void {
    this.campusId.set(null);
    this.schoolId.set(null);
    this.subjectId.set(null);
    this.statusFilter.set('all');
    this.searchText.set('');
    this.timeRange.set('all');
    this.currentPage.set(1);
  }

  protected openFilterDialog(): void {
    const ref = this.dialogService.open(ExamsFilterDialogComponent, {
      header: '篩選條件',
      width: 'min(400px, 96vw)',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data: {
        initial: {
          examType: this.examType(),
          campusId: this.campusId(),
          schoolId: this.schoolId(),
          subjectId: this.subjectId(),
          status: this.statusFilter(),
          timeRange: this.timeRange(),
        },
        options: {
          campusOptions: this.campusOptions(),
          schoolOptions: this.schoolOptions(),
          subjectOptions: this.subjectOptions(),
          statusOptions: this.statusOptions,
          examTypeOptions: this.examTypeOptions,
          timeRangeOptions: this.timeRangeOptions,
        },
      },
    });
    if (!ref) return;
    ref.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result: ExamsFilterDialogResult | undefined) => {
        if (!result) return;
        if (result.cleared) {
          this.clearFilters();
          return;
        }
        this.examType.set(result.examType ?? this.examType());
        this.campusId.set(result.campusId ?? null);
        this.schoolId.set(result.schoolId ?? null);
        this.subjectId.set(result.subjectId ?? null);
        this.statusFilter.set(result.status ?? 'all');
        this.timeRange.set(result.timeRange ?? 'all');
        this.currentPage.set(1);
      });
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
  }

  private resolveDateFrom(range: TimeRange): string | undefined {
    if (range === 'all') return undefined;
    const months = range === '1m' ? 1 : range === '3m' ? 3 : 6;
    return format(subMonths(new Date(), months), 'yyyy-MM-dd');
  }

  private reloadListAndCounts(): void {
    this.reloadToken.update((v) => v + 1);
    this.loadTodoCounts();
  }

  // ── Row helpers ───────────────────────────────────────────────────────
  protected getKindLabel(kind: ExamKind): string {
    return kind === 'academy' ? '補習班考試' : '學校考試';
  }

  protected getAcademyTypeLabel(type: AcademyExamType): string {
    return ACADEMY_EXAM_TYPE_LABELS[type];
  }

  protected getSchoolDisplayName(row: ExamRow): string {
    if (row.kind !== 'school') return row.name;
    const typeLabel = schoolExamTypeLabel(row.raw.examType);
    const customName = row.raw.name?.trim();
    return customName ? `${typeLabel} · ${customName}` : typeLabel;
  }

  protected getStatusLabel(status: AcademyExamStatus | SchoolExamStatus): string {
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
  protected statusTone(status: AcademyExamStatus | SchoolExamStatus): StatusTone {
    return status === 'active' ? 'pending' : 'inactive';
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
    if (row.kind === 'academy') {
      this.openAcademyDialog('edit', row.id);
    } else {
      this.openSchoolDialog('edit', row.id);
    }
  }

  protected openCreateAcademyDialog(): void {
    this.openAcademyDialog('create');
  }

  protected openCreateSchoolDialog(): void {
    this.openSchoolDialog('create');
  }

  private openAcademyDialog(mode: 'create' | 'edit', examId?: string): void {
    const ref = this.dialogService.open(AcademyExamFormDialogComponent, {
      header: mode === 'create' ? '新增補習班考試' : '編輯補習班考試',
      width: 'min(520px, 96vw)',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { mode, examId },
    });
    if (!ref) return;
    ref.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result: AcademyExamFormDialogResult | undefined) => {
        if (result) this.reloadListAndCounts();
      });
  }

  private openSchoolDialog(mode: 'create' | 'edit', examId?: string): void {
    const ref = this.dialogService.open(SchoolExamFormDialogComponent, {
      header: mode === 'create' ? '新增學校考試' : '編輯學校考試',
      width: 'min(480px, 96vw)',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { mode, examId },
    });
    if (!ref) return;
    ref.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result: SchoolExamFormDialogResult | undefined) => {
        if (result) this.reloadListAndCounts();
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
        : this.schoolExamsService.close(row.id);
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已結束',
          detail: `「${row.name}」已結束`,
        });
        this.reloadListAndCounts();
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
        : this.schoolExamsService.reopen(row.id);
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已重新開啟',
          detail: `「${row.name}」已恢復為進行中`,
        });
        this.reloadListAndCounts();
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
        : this.schoolExamsService.delete(row.id);
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已刪除',
          detail: `「${row.name}」已刪除`,
        });
        this.reloadListAndCounts();
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

  private openConfirmDialog(header: string, data: ConfirmDialogData, onAccept: () => void): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: 'min(420px, 96vw)',
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
