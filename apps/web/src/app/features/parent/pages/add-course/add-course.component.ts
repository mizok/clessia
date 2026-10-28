import { TextSwapDirective } from '@shared/directives/text-swap.directive';
import {
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SelectModule } from 'primeng/select';
import { filter, finalize, switchMap } from 'rxjs';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentApplicationsService,
  type ParentCatalogClass,
  type ParentEnrollmentRequest,
} from '@core/parent-applications.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { todayLocal } from '@shared/utils/session-time.util';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import { effectiveFromSuffix } from '@shared/utils/schedule-effective.util';

/**
 * 家長端加選課程（#1727 ⑤，A6 p-add-course，設計稿 kb/wiki/specs/parent/applications.md）。
 *
 * - 用家長端共用的孩子切換器（不加「新增孩子」，新孩子走公開報名頁）
 * - 依孩子年級（目錄 `matchesGrade`）、排除已在班上（`enrolled`）、推薦優先；工具列科目／星期／關鍵字
 * - 撞時間（目錄 `conflictsWith`）琥珀字標在卡片與詳情
 * - 詳情 →「加選此課程」→ 繳費週期、開始日期、備註 → 送報名申請（帶 `billingMode`）→「繼續瀏覽／查看申請狀態」
 * - 額滿 →「登記候補」（只問備註，送 `waitlist: true`）
 * - 已送出／已登記候補：由報名申請列表算（同一個孩子、同一班、還在處理中）
 */

type Mode = 'monthly' | 'period';
type Step = 'detail' | 'apply' | 'done';

const WEEKDAY = ['', '一', '二', '三', '四', '五', '六', '日'];
const PER = { monthly: '月', period: '期', session_pack: '堂數包' } as const;
const SENT = ['pending', 'awaiting_payment'];

@Component({
  selector: 'app-add-course',
  standalone: true,
  imports: [
    TextSwapDirective,
    PageOpenComponent,
    ChildScopeGateComponent,
    ChildSwitcherComponent,
    RouterLink,
    FormsModule,
    SelectModule,
  ],
  templateUrl: './add-course.component.html',
})
export class AddCourseComponent {
  readonly page = input.required<RouteObj>();

  private readonly api = inject(ParentApplicationsService);
  private readonly childScope = inject(ChildScopeService);

  protected readonly kid = this.childScope.activeChild;
  protected readonly today = todayLocal();
  protected readonly classes = signal<ParentCatalogClass[]>([]);
  private readonly requests = signal<ParentEnrollmentRequest[]>([]);

  // ── 工具列 ──
  protected readonly q = signal('');
  protected readonly subject = signal<string | null>(null);
  protected readonly weekday = signal<number | null>(null);
  // A6 只列週一～六；DB 與管理端開班都有週日（7），補上，不然週日的班篩不出來（R5 2026-10-19）
  protected readonly weekdayOptions = [1, 2, 3, 4, 5, 6, 7].map((w) => ({
    label: `週${WEEKDAY[w]}`,
    value: w,
  }));

