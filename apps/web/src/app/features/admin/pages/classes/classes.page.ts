import { Component, OnInit, inject, input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DatePickerModule } from 'primeng/datepicker';
import { MultiSelectModule } from 'primeng/multiselect';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { MessageService, ConfirmationService } from 'primeng/api';

// Services
import {
  ClassesService,
  Class,
  Schedule,
  SessionPreview,
  CreateClassInput,
  UpdateClassInput,
  CreateScheduleInput,
} from '@core/classes.service';
import { CoursesService, Course, CreateCourseInput, UpdateCourseInput } from '@core/courses.service';
import { CampusesService, Campus } from '@core/campuses.service';
import { SubjectsService, Subject } from '@core/subjects.service';
import { StaffService, Staff } from '@core/staff.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

export interface ScheduleFormEntry {
  id?: string;
  weekday: number | null;
  startTime: string;
  endTime: string;
  teacherId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface CourseGroup {
  course: Course;
  classes: Class[];
}

@Component({
  selector: 'app-classes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DialogModule,
    TagModule,
    ToastModule,
    ConfirmDialogModule,
    DatePickerModule,
    MultiSelectModule,
    ToggleSwitch,
    TooltipModule,
    SkeletonModule,
    IconFieldModule,
    InputIconModule,
    EmptyStateComponent,
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './classes.page.html',
  styleUrl: './classes.page.scss',
})
export class ClassesPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly classesService = inject(ClassesService);
  private readonly coursesService = inject(CoursesService);
  private readonly campusesService = inject(CampusesService);
  private readonly subjectsService = inject(SubjectsService);
  private readonly staffService = inject(StaffService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  // ---- Data ----
  protected readonly courses = signal<Course[]>([]);
  protected readonly classes = signal<Class[]>([]);
  protected readonly campuses = signal<Campus[]>([]);
  protected readonly subjects = signal<Subject[]>([]);
  protected readonly staff = signal<Staff[]>([]);
  protected readonly loading = signal(false);
  protected readonly expandedClassId = signal<string | null>(null);

  // ---- Filters ----
  protected readonly searchQuery = signal('');
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly selectedSubjectId = signal<string | null>(null);
  protected readonly statusFilter = signal<boolean | null>(null);

  // ---- Computed options ----
  protected readonly campusOptions = computed(() =>
    this.campuses().map((c) => ({ label: c.name, value: c.id }))
  );
  protected readonly subjectOptions = computed(() =>
    this.subjects().map((s) => ({ label: s.name, value: s.id }))
  );
  protected readonly staffOptions = computed(() =>
    this.staff().map((s) => ({ label: s.displayName, value: s.id }))
  );

  // ---- Computed course groups ----
  protected readonly courseGroups = computed((): CourseGroup[] => {
    const allCourses = this.courses();
    const allClasses = this.classes();
    const search = this.searchQuery().toLowerCase();
    const campusId = this.selectedCampusId();
    const subjectId = this.selectedSubjectId();
    const isActive = this.statusFilter();

    return allCourses
      .filter((c) => {
        if (campusId && c.campusId !== campusId) return false;
        if (subjectId && c.subjectId !== subjectId) return false;
        return true;
      })
      .map((course) => ({
        course,
        classes: allClasses.filter((cl) => {
          if (cl.courseId !== course.id) return false;
          if (search && !cl.name.toLowerCase().includes(search)) return false;
          if (isActive !== null && cl.isActive !== isActive) return false;
          return true;
        }),
      }))
      .filter((g) => g.classes.length > 0 || (!search && isActive === null));
  });

  protected readonly hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.selectedCampusId() ||
      !!this.selectedSubjectId() ||
      this.statusFilter() !== null
  );

  // ---- Course Dialog ----
  protected readonly courseDialogVisible = signal(false);
  protected readonly courseDialogMode = signal<'create' | 'edit'>('create');
  protected readonly editingCourseId = signal<string | null>(null);
  protected readonly courseDialogLoading = signal(false);
  protected readonly courseForm = signal({
    campusId: '',
    name: '',
    subjectId: '',
    description: null as string | null,
    isActive: true,
  });

  protected readonly courseDialogTitle = computed(() =>
    this.courseDialogMode() === 'create' ? '新增課程' : '編輯課程'
  );

