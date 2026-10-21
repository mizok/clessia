import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { forkJoin, of, switchMap, catchError } from 'rxjs';

import { BillingPeriodsService, type BillingPeriod } from '@core/billing-periods.service';
import {
  EnrollmentsService,
  type ProrationPreview,
  type ScheduleConflictWarning,
} from '@core/enrollments.service';
import {
  BILLING_MODE_LABELS,
  FeeTemplatesService,
  type BillingMode,
  type FeeTemplate,
} from '@core/fee-templates.service';
import {
  ParentRequestsService,
  type ApproveEnrollmentRequestInput,
  type ParentRequest,
} from '@core/parent-requests.service';
import { SystemClockService } from '@core/system-clock.service';

const MODES: BillingMode[] = ['monthly', 'period', 'session_pack'];

/** 核准 API 的錯誤碼 → 寫在表單裡的話（錯誤留在表單、填的不清） */
const ERROR_MESSAGES: Record<string, string> = {
  CLASS_FULL: '這班已額滿；要多收請先調高班級人數上限',
  NOT_APPROVABLE: '這筆申請已經不是待審核（可能已被處理），請重新整理',
  ALREADY_ENROLLED: '孩子已經在這班了',
  NO_BILLING_PERIOD: '沒有涵蓋這天的繳費期，請先到設定建立',
  INVALID_FEE_TEMPLATE: '這張價目表已停用或計費模式不符，請重新選',
  ZERO_AMOUNT: '首期金額不能是 0',
  DUE_BEFORE_ISSUE: '繳費期限不能早於今天',
  FINANCE_REQUIRED: '核准會開帳單，需要財務權限',
  NOT_FOUND: '找不到這筆申請（可能已被刪除），請重新整理',
};

/**
 * 核准家長的報名申請（#1726 拆單 2；spec：kb/wiki/specs/admin/enrollment/approve-request.md §1）。
 *
 * 嵌在收件頁的原生 `<dialog>` 裡（A6 `form()` 形狀，同家長端請假表單）：每次打開都是新的元件。
 * 首期金額的試算由伺服器算（proration-preview，跟核准 API 同一套 prorateByDays）；
 * 堂數制沒有比例，試算 = 議定價 ?? 價目表金額。送出成功帶回結果，取消帶 null。
 */
