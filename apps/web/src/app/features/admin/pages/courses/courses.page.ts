import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { format } from 'date-fns';

// PrimeNG
import { MessageService, MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ToastModule } from 'primeng/toast';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { MenuModule } from 'primeng/menu';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { PopoverModule } from 'primeng/popover';
import { DrawerModule } from 'primeng/drawer';
import type { Popover } from 'primeng/popover';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { PaginatorModule } from 'primeng/paginator';

import { CourseFormDialogComponent } from './course-form-dialog.component';
import { ClassFormDialogComponent } from './class-form-dialog/class-form-dialog.component';
import { GenerateSessionsDialogComponent } from './generate-sessions-dialog/generate-sessions-dialog.component';
// SessionListDialogComponent removed — replaced by sessions list view
import { DeactivateClassDialogComponent } from './deactivate-class-dialog/deactivate-class-dialog.component';

// Services
import { ClassesService, Class, Schedule } from '@core/classes.service';
import { CoursesService, Course } from '@core/courses.service';
import type { Campus } from '@core/campuses.service';
import type { Subject } from '@core/subjects.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import type { Staff } from '@core/staff.service';
import { SessionsService } from '@core/sessions.service';
import { BrowserStateService } from '@core/browser-state.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { CoursesFilterStateService } from './courses-filter-state.service';

interface CourseGroup {
  course: Course;
  classes: Class[];
}

