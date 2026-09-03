import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, forkJoin, map, of, catchError } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { CheckboxModule } from 'primeng/checkbox';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import {
  StudentsService,
  Student,
  GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
} from '@core/students.service';
import {
  EnrollmentsService,
  type BatchCreateResult,
  type ProrationPreview,
  type ScheduleConflictWarning,
} from '@core/enrollments.service';
import { BillingPeriodsService, type BillingPeriod } from '@core/billing-periods.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';
import { InvoicesService } from '@core/invoices.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';
import { personHue } from '@shared/utils/person-hue.util';
import { EnrollmentBillingFieldsComponent } from '../enrollment-billing-fields/enrollment-billing-fields.component';
import { todayLocal } from '@shared/utils/session-time.util';

import {
  emptyBillingDraft,
  findTemplate,
  isAdjusted,
  payableAmount,
  type BillingDraft,
} from '../enrollment-billing.util';

@Component({
  selector: 'app-student-picker-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    SkeletonModule,
    IconFieldModule,
    InputIconModule,
    CheckboxModule,
    InlineNoticeComponent,
    EnrollmentBillingFieldsComponent,
  ],
  templateUrl: './student-picker-dialog.component.html',
  styleUrl: './student-picker-dialog.component.scss',
})
export class StudentPickerDialogComponent implements OnInit {
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly billingPeriodsService = inject(BillingPeriodsService);
  private readonly invoicesService = inject(InvoicesService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  protected readonly loading = signal(true);
  protected readonly confirming = signal(false);
  protected readonly confirmError = signal<string | null>(null);
  protected readonly conflictWarnings = signal<readonly ScheduleConflictWarning[]>([]);
  protected readonly students = signal<Student[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);
  // **刻意不用 LIST_PAGE_SIZE。** 這是對話框裡的挑選器，清單區被 max-height 綁在
  // 340–380px（約 7–8 列），受限的是強制高度不是視窗高度 —— 跟整頁列表是不同的情境。
  protected readonly PAGE_SIZE = 8;

  protected readonly searchQuery = signal('');

  // ── 計費與開帳（B3 第一片）───────────────────────────────────────────────
  //
  // 報名跟開帳本來是三段各走各的：報名（不帶計費）→ 事後逐筆設計費 →
  // 再去繳費頁開帳，中間兩次要重打同一組數字。這裡把三段收成一次。

  protected readonly templates = signal<FeeTemplate[]>([]);
  protected readonly periods = signal<BillingPeriod[]>([]);
  /** 期繳的試算要指定是哪一段期間。**不存進報名** —— 它只是試算的參數 */
  protected readonly selectedPeriodId = signal<string | null>(null);
  protected readonly billing = signal<BillingDraft>(emptyBillingDraft());
  private readonly selectedTemplate = computed(() =>
    findTemplate(this.templates(), this.billing().feeTemplateId),
  );

  /** 送出前的驗證要用 —— 顯示由 `app-enrollment-billing-fields` 自己判斷 */
  protected readonly isAdjusted = computed(() =>
    isAdjusted(this.billing().agreedAmount, this.selectedTemplate()),
  );

  protected readonly payable = computed(() => payableAmount(this.billing(), this.templates()));

  /**
   * 期中插班的比例試算。**只在月繳模式自動算** —— 期繳要指定是哪一段收費週期
   * （`billing_periods` 是期繳專用的表），那是一個額外的選單，留給下一片；
   * 堂數制按堂不按天，本來就沒有比例可言。
   *
   * 算法跟月結批次共用後端的 `prorateByDays`，所以這裡看到的數字跟隔天真的開出來的
   * 帳單對得起來 —— 兩邊各算一次的話，哪天不一樣沒有人會知道。
   */
  protected readonly proration = signal<ProrationPreview | null>(null);
  protected readonly prorating = signal(false);

  private refreshProration(): void {
    const draft = this.billing();
    const hasPrice = draft.feeTemplateId !== null || draft.agreedAmount !== null;

    // **月繳給 periodMonth、期繳給 billingPeriodId，二擇一**（後端的 refine 會擋）。
    // 堂數制按堂不按天，沒有比例可言。
    const period =
      draft.billingMode === 'monthly'
        ? { periodMonth: todayLocal().slice(0, 7) }
        : draft.billingMode === 'period' && this.selectedPeriodId()
          ? { billingPeriodId: this.selectedPeriodId()! }
          : null;

    if (!hasPrice || !period) {
      this.proration.set(null);
      return;
    }

    this.prorating.set(true);
    this.enrollmentsService
      .prorationPreview({
        ...period,
        effectiveFrom: todayLocal(),
        feeTemplateId: draft.feeTemplateId ?? undefined,
        agreedAmount: draft.agreedAmount ?? undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.prorating.set(false);
          // 整期都在讀時 note 是 null —— 那時候沒有東西要解釋，也就不必顯示
          this.proration.set(res.note ? res : null);
        },
        // 試算失敗不擋報名 —— 它是建議值不是前提
        error: () => {
          this.prorating.set(false);
          this.proration.set(null);
        },
      });
  }

