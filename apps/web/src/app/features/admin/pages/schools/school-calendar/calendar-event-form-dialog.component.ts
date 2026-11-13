import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { map, type Observable } from 'rxjs';

import {
  SCHOOL_CALENDAR_KIND_LABELS,
  SINGLE_DAY_KINDS,
  SchoolsService,
  type School,
  type SchoolCalendarEvent,
  type SchoolCalendarKind,
} from '@core/schools.service';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';

const FIELD =
  'h-10 w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] tabular-nums hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg';

/** 存好的結果：新增回每所學校各一筆（自己那所在第一筆），編輯回那一筆 */
export interface CalendarEventFormResult {
  readonly mode: 'create' | 'edit';
  readonly events: readonly SchoolCalendarEvent[];
}

/**
 * 新增／編輯學校行事曆事件（#1160）。A6 沒畫，沿用 `A2.form` 形狀＋共用殼（R5）。
 * 原生 `<dialog>`，形狀同分校表單。單日類型（開學、休業式、補課）藏結束日、送出不帶 `endDate`。
 * 「同時加到」只在新增時出現（Q2 (a)）：不預選，自己勾。
 */
@Component({
  selector: 'app-calendar-event-form-dialog',
  standalone: true,
  imports: [DialogFrameComponent, FormsModule, SelectFieldComponent],
  template: `
    <dialog
      #dialog
      class="overlay-motion overlay-motion--from-bottom-narrow m-auto max-h-[calc(100%-48px)] min-h-11 w-[min(520px,calc(100%-32px))] overflow-y-auto overscroll-contain rounded-lg border-0 bg-white p-0 text-zinc-900 shadow-[0_24px_48px_-12px_rgb(26_22_20/36%)] backdrop:bg-zinc-900/40 max-wide:inset-x-0 max-wide:top-auto max-wide:bottom-0 max-wide:m-0 max-wide:max-h-[calc(100%-24px)] max-wide:w-full max-wide:max-w-none max-wide:rounded-none max-wide:rounded-t-xl max-wide:bg-(--sheet-bg)"
      role="dialog"
      (click)="onBackdrop($event)"
      (cancel)="onCancel($event)"
      (close)="onClosed()"
    >
      @if (isOpen()) {
        <app-dialog-frame [title]="editing() ? '編輯行事曆' : '新增行事曆'" (closed)="close()">
          <p class="m-0 text-sm text-zinc-600" data-part="dialog-context">{{ schoolName() }}</p>
          <form
            id="calendar-event-form"
            ngNoForm
            class="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 max-wide:grid-cols-1"
            (submit)="$event.preventDefault(); save()"
          >
            <div class="col-span-full min-w-0">
              <app-select-field
                label="類型"
                labelSize="md"
                [required]="true"
                [options]="kindOptions"
                [value]="kind()"
                (valueChange)="kind.set($event ?? 'other'); error.set(null)"
                [appendTo]="dialog"
              />
            </div>
            <div class="min-w-0" [class.col-span-full]="singleDay()">
              <label class="mb-1 block text-md font-semibold text-zinc-700" for="cal-start"
                >{{ singleDay() ? '日期' : '開始日' }}
                <span class="text-error-700" aria-hidden="true">*</span></label
              >
              <input
                id="cal-start"
                type="date"
                [class]="field"
                [ngModel]="startDate()"
                (ngModelChange)="startDate.set($event ?? ''); error.set(null)"
              />
            </div>
            @if (!singleDay()) {
              <div class="min-w-0">
                <label class="mb-1 block text-md font-semibold text-zinc-700" for="cal-end"
                  >結束日 <span class="text-error-700" aria-hidden="true">*</span></label
                >
                <input
                  id="cal-end"
                  type="date"
                  [class]="field"
                  [min]="startDate()"
                  [ngModel]="endDate()"
                  (ngModelChange)="endDate.set($event ?? ''); error.set(null)"
                />
              </div>
            }
            <div class="col-span-full min-w-0">
              <label class="mb-1 block text-md font-semibold text-zinc-700" for="cal-note"
                >備註</label
              >
              <input
                id="cal-note"
                type="text"
                maxlength="200"
                autocomplete="off"
                placeholder="例如：校慶補假"
                [class]="field"
                [(ngModel)]="note"
              />
            </div>
            @if (!editing() && otherSchools().length > 0) {
              <!-- L2：選填收進 details（dialog-frame.md 操作量分級） -->
              <details class="col-span-full min-w-0" data-part="also-schools">
                <summary class="flex min-h-11 cursor-pointer items-center text-md font-semibold">
                  同時加到其他學校{{ alsoIds().size ? '（已選 ' + alsoIds().size + ' 所）' : '' }}
                </summary>
                <p class="m-0 mb-2 text-sm text-zinc-600">每所學校各存一筆，之後可以分開改。</p>
                <div class="grid max-h-60 gap-1 overflow-y-auto wide:grid-cols-2">
                  @for (s of otherSchools(); track s.id) {
                    <label class="flex min-h-11 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        class="m-0 size-4 accent-zinc-900"
                        [checked]="alsoIds().has(s.id)"
                        (change)="toggleAlso(s.id)"
                      />{{ s.shortName || s.name }}
                    </label>
                  }
                </div>
              </details>
            }
          </form>

          <ng-container dialogFoot>
            <p
              class="form-dialog__why"
              [class.text-error-700]="!!error()"
              [class.text-zinc-600]="!error()"
              aria-live="polite"
            >
              {{ error() ?? missingHint() }}
            </p>
            <button
              type="button"
              class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 wide:h-9 border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50"
              [disabled]="loading()"
              (click)="close()"
            >
              取消
            </button>
            <button
              type="submit"
              form="calendar-event-form"
              class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 aria-disabled:opacity-55 wide:h-9 border-accent-vivid bg-accent-vivid hover:border-accent-vivid-2 hover:bg-accent-vivid-2"
              data-testid="calendar-submit"
              [attr.aria-disabled]="!!missingHint() || loading()"
            >
              {{ loading() ? '儲存中…' : editing() ? '儲存' : '新增' }}
            </button>
          </ng-container>
        </app-dialog-frame>
      }
    </dialog>
  `,
})
export class CalendarEventFormDialogComponent {
  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** 存成功帶結果，取消帶 null */
  readonly closed = output<CalendarEventFormResult | null>();

