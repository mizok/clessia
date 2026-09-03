import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, forkJoin, map, of } from 'rxjs';

import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';
import { InvoicesService } from '@core/invoices.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

import { payableAmount } from '../../courses/class-detail/enrollment-billing.util';

/**
 * 待開帳清單 —— 已經生效、但從來沒開過任何帳單的報名。
 *
 * **這一頁是 B3 設計裡「決定 4」的另一半。** 那個決定是「報名與帳單不同一個事務」：
 * 開帳失敗時報名保留，因為報名是既成事實。而它成立的前提是**殘留看得見** ——
 * 沒有這份清單，「報名在、帳單不在」就只是一個沒有人查得到的狀態，
 * 那時候分開事務就變成了把問題藏起來。
 *
 * 金額用 `payableAmount`（議定價 → 價目表 → 沒有）。**沒有金額的不給開** ——
 * 開一張金額是猜的帳單比不開更糟。
 */
@Component({
  selector: 'app-uninvoiced-dialog',
  standalone: true,
  imports: [DecimalPipe, ButtonModule, ProgressSpinnerModule, InlineNoticeComponent],
  templateUrl: './uninvoiced-dialog.component.html',
  styleUrl: './uninvoiced-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UninvoicedDialogComponent {
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly invoicesService = inject(InvoicesService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly rows = signal<Enrollment[]>([]);
  protected readonly templates = signal<FeeTemplate[]>([]);
  protected readonly total = signal(0);
  protected readonly issuing = signal(false);
  protected readonly issuedIds = signal<ReadonlySet<string>>(new Set<string>());
  protected readonly failedIds = signal<ReadonlySet<string>>(new Set<string>());

  /** 還沒開、而且開得了（有金額）的 —— 批次那顆按鈕算的是這個 */
  protected readonly issuableRows = computed(() =>
    this.rows().filter((r) => !this.issuedIds().has(r.id) && this.amountOf(r) !== null),
  );

  /** 有報名但**沒有計費設定**的 —— 這些人要先回班級名單設定，清單只能指出來 */
  protected readonly needsBillingCount = computed(
    () => this.rows().filter((r) => this.amountOf(r) === null).length,
  );

  constructor() {
    forkJoin({
      list: this.enrollmentsService
        .list({ hasInvoice: false, status: 'active', pageSize: 100 })
        .pipe(catchError(() => of(null))),
      templates: this.feeTemplatesService.list({ isActive: true }).pipe(catchError(() => of(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ list, templates }) => {
        this.loading.set(false);
        if (!list) {
          this.failed.set(true);
          return;
        }
        this.rows.set(list.data);
        // 後端算的是篩後全體，不是這一頁 —— 顯示「還有幾筆」要用它（charter 坑 #4）
        this.total.set(list.meta.total);
        this.templates.set(templates?.data ?? []);
      });
  }

  protected amountOf(row: Enrollment): number | null {
    return payableAmount(
      { agreedAmount: row.agreedAmount, feeTemplateId: row.feeTemplateId },
      this.templates(),
    );
  }

  protected isIssued(row: Enrollment): boolean {
    return this.issuedIds().has(row.id);
  }

  protected isFailed(row: Enrollment): boolean {
    return this.failedIds().has(row.id);
  }

  protected issueOne(row: Enrollment): void {
    this.issue([row]);
  }

  protected issueAll(): void {
    this.issue(this.issuableRows());
  }

  private issue(targets: readonly Enrollment[]): void {
    if (targets.length === 0) return;
    this.issuing.set(true);

    // 每一筆各自成敗 —— forkJoin 預設 fail-fast，一張掛掉會讓其餘已經開出去的看不見
    forkJoin(
      targets.map((row) =>
        this.invoicesService
          .create({
            studentId: row.studentId,
            items: [
              {
                type: row.billingMode === 'session_pack' ? 'session_pack' : 'tuition',
                enrollmentId: row.id,
                amount: this.amountOf(row)!,
              },
            ],
          })
          .pipe(
            map(() => ({ row, ok: true })),
            catchError(() => of({ row, ok: false })),
          ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((outcomes) => {
        this.issuing.set(false);
        this.issuedIds.update(
          (set) => new Set([...set, ...outcomes.filter((o) => o.ok).map((o) => o.row.id)]),
        );
        this.failedIds.set(new Set(outcomes.filter((o) => !o.ok).map((o) => o.row.id)));
      });
  }

  protected close(): void {
    this.ref.close(this.issuedIds().size > 0 ? { issued: this.issuedIds().size } : undefined);
  }
}
