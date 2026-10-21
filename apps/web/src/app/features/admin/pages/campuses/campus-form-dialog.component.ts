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
import {
  A6_BTN,
  A6_BTN_CTA,
  A6_CLOSE,
  A6_DIALOG,
  A6_FOOT,
  A6_FORM,
  A6_INPUT,
  A6_LABEL,
} from './a6-form';

type Mode = '' | 'per_session' | 'daily_checkin';

/**
 * 新增／編輯分校（A6 settings.html#campuses 的 `campusForm`，#1314 SE3 全採）。
 *
 * 欄位照稿：名稱*｜電話＋狀態（各半）｜地址｜出勤紀錄模式｜帳戶。兩處跟稿不同：
 * - **帳戶**：稿拆「收款銀行＋帳號」兩欄；使用者 10-21 裁不拆（SE3 Q1，R5）—— 多帳戶、LINE Pay 寫不進兩欄，
 *   維持一個多行欄位，標籤用稿的「收款帳戶」語氣。
 * - **出勤模式、帳戶只在編輯、且有權限時出現**：建立的 API 不收這兩欄（新分校先沿用機構預設）；
 *   出勤模式要 `manage_org_settings`（#1112）、帳戶要 `manage_finance`（#1073）—— 沒權限的人帶了這個 key，
 *   API 403，整張表單（改名、改電話）一起存不了。
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
      [class]="a6.dialog"
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
          <button type="button" [class]="a6.close" aria-label="關閉" (click)="close()">
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>

        <form ngNoForm [class]="a6.form" (submit)="$event.preventDefault(); save()">
          <div class="col-span-full min-w-0">
            <label [class]="a6.label" for="campus-name"
              >分校名稱 <span class="text-error-700" aria-hidden="true">*</span></label
            >
            <input
              id="campus-name"
              type="text"
              maxlength="100"
              autocomplete="off"
              placeholder="例如：台北分校"
              [attr.autofocus]="autofocus() ? '' : null"
              [class]="a6.input"
              [ngModel]="name()"
              (ngModelChange)="name.set($event); error.set(null)"
            />
          </div>
          <div class="min-w-0">
            <label [class]="a6.label" for="campus-phone">電話</label>
            <input
              id="campus-phone"
              type="text"
              maxlength="30"
              autocomplete="off"
              placeholder="02-12345678"
              [class]="a6.input"
              [(ngModel)]="phone"
            />
          </div>
          <div class="min-w-0">
            <span [class]="a6.label" id="campus-status-label">狀態</span>
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
            <label [class]="a6.label" for="campus-address">地址</label>
            <input
              id="campus-address"
              type="text"
              maxlength="255"
              autocomplete="off"
              placeholder="完整收件地址"
              [class]="a6.input"
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
              <label [class]="a6.label" for="campus-payment-info">收款帳戶</label>
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
        <div [class]="a6.foot">
          <p
            class="m-0 mr-auto text-md max-wide:basis-full"
            [class.text-error-700]="!!error()"
            [class.text-zinc-600]="!error()"
            aria-live="polite"
          >
            {{ error() ?? missingHint() }}
          </p>
          <button type="button" [class]="a6.btn" [disabled]="loading()" (click)="close()">
            取消
          </button>
          <button
            type="button"
            [class]="a6.cta"
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

  protected readonly a6 = {
    dialog: A6_DIALOG,
    close: A6_CLOSE,
    form: A6_FORM,
    label: A6_LABEL,
    input: A6_INPUT,
    foot: A6_FOOT,
    btn: A6_BTN,
    cta: A6_BTN_CTA,
  };
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

  /** 出勤模式：跟機構預設同一個門檻；只在編輯（建立的 API 不收） */
  protected readonly canEditAttendanceMode = computed(
    () => this.campus() !== null && this.auth.hasPermission('manage_org_settings'),
  );
  /** 帳戶（#1073）：改帳號＝改家長匯款的去向；只在編輯 */
  protected readonly canEditPaymentInfo = computed(
    () => this.campus() !== null && this.auth.hasPermission('manage_finance'),
  );
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
    const editing = this.campus();
    let request$: Observable<{ data: Campus }>;
    if (editing) {
      const input: UpdateCampusInput = {
        ...base,
        // 沒權限就不帶這個 key —— 帶了 API 會 403，整張表單一起存不了
        ...(this.canEditAttendanceMode() ? { attendanceMode: this.attendanceMode() || null } : {}),
        ...(this.canEditPaymentInfo()
          ? { paymentInfo: this.paymentInfo.trim() ? this.paymentInfo : null }
          : {}),
      };
      request$ = this.campusesService.update(editing.id, input);
    } else {
      const input: CreateCampusInput = base;
      request$ = this.campusesService.create(input);
    }

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