  protected readonly field = FIELD;
  protected readonly kindOptions: SelectFieldOption<SchoolCalendarKind>[] = (
    Object.entries(SCHOOL_CALENDAR_KIND_LABELS) as [SchoolCalendarKind, string][]
  ).map(([value, label]) => ({ value, label }));

  protected readonly isOpen = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<SchoolCalendarEvent | null>(null);
  protected readonly schoolName = signal('');
  protected readonly otherSchools = signal<readonly School[]>([]);
  protected readonly kind = signal<SchoolCalendarKind>('winter_break');
  protected readonly startDate = signal('');
  protected readonly endDate = signal('');
  protected readonly alsoIds = signal<ReadonlySet<string>>(new Set());
  protected note = '';
  private schoolId = '';
  private saved: CalendarEventFormResult | null = null;

  protected readonly singleDay = computed(() => SINGLE_DAY_KINDS.has(this.kind()));
  protected readonly missingHint = computed(() => {
    if (!this.startDate()) return this.singleDay() ? '還沒填：日期' : '還沒填：開始日';
    if (this.singleDay()) return null;
    if (!this.endDate()) return '還沒填：結束日';
    return this.endDate() < this.startDate() ? '結束日不能早於開始日' : null;
  });

  /** `event` 給了是編輯；`others` 是「同時加到」的候選（新增才用） */
  open(
    school: { id: string; name: string },
    event: SchoolCalendarEvent | null,
    others: readonly School[] = [],
  ): void {
    this.schoolId = school.id;
    this.schoolName.set(school.name);
    this.otherSchools.set(others);
    this.editing.set(event);
    this.kind.set(event?.kind ?? 'winter_break');
    this.startDate.set(event?.startDate ?? '');
    this.endDate.set(event?.endDate ?? '');
    this.note = event?.note ?? '';
    this.alsoIds.set(new Set());
    this.error.set(null);
    this.loading.set(false);
    this.saved = null;
    this.isOpen.set(true);
    afterNextRender(() => this.dialog().nativeElement.showModal(), { injector: this.injector });
  }

  /** 送出中不關（Esc、背景、✕、取消都擋）：不然存好的那筆回來時沒人接，列表少一筆 */
  close(): void {
    if (this.loading()) return;
    this.dialog().nativeElement.close();
  }

  /** Esc：瀏覽器自己關 dialog，不經 close()，要在 cancel 事件擋 */
  protected onCancel(event: Event): void {
    if (this.loading()) event.preventDefault();
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  protected onClosed(): void {
    this.isOpen.set(false);
    this.closed.emit(this.saved);
  }

  protected toggleAlso(id: string): void {
    this.alsoIds.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected save(): void {
    if (this.loading() || this.missingHint()) return;
    const editing = this.editing();
    const note = this.note.trim() || null;
    const endDate = this.singleDay() ? this.startDate() : this.endDate();
    const request$: Observable<readonly SchoolCalendarEvent[]> = editing
      ? this.schoolsService
          .updateCalendarEvent(this.schoolId, editing.id, {
            kind: this.kind(),
            startDate: this.startDate(),
            endDate,
            note,
          })
          .pipe(map((res) => [res.data]))
      : this.schoolsService
          .createCalendarEvent(this.schoolId, {
            kind: this.kind(),
            startDate: this.startDate(),
            // 單日不帶，API 補成開始日
            ...(this.singleDay() ? {} : { endDate }),
            note,
            ...(this.alsoIds().size ? { alsoSchoolIds: [...this.alsoIds()] } : {}),
          })
          .pipe(map((res) => res.data));

    this.loading.set(true);
    this.error.set(null);
    request$.subscribe({
      next: (events) => {
        const extra = events.length - 1;
        this.messageService.add({
          severity: 'success',
          summary: editing ? '已儲存' : extra > 0 ? `已新增，另外加到 ${extra} 所學校` : '已新增',
        });
        this.saved = { mode: editing ? 'edit' : 'create', events };
        this.loading.set(false);
        this.close();
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.error ?? '沒有存成功，請再試一次');
      },
    });
  }
}
