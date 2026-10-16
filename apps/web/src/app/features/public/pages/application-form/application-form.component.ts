import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { MessageService } from 'primeng/api';
import { GRADE_LEVELS, type GradeLevel } from '@core/students.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SystemClockService } from '@core/system-clock.service';

import {
  RELATION_OPTIONS,
  classGroups,
  courseGroups,
  emptyValues,
  gradeLabel,
  missingSummary,
  retryMinutes,
  toPayload,
  validate,
  type CampusContact,
  type FieldKey,
  type FormKind,
  type FormValues,
  type PublicCatalog,
} from './application-form.model';
import { PublicFormsService, type CaptchaConfig } from './public-forms.service';

type View = 'loading' | 'form' | 'done' | 'disabled' | 'load-failed';

interface Failure {
  message: string;
  /** 網路／500：附「重試」 */
  retry: boolean;
}

interface DoneSummary {
  values: FormValues;
  /** 已選的課程或開課班，結果畫面那幾行 */
  lines: string[];
  waitlistNames: string[];
  allWaitlist: boolean;
  campuses: CampusContact[];
}

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      reset(id?: string): void;
    };
  }
}

/** 機器人驗證失敗或逾時：不送出，等使用者按「重試驗證」 */
class CaptchaError extends Error {}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * 公開試聽申請／我要報名（#1665 PR-4；A6 `pub-trial.html`、`pub-enrollment.html`）。
 * 兩頁同一套版面與流程，差在選項（課程 vs 開課班）、試聽的「方便的時段」與報名的「期望開始日期」。
 * 規則見 `kb/wiki/specs/public/application-forms-a6.md` §1。
 *
 * 送出鈕不停用（A6 notes）：按下去才逐欄標紅、按鈕旁寫缺什麼並抖一下、捲到第一個錯的欄位。
 */
@Component({
  selector: 'app-application-form',
  imports: [RouterLink, SelectFieldComponent],
  templateUrl: './application-form.component.html',
  host: { class: 'flex w-full flex-col items-center' },
})
export class ApplicationFormComponent {
  readonly kind = input.required<FormKind>();

