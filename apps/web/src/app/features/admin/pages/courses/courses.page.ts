import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { MessageService, ConfirmationService } from 'primeng/api';

// Services
import {
  CoursesService,
  Course,
  CreateCourseInput,
  UpdateCourseInput,
} from '@core/courses.service';
import { CampusesService, Campus } from '@core/campuses.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

interface SubjectOption {
  label: string;
  value: string;
}

interface CampusOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-courses',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    ToggleSwitch,
    ToastModule,
    ConfirmDialogModule,
    TooltipModule,
    SkeletonModule,
    TagModule,
    IconFieldModule,
    InputIconModule,
    SelectModule,
    TextareaModule,
    EmptyStateComponent,
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './courses.page.html',
  styleUrl: './courses.page.scss',
})
export class CoursesPage implements OnInit {
  private readonly coursesService = inject(CoursesService);
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  // State
  readonly courses = signal<Course[]>([]);
  readonly campuses = signal<Campus[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly selectedCampusId = signal<string | null>(null);
  readonly selectedSubject = signal<string | null>(null);
  readonly dialogVisible = signal(false);
  readonly dialogLoading = signal(false);

  // Edit form state
  readonly editingCourse = signal<Course | null>(null);
  readonly formData = signal<{
    campusId: string;
    name: string;
    subject: string;
    description: string;
    isActive: boolean;
  }>({
    campusId: '',
    name: '',
    subject: '',
    description: '',
    isActive: true,
  });

  // Computed
  readonly isEditing = computed(() => this.editingCourse() !== null);
  readonly dialogTitle = computed(() =>
    this.isEditing() ? '編輯課程' : '新增課程'
  );

  readonly campusOptions = computed<CampusOption[]>(() => {
    return this.campuses()
      .filter((c) => c.isActive)
      .map((c) => ({ label: c.name, value: c.id }));
  });

  readonly subjectOptions = computed<SubjectOption[]>(() => {
    const subjects = [...new Set(this.courses().map((c) => c.subject))].sort();
    return subjects.map((s) => ({ label: s, value: s }));
  });

  readonly filteredCourses = computed(() => {
    let result = this.courses();

    // Filter by campus
    const campusId = this.selectedCampusId();
    if (campusId) {
      result = result.filter((c) => c.campusId === campusId);
    }

    // Filter by subject
    const subject = this.selectedSubject();
    if (subject) {
      result = result.filter((c) => c.subject === subject);
    }

    // Filter by search query
    const query = this.searchQuery().toLowerCase().trim();
    if (query) {
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.subject.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.campusName?.toLowerCase().includes(query)
      );
    }

    return result;
  });

  readonly activeCourseCount = computed(
    () => this.courses().filter((c) => c.isActive).length
  );

  readonly inactiveCourseCount = computed(
    () => this.courses().filter((c) => !c.isActive).length
  );

  readonly hasActiveFilters = computed(
    () => !!this.selectedCampusId() || !!this.selectedSubject() || !!this.searchQuery()
  );

  ngOnInit(): void {
    this.loadCampuses();
    this.loadCourses();
  }

  loadCampuses(): void {
    this.campusesService.list({ pageSize: 100, isActive: true }).subscribe({
      next: (res) => {
        this.campuses.set(res.data);
      },
      error: (err) => {
        console.error('Failed to load campuses', err);
      },
    });
  }

  loadCourses(): void {
    this.loading.set(true);
    this.coursesService.list({ pageSize: 100 }).subscribe({
      next: (res) => {
        this.courses.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load courses', err);
        this.messageService.add({
          severity: 'error',
          summary: '載入失敗',
          detail: '無法載入課程列表',
        });
        this.loading.set(false);
      },
    });
  }

  clearFilters(): void {
    this.selectedCampusId.set(null);
    this.selectedSubject.set(null);
    this.searchQuery.set('');
  }

  openCreateDialog(): void {
    this.editingCourse.set(null);
    this.formData.set({
      campusId: this.campusOptions()[0]?.value || '',
      name: '',
      subject: '',
      description: '',
      isActive: true,
    });
    this.dialogVisible.set(true);
  }

  openEditDialog(course: Course): void {
    this.editingCourse.set(course);
    this.formData.set({
      campusId: course.campusId,
      name: course.name,
      subject: course.subject,
      description: course.description || '',
      isActive: course.isActive,
    });
    this.dialogVisible.set(true);
  }

  closeDialog(): void {
    this.dialogVisible.set(false);
    this.editingCourse.set(null);
  }

  saveCourse(): void {
    const form = this.formData();

    if (!form.campusId) {
      this.messageService.add({
        severity: 'warn',
        summary: '請選擇分校',
        detail: '分校為必填欄位',
      });
      return;
    }

    if (!form.name.trim()) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫課程名稱',
        detail: '課程名稱為必填欄位',
      });
      return;
    }

    if (!form.subject.trim()) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫科目',
        detail: '科目為必填欄位',
      });
      return;
    }

    this.dialogLoading.set(true);

    if (this.isEditing()) {
      const course = this.editingCourse()!;
      const input: UpdateCourseInput = {
        name: form.name.trim(),
        subject: form.subject.trim(),
        description: form.description.trim() || null,
        isActive: form.isActive,
      };

      this.coursesService.update(course.id, input).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail: `「${form.name}」已更新`,
          });
          this.closeDialog();
          this.loadCourses();
          this.dialogLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to update course', err);
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.dialogLoading.set(false);
        },
      });
    } else {
      const input: CreateCourseInput = {
        campusId: form.campusId,
        name: form.name.trim(),
        subject: form.subject.trim(),
        description: form.description.trim() || null,
      };

      this.coursesService.create(input).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '新增成功',
            detail: `「${form.name}」已建立`,
          });
          this.closeDialog();
          this.loadCourses();
          this.dialogLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to create course', err);
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.dialogLoading.set(false);
        },
      });
    }
  }

  confirmDelete(course: Course): void {
    this.confirmationService.confirm({
      message: `確定要刪除「${course.name}」嗎？此操作無法復原。`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteCourse(course),
    });
  }

  private deleteCourse(course: Course): void {
    this.coursesService.delete(course.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '刪除成功',
          detail: `「${course.name}」已刪除`,
        });
        this.loadCourses();
      },
      error: (err) => {
        console.error('Failed to delete course', err);
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  getCampusName(campusId: string): string {
    return this.campuses().find((c) => c.id === campusId)?.name || '未知分校';
  }

  updateCampusId(value: string): void {
    this.formData.update((f) => ({ ...f, campusId: value }));
  }

  updateName(value: string): void {
    this.formData.update((f) => ({ ...f, name: value }));
  }

  updateSubject(value: string): void {
    this.formData.update((f) => ({ ...f, subject: value }));
  }

  updateDescription(value: string): void {
    this.formData.update((f) => ({ ...f, description: value }));
  }

  updateIsActive(value: boolean): void {
    this.formData.update((f) => ({ ...f, isActive: value }));
  }
}
