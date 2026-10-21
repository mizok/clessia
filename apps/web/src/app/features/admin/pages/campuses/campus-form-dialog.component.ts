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
import type { Observable } from 'rxjs';

import {
  CampusesService,
  type Campus,
  type CreateCampusInput,
  type UpdateCampusInput,
} from '@core/campuses.service';
import { AuthService } from '@core/auth.service';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';

type Mode = '' | 'per_session' | 'daily_checkin';

/**
 * 新增／編輯分校（A6 settings.html#campuses 的 `campusForm`，#1314 SE3 全採）。
 *
 * 欄位照稿：名稱*｜電話＋狀態（各半）｜地址｜出勤紀錄模式｜帳戶。兩處跟稿不同：
 * - **帳戶**：稿拆「收款銀行＋帳號」兩欄；使用者 10-21 裁不拆（SE3 Q1，R5）—— 多帳戶、LINE Pay 寫不進兩欄，
 *   維持一個多行欄位，標籤用稿的「收款帳戶」語氣。
 * - **出勤模式、帳戶只在有權限時出現**（新增、編輯都是）：出勤模式要 `manage_org_settings`（#1112）、
 *   帳戶要 `manage_finance`（#1073）—— 沒權限的人帶了這個 key，API 403，整張表單（改名、改電話）一起存不了。
 *   稿的出勤模式沒有「沿用機構預設」；app 保留（null＝跟著「一般」走，改了機構預設會跟著變 —— 舊有新無不刪，R2）。
 *
 * 原生 `<dialog>`（同教室對話框）。
 */
@Component({
  selector: 'app-campus-form-dialog',
  standalone: true,
  imports: [FormsModule, SelectFieldComponent],
  template: `
    <dialog
      #dialog
      class="overlay-motion overlay-motion--from-bottom-narrow m-auto max-h-[calc(100%-48px)] min-h-11 w-[min(520px,calc(100%-32px))] overflow-y-auto overscroll-contain rounded-lg border-0 bg-white p-0 text-zinc-900 shadow-[0_24px_48px_-12px_rgb(26_22_20/36%)] backdrop:bg-zinc-900/40 max-wide:inset-x-0 max-wide:top-auto max-wide:bottom-0 max-wide:m-0 max-wide:max-h-[calc(100%-24px)] max-wide:w-full max-wide:max-w-none max-wide:rounded-none max-wide:rounded-t-xl max-wide:bg-zinc-200"
      aria-labelledby="campus-form-title"
      (click)="onBackdrop($event)"
      (close)="onClosed()"
    >
      @if (isOpen()) {
        <div class="flex items-center justify-between pt-4 pr-4 pb-2 pl-6">
          <div>
            <h2 id="campus-form-title" class="m-0 text-xl font-bold">
              {{ campus() ? '編輯分校：' + campus()!.name : '新增分校' }}
            </h2>
            @if (!campus()) {
              <p class="m-0 mt-0.5 text-md text-zinc-600">建好之後就可以在這個分校開課</p>
            }
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
            <label class="mb-1 block text-md font-semibold text-zinc-700" for="campus-name"
              >分校名稱 <span class="text-error-700" aria-hidden="true">*</span></label
            >
            <input
              id="campus-name"
              type="text"
              maxlength="100"
              autocomplete="off"
              placeholder="例如：台北分校"
              [attr.autofocus]="autofocus() ? '' : null"
              class="h-10 w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] tabular-nums hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
              [ngModel]="name()"
              (ngModelChange)="name.set($event); error.set(null)"
            />
          </div>
          <div class="min-w-0">
            <label class="mb-1 block text-md font-semibold text-zinc-700" for="campus-phone"
              >電話</label
            >
            <input
              id="campus-phone"
              type="text"
              maxlength="30"
              autocomplete="off"
              placeholder="02-12345678"
              class="h-10 w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] tabular-nums hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
              [(ngModel)]="phone"
            />
          </div>
          <div class="min-w-0">
            <span class="mb-1 block text-md font-semibold text-zinc-700" id="campus-status-label"
              >狀態</span
            >
            <!-- A6 .fdlg__seg／.fdlg__opt：radio 包成框，選中的框加深 -->
            <div
              class="flex flex-wrap gap-2"
              role="radiogroup"
              aria-labelledby="campus-status-label"
            >
              @for (opt of statusOptions; track opt.label) {
                <label
                  class="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 font-semibold has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-checked:ring-inset max-wide:h-11"
                >
                  <input
                    type="radio"
                    name="campus-status"
                    class="m-0 accent-zinc-900"
                    [checked]="isActive() === opt.value"
                    (change)="isActive.set(opt.value)"
                  />{{ opt.label }}
                </label>
              }
            </div>
          </div>
          <div class="col-span-full min-w-0">
            <label class="mb-1 block text-md font-semibold text-zinc-700" for="campus-address"
              >地址</label
            >
            <input
              id="campus-address"
              type="text"
              maxlength="255"
              autocomplete="off"
              placeholder="完整收件地址"
              class="h-10 w-full rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] tabular-nums hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
              [(ngModel)]="address"
            />
          </div>
          @if (canEditAttendanceMode()) {
            <div class="col-span-full min-w-0">
              <app-select-field
                label="出勤紀錄模式"
                labelSize="md"
                [options]="modeOptions"
                [value]="attendanceMode()"
                (valueChange)="attendanceMode.set($event ?? '')"
                [appendTo]="dialog"
              />
              <p class="m-0 mt-1 text-sm text-zinc-600">預設跟著「一般」的設定</p>
            </div>
          }
          @if (canEditPaymentInfo()) {
            <div class="col-span-full min-w-0">
              <label
                class="mb-1 block text-md font-semibold text-zinc-700"
                for="campus-payment-info"
                >收款帳戶</label
              >
              <textarea
                id="campus-payment-info"
                rows="4"
                maxlength="1000"
                class="min-h-24 w-full resize-y rounded-md border border-solid border-zinc-300 bg-white px-3 py-2 text-base leading-normal text-zinc-900 [font-family:inherit] hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:text-lg"
                placeholder="例如：台灣銀行 景美分行（004）&#10;帳號 000-000-000000&#10;留白＝沿用「一般」設定的機構帳戶"
                [(ngModel)]="paymentInfo"
              ></textarea>
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
          >
            {{ error() ?? missingHint() }}
          </p>
          <button
            type="button"
            class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-55 wide:h-9 border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50"
            [disabled]="loading()"
            (click)="close()"
          >
            取消
          </button>
          <button
            type="button"
            class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-55 wide:h-9 border-accent-vivid bg-accent-vivid hover:border-accent-vivid-2 hover:bg-accent-vivid-2"
            [attr.aria-disabled]="!!missingHint() || loading()"
            (click)="save()"
          >
            {{ loading() ? (campus() ? '儲存中…' : '建立中…') : campus() ? '儲存' : '建立' }}
          </button>
        </div>
      }
    </dialog>
  `,
})
export class CampusFormDialogComponent {
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** 關掉時發出；存成功帶那一筆分校，取消帶 null */
  readonly closed = output<Campus | null>();