@Component({
  selector: 'app-courses',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ToastModule,
    ButtonModule,
    TabsModule,
    MenuModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectModule,
    MultiSelectModule,
    DatePickerModule,
    ToggleSwitchModule,
    PopoverModule,
    DrawerModule,
    PaginatorModule,
    TagModule,
    TooltipModule,
    RouterModule,
    EmptyStateComponent,
    ConfirmDialogComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './courses.page.html',
  styleUrl: './courses.page.scss',
})
export class CoursesPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly coursesService = inject(CoursesService);
  private readonly classesService = inject(ClassesService);
  private readonly refData = inject(ReferenceDataService);
  private readonly sessionsService = inject(SessionsService);
  private readonly messageService = inject(MessageService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly browserStateService = inject(BrowserStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly filterState = inject(CoursesFilterStateService);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected readonly isMobile = this.browserStateService.isMobile;

  // ---- Data ----
  protected readonly courses = signal<Course[]>([]);
  protected readonly classes = signal<Class[]>([]);
  protected readonly campuses = computed(() => this.refData.campuses());
  protected readonly subjects = computed(() => this.refData.subjects());
  protected readonly staff = computed(() => this.refData.teachers());
  protected readonly loading = signal(false);
  protected readonly showHistorical = signal(false);
  protected readonly historicalDateFrom = signal<Date | null>(null);
  protected readonly historicalDateTo = signal<Date | null>(null);
  protected readonly historicalClasses = signal<Class[]>([]);
  protected readonly loadingHistorical = signal(false);

  protected readonly classActionMenuItems = signal<MenuItem[]>([]);
  protected readonly selectedClassForMenu = signal<Class | null>(null);
  protected readonly expandedCourseIds = signal<Set<string>>(new Set());

  // ---- Selection ----
  protected readonly selectedClassIds = signal<Set<string>>(new Set());
  protected readonly currentPage = signal(1);
  protected readonly total = signal(0);
  protected readonly PAGE_SIZE = 20;

  protected readonly selectedActiveCount = computed(
    () =>
      this.allClasses().filter(
        (cl) => this.selectedClassIds().has(cl.id) && cl.isActive && !this.isHistorical(cl),
      ).length,
  );

  protected readonly selectedInactiveCount = computed(
    () =>
      this.allClasses().filter(
        (cl) => this.selectedClassIds().has(cl.id) && !cl.isActive && !this.isHistorical(cl),
      ).length,
  );

  protected readonly allVisibleSelected = computed(() => {
    const visible = this.courseGroups().flatMap((g) => g.classes);
    return visible.length > 0 && visible.every((cl) => this.selectedClassIds().has(cl.id));
  });

  // ---- Filters ----
  protected readonly searchQuery = signal('');
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly selectedSubjectId = signal<string | null>(null);
  protected readonly selectedTeacherIds = signal<string[]>([]);
  protected readonly statusFilter = signal<boolean | 'intervention' | null>(null);
  // ---- Filter Panel ----
  protected readonly filterPanelVisible = signal(false);
  protected readonly filterPopoverRef = viewChild<Popover>('filterPopover');

  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedSubjectId()) count++;
    if (this.selectedTeacherIds().length > 0) count++;
    if (this.statusFilter() !== null) count++;
    if (this.showHistorical()) count++;
    if (this.historicalDateFrom() || this.historicalDateTo()) count++;
    return count;
  });

  // ---- Computed options ----
  protected readonly activeCampuses = computed(() => this.campuses().filter((c) => c.isActive));
  protected readonly campusOptions = computed(() =>
    this.activeCampuses().map((c) => ({ label: c.name, value: c.id })),
  );
  protected readonly subjectOptions = computed(() =>
    this.subjects().map((s) => ({ label: s.name, value: s.id })),
  );
  protected readonly filteredStaffOptions = computed(() => {
    const selectedCampusId = this.selectedCampusId();
    const teachers = selectedCampusId
      ? this.staff().filter((teacher) => teacher.campusIds.includes(selectedCampusId))
      : this.staff();

    return teachers.map((teacher) => ({
      label: teacher.displayName,
      value: teacher.id,
      subjectNames: teacher.subjectNames,
    }));
  });

  protected readonly validTeacherIdsForSelectedCampus = computed(
    () => new Set(this.filteredStaffOptions().map((option) => option.value)),
  );

  protected isHistorical(cls: Class): boolean {
    if (!cls.endDate) return false;
    const end = new Date(cls.endDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return end < today;
  }

  protected readonly allClasses = computed(() => [
    ...this.classes(),
    ...(this.showHistorical() ? this.historicalClasses() : []),
  ]);

  // ---- Computed course groups ----
  protected readonly courseGroups = computed((): CourseGroup[] => {
    const allCourses = this.courses();
    const allClasses = this.allClasses();
    const search = this.searchQuery().toLowerCase();
    const campusId = this.selectedCampusId();
    const subjectId = this.selectedSubjectId();
    const teacherIds = this.selectedTeacherIds();
    const isActive = this.statusFilter();

    // statusFilter 語意：
    //   false（已停用）      → 只顯示停用課程，班級不額外過濾
    //   true（啟用中）       → 只顯示啟用課程，且只顯示啟用班級
    //   null（全部）         → 只顯示啟用課程，班級不過濾
    //   'intervention'（需介入）→ 同啟用中，再 client-side 過濾需介入的群組
    const effectiveActive = isActive === 'intervention' ? true : isActive;
    const classActiveFilter = effectiveActive === true ? true : null;

    return allCourses
      .filter((c) => {
        if (effectiveActive === false && c.isActive) return false;
        if (effectiveActive !== false && !c.isActive) return false;
        if (campusId && c.campusId !== campusId) return false;
        if (subjectId && c.subjectId !== subjectId) return false;
        return true;
      })
      .map((course) => {
        const courseMatchesSearch = search && course.name.toLowerCase().includes(search);
        return {
          course,
          classes: allClasses.filter((cl) => {
            if (cl.courseId !== course.id) return false;
            if (classActiveFilter !== null && cl.isActive !== classActiveFilter) return false;
            // 「啟用中」filter 時，歷史班級即使 isActive=true 也不顯示
            if (classActiveFilter === true && this.isHistorical(cl)) return false;
            if (
              teacherIds.length > 0 &&
              !teacherIds.some((id) => cl.scheduleTeacherIds?.includes(id))
            )
              return false;
            if (search && !courseMatchesSearch && !cl.name.toLowerCase().includes(search))
              return false;
            return true;
          }),
        };
      })
      .filter((g) => {
        if (g.classes.length > 0) return true;
        if (!search && teacherIds.length === 0) return true;
        return !!(search && g.course.name.toLowerCase().includes(search));
      })
      .filter((g) => isActive !== 'intervention' || this.hasCourseNeedsIntervention(g));
  });

  protected readonly hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.selectedSubjectId() ||
      this.selectedTeacherIds().length > 0 ||
      this.statusFilter() !== null ||
      this.showHistorical() ||
      !!this.historicalDateFrom() ||
      !!this.historicalDateTo(),
  );

  // ---- Static options ----
  protected readonly gradeOptions = [
    { label: '小一', value: '小一' },
    { label: '小二', value: '小二' },
    { label: '小三', value: '小三' },
    { label: '小四', value: '小四' },
    { label: '小五', value: '小五' },
    { label: '小六', value: '小六' },
    { label: '國一', value: '國一' },
    { label: '國二', value: '國二' },
    { label: '國三', value: '國三' },
    { label: '高一', value: '高一' },
    { label: '高二', value: '高二' },
    { label: '高三', value: '高三' },
  ];

  protected readonly weekdayOptions = [
    { label: '週一', value: 1 },
    { label: '週二', value: 2 },
    { label: '週三', value: 3 },
    { label: '週四', value: 4 },
    { label: '週五', value: 5 },
    { label: '週六', value: 6 },
    { label: '週日', value: 7 },
  ];

  protected readonly statusOptions = [
    { label: '全部狀態', value: null },
    { label: '啟用中', value: true },
    { label: '已停用', value: false },
    { label: '需介入', value: 'intervention' },
  ];

  // ================================================================
  // Lifecycle
  // ================================================================

  ngOnInit(): void {
    // 還原上次離開時的 filter 狀態
    const s = this.filterState;
    this.searchQuery.set(s.searchQuery);
    this.selectedCampusId.set(s.selectedCampusId);
    this.selectedSubjectId.set(s.selectedSubjectId);
    this.selectedTeacherIds.set(s.selectedTeacherIds);
    this.statusFilter.set(s.statusFilter);
    this.showHistorical.set(s.showHistorical);
    this.historicalDateFrom.set(s.historicalDateFrom);
    this.historicalDateTo.set(s.historicalDateTo);
    this.currentPage.set(s.currentPage);

    this.loadFilterOptions();
    this.loadAll();

    // 離開頁面時儲存 filter 快照
    this.destroyRef.onDestroy(() => {
      const fs = this.filterState;
      fs.searchQuery = this.searchQuery();
      fs.selectedCampusId = this.selectedCampusId();
      fs.selectedSubjectId = this.selectedSubjectId();
      fs.selectedTeacherIds = this.selectedTeacherIds();
      fs.statusFilter = this.statusFilter();
      fs.showHistorical = this.showHistorical();
      fs.historicalDateFrom = this.historicalDateFrom();
      fs.historicalDateTo = this.historicalDateTo();
      fs.currentPage = this.currentPage();
    });
  }

  protected loadAll(): void {
    this.loadClasses();
    this.loadCourses();
  }

  private loadFilterOptions(): void {
    this.refData.loadCampuses();
    this.refData.loadSubjects();
    this.refData.loadTeachers();
  }

  private loadClasses(): void {
    this.classesService.list({ pageSize: 0 }).subscribe({
      next: (res) => this.classes.set(res.data),
      error: (err) => console.error('Failed to load classes', err),
    });
  }

  private loadHistoricalClasses(): void {
    this.loadingHistorical.set(true);
    const from = this.historicalDateFrom();
    const to = this.historicalDateTo();
    this.classesService
      .list({
        pageSize: 0,
        includeHistorical: true,
        historicalFrom: from ? format(from, 'yyyy-MM-dd') : undefined,
        historicalTo: to ? format(to, 'yyyy-MM-dd') : undefined,
      })
      .subscribe({
        next: (res) => {
          const currentIds = new Set(this.classes().map((c) => c.id));
          this.historicalClasses.set(res.data.filter((c) => !currentIds.has(c.id)));
          this.loadingHistorical.set(false);
        },
        error: () => {
          this.loadingHistorical.set(false);
        },
      });
  }

  private loadCourses(): void {
    this.loading.set(true);
    this.coursesService
      .list({
        search: this.searchQuery() || undefined,
        campusId: this.selectedCampusId() || undefined,
        subjectId: this.selectedSubjectId() || undefined,
        isActive: this.statusFilter() === 'intervention' || this.statusFilter() === null ? true : (this.statusFilter() as boolean),
        page: this.statusFilter() === 'intervention' ? 1 : this.currentPage(),
        pageSize: this.statusFilter() === 'intervention' ? 0 : this.PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.courses.set(res.data);
          this.total.set(res.meta?.total ?? res.data.length);
          this.expandedCourseIds.set(new Set());
          this.selectedClassIds.set(new Set());
          this.loading.set(false);
        },
        error: (err) => {
          console.error('loadCourses failed:', err);
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入課程資料',
          });
        },
      });
  }

  protected onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(1);
    this.loadCourses();
  }

  protected onSubjectChange(value: string | null): void {
    this.selectedSubjectId.set(value);
    this.currentPage.set(1);
    this.loadCourses();
  }

  protected onTeacherChange(value: string[]): void {
    this.selectedTeacherIds.set(value);
    this.currentPage.set(1);
    this.loadCourses();
  }

  protected onStatusFilterChange(value: boolean | null): void {
    this.statusFilter.set(value);
    this.currentPage.set(1);
    this.loadCourses();
  }

  protected onToggleHistorical(value: boolean): void {
    this.showHistorical.set(value);
    if (value) {
      this.loadHistoricalClasses();
    } else {
      const historicalIds = new Set(this.historicalClasses().map((c) => c.id));
      this.historicalClasses.set([]);
      this.historicalDateFrom.set(null);
      this.historicalDateTo.set(null);
      if (historicalIds.size > 0) {
        const current = this.selectedClassIds();
        this.selectedClassIds.set(new Set([...current].filter((id) => !historicalIds.has(id))));
      }
    }
  }

  protected onHistoricalDateFromChange(value: Date | null): void {
    this.historicalDateFrom.set(value);
    if (this.showHistorical()) this.loadHistoricalClasses();
  }

  protected onHistoricalDateToChange(value: Date | null): void {
    this.historicalDateTo.set(value);
    if (this.showHistorical()) this.loadHistoricalClasses();
  }

  protected onPageChange(page: number): void {
    this.currentPage.set(page);
    this.loadCourses();
  }

  // ================================================================
  // Expand/Collapse
  // ================================================================


  openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      header: '課程管理操作紀錄',
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        resourceTypes: ['class', 'course'],
      },
    });
  }

  protected openActionMenu(event: Event, cls: Class, menu: any): void {
    const course = this.courses().find((item) => item.id === cls.courseId);
    const canGenerateSessions =
      Boolean(cls.scheduleCount) && cls.isActive && (course?.isActive ?? true);

    this.selectedClassForMenu.set(cls);
    this.classActionMenuItems.set([
      {
        label: '編輯班級',
        icon: 'pi pi-pencil',
        command: () => this.openEditClassDialog(cls),
      },
      {
        label: '產生課堂',
        icon: 'pi pi-calendar-plus',
        disabled: !canGenerateSessions,
        command: () => this.openGenerateDialog(cls),
      },
      {
        label: '課堂管理',
        icon: 'pi pi-list',
        command: () => this.navigateToSessionsList(cls),
      },
      {
        separator: true,
      },
      {
        label: cls.isActive ? '停用班級' : '啟用班級',
        icon: cls.isActive ? 'pi pi-ban' : 'pi pi-check-circle',
        itemClass: cls.isActive ? 'text-orange-500' : 'text-green-500',
        command: () => this.confirmToggleActive(cls),
      },
      {
        label: cls.hasPastSessions ? '已有歷史課堂，無法刪除' : '刪除班級',
        icon: 'pi pi-trash',
        disabled: cls.hasPastSessions,
        itemClass: 'text-red-500',
        command: () => this.confirmDeleteClass(cls),
      },
    ]);
    menu.toggle(event);
  }

  protected onCampusTabChange(value: string | number | null | undefined): void {
    this.selectedCampusId.set(!value || value === 'all' ? null : String(value));
    this.selectedTeacherIds.update((teacherIds) =>
      teacherIds.filter((teacherId) => this.validTeacherIdsForSelectedCampus().has(teacherId)),
    );
    this.currentPage.set(1);
    this.loadCourses();
  }

  protected clearFilters(): void {
    // 關閉篩選面板
    this.filterPanelVisible.set(false);
    this.filterPopoverRef()?.hide();
    if (this.showHistorical()) {
      this.onToggleHistorical(false);
    }
    this.searchQuery.set('');
    this.selectedCampusId.set(null);
    this.selectedSubjectId.set(null);
    this.selectedTeacherIds.set([]);
    this.statusFilter.set(null);
    this.historicalDateFrom.set(null);
    this.historicalDateTo.set(null);
    this.currentPage.set(1);
    this.loadCourses();
  }

  protected onFilterBtnClick(event: Event): void {
    if (this.isMobile()) {
      this.filterPanelVisible.set(true);
    } else {
      this.filterPopoverRef()?.toggle(event);
    }
  }

  protected isCourseCollapsed(courseId: string): boolean {
    return !this.expandedCourseIds().has(courseId);
  }

  protected toggleCourse(courseId: string): void {
    this.expandedCourseIds.update((set) => {
      const next = new Set(set);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  }

  protected onCourseHeaderSpace(event: Event, group: CourseGroup): void {
    if (group.classes.length === 0) return;
    event.preventDefault();
    this.toggleCourse(group.course.id);
  }

  // ================================================================

  // ================================================================
  // Batch Operations
  // ================================================================

  protected toggleClassSelection(classId: string, event: Event): void {
    event.stopPropagation();
    this.selectedClassIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(classId)) {
        next.delete(classId);
      } else {
        next.add(classId);
      }
      return next;
    });
  }

  protected toggleSelectAll(): void {
    const visibleIds = this.courseGroups()
      .flatMap((g) => g.classes)
      .map((cl) => cl.id);
    const shouldUnselectVisible = this.allVisibleSelected();

    this.selectedClassIds.update((ids) => {
      const next = new Set(ids);
      if (shouldUnselectVisible) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  protected clearSelection(): void {
    this.selectedClassIds.set(new Set());
  }

  protected batchActivate(): void {
    const ids = this.classes()
      .filter((cl) => this.selectedClassIds().has(cl.id) && !cl.isActive)
      .map((cl) => cl.id);
    if (ids.length === 0) return;

    this.openConfirmDialog(
      '批次啟用',
      {
        message: `確定要啟用這 ${ids.length} 個班級嗎？`,
        acceptLabel: '啟用',
        rejectLabel: '取消',
        acceptSeverity: 'success',
      },
      () => {
        this.classesService.batchSetActive(ids, true).subscribe({
          next: (res) => {
            this.classes.update((list) =>
              list.map((cl) => (ids.includes(cl.id) ? { ...cl, isActive: true } : cl)),
            );
            this.selectedClassIds.set(new Set());
            this.messageService.add({
              severity: 'success',
              summary: '批次啟用完成',
              detail: `已啟用 ${res.updated} 個班級`,
            });
          },
          error: (err) => {
            this.messageService.add({
              severity: 'error',
              summary: '批次啟用失敗',
              detail: err.error?.error || '請稍後再試',
            });
          },
        });
      },
    );
  }

  protected batchDeactivate(): void {
    const ids = this.classes()
      .filter((cl) => this.selectedClassIds().has(cl.id) && cl.isActive)
      .map((cl) => cl.id);
    if (ids.length === 0) return;

    this.openConfirmDialog(
      '批次停用',
      {
        message: `確定要停用這 ${ids.length} 個班級嗎？僅會停用班級本身，已排課堂維持原樣；停用後無法新增報名與產生課堂。`,
        acceptLabel: '停用',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
      },
      () => {
        this.classesService.batchSetActive(ids, false).subscribe({
          next: (res) => {
            this.classes.update((list) =>
              list.map((cl) => (ids.includes(cl.id) ? { ...cl, isActive: false } : cl)),
            );
            this.selectedClassIds.set(new Set());
            this.messageService.add({
              severity: 'success',
              summary: '批次停用完成',
              detail: `已停用 ${res.updated} 個班級，既有課堂維持原樣`,
            });
          },
          error: (err) => {
            this.messageService.add({
              severity: 'error',
              summary: '批次停用失敗',
              detail: err.error?.error || '請稍後再試',
            });
          },
        });
      },
    );
  }

  protected batchDelete(): void {
    const classMap = new Map(this.allClasses().map((c) => [c.id, c]));
    const ids = [...this.selectedClassIds()].filter((id) => {
      const cls = classMap.get(id);
      return cls ? !this.isHistorical(cls) : true;
    });
    if (ids.length === 0) return;

    this.openConfirmDialog(
      '批次刪除',
      {
        message: `確定要刪除這 ${ids.length} 個班級嗎？已有歷史課堂記錄的班級將自動略過（請改為停用）。此操作無法復原。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => {
        this.classesService.batchDelete(ids).subscribe({
          next: (res) => {
            this.classes.update((list) => list.filter((cl) => !res.deletedIds.includes(cl.id)));
            this.selectedClassIds.set(new Set());
            const detail =
              res.skipped > 0
                ? `已刪除 ${res.deleted} 個，略過 ${res.skipped} 個（已有歷史課堂記錄）`
                : `已刪除 ${res.deleted} 個班級`;
            this.messageService.add({
              severity: res.skipped > 0 ? 'warn' : 'success',
              summary: '批次刪除完成',
              detail,
            });
          },
          error: (err) => {
            this.messageService.add({
              severity: 'error',
              summary: '批次刪除失敗',
              detail: err.error?.error || '請稍後再試',
            });
          },
        });
      },
    );
  }

  protected openCreateCourseDialog(): void {
    const ref = this.dialogService.open(CourseFormDialogComponent, {
      header: '新增課程',
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        campuses: this.campuses(),
        subjects: this.subjects(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result) => {
        if (result) this.loadAll();
      });
  }

  protected openEditCourseDialog(course: Course): void {
    const ref = this.dialogService.open(CourseFormDialogComponent, {
      header: '編輯課程',
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        course,
        campuses: this.campuses(),
        subjects: this.subjects(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result: Course | undefined) => {
        if (!result) return;
        this.loadAll();
      });
  }

  protected confirmDeleteCourse(course: Course): void {
    this.openConfirmDialog(
      '確認刪除',
      {
        message: `確定要刪除課程「${course.name}」嗎？此操作無法復原。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => {
        this.coursesService.delete(course.id).subscribe({
          next: () => {
            this.loadAll();
            this.messageService.add({
              severity: 'success',
              summary: '刪除成功',
              detail: `「${course.name}」已刪除`,
            });
          },
          error: (err) => {
            if (err.error?.code === 'HAS_CLASSES') {
              this.openConfirmDialog(
                '無法刪除',
                {
                  message: `「${course.name}」底下還有班級，無法刪除。是否改為停用？`,
                  acceptLabel: '停用',
                  rejectLabel: '取消',
                  acceptSeverity: 'warn',
                },
                () => {
                  this.coursesService.update(course.id, { isActive: false }).subscribe({
                    next: () => {
                      this.loadAll();
                      this.messageService.add({
                        severity: 'success',
                        summary: '已停用',
                        detail: `「${course.name}」已停用`,
                      });
                    },
                    error: (updateErr) => {
                      this.messageService.add({
                        severity: 'error',
                        summary: '停用失敗',
                        detail: updateErr.error?.error || '請稍後再試',
                      });
                    },
                  });
                },
              );
            } else {
              this.messageService.add({
                severity: 'error',
                summary: '刪除失敗',
                detail: err.error?.error || '請稍後再試',
              });
            }
          },
        });
      },
    );
  }

  protected openCreateClassDialog(courseId: string): void {
    const course = this.courses().find((c) => c.id === courseId);
    const ref = this.dialogService.open(ClassFormDialogComponent, {
      header: '新增班級',
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        course,
        staff: this.staff(),
        campuses: this.campuses(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result) => {
        if (result) this.loadAll();
      });
  }

  protected openEditClassDialog(cls: Class): void {
    const course = this.courses().find((c) => c.id === cls.courseId);
    const ref = this.dialogService.open(ClassFormDialogComponent, {
      header: '編輯班級',
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        cls,
        course,
        staff: this.staff(),
        campuses: this.campuses(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result) => {
        if (result) this.loadAll();
      });
  }

  protected openGenerateDialog(cls: Class): void {
    const course = this.courses().find((item) => item.id === cls.courseId);
    if (!cls.isActive) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法產生課堂',
        detail: '班級已停用，無法新增未來課程排程',
      });
      return;
    }
    if (course && !course.isActive) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法產生課堂',
        detail: '課程已停用，無法新增未來課程排程',
      });
      return;
    }

    const ref = this.dialogService.open(GenerateSessionsDialogComponent, {
      header: '產生課堂',
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { cls },
    });

    if (ref)
      ref.onClose.subscribe((result) => {
        if (result?.action === 'navigate-sessions') {
          this.router.navigate(['/admin/sessions'], {
            queryParams: {
              classId: result.classId,
              campusId: result.campusId,
              courseId: result.courseId,
              from: result.from,
              to: result.to,
            },
          });
        } else if (result) {
          this.loadAll();
        }
      });
  }

  protected navigateToClass(courseId: string, classId: string): void {
    this.router.navigate(['/admin/courses', courseId, 'classes', classId]);
  }

  protected navigateToSessionsList(cls: Class): void {
    this.sessionsService
      .list({
        classId: cls.id,
        campusIds: [cls.campusId],
        courseIds: [cls.courseId],
      })
      .subscribe({
        next: (res: { data: Array<{ sessionDate: string }> }) => {
          const sessions = res.data;
          const firstSessionDate = sessions[0]?.sessionDate;
          const lastSessionDate = sessions[sessions.length - 1]?.sessionDate;

          this.openSessionsList(cls, firstSessionDate, lastSessionDate);
        },
        error: () => {
          this.openSessionsList(cls);
        },
      });
  }

  protected navigateToUnassignedSessions(cls: Class): void {
    this.sessionsService
      .list({
        classId: cls.id,
        campusIds: [cls.campusId],
        courseIds: [cls.courseId],
      })
      .subscribe({
        next: (res) => {
          const unassignedSessions = res.data.filter(
            (session) =>
              session.assignmentStatus === 'unassigned' && session.status === 'scheduled',
          );
          const firstSessionDate = unassignedSessions[0]?.sessionDate;
          const lastSessionDate = unassignedSessions[unassignedSessions.length - 1]?.sessionDate;

          this.openUnassignedSessionsList(cls, firstSessionDate, lastSessionDate);
        },
        error: () => {
          this.openUnassignedSessionsList(cls);
        },
      });
  }

  private openSessionsList(cls: Class, from?: string, to?: string): void {
    this.router.navigate(['/admin/sessions'], {
      queryParams: {
        classId: cls.id,
        campusId: cls.campusId,
        courseId: cls.courseId,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
    });
  }

  private openUnassignedSessionsList(cls: Class, from?: string, to?: string): void {
    this.router.navigate(['/admin/sessions'], {
      queryParams: {
        classId: cls.id,
        campusId: cls.campusId,
        courseId: cls.courseId,
        assignmentStatus: 'unassigned',
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
    });
  }

  protected confirmToggleActive(cls: Class): void {
    if (cls.isActive) {
      const ref = this.dialogService.open(DeactivateClassDialogComponent, {
        header: '停用班級',
        width: '500px',
        modal: true,
        showHeader: false,
        appendTo: this.overlayContainer || 'body',
        data: { cls },
      });
      if (ref)
        ref.onClose.subscribe((result) => {
          if (result) this.loadAll();
        });
    } else {
      this.openConfirmDialog(
        '確認啟用',
        {
          message: `確定要啟用班級「${cls.name}」嗎？`,
          acceptLabel: '啟用',
          rejectLabel: '取消',
          acceptSeverity: 'success',
        },
        () => {
          this.classesService.toggleActive(cls.id).subscribe({
            next: () => {
              this.loadAll();
              this.messageService.add({
                severity: 'success',
                summary: '啟用成功',
                detail: `「${cls.name}」已啟用`,
              });
            },
            error: (err) => {
              this.messageService.add({
                severity: 'error',
                summary: '啟用失敗',
                detail: err.error?.error || '請稍後再試',
              });
            },
          });
        },
      );
    }
  }

  protected confirmDeleteClass(cls: Class): void {
    if (cls.hasPastSessions) {
      this.openConfirmDialog(
        '無法刪除',
        {
          message: `「${cls.name}」已有歷史課堂記錄，無法刪除。是否改為停用？`,
          acceptLabel: '停用',
          rejectLabel: '取消',
          acceptSeverity: 'warn',
        },
        () => {
          this.classesService.toggleActive(cls.id).subscribe({
            next: () => {
              this.loadAll();
              this.messageService.add({
                severity: 'success',
                summary: '已停用',
                detail: `「${cls.name}」已停用`,
              });
            },
            error: (err) => {
              this.messageService.add({
                severity: 'error',
                summary: '停用失敗',
                detail: err.error?.error || '請稍後再試',
              });
            },
          });
        },
      );
      return;
    }

    this.openConfirmDialog(
      '確認刪除',
      {
        message: `確定要刪除班級「${cls.name}」嗎？此操作無法復原。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => {
        this.classesService.delete(cls.id).subscribe({
          next: () => {
            this.loadAll();
            this.messageService.add({
              severity: 'success',
              summary: '刪除成功',
              detail: `「${cls.name}」及其關聯資料已刪除`,
            });
          },
          error: (err) => {
            this.messageService.add({
              severity: 'error',
              summary: '刪除失敗',
              detail: err.error?.error || '請稍後再試',
            });
          },
        });
      },
    );
  }

  // ================================================================
  // Helpers
  // ================================================================

  private openConfirmDialog(header: string, data: ConfirmDialogData, onAccept: () => void): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: '420px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data,
    });
    if (!ref) return;
    ref.onClose.subscribe((result) => {
      if (result) onAccept();
    });
  }

  protected hasCourseNeedsIntervention(group: CourseGroup): boolean {
    const stats = this.getCourseInterventionStats(group);
    return (
      stats.noScheduleClassCount > 0 ||
      stats.noUpcomingClassCount > 0 ||
      stats.upcomingUnassignedCount > 0 ||
      stats.upcomingConflictCount > 0
    );
  }

  protected getCourseInterventionTooltip(group: CourseGroup): string {
    const stats = this.getCourseInterventionStats(group);
    const reasons: string[] = [];

    if (stats.noScheduleClassCount > 0) {
      reasons.push(`${stats.noScheduleClassCount} 個班級無時段`);
    }
    if (stats.noUpcomingClassCount > 0) {
      reasons.push(`${stats.noUpcomingClassCount} 個班級無未來排程`);
    }
    if (stats.upcomingUnassignedCount > 0) {
      reasons.push(`${stats.upcomingUnassignedCount} 堂課未指派老師`);
    }
    if (stats.upcomingConflictCount > 0) {
      reasons.push(`${stats.upcomingConflictCount} 組時段衝突`);
    }

    return reasons.length > 0 ? `需介入：${reasons.join('、')}` : '目前無需介入';
  }

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }

  protected getScheduleSummary(schedules: Schedule[] | undefined): string {
    if (!schedules || schedules.length === 0) return '';
    const items = schedules.map(
      (s) => `${this.getWeekdayLabel(s.weekday)} ${s.startTime.substring(0, 5)}–${s.endTime.substring(0, 5)}`,
    );

    const maxVisible = this.isMobile() ? 1 : 2;

    if (items.length <= maxVisible) {
      return items.join('、');
    }

    return `${items.slice(0, maxVisible).join('、')} (+${items.length - maxVisible})`;
  }

  protected getCampusName(campusId: string): string {
    return this.campuses().find((c) => c.id === campusId)?.name ?? '未知分校';
  }

  private getCourseInterventionStats(group: CourseGroup): {
    noScheduleClassCount: number;
    noUpcomingClassCount: number;
    upcomingUnassignedCount: number;
    upcomingConflictCount: number;
  } {
    const activeClasses = group.classes.filter((cls) => cls.isActive);
    return {
      noScheduleClassCount: activeClasses.filter((cls) => (cls.scheduleCount ?? 0) === 0).length,
      noUpcomingClassCount: activeClasses.filter(
        (cls) =>
          (cls.scheduleCount ?? 0) > 0 &&
          !cls.hasUpcomingSessions &&
          (cls.upcomingCancelledCount ?? 0) === 0,
      ).length,
      upcomingUnassignedCount: activeClasses.reduce(
        (sum, cls) => sum + (cls.upcomingUnassignedCount ?? 0),
        0,
      ),
      upcomingConflictCount: activeClasses.reduce(
        (sum, cls) =>
          sum + (cls.upcomingClassConflictCount ?? 0) + (cls.upcomingTeacherConflictCount ?? 0),
        0,
      ),
    };
  }
}