@Component({
  selector: 'app-approve-request-dialog',
  imports: [FormsModule, InputTextModule, SelectModule],
  template: `
    @if (loading()) {
      <p class="m-0 py-4 text-md text-zinc-600">載入價目表…</p>
    } @else {
      <form
        ngNoForm
        class="flex flex-col gap-4 py-2"
        (submit)="$event.preventDefault()"
        aria-label="核准報名"
      >
        <fieldset class="m-0 flex flex-col gap-1 border-0 p-0">
          <legend class="mb-1 p-0 text-md font-semibold text-zinc-700">
            計費模式 <span class="text-error-700" aria-hidden="true">*</span>
          </legend>
          <div class="flex flex-wrap gap-x-4">
            @for (m of modes; track m) {
              <label class="inline-flex min-h-11 cursor-pointer items-center gap-2 text-md">
                <input
                  type="radio"
                  name="approve-mode"
                  class="size-4"
                  [value]="m"
                  [checked]="mode() === m"
                  (change)="setMode(m)"
                />
                {{ modeLabels[m] }}
              </label>
            }
          </div>
          @if (modeMismatch(); as parentMode) {
            <p class="m-0 text-sm font-semibold text-warning-800" data-testid="mode-mismatch">
              家長選的是{{ modeLabels[parentMode] }}
            </p>
          }
        </fieldset>

        <div class="flex min-w-0 flex-col gap-1">
          <label class="text-md font-semibold text-zinc-700" for="approve-template"
            >價目表 <span class="text-error-700" aria-hidden="true">*</span></label
          >
          <p-select
            inputId="approve-template"
            [options]="templateOptions()"
            optionLabel="label"
            optionValue="value"
            [ngModel]="templateId()"
            (ngModelChange)="templateId.set($event)"
            [placeholder]="mode() ? '選價目表' : '先選計費模式'"
            [emptyMessage]="'沒有啟用中的' + (mode() ? modeLabels[mode()!] : '') + '價目表'"
            styleClass="w-full"
            [appendTo]="appendTo()"
          />
        </div>

        <div class="grid grid-cols-1 gap-x-3 gap-y-4 wide:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-1">
            <label class="text-md font-semibold text-zinc-700" for="approve-agreed"
              >議定金額（選填）</label
            >
            <input
              id="approve-agreed"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              pInputText
              class="w-full"
              placeholder="不填照價目表"
              [ngModel]="agreedAmount()"
              (ngModelChange)="agreedAmount.set($event)"
            />
          </div>
          @if (agreedAmount() !== null) {
            <div class="flex min-w-0 flex-col gap-1">
              <label class="text-md font-semibold text-zinc-700" for="approve-adjust-note"
                >調整原因 <span class="text-error-700" aria-hidden="true">*</span></label
              >
              <input
                id="approve-adjust-note"
                type="text"
                pInputText
                class="w-full"
                autocomplete="off"
                placeholder="例如：手足優惠"
                [ngModel]="adjustmentNote()"
                (ngModelChange)="adjustmentNote.set($event)"
              />
            </div>
          }

          <div class="flex min-w-0 flex-col gap-1">
            <label class="text-md font-semibold text-zinc-700" for="approve-from"
              >生效起 <span class="text-error-700" aria-hidden="true">*</span></label
            >
            <input
              id="approve-from"
              type="date"
              pInputText
              class="w-full"
              [ngModel]="effectiveFrom()"
              (ngModelChange)="effectiveFrom.set($event ?? '')"
            />
          </div>
          @if (mode() === 'session_pack') {
            <div class="flex min-w-0 flex-col gap-1">
              <label class="text-md font-semibold text-zinc-700" for="approve-sessions"
                >堂數 <span class="text-error-700" aria-hidden="true">*</span></label
              >
              <input
                id="approve-sessions"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                pInputText
                class="w-full"
                [ngModel]="sessionCount()"
                (ngModelChange)="sessionCount.set($event)"
              />
            </div>
          }
        </div>

        @if (noPeriod()) {
          <p class="m-0 text-md text-error-700" role="alert" data-testid="no-period">
            沒有涵蓋這天的繳費期，請先到設定建立
          </p>
        }

        <div class="grid grid-cols-1 gap-x-3 gap-y-4 wide:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-1">
            <label class="text-md font-semibold text-zinc-700" for="approve-amount">首期金額</label>
            <input
              id="approve-amount"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              pInputText
              class="w-full"
              [ngModel]="finalAmount()"
              (ngModelChange)="amountInput.set($event)"
            />
            @if (suggested() !== null) {
              <p class="m-0 text-sm text-zinc-600" data-testid="suggested">
                試算 {{ suggested() }} 元
                @if (preview()?.note; as note) {
                  · {{ note }}
                }
              </p>
            }
          </div>
          @if (amountEdited()) {
            <div class="flex min-w-0 flex-col gap-1">
              <label class="text-md font-semibold text-zinc-700" for="approve-amount-note"
                >修改原因 <span class="text-error-700" aria-hidden="true">*</span></label
              >
              <input
                id="approve-amount-note"
                type="text"
                pInputText
                class="w-full"
                autocomplete="off"
                placeholder="會寫在帳單明細上"
                [ngModel]="amountNote()"
                (ngModelChange)="amountNote.set($event)"
              />
            </div>
          }

          <div class="flex min-w-0 flex-col gap-1">
            <label class="text-md font-semibold text-zinc-700" for="approve-due"
              >繳費期限（選填）</label
            >
            <input
              id="approve-due"
              type="date"
              pInputText
              class="w-full"
              [min]="today()"
              [ngModel]="dueDate()"
              (ngModelChange)="dueDate.set($event ?? '')"
            />
            <p class="m-0 text-sm text-zinc-600">不填照機構設定的繳費天數</p>
          </div>
        </div>

        @if (conflicts().length > 0) {
          <div
            class="rounded-md border border-solid border-warning-200 bg-warning-50 px-3 py-2"
            data-testid="conflicts"
          >
            <p class="m-0 text-md font-semibold text-warning-800">跟孩子的其他班撞時間：</p>
            <ul class="m-0 mt-1 pl-5 text-md text-zinc-800">
              @for (c of conflicts(); track c.conflictingClassId + c.weekday + c.startTime) {
                <li>
                  {{ c.conflictingCourseName }} · {{ c.conflictingClassName }}（週{{
                    weekdayLabel(c.weekday)
                  }}
                  {{ c.startTime.substring(0, 5) }}–{{ c.endTime.substring(0, 5) }}）
                </li>
              }
            </ul>
          </div>
        }
      </form>
    }

    <!-- A6 form() 底部：送出鈕不鎖死，旁邊寫還差什麼（#723）；錯誤也寫在這一行 -->
    <div class="flex flex-wrap items-center justify-end gap-2 pt-4">
      <p
        class="m-0 mr-auto text-md max-wide:basis-full"
        [class.text-error-700]="!!errorMessage()"
        [class.text-zinc-600]="!errorMessage()"
        aria-live="polite"
        data-testid="hint"
      >
        {{ errorMessage() ?? missingHint() }}
      </p>
      <button
        type="button"
        class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 wide:h-9"
        [disabled]="saving()"
        (click)="closed.emit(null)"
      >
        取消
      </button>
      @if (conflicts().length > 0) {
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-warning-600 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-warning-800 hover:bg-warning-50 aria-disabled:opacity-55 wide:h-9"
          [attr.aria-disabled]="!canSubmit() || saving()"
          data-testid="force-approve"
          (click)="submit(true)"
        >
          {{ saving() ? '核准中…' : '仍要核准' }}
        </button>
      } @else {
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-accent-vivid-2 hover:bg-accent-vivid-2 aria-disabled:opacity-55 wide:h-9"
          [attr.aria-disabled]="!canSubmit() || saving()"
          data-testid="submit"
          (click)="submit()"
        >
          {{ saving() ? '核准中…' : '核准並開帳單' }}
        </button>
      }
    </div>
  `,
})
export class ApproveRequestDialogComponent implements OnInit {
  private readonly parentRequests = inject(ParentRequestsService);
  private readonly feeTemplates = inject(FeeTemplatesService);
  private readonly billingPeriods = inject(BillingPeriodsService);
  private readonly enrollments = inject(EnrollmentsService);
  private readonly clock = inject(SystemClockService);

