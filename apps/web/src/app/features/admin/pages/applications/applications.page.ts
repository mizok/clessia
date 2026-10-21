import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogService } from 'primeng/dynamicdialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { forkJoin, of } from 'rxjs';

import {
  PublicApplicationsService,
  type PublicApplication,
  type PublicApplicationStatus,
} from '@core/public-applications.service';
import {
  ParentRequestsService,
  type ParentRequest,
  type ParentRequestGroup,
  type TrialRequestStatus,
} from '@core/parent-requests.service';
import { AuthService } from '@core/auth.service';
import { GRADE_LEVEL_LABELS } from '@core/students.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ParentFormDialogComponent } from '@shared/components/parent-form-dialog/parent-form-dialog.component';
import { ApproveRequestDialogComponent } from './approve-request-dialog/approve-request-dialog.component';

const STATUS_OPTIONS: Array<{ label: string; value: PublicApplicationStatus }> = [
  { label: '新申請', value: 'new' },
  { label: '已聯絡', value: 'contacted' },
  { label: '已轉入', value: 'converted' },
  { label: '不受理', value: 'rejected' },
  { label: '垃圾送件', value: 'spam' },
];

/**
 * 篩選：同一個分頁對兩種來源各自的狀態（#1707 範圍說明 §2）。
 * 只有一邊有的分頁（進行中、已取消只有家長 App；垃圾送件只有公開表單），另一邊不打。
 */
const FILTERS: Array<{
  label: string;
  statuses: PublicApplicationStatus[];
  group: ParentRequestGroup | null;
}> = [
  { label: '待處理', statuses: ['new', 'contacted'], group: 'pending' },
  { label: '進行中', statuses: [], group: 'active' },
  { label: '已轉入', statuses: ['converted'], group: 'done' },
  { label: '不受理', statuses: ['rejected'], group: 'rejected' },
  { label: '已取消', statuses: [], group: 'cancelled' },
  { label: '垃圾送件', statuses: ['spam'], group: null },
];

/** 家長 App 申請的狀態標籤（報名、試聽兩套） */
const PARENT_STATUS_LABELS: Record<string, string> = {
  pending: '待審核',
  waitlist: '候補',
  awaiting_payment: '已核准・待繳費',
  completed: '已完成',
  rejected: '已拒絕',
  cancelled: '已取消',
  expired: '已過期',
};

const TRIAL_STATUS_OPTIONS: Array<{ label: string; value: TrialRequestStatus }> = [
  { label: '待安排', value: 'pending' },
  { label: '已排定', value: 'scheduled' },
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
];

/** 待審核、候補才能核准或拒絕；已核准（帳單開了）之後不能 —— 跟 API 的 409 同一條規則 */
const REJECTABLE = ['pending', 'waitlist'];

type Item =
  | { source: 'public'; createdAt: string; value: PublicApplication }
  | { source: 'parent'; createdAt: string; value: ParentRequest };

const RELATION_LABELS = { father: '父親', mother: '母親', other: '其他' } as const;

/**
 * 公開申請（#1245）：公開報名／試聽表單（#1123、#1124）送進來的、還沒建檔的人。
 * **＋家長在 app 裡送的申請（#1707）**：兩支 API 平行打、依時間合在一份；兩套狀態不合併，分頁共用。
 * 家長 App 的報名可核准（開帳單，#1726）或拒絕（原因家長看得到）；試聽改狀態。
 *
 * 狀態是聯絡流程，任意切換。「建立家長」開既有的新增家長表單並預填 ——
 * **不自動改狀態、不自動建學生或報名**：rules/enrollment-rules.md 1.4 是首次收款才建主資料，
 * 學生建檔、報名、開帳本來就有各自的流程與檢查（計畫席裁：自動轉檔上線用過再說）。
 *
 * 卡片清單而不是表格：行政多半在手機上處理（page-actions 的 80% 裁定），一筆申請的欄位又多。
 */