  // ---- Class Dialog ----
  protected readonly classDialogVisible = signal(false);
  protected readonly classDialogMode = signal<'create' | 'edit'>('create');
  protected readonly editingClassId = signal<string | null>(null);
  protected readonly classDialogCourseId = signal<string | null>(null);
  protected readonly classDialogLoading = signal(false);
  protected readonly classForm = signal({
    name: '',
    maxStudents: 20,
    gradeLevels: [] as string[],
    isRecommended: false,
    nextClassId: null as string | null,
    isActive: true,
  });
  protected readonly scheduleEntries = signal<ScheduleFormEntry[]>([]);

  protected readonly classDialogTitle = computed(() =>
    this.classDialogMode() === 'create' ? '新增班級' : '編輯班級'
  );

  // ---- Generate Sessions Dialog ----
  protected readonly generateDialogVisible = signal(false);
  protected readonly generateTargetClass = signal<Class | null>(null);
  protected readonly generateFrom = signal<Date | null>(null);
  protected readonly generateTo = signal<Date | null>(null);
  protected readonly previewSessions = signal<SessionPreview[]>([]);
  protected readonly generateLoading = signal(false);
  protected readonly generateStep = signal<'input' | 'preview'>('input');
  protected readonly newSessionCount = computed(
    () => this.previewSessions().filter((s) => !s.exists).length
  );
  protected readonly skippedSessionCount = computed(
    () => this.previewSessions().filter((s) => s.exists).length
  );

  // ---- Static options ----
  protected readonly gradeOptions = [
    { label: '國小一', value: '國小一' },
    { label: '國小二', value: '國小二' },
    { label: '國小三', value: '國小三' },
    { label: '國小四', value: '國小四' },
    { label: '國小五', value: '國小五' },
    { label: '國小六', value: '國小六' },
    { label: '國中一', value: '國中一' },
    { label: '國中二', value: '國中二' },
    { label: '國中三', value: '國中三' },
    { label: '高中一', value: '高中一' },
    { label: '高中二', value: '高中二' },
    { label: '高中三', value: '高中三' },
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
  ];

  // ================================================================
  // Lifecycle
  // ================================================================

  ngOnInit(): void {
    this.loadAll();
  }

  protected loadAll(): void {
    this.loading.set(true);
    Promise.all([
      this.coursesService.list({ pageSize: 200 }).toPromise(),
      this.classesService.list({ pageSize: 500 }).toPromise(),
      this.campusesService.list({ pageSize: 100 }).toPromise(),
      this.subjectsService.list().toPromise(),
      this.staffService.list({ pageSize: 200 }).toPromise(),
    ])
      .then(([coursesRes, classesRes, campusesRes, subjectsRes, staffRes]) => {
        this.courses.set(coursesRes?.data ?? []);
        this.classes.set(classesRes?.data ?? []);
        this.campuses.set(campusesRes?.data ?? []);
        this.subjects.set(subjectsRes?.data ?? []);
        this.staff.set(staffRes?.data ?? []);
        this.loading.set(false);
      })
      .catch((err) => {
        console.error('loadAll failed:', err);
        this.loading.set(false);
        this.messageService.add({ severity: 'error', summary: '載入失敗', detail: '無法載入資料' });
      });
  }

  // ================================================================
  // Expand/Collapse
  // ================================================================

  protected isExpanded(classId: string): boolean {
    return this.expandedClassId() === classId;
  }

  protected toggleExpand(classId: string): void {
    if (this.expandedClassId() === classId) {
      this.expandedClassId.set(null);
      return;
    }
    this.classesService.get(classId).subscribe({
      next: (res) => {
        this.classes.update((list) => list.map((cl) => (cl.id === classId ? res.data : cl)));
        this.expandedClassId.set(classId);
      },
      error: (err) => console.error('Failed to load class detail', err),
    });
  }

  protected clearFilters(): void {
    this.searchQuery.set('');
    this.selectedCampusId.set(null);
    this.selectedSubjectId.set(null);
    this.statusFilter.set(null);
  }

  // ================================================================
  // Course Dialog
  // ================================================================

