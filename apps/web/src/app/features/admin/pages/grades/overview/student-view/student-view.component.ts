import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule } from 'primeng/paginator';
import { DialogService } from 'primeng/dynamicdialog';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { JdenticonAvatarComponent } from '@shared/components/jdenticon-avatar/jdenticon-avatar.component';
import { ReferenceDataService } from '@core/reference-data.service';
import { SchoolsService } from '@core/schools.service';
import {
  GRADE_LEVEL_LABELS,
  GRADE_LEVELS,
  StudentsService,
  type GradeLevel,
  type Student,
  type StudentQueryParams,
} from '@core/students.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { forkJoin, map, of, switchMap } from 'rxjs';

import { StudentScoreDetailDialogComponent } from './student-score-detail-dialog/student-score-detail-dialog.component';
import {
  StudentViewFilterDialogComponent,
  type FilterOption,
  type StudentActiveStatusFilter,
  type StudentViewFilterSnapshot,
} from './student-view-filter-dialog/student-view-filter-dialog.component';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

const GRADE_OPTIONS: Array<{ label: string; value: GradeLevel }> = GRADE_LEVELS.map((grade) => ({
  label: GRADE_LEVEL_LABELS[grade],
  value: grade,
}));

const STATUS_OPTIONS: Array<FilterOption<StudentActiveStatusFilter>> = [
  { label: '全部', value: 'all' },
  { label: '啟用', value: 'active' },
  { label: '停用', value: 'inactive' },
];

const PAGE_SIZE = LIST_PAGE_SIZE;

