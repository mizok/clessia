import { Component, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, of, firstValueFrom, switchMap, map, type Observable } from 'rxjs';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ClassesService, type Class } from '@core/classes.service';
import { CoursesService } from '@core/courses.service';
import { StaffService } from '@core/staff.service';
import { CampusesService } from '@core/campuses.service';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { PageDialogRef } from '@shared/utils/form-page.util';
import type { LeaveGuarded } from '@shared/utils/form-page-leave.guard';
import { ClassFormDialogComponent } from '../class-form-dialog/class-form-dialog.component';

/**
 * 開課班表單的手機整頁宿主（#2396 L4）。桌機照舊是對話框；手機由開窗端導到這裡。
 * 只做三件事：抓表單要的資料（同 class-detail `openEditClass()`）、換上頁面版 ref、離開保護。
 * 表單本身與儲存 body 不動。
 */
@Component({
  selector: 'app-class-form-page',
  imports: [ClassFormDialogComponent],
  providers: [
    DialogService,
    { provide: DynamicDialogConfig, useFactory: () => new DynamicDialogConfig() },
    PageDialogRef,
    { provide: DynamicDialogRef, useExisting: PageDialogRef },
  ],
  // shell 看到 .form-page 就不加內距（底部列才黏得到捲動容器底）、底色白。
  // 殼的底部列是 `background: inherit`（對話框裡繼承 .p-dialog 的白），頁面裡外層沒有底色 ——
  // 不給殼白底的話底部列透明、捲動中的欄位會從底下透出來
  host: {
    class:
      'form-page flex flex-1 flex-col bg-white [&_.dialog-frame]:bg-white wide:mx-auto wide:w-full wide:max-w-(--dlg-w-lg)',
  },
  template: `
    @if (ready()) {
      <app-class-form-dialog />
    } @else if (failed()) {
      <p class="m-0 p-4 text-sm text-zinc-600">打不開這個班級，請回上一頁再試一次。</p>
    }
  `,
})
export class ClassFormPage implements LeaveGuarded {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(PageDialogRef);
  private readonly dialogService = inject(DialogService);
  private readonly classes = inject(ClassesService);
  private readonly courses = inject(CoursesService);
  private readonly staffApi = inject(StaffService);
  private readonly campusesApi = inject(CampusesService);

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);
  private readonly form = viewChild(ClassFormDialogComponent);

  constructor() {
    const params = inject(ActivatedRoute).snapshot.paramMap;
    const routeCourseId = params.get('courseId');
    const classId = params.get('classId');
    this.ref.fallback = classId
      ? ['/admin/courses', routeCourseId, 'classes', classId]
      : ['/admin/courses'];

    const cls$: Observable<Class | null> = classId
      ? this.classes.get(classId).pipe(map((res) => res.data))
      : of(null);
    cls$
      .pipe(
        // 編輯時以班級自己的 courseId 為準（網址的 courseId 段詳情頁也不讀）
        switchMap((cls) =>
          forkJoin({
            course: this.courses.get(cls?.courseId ?? routeCourseId ?? ''),
            classes: this.classes.list({ pageSize: 0 }),
            staff: this.staffApi.list({ status: 'active', role: 'teacher', pageSize: 0 }),
            campuses: this.campusesApi.list({ isActive: true, pageSize: 0 }),
          }).pipe(map((res) => ({ cls, ...res }))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: ({ cls, course, classes, staff, campuses }) => {
          // 表單在建構時讀 config.data，所以先填好再渲染
          this.config.data = {
            ...(cls ? { cls } : {}),
            course: course.data,
            staff: staff.data,
            campuses: campuses.data,
            classes: classes.data,
          };
          this.ready.set(true);
        },
        error: () => this.failed.set(true),
      });
  }

  canLeave(): boolean | Promise<boolean> {
    if (this.ref.saved || !this.form()?.hasChanges()) return true;
    const confirm = this.dialogService.open(ConfirmDialogComponent, {
      header: '放棄未儲存的變更？',
      width: 'var(--dlg-w-md)',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        message: '剛才改的內容還沒儲存，離開就不會保留。',
        acceptLabel: '放棄',
        rejectLabel: '繼續編輯',
      },
    });
    if (!confirm) return true;
    return firstValueFrom(confirm.onClose).then((ok) => ok === true);
  }
}
