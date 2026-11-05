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
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';

import {
  EnrollmentsService,
  type Enrollment,
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
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 直接報名（#1314 EN2，A6 enrollments.html `[data-direct]` 的 `A2.form`）。
 *
 * 寫入只有既有的 `POST /api/enrollments`，建 `active`（計畫席 11-05 裁 (a)）：月結 run 與
 * 「未開單名單」只挑 active，帳單由它們照常接手。稿最後一欄「繳費單：建立／不建立」＝SD9（#2296），不畫。
 * 稿只有計費模式；費用方案一起選，月結才算得出金額（議定金額之後在列尾 ⋯ 的計費設定改）。
 *
 * 原生 `<dialog>`，寫法同 campus-form-dialog（等 #2290 的共用殼合了再換）。
 */
@Component({
  selector: 'app-direct-enroll-dialog',
  standalone: true,
  imports: [FormsModule, SelectFieldComponent, StudentAutocompleteComponent],
  template: `
    <dialog
      #dialog
      class="overlay-motion overlay-motion--from-bottom-narrow m-auto max-h-[calc(100%-48px)] min-h-11 w-[min(520px,calc(100%-32px))] overflow-y-auto overscroll-contain rounded-lg border-0 bg-white p-0 text-zinc-900 shadow-[0_24px_48px_-12px_rgb(26_22_20/36%)] backdrop:bg-zinc-900/40 max-wide:inset-x-0 max-wide:top-auto max-wide:bottom-0 max-wide:m-0 max-wide:max-h-[calc(100%-24px)] max-wide:w-full max-wide:max-w-none max-wide:rounded-none max-wide:rounded-t-xl max-wide:bg-(--sheet-bg)"
      aria-labelledby="direct-enroll-title"
      data-testid="direct-enroll-dialog"
      (click)="onBackdrop($event)"
      (close)="onClosed()"
    >
      @if (isOpen()) {
        <div class="flex items-center justify-between pt-4 pr-4 pb-2 pl-6">
          <div>
            <h2 id="direct-enroll-title" class="m-0 text-xl font-bold">直接報名</h2>
            <p class="m-0 mt-0.5 text-md text-zinc-600">
              現場報名、老生加報、特殊例外 —— 跳過申請流程
            </p>
          </div>
          <button
            type="button"
            class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 wide:size-10"
            aria-label="關閉"
            (click)="close()"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>

        <form
          ngNoForm
          class="grid grid-cols-2 gap-x-3 gap-y-4 px-6 pt-2 pb-6 max-wide:grid-cols-1 max-wide:px-4"
          (submit)="$event.preventDefault(); save()"
        >
          <div class="col-span-full min-w-0">
            <label class="mb-1 block text-md font-semibold text-zinc-700"
              >學生 <span class="text-error-700" aria-hidden="true">*</span></label
            >
            <app-student-autocomplete
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

        <!-- A6 .fdlg__foot：必填沒填不鎖死送出鈕，旁邊寫還差什麼（#723）；失敗訊息也寫這裡，填的內容不清 -->
        <div
          class="sticky bottom-0 z-[1] flex flex-wrap items-center justify-end gap-2 bg-inherit px-6 pt-3 pb-6 max-wide:px-4 max-wide:pt-2 max-wide:pb-[calc(16px+env(safe-area-inset-bottom,0px))]"
        >
          <p
            class="m-0 mr-auto text-md max-wide:basis-full"
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
            type="button"
            class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-accent-vivid-2 hover:bg-accent-vivid-2 aria-disabled:opacity-55 wide:h-9"
            data-testid="direct-enroll-submit"
            [attr.aria-disabled]="!!missingHint() || loading()"
            (click)="save()"
          >
            {{ loading() ? '報名中…' : conflicts().length ? '仍要報名' : '報名' }}
          </button>
        </div>
      }
    </dialog>
  `,
})
export class DirectEnrollDialogComponent {
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly studentsService = inject(StudentsService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly messageService = inject(MessageService);
  private readonly today = inject(SystemClockService).todayTaipei;
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** 頁面篩選用的同一份班級清單（不含「全部班級」） */
  readonly classes = input.required<readonly { label: string; value: string }[]>();
  /** 報名成功帶那一筆，取消帶 null */
  readonly closed = output<Enrollment | null>();

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
  private saved: Enrollment | null = null;

  /** 方案只列選定模式的（月繳的方案套在期繳生身上，月結會算錯錢） */
  protected readonly templateOptions = computed<SelectFieldOption<string | null>[]>(() => [
    { label: '未指定', value: null },
    ...this.templates()
      .filter((t) => t.billingMode === this.mode())
      .map((t) => ({ label: `${t.name}（$${t.amount.toLocaleString()}）`, value: t.id })),
  ]);

  private readonly pickedStudent = computed(() => {
    const s = this.student();
    return s && typeof s === 'object' ? s : null;
  });

  protected readonly missingHint = computed(() => {
    const missing = [
      !this.pickedStudent() && '學生',
      !this.classId() && '開課班',
      !this.from() && '生效起',
    ].filter(Boolean);
    if (missing.length) return `還沒填：${missing.join('、')}`;
    if (this.to() && this.to() < this.from()) return '生效迄不能早於生效起';
    return null;
  });

  open(): void {
    this.student.set(null);
    this.studentSuggestions.set([]);
    this.classId.set(null);
    // 稿的 radio 預設選第一個（月繳）
    this.mode.set('monthly');
    this.feeTemplateId.set(null);
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
    this.loading.set(true);
    this.error.set(null);
    this.enrollmentsService
      .create({
        classId,
        studentId: student.id,
        status: 'active',
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
          this.error.set(
            code === 'OVER_QUOTA'
              ? '這個班已經額滿'
              : code === 'ALREADY_ENROLLED'
                ? `${student.name} 已經在這個班`
                : '沒有報名成功，請再試一次',
          );
        },
      });
  }
}