  // ── 詳情／申請對話框 ──
  protected readonly open = signal<ParentCatalogClass | null>(null);
  protected readonly step = signal<Step>('detail');
  protected readonly mode = signal<Mode | null>(null);
  protected readonly start = signal('');
  protected readonly note = signal('');
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);
  /** 這次送出的是候補（完成畫面的文案不同） */
  protected readonly wasWaitlist = signal(false);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  /** 這個孩子能加選的班：年級對、還沒在班上；推薦的排前面 */
  protected readonly pool = computed(() =>
    this.classes()
      .filter((c) => c.matchesGrade && !c.enrolled)
      .sort((a, b) => Number(b.isRecommended) - Number(a.isRecommended)),
  );

  protected readonly subjectOptions = computed(() =>
    [
      ...new Set(
        this.pool()
          .map((c) => c.subject)
          .filter((s): s is string => !!s),
      ),
    ].map((s) => ({
      label: s,
      value: s,
    })),
  );

  protected readonly filtered = computed(
    () => !!this.q().trim() || !!this.subject() || !!this.weekday(),
  );

  protected readonly list = computed(() => {
    const q = this.q().trim();
    return this.pool().filter(
      (c) =>
        (!q || `${c.className}${c.subject ?? ''}${c.courseName ?? ''}`.includes(q)) &&
        (!this.subject() || c.subject === this.subject()) &&
        (!this.weekday() || c.slots.some((s) => s.weekday === this.weekday())),
    );
  });

  protected readonly missing = computed(() =>
    this.step() === 'apply' && !this.isFull(this.open()) && !this.start() ? ['開始日期'] : [],
  );

  constructor() {
    this.childScope.load();
    this.loadRequests();
    // switchMap：快速換孩子時丟掉前一個孩子還沒回來的目錄
    toObservable(this.childScope.activeChildId)
      .pipe(
        filter((id): id is string => !!id),
        switchMap((id) => this.api.catalog(id)),
        takeUntilDestroyed(),
      )
      .subscribe({ next: (res) => this.classes.set(res.data) });
  }

  protected clear(): void {
    this.q.set('');
    this.subject.set(null);
    this.weekday.set(null);
  }

  protected isFull(c: ParentCatalogClass | null): boolean {
    return (c?.remainingSeats ?? 1) <= 0;
  }

  /** 這個孩子在這班的申請：還在處理中 → 'sent'；候補中 → 'waitlist' */
  protected applied(c: ParentCatalogClass): 'sent' | 'waitlist' | null {
    const mine = this.requests().filter(
      (r) => r.studentId === this.kid()?.id && r.classId === c.classId,
    );
    if (mine.some((r) => SENT.includes(r.status))) return 'sent';
    if (mine.some((r) => r.status === 'waitlist')) return 'waitlist';
    return null;
  }

  protected slotText(c: ParentCatalogClass): string {
    return c.slots
      .map(
        (s) =>
          `每週${WEEKDAY[s.weekday]} ${s.startTime}–${s.endTime}${effectiveFromSuffix(s.effectiveFrom)}`,
      )
      .join('、');
  }

  protected metaText(c: ParentCatalogClass): string {
    return [this.slotText(c), ...c.teacherNames].filter(Boolean).join(' · ');
  }

  protected feeText(c: ParentCatalogClass): string | null {
    return c.fee ? `${c.fee.amount.toLocaleString('zh-TW')} 元／${PER[c.fee.billingMode]}` : null;
  }

  protected seatText(c: ParentCatalogClass): string {
    if (c.remainingSeats > 0) return `剩 ${c.remainingSeats} 位`;
    return this.applied(c) === 'waitlist' ? '已登記候補' : '已額滿 · 可登記候補';
  }

  // ── 對話框 ──
  protected show(c: ParentCatalogClass): void {
    this.open.set(c);
    this.step.set('detail');
    queueMicrotask(() => this.dialog()?.nativeElement.showModal());
  }

  protected close(): void {
    this.dialog()?.nativeElement.close();
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  protected onClosed(): void {
    this.open.set(null);
  }

  /** 「加選此課程」／「登記候補」：班有啟用中的預設範本（月繳或期繳）就預選那個，家長可以改 */
  protected toApply(c: ParentCatalogClass): void {
    const m = c.fee?.billingMode;
    this.mode.set(m === 'monthly' || m === 'period' ? m : null);
    this.start.set('');
    this.note.set('');
    this.sendError.set(null);
    this.step.set('apply');
  }

  protected submit(): void {
    const c = this.open();
    const kid = this.kid();
    if (!c || !kid || this.sending() || this.missing().length) return;
    const waitlist = this.isFull(c);
    this.sending.set(true);
    this.sendError.set(null);
    this.api
      .createEnrollmentRequest({
        studentId: kid.id,
        classId: c.classId,
        preferredStartDate: waitlist ? undefined : this.start(),
        note: this.note().trim() || undefined,
        billingMode: waitlist ? undefined : (this.mode() ?? undefined),
        waitlist,
      })
      // finalize：成功、失敗都解除「送出中」（kb/wiki/lessons/submit-busy-flag-finalize.md）
      .pipe(finalize(() => this.sending.set(false)))
      .subscribe({
        next: () => {
          this.wasWaitlist.set(waitlist);
          this.step.set('done');
          this.loadRequests();
        },
        error: (err) => {
          // 錯誤留在表單、填的不清（CLASS_FULL：剛好被搶走最後一位 → 重抓目錄，按鈕會變「登記候補」）
          this.sendError.set(err?.error?.error ?? '送出失敗，請檢查網路後再試');
          if (err?.error?.code === 'CLASS_FULL') {
            this.api.catalog(kid.id).subscribe({
              next: (res) => {
                this.classes.set(res.data);
                this.open.set(res.data.find((x) => x.classId === c.classId) ?? c);
              },
            });
          }
        },
      });
  }

  protected modeLabel(m: Mode | null): string {
    return m === 'monthly' ? '月繳' : m === 'period' ? '期繳' : '跟補習班確認';
  }

  private loadRequests(): void {
    this.api.enrollmentRequests().subscribe({ next: (res) => this.requests.set(res.data) });
  }
}
