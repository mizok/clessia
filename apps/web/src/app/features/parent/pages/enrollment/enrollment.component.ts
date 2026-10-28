import {
  Component,
  computed,
  linkedSignal,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { filter, finalize, switchMap } from 'rxjs';
import { format, parseISO } from 'date-fns';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import {
  ParentApplicationsService,
  type EnrollmentRequestStatus,
  type ParentCatalogClass,
  type ParentEnrollmentRequest,
} from '@core/parent-applications.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { todayLocal } from '@shared/utils/session-time.util';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import {
  REQUEST_TAG_CLASS,
  RequestRowComponent,
  type RequestTagTone,
} from '../../shared/request-row/request-row.component';
import { effectiveFromSuffix } from '@shared/utils/schedule-effective.util';

/**
 * 家長端報名申請（#1727 ③，A6 p-enrollment，設計稿 kb/wiki/specs/parent/applications.md）。
 *
 * - 兩分頁「新增申請／申請紀錄」（`#records`）。**不用頁首孩子切換器**：表單裡選孩子、紀錄混列所有孩子（A6）
 * - 選班：依科目分組、可搜尋；已在班上（目錄 `enrolled`）、申請中、已登記候補的列出但不能選、寫原因
 * - 額滿的班送出鈕變「登記候補」（使用者 10/03 裁），送 `waitlist: true`
 * - 待付款：詳情顯示這筆申請自己的帳單（金額、期限、已收）與申請班級分校的帳戶（A6，#1726 §3）；
 *   帳單被作廢沒重開時退回「請到繳費頁」
 * - 取消：待審核、候補都可以（Q8）。API 的取消不能復原，所以 toast 沒有「復原」
 */

type Tab = 'new' | 'records';

const STATUS: Record<EnrollmentRequestStatus, [string, RequestTagTone]> = {
  pending: ['待審核', 'quiet'],
  awaiting_payment: ['待付款', 'warn'],
  completed: ['已完成', 'ok'],
  rejected: ['已拒絕', 'error'],
  cancelled: ['已取消', 'off'],
  expired: ['已過期', 'off'],
  waitlist: ['已登記候補', 'line'],
};

const WEEKDAY = ['', '一', '二', '三', '四', '五', '六', '日'];
const PER = { monthly: '月', period: '期', session_pack: '堂數包' } as const;

@Component({
  selector: 'app-enrollment',
  standalone: true,
  imports: [PageOpenComponent, ChildScopeGateComponent, RequestRowComponent, RouterLink],
  templateUrl: './enrollment.component.html',
})
export class EnrollmentComponent {
  readonly page = input.required<RouteObj>();

  private readonly api = inject(ParentApplicationsService);
  private readonly childScope = inject(ChildScopeService);
  private readonly messages = inject(MessageService);

  protected readonly tab = signal<Tab>(
    inject(ActivatedRoute).snapshot.fragment === 'records' ? 'records' : 'new',
  );
  protected readonly kids = this.childScope.children;
  protected readonly today = todayLocal();