  protected onPeriodChange(id: string | null): void {
    this.selectedPeriodId.set(id);
    this.refreshProration();
  }

  /** 把試算金額填進議定金額 —— 規則 5.2：試算是**建議值**，填進去之後照樣可以改 */
  protected applyProration(): void {
    const amount = this.proration()?.amount;
    if (amount === undefined) return;
    this.updateBilling('agreedAmount', amount);
  }

  /**
   * 立即開帳的預設值 **看選了幾個人**。
   *
   * 選一個人是櫃檯現場（那個人就站在前面，接下來就是收錢）；選一批是灌名單，
   * 金額多半還要逐筆議，而三十張開錯了要逐張作廢 —— 作廢比不開貴。
   * 預設值站在最常見的那一側，不是為了一致而一致。
   */
  private readonly issueInvoiceTouched = signal(false);
  protected readonly issueInvoice = signal(false);

  /** 已報名但帳單沒開成的 —— 決定 4 的殘留，當場看得到也重試得了 */
  /** 這批真的加進去的人（已存在與失敗的不算） */
  protected readonly enrolledTargets = computed(() =>
    (this.enrolledResult()?.results ?? [])
      .filter((r) => r.status === 'enrolled' && r.enrollmentId)
      .map((r) => ({ studentId: r.studentId, enrollmentId: r.enrollmentId! })),
  );

  /** 還沒開帳的人數 —— 結果頁那顆按鈕靠它決定要不要出現、以及寫幾張 */
  protected readonly uninvoicedCount = computed(
    () => this.enrolledTargets().filter((t) => !this.invoicedStudentIds().has(t.studentId)).length,
  );

  protected readonly alreadyExistsCount = computed(
    () =>
      (this.enrolledResult()?.results ?? []).filter((r) => r.status === 'already_exists').length,
  );

  protected readonly enrollErrorCount = computed(
    () => (this.enrolledResult()?.results ?? []).filter((r) => r.status === 'error').length,
  );

  protected readonly invoiceFailures = signal<
    readonly { studentId: string; enrollmentId: string }[]
  >([]);
  protected readonly issuing = signal(false);
  /** 結果頁的提示（例如「沒有金額不能開帳」）—— 跟 confirmError 分開，那是送出前的 */
  protected readonly notice = signal<string | null>(null);
  protected readonly invoicesCreated = signal(0);
  private readonly enrolledResult = signal<BatchCreateResult | null>(null);
  protected selectedGrade: GradeLevel | null = null;
  protected selectedGender: string | null = null;

  // 兩步 wizard 狀態
  /**
   * `result` 這一步是 B3 第二片加的。原本批次送出就直接關閉，只留一個 toast 摘要
   * （「成功加入 30 人」）—— **誰已經在班上、誰失敗了，一個字都看不到**。
   *
   * 停在結果頁同時解掉兩件事：逐筆結果看得見，以及**開帳的入口就在這裡**
   * （不用切到繳費頁把那 30 個人再找一次）。
   */
  protected readonly step = signal<'selecting' | 'reviewing' | 'result'>('selecting');

  /** 已經開過帳的學生 —— 重試與補開都不該對同一個人開第二張 */
  private readonly invoicedStudentIds = signal<ReadonlySet<string>>(new Set<string>());

  // 多選狀態：選中的 studentId set
  protected readonly selectedIds = signal<Set<string>>(new Set());

  // 從 class-detail 傳入的 config
  private readonly existingStudentIds = new Set<string>(this.config.data?.existingStudentIds ?? []);
  private readonly maxStudents: number = this.config.data?.maxStudents ?? 9999;
  private readonly currentActiveCount: number = this.config.data?.currentActiveCount ?? 0;
  private readonly classId: string = this.config.data?.classId ?? '';
  protected readonly remainingSlots = this.maxStudents - this.currentActiveCount;