  readonly request = input.required<ParentRequest>();
  /** 嵌在原生 `<dialog>`（top layer）裡，下拉面板要掛在 dialog 上，掛 body 會被蓋住 */
  readonly appendTo = input<HTMLElement | 'body'>('body');
  /** 核准成功帶回帳單編號，取消帶 null */
  readonly closed = output<{ invoiceNo: string | null } | null>();

  protected readonly modes = MODES;
  protected readonly modeLabels = BILLING_MODE_LABELS;
  protected readonly today = this.clock.todayTaipei;

  protected readonly loading = signal(true);
  protected readonly templates = signal<FeeTemplate[]>([]);
  protected readonly periods = signal<BillingPeriod[]>([]);

  protected readonly mode = signal<BillingMode | null>(null);
  protected readonly templateId = signal<string | null>(null);
  protected readonly agreedAmount = signal<number | null>(null);
  protected readonly adjustmentNote = signal('');
  protected readonly effectiveFrom = signal('');
  protected readonly sessionCount = signal<number | null>(null);
  /** 行政改過的首期金額；null = 照試算 */
  protected readonly amountInput = signal<number | null>(null);
  protected readonly amountNote = signal('');
  protected readonly dueDate = signal('');

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly conflicts = signal<ScheduleConflictWarning[]>([]);