  // ── 新增申請 ──
  /** 預設選「目前在看的孩子」（共用切換器記住的那一個），少一步 */
  // linkedSignal：直接打開這頁時孩子名單還沒載完，activeChildId 晚到 —— 跟著它走，家長自己選了才固定
  protected readonly sid = linkedSignal<string>(() => this.childScope.activeChildId() ?? '');
  protected readonly cid = signal('');
  protected readonly q = signal('');
  protected readonly start = signal('');
  protected readonly note = signal('');
  protected readonly classes = signal<ParentCatalogClass[]>([]);
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);

  // ── 申請紀錄 ──
  protected readonly requests = signal<ParentEnrollmentRequest[]>([]);
  protected readonly detail = signal<ParentEnrollmentRequest | null>(null);
  protected readonly cancelling = signal(false);
  private readonly detailDialog = viewChild<ElementRef<HTMLDialogElement>>('detailDialog');

  protected readonly status = STATUS;
  protected readonly tagClass = REQUEST_TAG_CLASS;

  protected readonly headline = computed(() => {
    const pay = this.requests().filter((r) => r.status === 'awaiting_payment').length;
    const wait = this.requests().filter((r) => r.status === 'pending').length;
    if (!pay && !wait) return { first: '申請都處理完了。', second: null };
    const parts = [pay && `${pay} 筆等你繳費`, wait && `${wait} 筆在等補習班審核`].filter(
      (p): p is string => !!p,
    );
    return parts.length === 2
      ? { first: `${parts[0]}，`, second: `${parts[1]}。` }
      : { first: `${parts[0]}。`, second: null };
  });

  protected readonly sorted = computed(() =>
    [...this.requests()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
  );

  /** 依科目分組（沒有科目用課程名），搜尋課程或班名 */
  protected readonly groups = computed(() => {
    const q = this.q().trim();
    const list = this.classes().filter(
      (c) => !q || `${c.className}${c.subject ?? ''}${c.courseName ?? ''}`.includes(q),
    );
    const bySubject = new Map<string, ParentCatalogClass[]>();
    for (const c of list) {
      const key = c.subject ?? c.courseName ?? '其他';
      bySubject.set(key, [...(bySubject.get(key) ?? []), c]);
    }
    return [...bySubject].map(([subject, items]) => ({ subject, items }));
  });

  protected readonly selected = computed(
    () => this.classes().find((c) => c.classId === this.cid()) ?? null,
  );
  protected readonly isFull = computed(() => (this.selected()?.remainingSeats ?? 1) <= 0);

  protected readonly missing = computed(() =>
    [!this.sid() && '孩子', !this.cid() && '開課班', !this.start() && '開始日期'].filter(
      (m): m is string => !!m,
    ),
  );

  constructor() {
    this.childScope.load();
    this.loadRequests();
    // switchMap：快速換孩子時丟掉前一個孩子還沒回來的目錄，免得晚到的舊回應蓋掉新孩子的
    toObservable(this.sid)
      .pipe(
        filter(Boolean),
        switchMap((sid) => this.api.catalog(sid)),
        takeUntilDestroyed(),
      )
      .subscribe({ next: (res) => this.classes.set(res.data) });
  }

  protected gradeLabel(grade: string | null): string {
    return GRADE_LEVEL_LABELS[grade as GradeLevel] ?? grade ?? '';
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    history.replaceState(null, '', tab === 'records' ? '#records' : location.pathname);
  }

  protected pickKid(id: string): void {
    this.sid.set(id);
    this.cid.set('');
  }

  /** 不能選的原因：已在班上、申請中、已登記候補；可以選 → null */
  protected busy(c: ParentCatalogClass): string | null {
    if (c.enrolled) return '已在班上';
    const mine = this.requests().filter(
      (r) => r.studentId === this.sid() && r.classId === c.classId,
    );
    if (mine.some((r) => r.status === 'pending' || r.status === 'awaiting_payment'))
      return '申請中';
    if (mine.some((r) => r.status === 'waitlist')) return '已登記候補';
    return null;
  }

  protected slotText(c: ParentCatalogClass): string {
    const slots = c.slots.map(
      (s) =>
        `每週${WEEKDAY[s.weekday]} ${s.startTime}–${s.endTime}${effectiveFromSuffix(s.effectiveFrom)}`,
    );
    return [...slots, ...c.teacherNames].join(' · ');
  }

  protected feeText(c: ParentCatalogClass): string | null {
    return c.fee ? `${c.fee.amount.toLocaleString('zh-TW')} 元／${PER[c.fee.billingMode]}` : null;
  }

  protected submit(): void {
    if (this.sending() || this.missing().length) return;
    const kid = this.kids().find((k) => k.id === this.sid());
    const c = this.selected()!;
    const waitlist = this.isFull();
    this.sending.set(true);
    this.sendError.set(null);
    this.api
      .createEnrollmentRequest({
        studentId: this.sid(),
        classId: this.cid(),
        preferredStartDate: this.start(),
        note: this.note().trim() || undefined,
        waitlist,
      })
      // finalize：成功、失敗都解除「送出中」（kb/wiki/lessons/submit-busy-flag-finalize.md）
      .pipe(finalize(() => this.sending.set(false)))
      .subscribe({
        next: () => {
          this.messages.add({
            severity: 'success',
            summary: waitlist
              ? '已額滿，已為您登記候補，補習班會主動聯絡'
              : `已送出 ${kid?.name ?? ''}「${c.className}」的申請，補習班審核後會通知你`,
          });
          this.cid.set('');
          this.q.set('');
          this.loadRequests();
          this.setTab('records');
        },
        error: (err) => {
          // 錯誤留在表單、填的不清（CLASS_FULL：剛好被搶走最後一個位子 → 重抓目錄，按鈕會變「登記候補」）
          this.sendError.set(err?.error?.error ?? '送出失敗，請檢查網路後再試');
          if (err?.error?.code === 'CLASS_FULL') {
            this.api.catalog(this.sid()).subscribe({ next: (res) => this.classes.set(res.data) });
          }
        },
      });
  }

  // ── 詳情 ──
  protected openDetail(r: ParentEnrollmentRequest): void {
    this.detail.set(r);
    queueMicrotask(() => this.detailDialog()?.nativeElement.showModal());
  }

  protected closeDetail(): void {
    this.detailDialog()?.nativeElement.close();
  }

  protected onDetailBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeDetail();
  }

  protected canCancel(r: ParentEnrollmentRequest): boolean {
    return r.status === 'pending' || r.status === 'waitlist';
  }

  protected cancel(r: ParentEnrollmentRequest): void {
    if (this.cancelling()) return;
    this.cancelling.set(true);
    this.api
      .cancelEnrollmentRequest(r.id)
      .pipe(finalize(() => this.cancelling.set(false)))
      .subscribe({
        next: () => {
          this.closeDetail();
          this.messages.add({ severity: 'success', summary: `已取消 ${r.className ?? ''} 的申請` });
          this.loadRequests();
        },
        error: (err) => {
          this.messages.add({
            severity: 'error',
            summary: err?.error?.error ?? '取消失敗，請稍後再試',
          });
        },
      });
  }

  protected money(n: number): string {
    return n.toLocaleString('zh-TW');
  }

  protected md(iso: string | null): string {
    return iso ? format(parseISO(iso), 'M/d') : '';
  }

  protected meta(r: ParentEnrollmentRequest): string {
    return `${r.studentName ?? ''} · ${this.md(r.createdAt)} 送出`;
  }

  /** 時間軸（rules/enrollment-rules.md §1 的狀態機）：已走過的實心、還沒到的空心 */
  protected steps(r: ParentEnrollmentRequest): Array<{ text: string; done: boolean; at?: string }> {
    const sent = { text: '送出申請', done: true, at: this.md(r.createdAt) };
    const todo = (text: string) => ({ text, done: false });
    const done = (text: string) => ({ text, done: true });
    switch (r.status) {
      case 'pending':
        return [sent, todo('補習班審核'), todo('繳費'), todo('完成報名')];
      case 'awaiting_payment':
        return [sent, done('審核通過，開立繳費單'), todo('繳費（櫃台確認收款）'), todo('完成報名')];
      case 'completed':
        return [sent, done('審核通過，開立繳費單'), done('補習班確認收款'), done('完成報名')];
      case 'rejected':
        return [sent, done('未通過審核')];
      case 'cancelled':
        return [sent, done('你取消了這筆申請')];
      case 'waitlist':
        return [
          { text: '登記候補（這班已額滿）', done: true, at: this.md(r.createdAt) },
          todo('有名額時補習班會主動聯絡'),
        ];
    }
    // expired：enum 有這個值，但沒有任何路徑會走到（不自動過期，R5 2026-10-21／#1758）。
    // 不替它編一段「繳費期限已過」的故事，只留送出那一步
    return [sent];
  }

  private loadRequests(): void {
    this.api.enrollmentRequests().subscribe({ next: (res) => this.requests.set(res.data) });
  }
}