  protected openCreateCourseDialog(): void {
    this.courseDialogMode.set('create');
    this.editingCourseId.set(null);
    this.courseForm.set({
      campusId: this.campusOptions()[0]?.value ?? '',
      name: '',
      subjectId: this.subjectOptions()[0]?.value ?? '',
      description: null,
      isActive: true,
    });
    this.courseDialogVisible.set(true);
  }

  protected openEditCourseDialog(course: Course): void {
    this.courseDialogMode.set('edit');
    this.editingCourseId.set(course.id);
    this.courseForm.set({
      campusId: course.campusId,
      name: course.name,
      subjectId: course.subjectId,
      description: course.description ?? null,
      isActive: course.isActive,
    });
    this.courseDialogVisible.set(true);
  }

  protected updateCourseForm(field: string, value: unknown): void {
    this.courseForm.update((f) => ({ ...f, [field]: value }));
  }

  protected saveCourse(): void {
    const form = this.courseForm();
    if (!form.name.trim()) {
      this.messageService.add({ severity: 'warn', summary: '請填寫課程名稱', detail: '' });
      return;
    }
    if (!form.subjectId) {
      this.messageService.add({ severity: 'warn', summary: '請選擇科目', detail: '' });
      return;
    }
    this.courseDialogLoading.set(true);

    if (this.courseDialogMode() === 'create') {
      if (!form.campusId) {
        this.messageService.add({ severity: 'warn', summary: '請選擇分校', detail: '' });
        this.courseDialogLoading.set(false);
        return;
      }
      const input: CreateCourseInput = {
        campusId: form.campusId,
        name: form.name.trim(),
        subjectId: form.subjectId,
        description: form.description?.trim() || null,
      };
      this.coursesService.create(input).subscribe({
        next: (res) => {
          this.courses.update((list) => [...list, res.data]);
          this.courseDialogVisible.set(false);
          this.courseDialogLoading.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '新增成功',
            detail: `「${res.data.name}」已建立`,
          });
        },
        error: (err) => {
          this.courseDialogLoading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    } else {
      const courseId = this.editingCourseId()!;
      const input: UpdateCourseInput = {
        name: form.name.trim(),
        subjectId: form.subjectId,
        description: form.description?.trim() || null,
        isActive: form.isActive,
      };
      this.coursesService.update(courseId, input).subscribe({
        next: (res) => {
          this.courses.update((list) => list.map((c) => (c.id === courseId ? res.data : c)));
          this.courseDialogVisible.set(false);
          this.courseDialogLoading.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail: `「${res.data.name}」已更新`,
          });
        },
        error: (err) => {
          this.courseDialogLoading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    }
  }

  protected confirmDeleteCourse(course: Course): void {
    this.confirmationService.confirm({
      message: `確定要刪除課程「${course.name}」嗎？此操作無法復原。`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.coursesService.delete(course.id).subscribe({
          next: () => {
            this.courses.update((list) => list.filter((c) => c.id !== course.id));
            this.classes.update((list) => list.filter((cl) => cl.courseId !== course.id));
            this.messageService.add({
              severity: 'success',
              summary: '刪除成功',
              detail: `「${course.name}」已刪除`,
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
    });
  }

  // ================================================================
  // Class Dialog
  // ================================================================

  protected openCreateClassDialog(courseId: string): void {
    this.classDialogMode.set('create');
    this.editingClassId.set(null);
    this.classDialogCourseId.set(courseId);
    this.classForm.set({
      name: '',
      maxStudents: 20,
      gradeLevels: [],
      isRecommended: false,
      nextClassId: null,
      isActive: true,
    });
    this.scheduleEntries.set([]);
    this.classDialogVisible.set(true);
  }

  protected openEditClassDialog(cls: Class): void {
    this.classDialogMode.set('edit');
    this.editingClassId.set(cls.id);
    this.classDialogCourseId.set(cls.courseId);
    this.classForm.set({
      name: cls.name,
      maxStudents: cls.maxStudents,
      gradeLevels: [...cls.gradeLevels],
      isRecommended: cls.isRecommended,
      nextClassId: cls.nextClassId,
      isActive: cls.isActive,
    });
    this.scheduleEntries.set(
      (cls.schedules ?? []).map((s) => ({
        id: s.id,
        weekday: s.weekday,
        startTime: s.startTime.substring(0, 5),
        endTime: s.endTime.substring(0, 5),
        teacherId: s.teacherId,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
      }))
    );
    this.classDialogVisible.set(true);
  }

  protected updateClassForm(field: string, value: unknown): void {
    this.classForm.update((f) => ({ ...f, [field]: value }));
  }

  protected addScheduleEntry(): void {
    const today = new Date().toISOString().split('T')[0];
    this.scheduleEntries.update((list) => [
      ...list,
      {
        weekday: 1,
        startTime: '09:00',
        endTime: '11:00',
        teacherId: this.staffOptions()[0]?.value ?? '',
        effectiveFrom: today,
        effectiveTo: null,
      },
    ]);
  }

  protected removeScheduleEntry(index: number): void {
    this.scheduleEntries.update((list) => list.filter((_, i) => i !== index));
  }

  protected updateScheduleEntry(index: number, field: string, value: unknown): void {
    this.scheduleEntries.update((list) =>
      list.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry))
    );
  }

  protected saveClass(): void {
    const form = this.classForm();
    const courseId = this.classDialogCourseId()!;

    if (!form.name.trim()) {
      this.messageService.add({ severity: 'warn', summary: '請填寫班級名稱', detail: '' });
      return;
    }

    this.classDialogLoading.set(true);

    if (this.classDialogMode() === 'create') {
      const input: CreateClassInput = {
        courseId,
        name: form.name.trim(),
        maxStudents: form.maxStudents,
        gradeLevels: form.gradeLevels,
        isRecommended: form.isRecommended,
        nextClassId: form.nextClassId,
      };
      this.classesService.create(input).subscribe({
        next: (res) => {
          const entries = this.scheduleEntries();
          if (entries.length === 0) {
            this.reloadClass(res.data.id, 'create');
            return;
          }
          this.addSchedulesSequentially(res.data.id, entries, 0, () =>
            this.reloadClass(res.data.id, 'create')
          );
        },
        error: (err) => {
          this.classDialogLoading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    } else {
      const classId = this.editingClassId()!;
      const updateInput: UpdateClassInput = {
        name: form.name.trim(),
        maxStudents: form.maxStudents,
        gradeLevels: form.gradeLevels,
        isRecommended: form.isRecommended,
        nextClassId: form.nextClassId,
        isActive: form.isActive,
      };
      this.classesService.update(classId, updateInput).subscribe({
        next: () => {
          const existingIds = (
            this.classes()
              .find((cl) => cl.id === classId)
              ?.schedules ?? []
          ).map((s) => s.id);
          const updatedEntries = this.scheduleEntries();
          const keptIds = new Set(updatedEntries.filter((e) => e.id).map((e) => e.id!));
          const toDelete = existingIds.filter((id) => !keptIds.has(id));
          const toAdd = updatedEntries.filter((e) => !e.id);

          const deleteOps = toDelete.map((sid) =>
            this.classesService.deleteSchedule(classId, sid).toPromise()
          );
          Promise.all(deleteOps).then(() => {
            if (toAdd.length === 0) {
              this.reloadClass(classId, 'edit');
            } else {
              this.addSchedulesSequentially(classId, toAdd, 0, () =>
                this.reloadClass(classId, 'edit')
              );
            }
          });
        },
        error: (err) => {
          this.classDialogLoading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    }
  }

  private addSchedulesSequentially(
    classId: string,
    entries: ScheduleFormEntry[],
    index: number,
    onComplete: () => void
  ): void {
    if (index >= entries.length) {
      onComplete();
      return;
    }
    const entry = entries[index];
    if (!entry.teacherId || !entry.weekday) {
      this.addSchedulesSequentially(classId, entries, index + 1, onComplete);
      return;
    }
    const input: CreateScheduleInput = {
      weekday: entry.weekday,
      startTime: entry.startTime,
      endTime: entry.endTime,
      teacherId: entry.teacherId,
      effectiveFrom: entry.effectiveFrom,
      effectiveTo: entry.effectiveTo,
    };
    this.classesService.addSchedule(classId, input).subscribe({
      next: () => this.addSchedulesSequentially(classId, entries, index + 1, onComplete),
      error: () => this.addSchedulesSequentially(classId, entries, index + 1, onComplete),
    });
  }

  private reloadClass(classId: string, mode: 'create' | 'edit'): void {
    this.classesService.get(classId).subscribe({
      next: (res) => {
        if (mode === 'create') {
          this.classes.update((list) => [res.data, ...list]);
        } else {
          this.classes.update((list) => list.map((cl) => (cl.id === classId ? res.data : cl)));
        }
        this.expandedClassId.set(classId);
        this.classDialogVisible.set(false);
        this.classDialogLoading.set(false);
        this.messageService.add({
          severity: 'success',
          summary: mode === 'create' ? '新增成功' : '更新成功',
          detail: `班級已${mode === 'create' ? '建立' : '更新'}`,
        });
      },
      error: () => {
        this.classDialogLoading.set(false);
        this.classDialogVisible.set(false);
        this.loadAll();
      },
    });
  }

  protected confirmDeleteClass(cls: Class): void {
    this.confirmationService.confirm({
      message: `確定要刪除班級「${cls.name}」嗎？此操作無法復原。`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.classesService.delete(cls.id).subscribe({
          next: () => {
            this.classes.update((list) => list.filter((c) => c.id !== cls.id));
            if (this.expandedClassId() === cls.id) this.expandedClassId.set(null);
            this.messageService.add({
              severity: 'success',
              summary: '刪除成功',
              detail: `「${cls.name}」已刪除`,
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
    });
  }

  protected confirmToggleActive(cls: Class): void {
    const action = cls.isActive ? '停用' : '啟用';
    this.confirmationService.confirm({
      message: `確定要${action}班級「${cls.name}」嗎？`,
      header: `確認${action}`,
      icon: 'pi pi-question-circle',
      acceptLabel: action,
      rejectLabel: '取消',
      accept: () => {
        this.classesService.toggleActive(cls.id).subscribe({
          next: (res) => {
            this.classes.update((list) =>
              list.map((c) => (c.id === cls.id ? res.data : c))
            );
            this.messageService.add({
              severity: 'success',
              summary: `${action}成功`,
              detail: `「${cls.name}」已${action}`,
            });
          },
          error: (err) => {
            this.messageService.add({
              severity: 'error',
              summary: `${action}失敗`,
              detail: err.error?.error || '請稍後再試',
            });
          },
        });
      },
    });
  }

  // ================================================================
  // Generate Sessions Dialog
  // ================================================================

  protected openGenerateDialog(cls: Class): void {
    this.generateTargetClass.set(cls);
    this.generateFrom.set(null);
    this.generateTo.set(null);
    this.previewSessions.set([]);
    this.generateStep.set('input');
    this.generateDialogVisible.set(true);
  }

  protected previewSessionsAction(): void {
    const cls = this.generateTargetClass();
    const from = this.generateFrom();
    const to = this.generateTo();
    if (!cls || !from || !to) {
      this.messageService.add({ severity: 'warn', summary: '請選擇完整日期範圍', detail: '' });
      return;
    }
    this.generateLoading.set(true);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    this.classesService.previewSessions(cls.id, fromStr, toStr).subscribe({
      next: (res) => {
        this.previewSessions.set(res.data);
        this.generateLoading.set(false);
        this.generateStep.set('preview');
      },
      error: (err) => {
        this.generateLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '預覽失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  protected confirmGenerateSessions(): void {
    const cls = this.generateTargetClass();
    const from = this.generateFrom();
    const to = this.generateTo();
    if (!cls || !from || !to) return;

    this.generateLoading.set(true);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    this.classesService.generateSessions(cls.id, fromStr, toStr).subscribe({
      next: (res) => {
        this.generateLoading.set(false);
        this.generateDialogVisible.set(false);
        this.messageService.add({
          severity: 'success',
          summary: '課堂產生完成',
          detail: `已建立 ${res.created} 筆，略過 ${res.skipped} 筆（已存在）`,
        });
      },
      error: (err) => {
        this.generateLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '產生失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  // ================================================================
  // Helpers
  // ================================================================

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }

  protected getScheduleSummary(schedules: Schedule[] | undefined): string {
    if (!schedules || schedules.length === 0) return '';
    return schedules
      .map(
        (s) =>
          `${this.getWeekdayLabel(s.weekday)} ${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`
      )
      .join('、');
  }

  protected getCampusName(campusId: string): string {
    return this.campuses().find((c) => c.id === campusId)?.name ?? '未知分校';
  }
}