  protected readonly templateOptions = computed(() =>
    this.templates()
      .filter((t) => t.billingMode === this.mode())
      .map((t) => ({ label: `${t.name}（${t.amount.toLocaleString()} 元）`, value: t.id })),
  );

  /** 家長選的模式跟實際選的不同：琥珀字提醒、不擋（#1727 B (b)） */
  protected readonly modeMismatch = computed(() => {
    const parentMode = this.request().billingMode;
    return parentMode && this.mode() && parentMode !== this.mode() ? parentMode : null;
  });

  /** 期繳的首期 = 涵蓋生效起的那期；重疊取最晚開始（同 API 的 ORDER BY start_date DESC） */
  private readonly coveringPeriod = computed(() => {
    const day = this.effectiveFrom();
    if (!day) return null;
    return (
      this.periods()
        .filter((p) => p.startDate <= day && day <= p.endDate)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null
    );
  });

  protected readonly noPeriod = computed(
    () => this.mode() === 'period' && !!this.effectiveFrom() && !this.coveringPeriod(),
  );

  /** 伺服器試算（月繳、期繳）；參數不齊或堂數制回 null */
  protected readonly preview = signal<ProrationPreview | null>(null);
  private readonly previewParams = computed(() => {
    const mode = this.mode();
    const feeTemplateId = this.templateId();
    const effectiveFrom = this.effectiveFrom();
    if (!feeTemplateId || !effectiveFrom) return null;
    const agreed = this.agreedAmount();
    const amountPart = agreed !== null ? { agreedAmount: agreed } : { feeTemplateId };
    if (mode === 'monthly') {
      return { periodMonth: effectiveFrom.slice(0, 7), effectiveFrom, ...amountPart };
    }
    const period = this.coveringPeriod();
    if (mode === 'period' && period) {
      return { billingPeriodId: period.id, effectiveFrom, ...amountPart };
    }
    return null;
  });

  protected readonly suggested = computed<number | null>(() => {
    if (this.mode() === 'session_pack') {
      const template = this.templates().find((t) => t.id === this.templateId());
      return this.agreedAmount() ?? template?.amount ?? null;
    }
    return this.preview()?.amount ?? null;
  });

  protected readonly finalAmount = computed(() => this.amountInput() ?? this.suggested());
  protected readonly amountEdited = computed(
    () => this.amountInput() !== null && this.amountInput() !== this.suggested(),
  );

  /** A6「還沒填：…」 */
  protected readonly missing = computed(() => [
    ...(this.mode() ? [] : ['計費模式']),
    ...(this.templateId() ? [] : ['價目表']),
    ...(this.agreedAmount() !== null && !this.adjustmentNote().trim() ? ['調整原因'] : []),
    ...(this.effectiveFrom() ? [] : ['生效起']),
    ...(this.mode() === 'session_pack' &&
    !(Number.isInteger(this.sessionCount()) && this.sessionCount()! >= 1)
      ? ['堂數']
      : []),
    ...(this.amountEdited() && !this.amountNote().trim() ? ['修改原因'] : []),
  ]);

  protected readonly missingHint = computed(() => {
    if (this.missing().length) return `還沒填：${this.missing().join('、')}`;
    if (this.finalAmount() === 0) return '首期金額不能是 0';
    if (this.dueDate() && this.dueDate() < this.today()) return '繳費期限不能早於今天';
    return '';
  });

  protected readonly canSubmit = computed(
    () => !this.loading() && !this.missingHint() && !this.noPeriod(),
  );

