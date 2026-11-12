import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { catchError, of, switchMap } from 'rxjs';

import { AuthService } from '@core/auth.service';
import { BillingPeriodsService, type BillingPeriod } from '@core/billing-periods.service';

import {
  EnrollmentsService,
  type Enrollment,
  type ProrationPreview,
  type ScheduleConflictWarning,
} from '@core/enrollments.service';
import {
  BILLING_MODE_LABELS,
  FeeTemplatesService,
  type BillingMode,
  type FeeTemplate,
} from '@core/fee-templates.service';
import { StudentsService, type Student } from '@core/students.service';
import { SystemClockService } from '@core/system-clock.service';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

type InvoiceChoice = 'create' | 'none';

/**
 * 直接報名（#1314 EN2，A6 enrollments.html `[data-direct]` 的 `A2.form`）。
 *
 * 寫入只有 `POST /api/enrollments`。稿最後一欄「繳費單」（#2296 SD9）：
 * - 建立繳費單（待繳費）：帶 `firstInvoice`，報名建 `pending_payment`、同一個交易開第一期帳單
 *   （跟家長申請核准共用同一段算法）。費用方案必填；底部一行唯讀的首期試算（`proration-preview`，
 *   同核准對話框的取法）；堂數制多一欄堂數。這裡不給改金額／期限 —— 要改走帳單頁。要財務權限。
 * - 不建立（已收款或免費）：建 `active`，帳單由月結 run／「未開單名單」照常接手。
 * 稿只有計費模式；費用方案一起選，月結才算得出金額（議定金額之後在列尾 ⋯ 的計費設定改）。
 *
 * 原生 `<dialog>` 裡放共用殼 app-dialog-frame（#2290）。
 */
