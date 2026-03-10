import { Component, OnInit, inject, signal, computed, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { TextareaModule } from 'primeng/textarea';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService, ConfirmationService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { CourseFormDialogComponent } from './course-form-dialog.component';

// Services
import {
  CoursesService,
  Course,
  CreateCourseInput,
  UpdateCourseInput,
} from '@core/courses.service';
import { CampusesService, Campus } from '@core/campuses.service';
import { SubjectsService, Subject } from '@core/subjects.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SubjectManagerComponent } from '@shared/components/subject-manager/subject-manager.component';

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
    SelectModule,
    MultiSelectModule,
    TextareaModule,
    TagModule,
    TooltipModule,
    ToastModule,
    ConfirmDialogModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    EmptyStateComponent,
  ],
  providers: [MessageService, ConfirmationService, DialogService],
  templateUrl: './courses.page.html',
  styleUrl: './courses.page.scss',
})
export class CoursesPage implements OnInit {
  private readonly dialogService = inject(DialogService);
  private readonly coursesService = inject(CoursesService);
  private readonly campusesService = inject(CampusesService);
  private readonly subjectsService = inject(SubjectsService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // State
  readonly courses = signal<Course[]>([]);
  readonly editingCourse = signal<Course | null>(null);
  readonly campuses = signal<Campus[]>([]);
  readonly subjects = signal<Subject[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly selectedCampusId = signal<string | null>(null);
  readonly selectedSubjectId = signal<string | null>(null);

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

  // Computed
  readonly isEditing = computed(() => this.editingCourse() !== null);
  readonly dialogTitle = computed(() => (this.isEditing() ? '編輯課程' : '新增課程'));

  readonly campusOptions = computed<CampusOption[]>(() => {
    return this.campuses()
      .filter((c) => c.isActive)
      .map((c) => ({ label: c.name, value: c.id }));
  });

  readonly subjectOptions = computed<SubjectOption[]>(() => {
    return this.subjects().map((subject) => ({
      label: subject.name,
      value: subject.id,
    }));
  });

  readonly filteredCourses = computed(() => {
    let result = this.courses();

    // Filter by campus
    const campusId = this.selectedCampusId();
    if (campusId) {
      result = result.filter((c) => c.campusId === campusId);
    }

    // Filter by subject
    const subjectId = this.selectedSubjectId();
    if (subjectId) {
      result = result.filter((c) => c.subjectId === subjectId);
    }

    // Filter by search query
    const query = this.searchQuery().toLowerCase().trim();
    if (query) {
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.subjectName.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.campusName?.toLowerCase().includes(query),
      );
    }

    return result;
  });

  readonly activeCourseCount = computed(() => this.courses().filter((c) => c.isActive).length);

  readonly inactiveCourseCount = computed(() => this.courses().filter((c) => !c.isActive).length);

  readonly hasActiveFilters = computed(
    () => !!this.selectedCampusId() || !!this.selectedSubjectId() || !!this.searchQuery(),
  );

  ngOnInit(): void {
    this.loadCampuses();
    this.loadSubjects();
    this.loadCourses();
  }

  loadCampuses(): void {
    this.campusesService.list({ pageSize: 100, isActive: true }).subscribe({
      next: (res: { data: Campus[] }) => {
        this.campuses.set(res.data);
      },
      error: (err: any) => {
        console.error('Failed to load campuses', err);
      },
    });
  }

  loadCourses(): void {
    this.loading.set(true);
    this.coursesService.list({ pageSize: 100 }).subscribe({
      next: (res: { data: Course[] }) => {
        this.courses.set(res.data);
        this.loading.set(false);
      },
      error: (err: any) => {
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

  loadSubjects(): void {
    this.subjectsService.list().subscribe({
      next: (res: { data: Subject[] }) => {
        this.subjects.set(res.data);
      },
      error: (err: any) => {
        console.error('Failed to load subjects', err);
      },
    });
  }

  clearFilters(): void {
    this.selectedCampusId.set(null);
    this.selectedSubjectId.set(null);
    this.searchQuery.set('');
  }

  openCreateDialog(): void {
    const ref = this.dialogService.open(CourseFormDialogComponent, {
      header: '新增課程',
      width: '500px',
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
        if (result) this.loadCourses();
      });
  }

  openEditDialog(course: Course): void {
    const ref = this.dialogService.open(CourseFormDialogComponent, {
      header: '編輯課程',
      width: '500px',
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
      ref.onClose.subscribe((result) => {
        if (result) this.loadCourses();
      });
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
      error: (err: any) => {
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
}