  protected readonly gradeOptions = [
    { label: '全部年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];
  protected readonly gradeLabelMap = GRADE_LEVEL_LABELS;
  protected readonly genderOptions = [
    { label: '全部性別', value: null },
    { label: '男', value: 'male' },
    { label: '女', value: 'female' },
    { label: '不提供', value: 'prefer_not_to_say' },
  ];
  // 過濾掉已在班的學生
  protected readonly filteredStudents = computed(() =>
    this.students().filter((s) => !this.existingStudentIds.has(s.id)),
  );

  // 選中的人數
  protected readonly selectedCount = computed(() => this.selectedIds().size);

  // 選中的 Student 物件清單（Step 2 預覽用）
  protected readonly selectedStudents = computed(() =>
    this.students().filter((s) => this.selectedIds().has(s.id)),
  );
  protected readonly studentNameMap = computed(
    () => new Map(this.students().map((student) => [student.id, student.name])),
  );

  // 超額檢查（Step 2 用）
  protected readonly overQuotaCount = computed(() =>
    Math.max(0, this.selectedCount() - this.remainingSlots),
  );

  ngOnInit(): void {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.currentPage.set(1);
        this.load();
      });
    this.load();

    // 只撈啟用中的 —— 停用的價目表不該還能被挑到
    this.feeTemplatesService
      .list({ isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.templates.set(res.data),
        error: () => this.templates.set([]),
      });

    // 收費期間沒有分頁，一次撈完。載入失敗只會讓期繳的試算叫不動，不擋報名
    this.billingPeriodsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.periods.set(res.data),
        error: () => this.periods.set([]),
      });
  }

  protected load(): void {
    this.loading.set(true);
    this.studentsService
      .list({
        search: this.searchQuery() || undefined,
        grade: this.selectedGrade ?? undefined,
        isActive: true,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.students.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected onSearchChange(value: string): void {
    this.searchSubject.next(value);
  }

  protected onFilterChange(): void {
    this.currentPage.set(1);
    this.load();
  }

  protected toggleSelection(student: Student): void {
    const ids = new Set(this.selectedIds());
    if (ids.has(student.id)) {
      ids.delete(student.id);
    } else {
      ids.add(student.id);
    }
    this.selectedIds.set(ids);
  }

  protected isSelected(studentId: string): boolean {
    return this.selectedIds().has(studentId);
  }

  protected goToReview(): void {
    // 人數會在 review 裡被改（移除某人），所以只在使用者還沒碰過那顆時才跟著動 ——
    // 他明確關掉之後又因為刪掉一個人自動打開，是最惱人的那種「聰明」
    if (!this.issueInvoiceTouched()) this.issueInvoice.set(this.selectedCount() === 1);
    this.step.set('reviewing');
  }

  protected onIssueInvoiceChange(value: boolean): void {
    this.issueInvoiceTouched.set(true);
    this.issueInvoice.set(value);
  }

  protected updateBilling<K extends keyof BillingDraft>(field: K, value: BillingDraft[K]): void {
    this.billing.update((draft) => ({ ...draft, [field]: value }));
  }

  protected onBillingChange(next: BillingDraft): void {
    const prev = this.billing();
    this.billing.set(next);
    // 金額與原因不重算 —— 前者會變成「填了試算值 → 觸發試算 → 又填」的迴圈
    if (next.billingMode !== prev.billingMode || next.feeTemplateId !== prev.feeTemplateId) {
      this.refreshProration();
    }
  }

  protected goBack(): void {
    this.step.set('selecting');
  }

  protected removeFromReview(studentId: string): void {
    const ids = new Set(this.selectedIds());
    ids.delete(studentId);
    this.selectedIds.set(ids);
    if (ids.size === 0) this.step.set('selecting');
  }

  // 確認加入：dialog 自行呼叫 API，顯示 loading，完成後關閉並傳回結果
  protected confirm(force = false): void {
    const draft = this.billing();

    // 規則 5.3：改了金額就要說為什麼。擋在這裡而不是事後補，因為事後沒有人會回來補
    if (this.isAdjusted() && !draft.adjustmentNote.trim()) {
      this.confirmError.set('議定金額跟定價不同，請填調整原因。');
      return;
    }

    // 要開帳卻沒有金額可用 —— 與其開一張 0 元的假帳單，不如當場說清楚
    if (this.issueInvoice() && this.payable() === null) {
      this.confirmError.set('要立即開帳的話，先選價目表或填議定金額。');
      return;
    }

    this.confirming.set(true);
    this.confirmError.set(null);
    if (!force) {
      this.conflictWarnings.set([]);
    }

    this.enrollmentsService
      .batchCreate({
        classId: this.classId,
        studentIds: Array.from(this.selectedIds()),
        skipConflictCheck: force,
        billingMode: draft.billingMode ?? undefined,
        feeTemplateId: draft.feeTemplateId ?? undefined,
        agreedAmount: draft.agreedAmount ?? undefined,
        adjustmentNote: draft.adjustmentNote.trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.confirming.set(false);
          this.enrolledResult.set(res);
          this.step.set('result');
          if (this.issueInvoice()) this.issueInvoices(res);
        },
        error: (err) => {
          this.confirming.set(false);
          const code = err?.error?.code;
          const warnings = err?.error?.warnings as ScheduleConflictWarning[] | undefined;

          if (code === 'SCHEDULE_CONFLICT' && warnings?.length) {
            this.conflictWarnings.set(warnings);
            return;
          }

          this.conflictWarnings.set([]);
          this.confirmError.set(
            code === 'OVER_QUOTA' || code === 'over_quota'
              ? '超過班級人數上限，請減少加入人數'
              : '加入失敗，請稍後再試',
          );
        },
      });
  }

  protected confirmForce(): void {
    this.confirm(true);
  }

  /**
   * 報名成功之後才走這裡。**帳單跟報名不同一個事務。**
   *
   * 綁一起的話，開帳 API 掛掉會變成學生報不了名 —— 那是把次要動作的失敗升級成主要
   * 動作的失敗，而報名是既成事實：人已經在教室裡了。
   *
   * 兩種殘留也不對等：分開的殘留**看得見**（報名在、帳單不在，畫面當場說出來、
   * 而且重試得了）；綁一起的殘留看不見（什麼都沒發生，而櫃檯前的人以為報好了）。
   */
  private issueInvoices(res: BatchCreateResult): void {
    const targets = this.enrolledTargets().filter(
      (t) => !this.invoicedStudentIds().has(t.studentId),
    );
    if (targets.length === 0) return;

    this.issuing.set(true);
    this.invoiceFailures.set([]);

    // 每一筆各自成敗 —— forkJoin 預設 fail-fast，一張掛掉會讓其餘的結果全部看不到，
    // 而那些帳單其實已經開出去了
    forkJoin(
      targets.map((t) =>
        this.invoicesService
          .create({
            studentId: t.studentId,
            items: [
              {
                type: this.billing().billingMode === 'session_pack' ? 'session_pack' : 'tuition',
                enrollmentId: t.enrollmentId,
                amount: this.payable()!,
              },
            ],
          })
          .pipe(
            map(() => ({ target: t, ok: true })),
            catchError(() => of({ target: t, ok: false })),
          ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((outcomes) => {
        this.issuing.set(false);
        const ok = outcomes.filter((o) => o.ok).map((o) => o.target.studentId);
        this.invoicedStudentIds.update((set) => new Set([...set, ...ok]));
        this.invoicesCreated.update((n) => n + ok.length);
        this.invoiceFailures.set(outcomes.filter((o) => !o.ok).map((o) => o.target));
      });
  }

  /** 結果頁的「為這 N 筆開帳」—— 沒勾立即開帳的批次事後在這裡補 */
  protected issueRemaining(): void {
    const res = this.enrolledResult();
    if (!res || this.payable() === null) {
      this.notice.set('要開帳的話，回上一步選價目表或填議定金額。');
      return;
    }
    this.issueInvoices(res);
  }

  /** 只對沒開成的重試 —— `issueInvoices` 自己會濾掉已經開過的，所以走同一條路 */
  protected retryInvoices(): void {
    this.issueRemaining();
  }

  /** 結果頁的「完成」—— 報名已經成立，帳單開了幾張一起回報給呼叫端 */
  protected closeWithResult(): void {
    const res = this.enrolledResult();
    this.ref.close(res ? { ...res, invoicesCreated: this.invoicesCreated() } : undefined);
  }

  protected clearConflicts(): void {
    this.conflictWarnings.set([]);
  }

  /** 結果頁每一列的狀態 —— 誰進去了、誰本來就在、誰失敗了、誰已經有帳單 */
  protected resultLabel(studentId: string): string {
    const row = this.enrolledResult()?.results.find((r) => r.studentId === studentId);
    if (!row) return '';
    if (row.status === 'already_exists') return '已在班上，略過';
    if (row.status === 'error') return row.message ?? '加入失敗';
    return this.invoicedStudentIds().has(studentId) ? '已加入 · 帳單已開' : '已加入';
  }

  protected studentName(studentId: string): string {
    return this.studentNameMap().get(studentId) ?? '未知學生';
  }

  protected weekdayLabel(weekday: number): string {
    return ['一', '二', '三', '四', '五', '六', '日'][weekday - 1] ?? `${weekday}`;
  }

  protected cancel(): void {
    this.ref.close();
  }

  /** 見 `personHue` —— 契約是「同一個人到哪一頁都同色」，所以只能有一份實作 */
  protected getStudentHue(studentId: string): number {
    return personHue(studentId);
  }
}