@Component({
  selector: 'app-direct-enroll-dialog',
  standalone: true,
  imports: [FormsModule, SelectFieldComponent, StudentAutocompleteComponent, DialogFrameComponent],
  template: `
    <dialog
      #dialog
      class="overlay-motion overlay-motion--from-bottom-narrow m-auto max-h-[calc(100%-48px)] min-h-11 w-[min(520px,calc(100%-32px))] overflow-y-auto overscroll-contain rounded-lg border-0 bg-white p-0 text-zinc-900 shadow-[0_24px_48px_-12px_rgb(26_22_20/36%)] backdrop:bg-zinc-900/40 max-wide:inset-x-0 max-wide:top-auto max-wide:bottom-0 max-wide:m-0 max-wide:max-h-[calc(100%-24px)] max-wide:w-full max-wide:max-w-none max-wide:rounded-none max-wide:rounded-t-xl max-wide:bg-(--sheet-bg)"
      role="dialog"
      data-testid="direct-enroll-dialog"
      (click)="onBackdrop($event)"
      (close)="onClosed()"
    >
      @if (isOpen()) {
        <!-- 共用殼（#2290）；原生 dialog 帶 role="dialog"，殼的 appDialogTitle 才找得到它掛名稱 -->
        <app-dialog-frame title="直接報名" (closed)="close()">
          <form
            ngNoForm
            id="direct-enroll-form"
            class="grid grid-cols-2 gap-x-3 gap-y-4 max-wide:grid-cols-1"
            (submit)="$event.preventDefault(); save()"
          >
            <div class="col-span-full min-w-0">
              <label
                class="mb-1 block text-md font-semibold text-zinc-700"
                for="direct-enroll-student"
                >學生 <span class="text-error-700" aria-hidden="true">*</span></label
              >
              <app-student-autocomplete
                inputId="direct-enroll-student"
                placeholder="輸入姓名搜尋"
                [inline]="true"
                [forceSelection]="true"
                [value]="student()"
                [suggestions]="studentSuggestions()"
                (queryChange)="searchStudents($event)"
                (valueChange)="onStudent($event)"
              />
            </div>
            <div class="col-span-full min-w-0">
              <app-select-field
                label="開課班"
                labelSize="md"
                placeholder="選一個班"
                [required]="true"
                [options]="classes()"
                [value]="classId()"
                (valueChange)="classId.set($event); clearOutcome()"
                [appendTo]="dialog"
              />
            </div>
            <div class="col-span-full min-w-0">
              <!-- 稿是 label；radiogroup 沒有單一控制項可以 for，靠 aria-labelledby 指回來（同 campus-form-dialog） -->
              <label class="mb-1 block text-md font-semibold text-zinc-700" id="direct-enroll-mode"
                >計費模式</label
              >
              <div
                class="flex flex-wrap gap-2"
                role="radiogroup"
                aria-labelledby="direct-enroll-mode"
              >
                @for (opt of modeOptions; track opt.value) {
                  <label
                    class="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 font-semibold has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-checked:ring-inset max-wide:h-11"
                  >
                    <input
                      type="radio"
                      name="direct-enroll-mode"
                      class="m-0 accent-zinc-900"
                      [checked]="mode() === opt.value"
                      (change)="onMode(opt.value)"
                    />{{ opt.label }}
                  </label>
                }
              </div>
            </div>
            @if (mode()) {
              <div class="col-span-full min-w-0">
                <app-select-field
                  label="費用方案"
                  labelSize="md"
                  [options]="templateOptions()"
                  [value]="feeTemplateId()"
                  (valueChange)="feeTemplateId.set($event)"
                  [appendTo]="dialog"
                />
              </div>
            }
            <div class="min-w-0">
              <label class="mb-1 block text-md font-semibold text-zinc-700" for="direct-enroll-from"
                >生效起 <span class="text-error-700" aria-hidden="true">*</span></label
              >
              <input
                id="direct-enroll-from"
                type="date"
                class="h-10 w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] tabular-nums hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
                [ngModel]="from()"
                (ngModelChange)="from.set($event); clearOutcome()"
              />
            </div>
            <div class="min-w-0">
              <label class="mb-1 block text-md font-semibold text-zinc-700" for="direct-enroll-to"
                >生效迄</label
              >
              <input
                id="direct-enroll-to"
                type="date"
                class="h-10 w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] tabular-nums hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
                [ngModel]="to()"
                (ngModelChange)="to.set($event); clearOutcome()"
              />
              <p class="m-0 mt-1 text-sm text-zinc-600">留白＝讀到退班為止</p>
            </div>
            <div class="col-span-full min-w-0">
              <label
                class="mb-1 block text-md font-semibold text-zinc-700"
                id="direct-enroll-invoice"
                >繳費單</label
              >
              <div
                class="flex flex-wrap gap-2"
                role="radiogroup"
                aria-labelledby="direct-enroll-invoice"
              >
                @for (opt of invoiceOptions; track opt.value) {
                  <label
                    class="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 font-semibold has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-checked:ring-inset has-disabled:cursor-not-allowed has-disabled:opacity-55 max-wide:h-11"
                  >
                    <input
                      type="radio"
                      name="direct-enroll-invoice"
                      class="m-0 accent-zinc-900"
                      [checked]="invoice() === opt.value"
                      [disabled]="opt.value === 'create' && !canInvoice"
                      (change)="invoice.set(opt.value); clearOutcome()"
                    />{{ opt.label }}
                  </label>
                }
              </div>
              @if (!canInvoice) {
                <p class="m-0 mt-1 text-sm text-zinc-600">建立繳費單需要財務權限</p>
              }
            </div>
            @if (invoice() === 'create' && mode() === 'session_pack') {
              <div class="min-w-0">
                <label
                  class="mb-1 block text-md font-semibold text-zinc-700"
                  for="direct-enroll-sessions"
                  >堂數 <span class="text-error-700" aria-hidden="true">*</span></label
                >
                <input
                  id="direct-enroll-sessions"
                  type="number"
                  min="1"
                  step="1"
                  inputmode="numeric"
                  class="h-10 w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] tabular-nums hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
                  [ngModel]="sessionCount()"
                  (ngModelChange)="sessionCount.set($event); clearOutcome()"
                />
              </div>
            }
            @if (firstPeriodText(); as text) {
              <p
                class="col-span-full m-0 text-md text-zinc-700 tabular-nums"
                data-testid="direct-enroll-first"
              >
                {{ text }}
              </p>
            }
            @if (conflicts().length) {
              <div
                class="col-span-full rounded-md bg-warning-50 p-3 text-md text-zinc-900"
                data-testid="direct-enroll-conflict"
                role="alert"
              >
                <p class="m-0 font-semibold">跟這位學生已經在上的課撞時間：</p>
                <ul class="m-0 mt-1 pl-5">
                  @for (w of conflicts(); track w.conflictingClassId + w.weekday + w.startTime) {
                    <li>
                      {{ w.conflictingClassName }} · 週{{ weekday(w.weekday) }}
                      {{ w.startTime.slice(0, 5) }}–{{ w.endTime.slice(0, 5) }}
                    </li>
                  }
                </ul>
              </div>
            }
          </form>

          <ng-container dialogFoot>
            <p
              class="form-dialog__why"
              [class.text-error-700]="!!error()"
              [class.text-zinc-600]="!error()"
              aria-live="polite"
              data-testid="direct-enroll-hint"
            >
              {{ error() ?? missingHint() }}
            </p>
            <button
              type="button"
              class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 wide:h-9"
              [disabled]="loading()"
              (click)="close()"
            >
              取消
            </button>
            <button
              type="submit"
              form="direct-enroll-form"
              class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-accent-vivid-2 hover:bg-accent-vivid-2 aria-disabled:opacity-55 wide:h-9"
              data-testid="direct-enroll-submit"
              [attr.aria-disabled]="!!missingHint() || loading()"
            >
              {{ loading() ? '報名中…' : conflicts().length ? '仍要報名' : '報名' }}
            </button>
          </ng-container>
        </app-dialog-frame>
      }
    </dialog>
  `,
})
export class DirectEnrollDialogComponent {
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly studentsService = inject(StudentsService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly billingPeriodsService = inject(BillingPeriodsService);
  private readonly messageService = inject(MessageService);
  private readonly today = inject(SystemClockService).todayTaipei;
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** 頁面篩選用的同一份班級清單（不含「全部班級」） */
  readonly classes = input.required<readonly { label: string; value: string }[]>();
  /** 報名成功帶那一筆，取消帶 null */
  readonly closed = output<Enrollment | null>();

  /** 會開帳單：同家長申請核准，要財務權限（API 也擋，403） */
  protected readonly canInvoice = inject(AuthService).hasPermission('manage_finance');
  protected readonly invoiceOptions: readonly { label: string; value: InvoiceChoice }[] = [
    { label: '建立繳費單（待繳費）', value: 'create' },
    { label: '不建立（已收款或免費）', value: 'none' },
  ];

  protected readonly modeOptions = (Object.keys(BILLING_MODE_LABELS) as BillingMode[]).map(
    (value) => ({ label: BILLING_MODE_LABELS[value], value }),
  );

  protected readonly isOpen = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly student = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly classId = signal<string | null>(null);
  protected readonly mode = signal<BillingMode | null>(null);
  protected readonly feeTemplateId = signal<string | null>(null);
  protected readonly from = signal('');
  protected readonly to = signal('');
  /** 409 撞課回來的衝突；有值時送出鈕變「仍要報名」（skipConflictCheck，同學生頁加入班級） */
  protected readonly conflicts = signal<readonly ScheduleConflictWarning[]>([]);
  private readonly templates = signal<readonly FeeTemplate[]>([]);
  private readonly periods = signal<readonly BillingPeriod[]>([]);
  protected readonly invoice = signal<InvoiceChoice>('none');
  protected readonly sessionCount = signal<number | null>(null);
  /** 伺服器試算（月繳、期繳）；參數不齊、堂數制回 null */
  private readonly preview = signal<ProrationPreview | null>(null);
  private saved: Enrollment | null = null;

  /** 方案只列選定模式的（月繳的方案套在期繳生身上，月結會算錯錢） */
  protected readonly templateOptions = computed<SelectFieldOption<string | null>[]>(() => [
    // 開帳單要有方案才算得出首期
    ...(this.invoice() === 'create' ? [] : [{ label: '未指定', value: null }]),
    ...this.templates()
      .filter((t) => t.billingMode === this.mode())
      .map((t) => ({ label: `${t.name}（$${t.amount.toLocaleString()}）`, value: t.id })),
  ]);

  private readonly pickedStudent = computed(() => {
    const s = this.student();
    return s && typeof s === 'object' ? s : null;
  });

  /** 期繳的首期 = 涵蓋生效起的那期；重疊取最晚開始（同 API 的 ORDER BY start_date DESC） */
  private readonly coveringPeriod = computed(() => {
    const day = this.from();
    if (!day) return null;
    return (
      this.periods()
        .filter((p) => p.startDate <= day && day <= p.endDate)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null
    );
  });

  private readonly previewParams = computed(() => {
    const feeTemplateId = this.feeTemplateId();
    const effectiveFrom = this.from();
    if (this.invoice() !== 'create' || !feeTemplateId || !effectiveFrom) return null;
    const range = { effectiveFrom, effectiveTo: this.to() || null, feeTemplateId };
    if (this.mode() === 'monthly') return { periodMonth: effectiveFrom.slice(0, 7), ...range };
    const period = this.coveringPeriod();
    if (this.mode() === 'period' && period) return { billingPeriodId: period.id, ...range };
    return null;
  });

  /** 唯讀的首期試算；金額只由伺服器算（堂數制不按比例＝方案金額） */
  protected readonly firstPeriodText = computed(() => {
    if (this.invoice() !== 'create' || !this.feeTemplateId()) return null;
    if (this.mode() === 'session_pack') {
      const t = this.templates().find((x) => x.id === this.feeTemplateId());
      return t ? `首期 $${t.amount.toLocaleString()}（堂數制不按比例）` : null;
    }
    const p = this.preview();
    if (!p) return null;
    return `首期 $${p.amount.toLocaleString()}${p.note ? `（${p.note}）` : ''}`;
  });

  protected readonly missingHint = computed(() => {
    const creating = this.invoice() === 'create';
    const sessions = this.sessionCount();
    const missing = [
      !this.pickedStudent() && '學生',
      !this.classId() && '開課班',
      !this.from() && '生效起',
      creating && !this.feeTemplateId() && '費用方案',
      creating &&
        this.mode() === 'session_pack' &&
        !(Number.isInteger(sessions) && sessions! >= 1) &&
        '堂數',
    ].filter(Boolean);
    if (missing.length) return `還沒填：${missing.join('、')}`;
    if (this.to() && this.to() < this.from()) return '生效迄不能早於生效起';
    if (creating && this.mode() === 'period' && !this.coveringPeriod()) {
      return '沒有涵蓋生效起的繳費期，先到繳費期設定新增';
    }
    return null;
  });

  constructor() {
    // 參數一變就重算；switchMap 丟掉舊的回應（同核准對話框）
    toObservable(this.previewParams)
      .pipe(
        switchMap((params) =>
          params
            ? this.enrollmentsService.prorationPreview(params).pipe(catchError(() => of(null)))
            : of(null),
        ),
      )
      .subscribe((p) => this.preview.set(p));
  }

  open(): void {
    this.student.set(null);
    this.studentSuggestions.set([]);
    this.classId.set(null);
    // 稿的 radio 預設選第一個（月繳）
    this.mode.set('monthly');
    this.feeTemplateId.set(null);
    // 稿的 radio 預設第一個（建立）；沒財務權限只能不建立
    this.invoice.set(this.canInvoice ? 'create' : 'none');
    this.sessionCount.set(null);
    this.from.set(this.today());
    this.to.set('');
    this.conflicts.set([]);
    this.error.set(null);
    this.loading.set(false);
    this.saved = null;
    this.feeTemplatesService.list({ isActive: true }).subscribe({
      next: (res) => this.templates.set(res.data),
      // 方案載不到只是少一個選單，報名照樣能送（之後在 ⋯ 的計費設定補）
      error: () => this.templates.set([]),
    });
    if (this.canInvoice) {
      this.billingPeriodsService.list().subscribe({
        next: (res) => this.periods.set(res.data),
        error: () => this.periods.set([]),
      });
    }
    this.isOpen.set(true);
    afterNextRender(() => this.dialog().nativeElement.showModal(), { injector: this.injector });
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected weekday(n: number): string {
    return WEEKDAYS[n - 1] ?? `${n}`;
  }

  protected searchStudents(query: string): void {
    this.studentsService
      .list({ search: query, searchScope: 'student_name', isActive: true, pageSize: 30 })
      .subscribe({ next: (res) => this.studentSuggestions.set(res.data) });
  }

  protected onStudent(value: Student | string | null): void {
    this.student.set(value);
    this.clearOutcome();
  }

  protected onMode(mode: BillingMode): void {
    this.mode.set(mode);
    this.feeTemplateId.set(null);
  }

  /** 改了學生、班、日期，上一次的撞課與錯誤就不算數了 */
  protected clearOutcome(): void {
    this.conflicts.set([]);
    this.error.set(null);
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  protected onClosed(): void {
    this.isOpen.set(false);
    this.closed.emit(this.saved);
  }

  protected save(): void {
    const student = this.pickedStudent();
    const classId = this.classId();
    if (this.loading() || this.missingHint() || !student || !classId) return;
    const className = this.classes().find((c) => c.value === classId)?.label ?? '';
    const creating = this.invoice() === 'create';
    this.loading.set(true);
    this.error.set(null);
    this.enrollmentsService
      .create({
        classId,
        studentId: student.id,
        status: creating ? 'pending_payment' : 'active',
        ...(creating
          ? {
              firstInvoice:
                this.mode() === 'session_pack' ? { sessionCount: this.sessionCount()! } : {},
            }
          : {}),
        ...(this.mode() ? { billingMode: this.mode()! } : {}),
        ...(this.feeTemplateId() ? { feeTemplateId: this.feeTemplateId()! } : {}),
        effectiveFrom: this.from(),
        effectiveTo: this.to() || null,
        skipConflictCheck: this.conflicts().length > 0,
      })
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: `已幫 ${student.name} 報名 ${className}`,
          });
          this.saved = res.data;
          this.loading.set(false);
          this.close();
        },
        error: (err) => {
          this.loading.set(false);
          const code = err?.error?.code;
          const warnings = err?.error?.warnings as ScheduleConflictWarning[] | undefined;
          if (code === 'SCHEDULE_CONFLICT' && warnings?.length) {
            this.conflicts.set(warnings);
            return;
          }
          const messages: Record<string, string> = {
            OVER_QUOTA: '這個班已經額滿',
            ALREADY_ENROLLED: `${student.name} 已經在這個班`,
            FINANCE_REQUIRED: '建立繳費單需要財務權限',
            NO_BILLING_PERIOD: '沒有涵蓋生效起的繳費期，先到繳費期設定新增',
            INVALID_FEE_TEMPLATE: '費用方案已停用或計費模式不符，換一個方案',
            ZERO_AMOUNT: '首期金額是 0，免費請選「不建立」',
          };
          this.error.set(messages[code as string] ?? '沒有報名成功，請再試一次');
        },
      });
  }
}
