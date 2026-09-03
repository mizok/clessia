import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, forkJoin, map, of, catchError } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
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
  type ScheduleConflictWarning,
} from '@core/enrollments.service';
import { FeeTemplatesService, type FeeTemplate } from '@core/fee-templates.service';
import { InvoicesService } from '@core/invoices.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';
import { personHue } from '@shared/utils/person-hue.util';

import {
  billingModeOptions,
  emptyBillingDraft,
  feeTemplateOptions,
  findTemplate,
  isAdjusted,
  payableAmount,
  pricingHint,
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
    TagModule,
    SkeletonModule,
    IconFieldModule,
    InputIconModule,
    InputNumberModule,
    TextareaModule,
    CheckboxModule,
    InlineNoticeComponent,
  ],
  templateUrl: './student-picker-dialog.component.html',
  styleUrl: './student-picker-dialog.component.scss',
})
export class StudentPickerDialogComponent implements OnInit {
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
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
  protected readonly billing = signal<BillingDraft>(emptyBillingDraft());
  protected readonly billingModeOptions = billingModeOptions();
  protected readonly templateOptions = computed(() => feeTemplateOptions(this.templates()));

  private readonly selectedTemplate = computed(() =>
    findTemplate(this.templates(), this.billing().feeTemplateId),
  );

  protected readonly pricingHint = computed(() => pricingHint(this.selectedTemplate()));

  protected readonly isAdjusted = computed(() =>
    isAdjusted(this.billing().agreedAmount, this.selectedTemplate()),
  );

  protected readonly payable = computed(() => payableAmount(this.billing(), this.templates()));

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
  protected readonly invoiceFailures = signal<
    readonly { studentId: string; enrollmentId: string }[]
  >([]);
  protected readonly issuing = signal(false);
  protected readonly invoicesCreated = signal(0);
  private readonly enrolledResult = signal<BatchCreateResult | null>(null);
  protected selectedGrade: GradeLevel | null = null;
  protected selectedGender: string | null = null;

  // 兩步 wizard 狀態
  protected readonly step = signal<'selecting' | 'reviewing'>('selecting');

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
          if (!this.issueInvoice()) {
            this.ref.close(res);
            return;
          }
          this.issueInvoices(res);
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
    const targets = res.results
      .filter((r) => r.status === 'enrolled' && r.enrollmentId)
      .map((r) => ({ studentId: r.studentId, enrollmentId: r.enrollmentId! }));

    if (targets.length === 0) {
      this.ref.close(res);
      return;
    }

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
        const failed = outcomes.filter((o) => !o.ok).map((o) => o.target);
        this.invoicesCreated.set(outcomes.length - failed.length);

        if (failed.length === 0) {
          this.ref.close({ ...res, invoicesCreated: outcomes.length });
          return;
        }

        // **不關閉。** 報名已經成立，關掉的話那幾筆缺帳單就只剩下一支還沒做的查詢找得到
        this.invoiceFailures.set(failed);
        this.enrolledResult.set(res);
      });
  }

  /** 只對沒開成的重試 —— 報名不能重報，成功的帳單也不該開第二張 */
  protected retryInvoices(): void {
    const failed = this.invoiceFailures();
    const res = this.enrolledResult();
    if (failed.length === 0 || !res) return;

    this.issueInvoices({
      ...res,
      results: failed.map((f) => ({
        studentId: f.studentId,
        enrollmentId: f.enrollmentId,
        status: 'enrolled' as const,
      })),
    });
  }

  /** 帳單沒開成也要能離開 —— 報名是成立的，硬留在對話框裡沒有意義 */
  protected closeWithPartialResult(): void {
    this.ref.close(this.enrolledResult() ?? undefined);
  }

  protected clearConflicts(): void {
    this.conflictWarnings.set([]);
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