  protected readonly statusOptions = [
    { label: '啟用', value: true },
    { label: '停用', value: false },
  ] as const;
  protected readonly modeOptions: SelectFieldOption<Mode>[] = [
    { label: '沿用機構預設', value: '' },
    { label: '日到班', value: 'daily_checkin' },
    { label: '隨堂點名', value: 'per_session' },
  ];

  protected readonly isOpen = signal(false);
  /** null = 新增 */
  protected readonly campus = signal<Campus | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly autofocus = signal(false);
  protected readonly name = signal('');
  protected readonly isActive = signal(true);
  /** '' = 沿用機構預設（null） */
  protected readonly attendanceMode = signal<Mode>('');
  protected phone = '';
  protected address = '';
  protected paymentInfo = '';
  private saved: Campus | null = null;

  /** 出勤模式：跟機構預設同一個門檻 */
  protected readonly canEditAttendanceMode = computed(() =>
    this.auth.hasPermission('manage_org_settings'),
  );
  /** 帳戶（#1073）：改帳號＝改家長匯款的去向 */
  protected readonly canEditPaymentInfo = computed(() => this.auth.hasPermission('manage_finance'));
  protected readonly missingHint = computed(() => (this.name().trim() ? null : '還沒填：分校名稱'));

  /** `campus` 給了是編輯，沒給是新增。每次打開都是新的一輪 */
  open(campus: Campus | null = null): void {
    this.campus.set(campus);
    this.name.set(campus?.name ?? '');
    this.phone = campus?.phone ?? '';
    this.address = campus?.address ?? '';
    this.paymentInfo = campus?.paymentInfo ?? '';
    this.isActive.set(campus?.isActive ?? true);
    this.attendanceMode.set(campus?.attendanceMode ?? '');
    this.error.set(null);
    this.loading.set(false);
    this.saved = null;
    // 稿：桌機聚焦第一個欄位、手機不聚焦（不要一開就彈鍵盤）—— 交給 showModal 的 autofocus
    this.autofocus.set(matchMedia('(min-width: 861px)').matches);
    this.isOpen.set(true);
    // 等 @if 把內容畫進 dialog 再 showModal（microtask 太早：內容還沒畫，焦點落在 dialog 本身）
    afterNextRender(() => this.dialog().nativeElement.showModal(), { injector: this.injector });
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  /**
   * 點背景（dialog 本身，不是裡面的東西）關掉，同 A6 `form()`。
   * **不能寫成模板裡的 `target === dialog && close()`**：點裡面時那個運算式回 false，
   * Angular 會當成 preventDefault —— radio 點不下去。
   */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  protected onClosed(): void {
    this.isOpen.set(false);
    this.closed.emit(this.saved);
  }

  protected save(): void {
    if (this.loading() || this.missingHint()) return;
    const name = this.name().trim();
    const base = {
      name,
      address: this.address.trim() || null,
      phone: this.phone.trim() || null,
      isActive: this.isActive(),
    };
    const input: CreateCampusInput & UpdateCampusInput = {
      ...base,
      // 沒權限就不帶這個 key —— 帶了 API 會 403，整張表單一起存不了
      ...(this.canEditAttendanceMode() ? { attendanceMode: this.attendanceMode() || null } : {}),
      ...(this.canEditPaymentInfo()
        ? { paymentInfo: this.paymentInfo.trim() ? this.paymentInfo : null }
        : {}),
    };
    const editing = this.campus();
    const request$: Observable<{ data: Campus }> = editing
      ? this.campusesService.update(editing.id, input)
      : this.campusesService.create(input);

    this.loading.set(true);
    this.error.set(null);
    request$.subscribe({
      next: (res) => {
        this.messageService.add({
          severity: 'success',
          summary: editing ? `已儲存「${name}」` : `已新增分校「${name}」`,
        });
        this.saved = res.data;
        this.loading.set(false);
        this.close();
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          err.error?.error ?? (editing ? '沒有存成功' : '沒有建立成功') + '，請再試一次',
        );
      },
    });
  }
}
