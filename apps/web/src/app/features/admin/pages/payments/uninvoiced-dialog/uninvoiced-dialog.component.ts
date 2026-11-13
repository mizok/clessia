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
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { addDays, format, parseISO } from 'date-fns';
import { catchError, filter, forkJoin, map, of } from 'rxjs';

import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { CampusContextService } from '@core/campus-context.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';
import { InvoicesService, type Invoice, type InvoiceItemType } from '@core/invoices.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { SystemClockService } from '@core/system-clock.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/components/confirm-dialog/confirm-dialog.component';

import { payableAmount } from '../../courses/class-detail/enrollment-billing.util';
import { invoicePeriodLabel } from '../payments.util';

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
  imports: [
    DialogFrameComponent,
    DecimalPipe,
    ButtonModule,
    ProgressSpinnerModule,
    InlineNoticeComponent,
  ],
  templateUrl: './uninvoiced-dialog.component.html',
  // 確認框從這個對話框裡開（#2445）；元件層提供，跟帳單頁的 DialogService 分開
  providers: [DialogService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UninvoicedDialogComponent {
  private readonly enrollmentsService = inject(EnrollmentsService);
  /** 跟帳單頁同一個分校範圍（#1314）：頁面上的「有 N 筆」與這裡列的是同一批 */
  private readonly campusCtx = inject(CampusContextService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly invoicesService = inject(InvoicesService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);
  private readonly orgSettings = inject(OrgSettingsService);
  private readonly today = inject(SystemClockService).todayTaipei;
  /** 機構的繳費天數（後端開帳沒給 dueDate 時用它算期限）。沒有 manage_finance 時 API 不給 → null */
  private readonly dueDays = signal<number | null>(null);

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
        .list({
          hasInvoice: false,
          status: 'active',
          campusId: this.campusCtx.id() ?? undefined,
          pageSize: 100,
        })
        .pipe(catchError(() => of(null))),
      templates: this.feeTemplatesService.list({ isActive: true }).pipe(catchError(() => of(null))),
      settings: this.orgSettings.getSettings().pipe(catchError(() => of(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ list, templates, settings }) => {
        this.loading.set(false);
        this.dueDays.set(settings?.invoiceDueDays ?? null);
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

  private itemType(row: Enrollment): InvoiceItemType {
    return row.billingMode === 'session_pack' ? 'session_pack' : 'tuition';
  }

  /**
   * 這筆開出去後帳單列表會寫的期別（#2445，同 `invoicePeriodLabel`）。這裡開的明細不帶 `periodMonth`，
   * 所以是「學費」「堂數包」—— 不另編月份：編了就跟開出去的帳單對不上。
   */
  protected periodOf(row: Enrollment): string {
    const item = { type: this.itemType(row), periodMonth: null, note: null };
    return invoicePeriodLabel({ items: [item] } as unknown as Pick<Invoice, 'items'>);
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

  /**
   * 「全部開帳」先預覽再確認（#2445）：一點就並行開 N 張、按錯要一張張作廢。
   * 預覽只讀，確認後走跟單筆同一個 `issue()`，開出去的帳單逐欄不變。
   */
  protected issueAll(): void {
    const targets = this.issuableRows();
    if (targets.length === 0) return;
    const sum = targets.reduce((acc, row) => acc + this.amountOf(row)!, 0);
    const periods = [...new Set(targets.map((row) => this.periodOf(row)))].join('、');
    const days = this.dueDays();
    // 後端同一個算法：開立日（台北今天）＋機構繳費天數
    const due =
      days === null
        ? '開立日起依機構設定'
        : format(addDays(parseISO(this.today()), days), 'yyyy/M/d');
    const data: ConfirmDialogData = {
      message: [
        `開 ${targets.length} 張`,
        `合計 NT$ ${sum.toLocaleString('en-US')}`,
        `期別 ${periods}`,
        `期限 ${due}`,
      ].join('\n'),
      acceptLabel: `開 ${targets.length} 張`,
      rejectLabel: '再看看',
    };
    this.dialogService
      .open(ConfirmDialogComponent, {
        header: '全部開帳？',
        width: 'var(--dlg-w-md)',
        modal: true,
        showHeader: false,
        data,
      })
      ?.onClose.pipe(
        filter((ok) => ok === true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.issue(targets));
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
                type: this.itemType(row),
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
