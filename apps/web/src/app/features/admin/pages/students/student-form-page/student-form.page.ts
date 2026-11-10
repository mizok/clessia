import { Component, Injectable, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { StudentsService, type Student } from '@core/students.service';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { PageDialogRef, type LeaveGuarded } from '@shared/utils/form-page.util';
import { StudentFormDialogComponent } from '../student-form-dialog.component';

/**
 * 存檔成功先發 toast 再回來源頁（#2396 L4 學生 gate）：對話框模式的回饋是開窗端在 onClose 發的，
 * 整頁回去時開窗端重建、那段不會跑。`<app-toast>` 在 app.component，換頁不會消失
 */
@Injectable()
class StudentPageRef extends PageDialogRef {
  private readonly messages = inject(MessageService);
  /** 從家長頁進來時開窗端放在 navigation state 的家長名；直接打網址沒有 */
  private readonly parentName: string | undefined = history.state?.parentName;
  isCreate = true;

  override close(result?: Student): void {
    if (result) {
      this.messages.add({
        severity: 'success',
        summary: this.isCreate ? '已建立' : '已更新',
        detail: !this.isCreate
          ? `「${result.name}」已更新`
          : this.parentName
            ? `「${result.name}」已建立並關聯至「${this.parentName}」`
            : `「${result.name}」已建立`,
      });
    }
    super.close(result);
  }
}

/**
 * 學生表單的手機整頁宿主（#2396 L4）。桌機照舊是對話框；手機由開窗端導到這裡。
 * 抓資料（編輯讀學生；新增從 query 帶 parentId）、換上頁面版 ref、離開保護。表單與儲存 body 不動。
 */
@Component({
  selector: 'app-student-form-page',
  imports: [StudentFormDialogComponent],
  providers: [
    DialogService,
    { provide: DynamicDialogConfig, useFactory: () => new DynamicDialogConfig() },
    StudentPageRef,
    { provide: DynamicDialogRef, useExisting: StudentPageRef },
  ],
  // shell 看到 .form-page 就不加內距（底部列才黏得到捲動容器底）、底色白；殼也給白底（底部列是
  // `background: inherit`，頁面裡不給就透明，見 dialog-frame.md「L4 整頁怎麼寫」）
  host: {
    class:
      'form-page flex flex-1 flex-col bg-white [&_.dialog-frame]:bg-white wide:mx-auto wide:w-full wide:max-w-(--dlg-w-md)',
  },
  template: `
    @if (ready()) {
      <app-student-form-dialog />
    } @else if (failed()) {
      <p class="m-0 p-4 text-sm text-zinc-600">打不開這位學生的資料，請回上一頁再試一次。</p>
    }
  `,
})
export class StudentFormPage implements LeaveGuarded {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(StudentPageRef);
  private readonly dialogService = inject(DialogService);

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);
  private readonly form = viewChild(StudentFormDialogComponent);

  constructor() {
    const snapshot = inject(ActivatedRoute).snapshot;
    const id = snapshot.paramMap.get('id');
    const parentId = snapshot.queryParamMap.get('parentId');
    this.ref.isCreate = !id;
    this.ref.fallback = id
      ? ['/admin/students', id]
      : parentId
        ? ['/admin/parents']
        : ['/admin/students'];

    if (!id) {
      // 表單在建構時讀 config.data，所以先填好再渲染
      this.config.data = { student: null, ...(parentId ? { parentId } : {}) };
      this.ready.set(true);
      return;
    }
    inject(StudentsService)
      .get(id)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (res) => {
          this.config.data = { student: res.data };
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
