import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ToastModule } from 'primeng/toast';

import { StudentsService, StudentDetail, GradeLevel, GRADE_LEVEL_LABELS } from '@core/students.service';
import {
  EnrollmentsService,
  Enrollment,
  ENROLLMENT_STATUS_LABELS,
} from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StudentFormDialogComponent } from '../student-form-dialog.component';

@Component({
  selector: 'app-student-detail',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, SkeletonModule, ToastModule, EmptyStateComponent],
  providers: [MessageService, DialogService],
  templateUrl: './student-detail.page.html',
  styleUrl: './student-detail.page.scss',
})
export class StudentDetailPage implements OnInit {
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  readonly student = signal<StudentDetail | null>(null);
  readonly loading = signal(true);
  protected readonly enrollments = signal<Enrollment[]>([]);
  protected readonly enrollmentsLoading = signal(false);
  protected readonly ENROLLMENT_STATUS_LABELS = ENROLLMENT_STATUS_LABELS;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadStudent(id);
      this.loadEnrollments(id);
    }
  }

  protected getGradeLabel(grade: GradeLevel): string {
    return GRADE_LEVEL_LABELS[grade] ?? grade;
  }

  protected getGenderLabel(gender: string | null): string {
    if (!gender) return '未填寫';
    const map: Record<string, string> = {
      male: '男',
      female: '女',
      prefer_not_to_say: '不提供',
    };
    return map[gender] ?? gender;
  }

  protected goBack(): void {
    this.router.navigate([RoutesCatalog.ADMIN_STUDENTS.absolutePath]);
  }

  protected openEditDialog(): void {
    const s = this.student();
    if (!s) return;
    const ref = this.dialogService.open(StudentFormDialogComponent, {
      header: '編輯學生資料',
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { student: s },
    });
    if (ref) {
      ref.onClose.subscribe((updated) => {
        if (updated) {
          const id = this.route.snapshot.paramMap.get('id');
          if (id) this.loadStudent(id);
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail: `「${updated.name}」已更新`,
          });
        }
      });
    }
  }

  private loadStudent(id: string): void {
    this.loading.set(true);
    this.studentsService.get(id).subscribe({
      next: (res) => {
        this.student.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load student', err);
        this.messageService.add({
          severity: 'error',
          summary: '載入失敗',
          detail: '無法載入學生資料',
        });
        this.loading.set(false);
      },
    });
  }

  private loadEnrollments(studentId: string): void {
    this.enrollmentsLoading.set(true);
    this.enrollmentsService
      .list({ studentId, pageSize: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.enrollments.set(
            res.data.filter((e) => ['active', 'pending_payment'].includes(e.status)),
          );
          this.enrollmentsLoading.set(false);
        },
        error: () => this.enrollmentsLoading.set(false),
      });
  }
}