@Component({
  selector: 'app-student-view',
  standalone: true,
  imports: [
    DataChipComponent,
    FormsModule,
    SelectModule,
    InputTextModule,
    PaginatorModule,
    ButtonModule,
    EmptyStateComponent,
    PageBreadcrumbComponent,
    JdenticonAvatarComponent,
  ],
  templateUrl: './student-view.component.html',
  styleUrl: './student-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DialogService, MessageService],
})
export class StudentViewComponent implements OnInit {
  private readonly studentsService = inject(StudentsService);
  private readonly schoolsService = inject(SchoolsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private studentsRequestToken = 0;

  readonly page = input<RouteObj>();

  protected readonly breadcrumbs: BreadcrumbItem[] = [
    { label: '成績總覽', routerLink: '/admin/grades/overview' },
    { label: '學生視角' },
  ];

  protected readonly gradeOptions = GRADE_OPTIONS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly campusId = signal<string>('');
  protected readonly gradeFilter = signal<GradeLevel | ''>('');
  protected readonly searchText = signal('');
  protected readonly schoolIdFilter = signal<string | null>(null);
  protected readonly activeStatusFilter = signal<StudentActiveStatusFilter>('active');

  protected readonly rawStudents = signal<Student[]>([]);
  protected readonly loadingList = signal(true);
  protected readonly currentPage = signal(1);

  protected readonly schoolOptionsState = signal<Array<FilterOption<string>>>([]);

  protected readonly campusOptions = computed(() =>
    this.refData.campuses().map((campus) => ({ label: campus.name, value: campus.id })),
  );

  protected readonly schoolOptions = computed(() => this.schoolOptionsState());

  protected readonly filteredStudents = computed<Student[]>(() => {
    const schoolId = this.schoolIdFilter();
    let result = this.rawStudents();

    if (schoolId) {
      result = result.filter((student) => student.school?.id === schoolId);
    }

    return result;
  });

  protected readonly totalStudents = computed(() => this.filteredStudents().length);

  protected readonly pagedStudents = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filteredStudents().slice(start, start + PAGE_SIZE);
  });

  constructor() {
    effect(() => {
      const total = this.totalStudents();
      const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (this.currentPage() > maxPage) {
        this.currentPage.set(maxPage);
      }
    });
  }

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.loadSchools();
    this.loadStudents();
  }

  protected onCampusChange(id: string | null): void {
    const nextCampusId = id ?? '';
    if (this.campusId() === nextCampusId) return;
    this.campusId.set(nextCampusId);
    this.resetAndReload();
  }

  protected onGradeChange(grade: GradeLevel | null | ''): void {
    const nextGrade = grade ?? '';
    if (this.gradeFilter() === nextGrade) return;
    this.gradeFilter.set(nextGrade);
    this.resetAndReload();
  }

  protected onSearchChange(text: string): void {
    if (this.searchText() === text) return;
    this.searchText.set(text);
    this.resetAndReload();
  }

  protected onSchoolChange(schoolId: string | null): void {
    this.schoolIdFilter.set(schoolId);
    this.currentPage.set(1);
  }

  protected onActiveStatusChange(status: StudentActiveStatusFilter | null): void {
    const nextStatus = status ?? 'active';
    if (this.activeStatusFilter() === nextStatus) return;
    this.activeStatusFilter.set(nextStatus);
    this.resetAndReload();
  }

  protected onPageChange(page: number): void {
    this.currentPage.set(page);
  }

  protected openMobileFilterDialog(): void {
    this.dialogService.open(StudentViewFilterDialogComponent, {
      width: 'min(420px, 95vw)',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      contentStyle: {
        'max-height': 'calc(var(--window-height, 800px) * 0.85)',
        overflow: 'auto',
      },
      data: {
        initial: this.buildFilterSnapshot(),
        options: {
          campusOptions: this.campusOptions(),
          gradeOptions: this.gradeOptions,
          schoolOptions: this.schoolOptions(),
          statusOptions: this.statusOptions,
        },
        onClear: () => {
          this.clearFilters();
        },
        onChange: (next: StudentViewFilterSnapshot) => {
          this.applyFilterSnapshot(next);
        },
      },
    });
  }

  protected selectStudent(student: Student): void {
    this.dialogService.open(StudentScoreDetailDialogComponent, {
      width: 'min(720px, 95vw)',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      contentStyle: {
        'max-height': 'calc(var(--window-height, 800px) * 0.85)',
        overflow: 'auto',
      },
      data: { student },
    });
  }

  protected formatGrade(grade: GradeLevel): string {
    return GRADE_LEVEL_LABELS[grade] ?? grade;
  }

  private buildFilterSnapshot(): StudentViewFilterSnapshot {
    return {
      campusId: this.campusId(),
      searchText: this.searchText(),
      grade: this.gradeFilter(),
      schoolId: this.schoolIdFilter(),
      status: this.activeStatusFilter(),
    };
  }

  private applyFilterSnapshot(next: StudentViewFilterSnapshot): void {
    const prevCampusId = this.campusId();
    const shouldReload =
      prevCampusId !== next.campusId ||
      this.searchText() !== next.searchText ||
      this.gradeFilter() !== next.grade ||
      this.activeStatusFilter() !== next.status;

    this.campusId.set(next.campusId);
    this.searchText.set(next.searchText);
    this.gradeFilter.set(next.grade);
    this.schoolIdFilter.set(next.schoolId);
    this.activeStatusFilter.set(next.status);

    this.currentPage.set(1);
    if (shouldReload) {
      this.loadStudents();
    }
  }

  private clearFilters(): void {
    const hadServerFilters =
      !!this.campusId() ||
      !!this.searchText() ||
      !!this.gradeFilter() ||
      this.activeStatusFilter() !== 'active';

    this.campusId.set('');
    this.searchText.set('');
    this.gradeFilter.set('');
    this.schoolIdFilter.set(null);
    this.activeStatusFilter.set('active');
    this.currentPage.set(1);

    if (hadServerFilters) {
      this.loadStudents();
    }
  }

  private resetAndReload(): void {
    this.currentPage.set(1);
    this.loadStudents();
  }

  private loadSchools(): void {
    this.schoolsService
      .list({ isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.schoolOptionsState.set(
            res.data
              .map((school) => ({ label: school.name, value: school.id }))
              .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant')),
          );
        },
        error: () => {
          this.schoolOptionsState.set([]);
        },
      });
  }

  private loadStudents(): void {
    const requestToken = ++this.studentsRequestToken;
    this.loadingList.set(true);

    const baseParams = this.buildStudentQueryParams();

    this.studentsService
      .list({ ...baseParams, page: 1, pageSize: 100 })
      .pipe(
        switchMap((firstPage) => {
          const totalPages =
            firstPage.meta?.totalPages ??
            Math.max(1, Math.ceil((firstPage.meta?.total ?? firstPage.data.length) / 100));

          if (totalPages <= 1) {
            return of(firstPage.data);
          }

          const requests = Array.from({ length: totalPages - 1 }, (_, index) => {
            const page = index + 2;
            return this.studentsService.list({ ...baseParams, page, pageSize: 100 });
          });

          return forkJoin(requests).pipe(
            map((responses) => [firstPage, ...responses].flatMap((response) => response.data)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (students) => {
          if (requestToken !== this.studentsRequestToken) return;
          this.rawStudents.set(students);
          this.loadingList.set(false);
        },
        error: () => {
          if (requestToken !== this.studentsRequestToken) return;
          this.rawStudents.set([]);
          this.loadingList.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學生名單',
          });
        },
      });
  }

  private buildStudentQueryParams(): StudentQueryParams {
    return {
      campusId: this.campusId() || undefined,
      grade: this.gradeFilter() || undefined,
      search: this.searchText() || undefined,
      searchScope: 'student_name',
      isActive: this.toIsActiveParam(this.activeStatusFilter()),
    };
  }

  private toIsActiveParam(status: StudentActiveStatusFilter): boolean | undefined {
    if (status === 'active') return true;
    if (status === 'inactive') return false;
    return undefined;
  }
}