@Component({
  selector: 'app-applications',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    SelectModule,
    TextareaModule,
    PageOpenComponent,
    ApproveRequestDialogComponent,
  ],
  providers: [DialogService],
  templateUrl: './applications.page.html',
})
export class ApplicationsPage {
  private readonly service = inject(PublicApplicationsService);
  private readonly parentRequests = inject(ParentRequestsService);
  private readonly messages = inject(MessageService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly approveDialog = viewChild<ElementRef<HTMLDialogElement>>('approveDialog');

  /** 核准會開帳單：收件頁的 manage_students 之外還要 manage_finance（spec Q6） */
  private readonly auth = inject(AuthService);
  protected readonly canApprove = computed(() => this.auth.hasPermission('manage_finance'));

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly filters = FILTERS;
  protected readonly kindOptions = [
    { label: '全部', value: null },
    { label: '報名', value: 'enrollment' as const },
    { label: '試聽', value: 'trial' as const },
  ];
  protected readonly gradeLabels = GRADE_LEVEL_LABELS;
  protected readonly relationLabels = RELATION_LABELS;
  protected readonly parentStatusLabels = PARENT_STATUS_LABELS;
  protected readonly trialStatusOptions = TRIAL_STATUS_OPTIONS;

  protected readonly filter = signal(FILTERS[0]!);
  protected readonly kind = signal<'enrollment' | 'trial' | null>(null);
  protected readonly applications = signal<PublicApplication[]>([]);
  protected readonly requests = signal<ParentRequest[]>([]);
  /** 兩種來源依時間合在一份，新的在前 */
  protected readonly items = computed<Item[]>(() =>
    [
      ...this.applications().map((value) => ({
        source: 'public' as const,
        createdAt: value.createdAt,
        value,
      })),
      ...this.requests().map((value) => ({
        source: 'parent' as const,
        createdAt: value.createdAt,
        value,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  /** 正在核准的那一筆（對話框開著） */
  protected readonly approving = signal<ParentRequest | null>(null);
  /** 正在填拒絕原因的那一筆 */
  protected readonly rejectingId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    const { statuses, group } = this.filter();
    const kind = this.kind();
    // ponytail: 一邊失敗整頁算失敗（可重試）；真的常常一邊壞再改成各自顯示
    forkJoin([
      statuses.length > 0 ? this.service.list({ statuses, kind }) : of({ data: [] }),
      group ? this.parentRequests.list({ group, kind }) : of({ data: [] }),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([pub, parent]) => {
          this.applications.set(pub.data);
          this.requests.set(parent.data);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  protected setFilter(filter: (typeof FILTERS)[number]): void {
    this.filter.set(filter);
    this.load();
  }

  protected setKind(kind: 'enrollment' | 'trial' | null): void {
    this.kind.set(kind);
    this.load();
  }

  protected setStatus(app: PublicApplication, status: PublicApplicationStatus): void {
    if (status === app.status) return;
    this.patch(app, { status });
  }

  /** 失焦存；沒改不送 */
  protected saveNote(app: PublicApplication, value: string): void {
    const note = value.trim() || null;
    if (note === (app.staffNote ?? null)) return;
    this.patch(app, { staffNote: note });
  }

  protected createParent(app: PublicApplication): void {
    this.dialog.open(ParentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        parent: null,
        prefill: { name: app.parent.name, email: app.parent.email, phone: app.parent.phone },
      },
    });
  }

  protected canReject(r: ParentRequest): boolean {
    return r.kind === 'enrollment' && REJECTABLE.includes(r.status);
  }

  protected startReject(r: ParentRequest): void {
    this.rejectingId.set(r.id);
  }

  /** 原因必填（家長看得到）；空白不送 */
  protected submitReject(r: ParentRequest, value: string): void {
    const reason = value.trim();
    if (!reason) return;
    this.parentRequests.reject(r.id, reason).subscribe({
      next: (res) => {
        this.replaceRequest(res.data);
        this.rejectingId.set(null);
      },
      error: (err: { status?: number }) => {
        // 409＝被搶先核准（帳單開了）：再試也一樣，說清楚並重抓，讓卡片換成現在的狀態
        if (err.status === 409) {
          this.rejectingId.set(null);
          this.messages.add({
            severity: 'warn',
            summary: '這筆已經不是待審核',
            detail: '已重新整理',
          });
          this.load();
          return;
        }
        this.messages.add({ severity: 'error', summary: '拒絕失敗', detail: '請稍後再試' });
      },
    });
  }

  protected openApprove(r: ParentRequest): void {
    this.approving.set(r);
    // 等 @if 把表單畫進 dialog 再 showModal（焦點才落得到第一個欄位）
    queueMicrotask(() => this.approveDialog()?.nativeElement.showModal());
  }

  protected closeApprove(): void {
    this.approveDialog()?.nativeElement.close();
  }

  /** 點背景（dialog 本身，不是裡面的表單）關掉，同 A6 `form()` */
  protected onApproveBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeApprove();
  }

  /** 成功：toast 帳單編號、重抓（這筆移到「進行中」）；取消只關 */
  protected onApproveClosed(result: { invoiceNo: string | null } | null): void {
    this.closeApprove();
    if (!result) return;
    this.messages.add({
      severity: 'success',
      summary: `已核准，帳單 ${result.invoiceNo ?? ''} 已開`,
    });
    this.load();
  }

  protected setTrialStatus(r: ParentRequest, status: TrialRequestStatus): void {
    if (status === r.status) return;
    this.parentRequests.setTrialStatus(r.id, status).subscribe({
      next: (res) => this.replaceRequest(res.data),
      error: () => {
        // 下拉已經在畫面上選了新值；換一個新物件讓它重畫回原本的狀態
        this.replaceRequest({ ...r });
        this.messages.add({ severity: 'error', summary: '儲存失敗', detail: '請稍後再試' });
      },
    });
  }

  private replaceRequest(next: ParentRequest): void {
    this.requests.update((list) => list.map((r) => (r.id === next.id ? next : r)));
  }

  private patch(
    app: PublicApplication,
    patch: { status?: PublicApplicationStatus; staffNote?: string | null },
  ): void {
    this.service.update(app.id, patch).subscribe({
      next: (res) =>
        this.applications.update((list) => list.map((a) => (a.id === app.id ? res.data : a))),
      error: () =>
        this.messages.add({ severity: 'error', summary: '儲存失敗', detail: '請稍後再試' }),
    });
  }
}
