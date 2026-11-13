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

import {
  ParentRenewalService,
  type ParentRenewalItem,
  type RenewalRequestKind,
} from '@core/parent-renewal.service';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';

export const RENEWAL_KIND_LABELS: Readonly<Record<RenewalRequestKind, string>> = {
  transfer: '轉班',
  stop: '停課（不續報）',
  billing_mode: '變更繳費方式',
};

const FIELD =
  'w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:text-lg';

/**
 * 申請續課異動（#1122，A6 p-renewal 的 `A2.form`，全採）：要異動的課（select）→ 異動類型（radio）→
 * 想怎麼改（必填）→ 備註。稿沒有依類型換欄位（A2.form 沒有條件欄位），用一個必填欄、提示依類型寫什麼。
 * 原生 `<dialog>`＋共用殼；送出鈕 `type=submit form=id`、不綁 click；送出中不讓關（同 #2473）。
 */
@Component({
  selector: 'app-renewal-request-dialog',
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
        <app-dialog-frame title="申請異動" (closed)="close()">
          <p class="m-0 text-sm text-zinc-600" data-part="dialog-context">{{ context() }}</p>
          <form
            id="renewal-request-form"
            ngNoForm
            class="mt-4 grid gap-4"
            (submit)="$event.preventDefault(); save()"
          >
            <app-select-field
              label="要異動的課"
              labelSize="md"
              placeholder="選一門課"
              [required]="true"
              [options]="courseOptions()"
              [value]="enrollmentId()"
              (valueChange)="enrollmentId.set($event); error.set(null)"
              [appendTo]="dialog"
            />
            <div class="min-w-0">
              <span class="mb-1 block text-md font-semibold text-zinc-700" id="renewal-kind-label"
                >異動類型</span
              >
              <div
                class="flex flex-wrap gap-2"
                role="radiogroup"
                aria-labelledby="renewal-kind-label"
              >
                @for (opt of kindOptions; track opt.value) {
                  <label
                    class="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 font-semibold has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-checked:ring-inset max-wide:h-11"
                  >
                    <input
                      type="radio"
                      name="renewal-kind"
                      class="m-0 accent-zinc-900"
                      [checked]="kind() === opt.value"
                      (change)="kind.set(opt.value)"
                    />{{ opt.label }}
                  </label>
                }
              </div>
            </div>
            <div class="min-w-0">
              <label class="mb-1 block text-md font-semibold text-zinc-700" for="renewal-detail"
                >想怎麼改 <span class="text-error-700" aria-hidden="true">*</span></label
              >
              <textarea
                id="renewal-detail"
                rows="3"
                maxlength="500"
                class="min-h-24 resize-y py-2 leading-normal"
                [class]="field"
                placeholder="轉班：想轉到哪一班或哪個時段　停課：原因　變更繳費方式：想改成月繳或期繳"
                [ngModel]="detail()"
                (ngModelChange)="detail.set($event); error.set(null)"
              ></textarea>
            </div>
            <div class="min-w-0">
              <label class="mb-1 block text-md font-semibold text-zinc-700" for="renewal-note"
                >備註（選填）</label
              >
              <input
                id="renewal-note"
                type="text"
                maxlength="200"
                autocomplete="off"
                class="h-10 max-wide:h-11"
                [class]="field"
                [(ngModel)]="note"
              />
            </div>
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
              class="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-solid border-zinc-300 bg-white px-4 text-md font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 wide:h-9"
              [disabled]="loading()"
              (click)="close()"
            >
              取消
            </button>
            <button
              type="submit"
              form="renewal-request-form"
              class="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md font-semibold whitespace-nowrap text-zinc-900 hover:border-accent-vivid-2 hover:bg-accent-vivid-2 aria-disabled:opacity-55 wide:h-9"
              data-testid="renewal-submit"
              [attr.aria-disabled]="!!missingHint() || loading()"
            >
              {{ loading() ? '送出中…' : '送出異動申請' }}
            </button>
          </ng-container>
        </app-dialog-frame>
      }
    </dialog>
  `,
})
export class RenewalRequestDialogComponent {
  private readonly api = inject(ParentRenewalService);
  private readonly messages = inject(MessageService);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** 送出成功 true、取消 false */
  readonly closed = output<boolean>();

  protected readonly field = FIELD;
  protected readonly kindOptions = (
    Object.entries(RENEWAL_KIND_LABELS) as [RenewalRequestKind, string][]
  ).map(([value, label]) => ({ value, label }));

  protected readonly isOpen = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly context = signal('');
  private readonly items = signal<readonly ParentRenewalItem[]>([]);
  protected readonly enrollmentId = signal<string | null>(null);
  protected readonly kind = signal<RenewalRequestKind>('transfer');
  protected readonly detail = signal('');
  protected note = '';
  private childId = '';
  private childName = '';
  private saved = false;

  protected readonly courseOptions = computed<SelectFieldOption<string>[]>(() =>
    this.items().map((i) => ({ value: i.enrollmentId, label: i.nextClassName })),
  );
  protected readonly missingHint = computed(() => {
    const missing = [
      ...(this.enrollmentId() ? [] : ['要異動的課']),
      ...(this.detail().trim() ? [] : ['想怎麼改']),
    ];
    return missing.length ? `還沒填：${missing.join('、')}` : null;
  });

  open(
    child: { id: string; name: string },
    items: readonly ParentRenewalItem[],
    nextStart: string,
  ): void {
    this.childId = child.id;
    this.childName = child.name;
    const [, m, d] = nextStart.split('-').map(Number);
    this.context.set(`${child.name} · 下期 ${m}/${d} 起`);
    this.items.set(items);
    this.enrollmentId.set(items.length === 1 ? items[0]!.enrollmentId : null);
    this.kind.set('transfer');
    this.detail.set('');
    this.note = '';
    this.error.set(null);
    this.loading.set(false);
    this.saved = false;
    this.isOpen.set(true);
    afterNextRender(() => this.dialog().nativeElement.showModal(), { injector: this.injector });
  }

  /** 送出中不關（Esc、背景、✕、取消都擋） */
  close(): void {
    if (this.loading()) return;
    this.dialog().nativeElement.close();
  }

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

  protected save(): void {
    const enrollmentId = this.enrollmentId();
    if (this.loading() || this.missingHint() || !enrollmentId) return;
    const className = this.items().find((i) => i.enrollmentId === enrollmentId)?.nextClassName;
    this.loading.set(true);
    this.error.set(null);
    this.api
      .createRequest({
        childId: this.childId,
        enrollmentId,
        kind: this.kind(),
        detail: this.detail().trim(),
        note: this.note.trim() || null,
      })
      .subscribe({
        next: () => {
          this.messages.add({
            severity: 'success',
            summary: `已送出 ${className ?? ''} 的異動申請，${this.childName}的自動開單先暫停`,
          });
          this.saved = true;
          this.loading.set(false);
          this.close();
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(err.error?.error ?? '沒有送出，請再試一次');
        },
      });
  }
}