  private readonly api = inject(PublicFormsService);
  private readonly messages = inject(MessageService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  /** 第一項是 A6 的「選擇年級」（稿的 `<option value="">`）；選它等於還沒選 */
  protected readonly gradeOptions = [
    { label: '選擇年級', value: null as GradeLevel | null },
    ...GRADE_LEVELS.map((g) => ({ label: gradeLabel(g), value: g as GradeLevel | null })),
  ];
  protected readonly gradeLabel = gradeLabel;
  protected readonly relations = RELATION_OPTIONS;
  protected readonly trialPath = RoutesCatalog.PUBLIC_TRIAL.absolutePath;
  protected readonly enrollmentPath = RoutesCatalog.PUBLIC_ENROLLMENT.absolutePath;
  protected readonly loginPath = RoutesCatalog.PUBLIC_LOGIN.absolutePath;
  /** 跟伺服器同步過的台北日期（不信瀏覽器的時鐘）；`min` 與「不能早於今天」都用它 */
  protected readonly today = inject(SystemClockService).todayTaipei;

  protected readonly view = signal<View>('loading');
  protected readonly catalog = signal<PublicCatalog | null>(null);
  protected readonly values = signal<FormValues>(emptyValues());
  /** 按過送出之後才顯示錯誤；之後每次輸入即時重驗 */
  private readonly tried = signal(false);
  protected readonly submitting = signal(false);
  protected readonly why = signal('');
  protected readonly failure = signal<Failure | null>(null);
  protected readonly done = signal<DoneSummary | null>(null);
  /** 機器人驗證：還在算／算好了／失敗或逾時（要按「重試」，這時不能送出） */
  protected readonly captchaState = signal<'pending' | 'ready' | 'failed'>('pending');
  protected readonly captchaProvider = signal<CaptchaConfig['provider'] | null>(null);

  protected readonly errors = computed(() =>
    this.tried() ? validate(this.kind(), this.values(), this.today()) : {},
  );
  protected readonly courseGroups = computed(() => courseGroups(this.catalog()?.data ?? []));
  protected readonly classGroups = computed(() => classGroups(this.catalog()?.data ?? []));
  /** 補習班電話：失敗訊息、聲明、結果畫面用。多分校時取第一個有電話的 */
  protected readonly phone = computed(
    () => this.catalog()?.campuses.find((c) => c.phone)?.phone ?? null,
  );

  private readonly why$ = viewChild<ElementRef<HTMLElement>>('whyEl');
  private readonly privacy = viewChild<ElementRef<HTMLDialogElement>>('privacy');
  private readonly turnstileEl = viewChild<ElementRef<HTMLElement>>('turnstileEl');

  /** 這一輪機器人驗證的結果；送出時 await 它（還沒算完就停在「送出中」） */
  private captcha!: Promise<string>;
  private resolveCaptcha: (token: string) => void = () => undefined;
  private rejectCaptcha: (err: unknown) => void = () => undefined;
  private turnstileId: string | undefined;
  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.catalog.set(await this.api.catalog());
      this.view.set('form');
      this.startCaptcha();
    } catch (err) {
      this.view.set(this.isDisabled(err) ? 'disabled' : 'load-failed');
    }
  }

  protected reload(): void {
    this.view.set('loading');
    void this.load();
  }

  // ─── 欄位 ───

  protected set<K extends keyof FormValues>(key: K, value: FormValues[K]): void {
    this.values.update((v) => ({ ...v, [key]: value }));
  }

  protected text(key: keyof FormValues, event: Event): void {
    this.set(key, (event.target as HTMLInputElement).value as never);
  }

  protected toggleTarget(id: string, checked: boolean): void {
    this.values.update((v) => ({
      ...v,
      targets: checked ? [...v.targets, id] : v.targets.filter((t) => t !== id),
    }));
  }

  protected checked(id: string): boolean {
    return this.values().targets.includes(id);
  }

  protected fits(gradeLevels: string[]): boolean {
    const grade = this.values().grade;
    return !!grade && gradeLevels.includes(grade);
  }

  protected error(key: FieldKey): string | undefined {
    return this.errors()[key];
  }

  protected openPrivacy(): void {
    this.privacy()?.nativeElement.showModal();
  }

  protected closePrivacy(event?: MouseEvent): void {
    const dialog = this.privacy()?.nativeElement;
    // 點到 dialog 本身＝點到背景（內容都包在裡面那層）
    if (!event || event.target === dialog) dialog?.close();
  }

  // ─── 機器人驗證 ───

  /** 開新的一輪：狀態回到 pending，結果交給 resolveCaptcha／rejectCaptcha */
  private newAttempt(): void {
    this.captchaState.set('pending');
    this.captcha = new Promise<string>((resolve, reject) => {
      this.resolveCaptcha = resolve;
      this.rejectCaptcha = reject;
    });
    this.captcha.then(
      () => !this.destroyed && this.captchaState.set('ready'),
      () => !this.destroyed && this.captchaState.set('failed'),
    );
  }

  /**
   * 照 `GET /api/public/captcha` 回的 provider 分流（#1665 Q4′）：
   * - altcha：背景解題（`solveAltcha`，有逾時）
   * - turnstile：**一定要渲染 Turnstile 的 widget** —— token 只能從 widget 拿到
   */
  private startCaptcha(): void {
    this.newAttempt();
    this.api.captcha().then(
      (config) => {
        this.captchaProvider.set(config.provider);
        if (config.provider === 'altcha') {
          this.api.solveAltcha(config.challenge).then(this.resolveCaptcha, this.rejectCaptcha);
        } else {
          this.mountTurnstile(config.siteKey).catch(this.rejectCaptcha);
        }
      },
      (err) => this.rejectCaptcha(err),
    );
  }

  /** 失敗或逾時之後的「重試」。Turnstile 已經畫過就 reset 同一個 widget，不再畫第二個 */
  protected retryCaptcha(): void {
    if (this.turnstileId && window.turnstile) {
      this.newAttempt();
      window.turnstile.reset(this.turnstileId);
    } else {
      this.startCaptcha();
    }
  }

  /** Turnstile（`CAPTCHA_PROVIDER=turnstile` 的部署才會走到）：載官方 script、在那一列裡畫 widget */
  private async mountTurnstile(siteKey: string): Promise<void> {
    if (!window.turnstile) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SRC;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new CaptchaError());
        document.head.appendChild(script);
      });
    }
    // 表單剛切成 'form' 時還沒畫出來（load() 緊接著就呼叫 startCaptcha）：等下一次畫完再找掛點
    if (!this.turnstileEl()) {
      await new Promise<void>((resolve) =>
        afterNextRender(() => resolve(), { injector: this.injector }),
      );
    }
    const el = this.turnstileEl()?.nativeElement;
    if (!el || !window.turnstile) throw new CaptchaError();
    if (this.turnstileId) {
      window.turnstile.reset(this.turnstileId);
      return;
    }
    // callback 永遠交給「當下這一輪」：reset 之後的新 token 進新的 promise
    this.turnstileId = window.turnstile.render(el, {
      sitekey: siteKey,
      callback: (token: string) => this.resolveCaptcha(token),
      'error-callback': () => this.rejectCaptcha(new CaptchaError()),
      'timeout-callback': () => this.rejectCaptcha(new CaptchaError()),
      // token 過期（約 5 分鐘）：換新一輪，widget 自己會再拿一次
      'expired-callback': () => this.newAttempt(),
    });
  }

  // ─── 送出 ───

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    this.tried.set(true);
    const errors = this.errors();
    const summary = missingSummary(this.kind(), errors);
    this.why.set(summary);
    if (summary) {
      this.shakeWhy();
      this.focusFirstError();
      return;
    }

    this.submitting.set(true);
    this.failure.set(null);
    try {
      const result = await this.sendWithCaptcha();
      this.showDone(result.waitlistClassIds ?? []);
    } catch (err) {
      this.failure.set(this.describe(err));
      if (this.isDisabled(err)) this.view.set('disabled');
    } finally {
      this.submitting.set(false);
    }
  }

  /**
   * 機器人驗證沒過（失敗、逾時）**不送出**，丟 CaptchaError 讓使用者按重試。
   * 伺服器回 CAPTCHA_FAILED（題目過期或驗不過）：重新取一題、自動再算一次並重送；再失敗才往外丟（設計稿 §1）。
   */
  private async sendWithCaptcha() {
    const token = async () => {
      try {
        return await this.captcha;
      } catch {
        throw new CaptchaError();
      }
    };
    const send = async () =>
      this.api.submit(this.kind(), toPayload(this.kind(), this.values(), await token()));
    try {
      return await send();
    } catch (err) {
      if (this.code(err) !== 'CAPTCHA_FAILED') throw err;
      this.retryCaptcha();
      return send();
    }
  }

  private describe(err: unknown): Failure {
    const phone = this.phone();
    const call = phone ? `，或直接打 ${phone}` : '';
    if (err instanceof HttpErrorResponse && err.status === 429) {
      const minutes = retryMinutes(err.headers.get('Retry-After'));
      const when = minutes ? `請 ${minutes} 分鐘後再試` : '請稍後再試';
      return { message: `送出太多次了，${when}${call}。你填的資料都還在。`, retry: false };
    }
    if (err instanceof CaptchaError) {
      return { message: '機器人驗證沒有完成，請按「重試驗證」後再送出', retry: false };
    }
    if (this.code(err) === 'CAPTCHA_FAILED') {
      return { message: '驗證沒通過，請再按一次送出', retry: false };
    }
    if (err instanceof HttpErrorResponse && err.status === 400 && err.error?.error) {
      return { message: err.error.error as string, retry: false };
    }
    return { message: '沒送出去，請再試一次', retry: true };
  }

  private code(err: unknown): string | undefined {
    return err instanceof HttpErrorResponse ? (err.error?.code as string | undefined) : undefined;
  }

  /** 自架的部署可以不開公開頁（c12）：`PUBLIC_ORG_SLUG` 沒設時整頁換成請來電 */
  private isDisabled(err: unknown): boolean {
    return err instanceof HttpErrorResponse && err.status === 404;
  }

  private shakeWhy(): void {
    const el = this.why$()?.nativeElement;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // A6 `why-shake`：只是加強「按了有反應」，錯誤本身由文字與紅框表達
    el.animate(
      [
        { transform: 'none' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'none' },
      ],
      { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
  }

  private focusFirstError(): void {
    // 錯誤框要等這一輪變更偵測畫上去
    requestAnimationFrame(() => {
      const box = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '[data-invalid="true"]',
      );
      if (!box) return;
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      box.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
      const input = box.querySelector<HTMLElement>(
        'input:not([type=checkbox]):not([type=radio]), textarea',
      );
      input?.focus({ preventScroll: true });
    });
  }

  private showDone(waitlistIds: string[]): void {
    const v = this.values();
    const data = this.catalog()?.data ?? [];
    const picked = data.filter((c) =>
      this.kind() === 'trial'
        ? v.targets.includes(c.courseId ?? '')
        : v.targets.includes(c.classId),
    );
    const campusNames = new Set(picked.map((c) => c.campusName));
    const campuses = (this.catalog()?.campuses ?? []).filter((c) => campusNames.has(c.name));
    let lines: string[];
    if (this.kind() === 'trial') {
      const names = this.courseGroups()
        .flatMap((g) => g.options)
        .filter((o) => v.targets.includes(o.id))
        .map((o) => o.name);
      lines = [`想試聽：${names.join('、')}`];
    } else {
      lines = this.classGroups()
        .flatMap((g) => g.options)
        .filter((o) => v.targets.includes(o.id))
        .map((o) =>
          [o.name, o.start, waitlistIds.includes(o.id) ? '已額滿 · 登記候補' : (o.fee ?? '')]
            .filter(Boolean)
            .join(' · '),
        );
    }
    const waitlistNames = this.classGroups()
      .flatMap((g) => g.options)
      .filter((o) => waitlistIds.includes(o.id))
      .map((o) => o.name);
    this.done.set({
      values: v,
      lines,
      waitlistNames,
      allWaitlist: waitlistIds.length > 0 && waitlistIds.length === v.targets.length,
      campuses: campuses.length ? campuses : (this.catalog()?.campuses ?? []).slice(0, 1),
    });
    this.view.set('done');
    this.messages.add({
      severity: 'success',
      summary:
        this.kind() === 'trial'
          ? '試聽申請已送出'
          : this.done()!.allWaitlist
            ? '已額滿，已為您登記候補，補習班會主動聯絡'
            : '報名申請已送出',
    });
    requestAnimationFrame(() => {
      const el = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('#done');
      el?.scrollIntoView({ block: 'start' });
      el?.focus({ preventScroll: true });
    });
  }

  /** 「再幫另一個孩子申請」：保留家長、清掉孩子與課程 */
  protected again(): void {
    const v = this.values();
    this.values.set({
      ...emptyValues(),
      parentName: v.parentName,
      email: v.email,
      phone: v.phone,
      relation: v.relation,
    });
    this.tried.set(false);
    this.why.set('');
    this.failure.set(null);
    this.done.set(null);
    this.view.set('form');
    this.startCaptcha();
    this.messages.add({ severity: 'info', summary: '已保留家長資訊，填孩子的部分就好' });
    requestAnimationFrame(() => {
      const host = this.host.nativeElement as HTMLElement;
      host.scrollIntoView({ block: 'start' });
      host.querySelector<HTMLElement>('#f-studentName')?.focus();
    });
  }

  /** 「信義校（地址）或文山校（地址）」 */
  protected campusText(campuses: CampusContact[]): string {
    return campuses.map((c) => (c.address ? `${c.name}（${c.address}）` : c.name)).join('或');
  }

  protected tel(phone: string): string {
    return `tel:${phone.replace(/[^\d+]/g, '')}`;
  }

  protected relationLabel(value: string): string {
    return RELATION_OPTIONS.find((r) => r.value === value)?.label ?? '';
  }

  protected monthDay(date: string): string {
    const [, m, d] = date.split('-');
    return `${Number(m)}/${Number(d)}`;
  }
}