  constructor() {
    // 參數一變就重算；switchMap 丟掉舊的回應（打字中的議定金額不會讓舊值蓋過新值）
    toObservable(this.previewParams)
      .pipe(
        switchMap((params) =>
          params
            ? this.enrollments.prorationPreview(params).pipe(catchError(() => of(null)))
            : of(null),
        ),
      )
      .subscribe((p) => this.preview.set(p));

    // 撞課清單只對「當時送出的那組值」成立：任何欄位一改就收掉，主按鈕回到「核准」，
    // 免得「仍要核准」帶 skipConflictCheck 送出沒檢查過的新日期（審核席 #1775）
    effect(() => {
      // 只為了追蹤這幾個欄位
      void [
        this.mode(),
        this.templateId(),
        this.agreedAmount(),
        this.effectiveFrom(),
        this.amountInput(),
        this.dueDate(),
        this.sessionCount(),
      ];
      untracked(() => {
        if (this.conflicts().length === 0) return;
        this.conflicts.set([]);
        this.errorMessage.set(null);
      });
    });
  }

  ngOnInit(): void {
    const r = this.request();
    this.effectiveFrom.set(r.preferredStartDate ?? this.today());
    forkJoin([this.feeTemplates.list({ isActive: true }), this.billingPeriods.list()]).subscribe({
      next: ([templates, periods]) => {
        this.templates.set(templates.data);
        this.periods.set(periods.data);
        // 預設：家長選的 → 班級預設範本的模式 → 不預選
        const classDefault = templates.data.find((t) => t.id === r.defaultFeeTemplateId);
        const mode = r.billingMode ?? classDefault?.billingMode ?? null;
        if (mode) this.setMode(mode);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('讀取價目表失敗，請關掉再試');
      },
    });
  }

  /** 換模式就重新預選價目表：班級預設（模式相符）→ 該模式唯一一張 → 不預選 */
  protected setMode(mode: BillingMode): void {
    this.mode.set(mode);
    const ofMode = this.templates().filter((t) => t.billingMode === mode);
    const classDefault = ofMode.find((t) => t.id === this.request().defaultFeeTemplateId);
    this.templateId.set(classDefault?.id ?? (ofMode.length === 1 ? ofMode[0]!.id : null));
  }

  protected weekdayLabel(weekday: number): string {
    return ['一', '二', '三', '四', '五', '六', '日'][weekday - 1] ?? `${weekday}`;
  }

  protected submit(skipConflictCheck = false): void {
    if (this.saving() || !this.canSubmit()) return;
    const agreed = this.agreedAmount();
    const body: ApproveEnrollmentRequestInput = {
      billingMode: this.mode()!,
      feeTemplateId: this.templateId()!,
      effectiveFrom: this.effectiveFrom(),
      ...(agreed !== null
        ? { agreedAmount: agreed, adjustmentNote: this.adjustmentNote().trim() }
        : {}),
      ...(this.amountEdited()
        ? { amount: this.amountInput()!, amountNote: this.amountNote().trim() }
        : {}),
      ...(this.dueDate() ? { dueDate: this.dueDate() } : {}),
      ...(this.mode() === 'session_pack' ? { sessionCount: this.sessionCount()! } : {}),
      ...(skipConflictCheck ? { skipConflictCheck: true } : {}),
    };

    this.saving.set(true);
    this.errorMessage.set(null);
    this.parentRequests.approve(this.request().id, body).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.closed.emit({ invoiceNo: res.data.invoiceNo });
      },
      error: (err: {
        status?: number;
        error?: {
          code?: string;
          details?: { conflicts?: ScheduleConflictWarning[]; suggested?: number };
        };
      }) => {
        this.saving.set(false);
        const code = err.error?.code;
        if (code === 'SCHEDULE_CONFLICT') {
          this.conflicts.set(err.error?.details?.conflicts ?? []);
          this.errorMessage.set('有撞課；確認沒問題按「仍要核准」');
          return;
        }
        this.conflicts.set([]);
        if (code === 'AMOUNT_NOTE_REQUIRED') {
          this.errorMessage.set(
            `首期金額跟試算（${err.error?.details?.suggested ?? '?'} 元）不同，要寫原因`,
          );
          return;
        }
        this.errorMessage.set(
          (code && ERROR_MESSAGES[code]) ??
            (err.status === 0 ? '連線失敗，請檢查網路後再試' : '核准失敗，請稍後再試'),
        );
      },
    });
  }
}
