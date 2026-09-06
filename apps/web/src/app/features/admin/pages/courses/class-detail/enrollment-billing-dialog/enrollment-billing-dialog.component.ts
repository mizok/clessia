import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import {
  BILLING_MODE_LABELS,
  FeeTemplatesService,
  type BillingMode,
  type FeeTemplate,
} from '@core/fee-templates.service';
import {
  SessionPacksService,
  type SessionPack,
  type SessionPackSummary,
} from '@core/session-packs.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

import {
  billingModeOptions,
  feeTemplateOptions,
  findTemplate,
  isAdjusted,
  pricingHint,
} from '../enrollment-billing.util';
import { SessionPackFormDialogComponent } from '../session-pack-form-dialog/session-pack-form-dialog.component';

/**
 * 單筆報名的計費設定 —— 見 kb/wiki/rules/billing-rules.md 規則 1 與 2。
 *
 * **計費模式是報名層級的選擇，不是班級屬性** —— 同一班可以同時有月繳生與期繳生，
 * 所以這個 dialog 掛在班級名單的單筆動作上，不是班級設定裡。
 *
 * **金額：定價 + 人工覆寫，沒有折扣引擎。** 議定金額留空 = 照價目表定價；
 * 填了數字 = 這個學生就是這個價。改動定價要留原因（自由文字），因為現實中
 * 「折數看老闆當下心情，每個客人還有可能不一樣」—— 那是議價不是規則。
 */
@Component({
  selector: 'app-enrollment-billing-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputNumberModule,
    SelectModule,
    TextareaModule,
    InlineNoticeComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './enrollment-billing-dialog.component.html',
  styleUrl: './enrollment-billing-dialog.component.scss',
})
export class EnrollmentBillingDialogComponent {
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly sessionPacksService = inject(SessionPacksService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly enrollment: Enrollment = this.config.data.enrollment;
  protected readonly saving = signal(false);
  protected readonly templates = signal<FeeTemplate[]>([]);

  protected readonly packs = signal<SessionPack[]>([]);
  protected readonly packSummary = signal<SessionPackSummary | null>(null);
  protected readonly loadingPacks = signal(false);

  protected readonly form = signal({
    billingMode: this.enrollment.billingMode as BillingMode | null,
    feeTemplateId: this.enrollment.feeTemplateId,
    agreedAmount: this.enrollment.agreedAmount,
    adjustmentNote: this.enrollment.adjustmentNote ?? '',
  });

  // 這五個判斷跟 student-picker 的計費區塊共用同一份 —— 兩邊的畫面不一樣，
  // 但「什麼算調整」「該收多少」必須是同一個答案（見 enrollment-billing.util）
  protected readonly billingModeOptions = billingModeOptions();

  protected readonly templateOptions = computed(() => feeTemplateOptions(this.templates()));

  private readonly selectedTemplate = computed(() =>
    findTemplate(this.templates(), this.form().feeTemplateId),
  );

  protected readonly pricingHint = computed(() => pricingHint(this.selectedTemplate()));

  protected readonly isAdjusted = computed(() =>
    isAdjusted(this.form().agreedAmount, this.selectedTemplate()),
  );

  /**
   * 這裡看的是**表單目前選的模式**，不是 `enrollment.billingMode`——
   * 使用者在這個 dialog 裡把模式切成堂數制的當下，就該看得到這個區塊。
   */
  protected readonly isSessionPackMode = computed(() => this.form().billingMode === 'session_pack');

  private get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  constructor() {
    this.feeTemplatesService.list({ isActive: true }).subscribe({
      next: (res) => this.templates.set(res.data),
      error: () => this.templates.set([]),
    });

    // 堂數帳跟表單模式無關（查的是這個報名本來就有的購買紀錄），
    // 不等使用者切到堂數制才載入——一次打完，模式切換只是決定要不要顯示。
    this.loadPacks();
  }

  private loadPacks(): void {
    this.loadingPacks.set(true);
    this.sessionPacksService.list(this.enrollment.id).subscribe({
      next: (res) => {
        this.packs.set(res.data);
        this.packSummary.set(res.summary);
        this.loadingPacks.set(false);
      },
      error: () => {
        this.packs.set([]);
        this.packSummary.set(null);
        this.loadingPacks.set(false);
      },
    });
  }

  protected openBuyPackDialog(): void {
    const dialogRef = this.dialogService.open(SessionPackFormDialogComponent, {
      width: '440px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { enrollmentId: this.enrollment.id, studentName: this.enrollment.studentName },
    });

    dialogRef?.onClose.subscribe((created: SessionPack | undefined) => {
      if (!created) return;
      this.loadPacks();
    });
  }

  protected confirmDeletePack(pack: SessionPack): void {
    this.confirmationService.confirm({
      message: `確定要刪除「${pack.purchasedAt} 購買 ${pack.purchasedCount} 堂」這筆紀錄嗎？`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      acceptButtonProps: { severity: 'danger' },
      accept: () => this.deletePack(pack),
    });
  }

  private deletePack(pack: SessionPack): void {
    this.sessionPacksService.delete(pack.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已刪除',
          detail: '購買紀錄已刪除',
        });
        this.loadPacks();
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  protected update<K extends keyof ReturnType<typeof this.form>>(
    field: K,
    value: ReturnType<typeof this.form>[K],
  ): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    const form = this.form();
    const note = (form.adjustmentNote ?? '').trim();

    if (this.isAdjusted() && !note) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫調整原因',
        detail: '金額與定價不同時要留下原因 —— 半年後沒有人記得為什麼收這個數字',
      });
      return;
    }

    this.saving.set(true);
    this.enrollmentsService
      .update(this.enrollment.id, {
        billingMode: form.billingMode,
        feeTemplateId: form.feeTemplateId,
        // 留空是「照定價」，不是「免費」—— 送 0 會變成後者
        agreedAmount: form.agreedAmount ?? null,
        adjustmentNote: note || null,
      })
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '已儲存',
            detail: `${this.enrollment.studentName ?? '這位學生'}的計費設定已更新`,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '儲存失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.saving.set(false);
        },
      });
  }

  protected cancel(): void {
    this.ref.close();
  }
}
