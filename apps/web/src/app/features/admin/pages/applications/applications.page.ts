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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MessageService, type MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogService } from 'primeng/dynamicdialog';
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
  type TrialSchedule,
} from '@core/parent-requests.service';
import { AuthService } from '@core/auth.service';
import { GRADE_LEVEL_LABELS } from '@core/students.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';
import { ParentFormDialogComponent } from '@shared/components/parent-form-dialog/parent-form-dialog.component';
import { ApproveRequestDialogComponent } from './approve-request-dialog/approve-request-dialog.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

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

const TRIAL_STATUS_LABELS: Record<string, string> = {
  pending: '待安排',
  scheduled: '已排定',
  completed: '已完成',
  cancelled: '已取消',
};

type Item =
  | { source: 'public'; createdAt: string; value: PublicApplication }
  | { source: 'parent'; createdAt: string; value: ParentRequest };

/**
 * 章＝這一筆要你做什麼（#1874，使用者 10-22 確認）：家長 App 的報名（核准）、家長 App 的試聽（排時間）、
 * 公開表單（新家長，聯絡過再建檔；報名、試聽都在這章）。狀態已經是工具列的分頁，不再拿來分章
 */
type ChapterKey = 'enroll' | 'trial' | 'lead';
const CHAPTERS: ReadonlyArray<{ key: ChapterKey; name: string; sub: string }> = [
  { key: 'enroll', name: '報名', sub: '家長在 app 送的。核准會建報名並開首期帳單' },
  { key: 'trial', name: '試聽', sub: '排好時間家長端會看到' },
  { key: 'lead', name: '新家長', sub: '公開表單送進來的。聯絡過再建檔' },
];
const chapterOf = (item: Item): ChapterKey =>
  item.source === 'public' ? 'lead' : item.value.kind === 'trial' ? 'trial' : 'enroll';

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
 * 版面（#1874，A6 沒畫這頁，零件借自家長／報名進出頁）：色面句 → 灰帶工具列（搜尋、狀態、類型）→
 * 依要做的事分章 → 一筆一列，主動作在列上、其餘收進「⋯」。規格：kb/wiki/specs/admin/enrollment/enrollment-requests.md「版面」
 */
@Component({
  selector: 'app-applications',
  imports: [
    SkeletonComponent,
    DatePipe,
    FormsModule,
    RouterLink,
    ButtonModule,
    TextareaModule,
    PageOpenComponent,
    ChapterHeadComponent,
    PopupMenuComponent,
    SelectFieldComponent,
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
  private readonly router = inject(Router);
  private readonly approveDialog = viewChild<ElementRef<HTMLDialogElement>>('approveDialog');

  /** 核准會開帳單：收件頁的 manage_students 之外還要 manage_finance（spec Q6） */
  private readonly auth = inject(AuthService);
  protected readonly canApprove = computed(() => this.auth.hasPermission('manage_finance'));

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly filters = FILTERS;
  protected readonly kindOptions: SelectFieldOption<'enrollment' | 'trial' | null>[] = [
    { label: '全部類型', value: null },
    { label: '報名', value: 'enrollment' },
    { label: '試聽', value: 'trial' },
  ];
  protected readonly gradeLabels = GRADE_LEVEL_LABELS;
  protected readonly relationLabels = RELATION_LABELS;
  protected readonly parentStatusLabels = PARENT_STATUS_LABELS;
  protected readonly trialStatusOptions = TRIAL_STATUS_OPTIONS;
  protected readonly trialStatusLabels = TRIAL_STATUS_LABELS;
  protected readonly publicStatusLabels = Object.fromEntries(
    STATUS_OPTIONS.map((o) => [o.value, o.label]),
  ) as Record<PublicApplicationStatus, string>;

  protected readonly filter = signal(FILTERS[0]!);
  /**
   * 通知連過來會帶 `?kind=enrollment|trial`（#1821 申請提醒，點了要落在對應分頁）；其他值當沒帶。
   * 只在進頁時讀一次，之後切換不回寫網址
   */
  protected readonly kind = signal<'enrollment' | 'trial' | null>(
    ((k) => (k === 'enrollment' || k === 'trial' ? k : null))(
      inject(ActivatedRoute).snapshot.queryParamMap.get('kind'),
    ),
  );
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
  /** 工具列搜尋：只在已載入的清單裡找（學生、家長姓名或電話），不另外打 API */
  protected readonly query = signal('');
  private readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.items();
    const digits = q.replace(/\D/g, '');
    return this.items().filter(({ value: v }) => {
      const names = [v.student.name, v.parent.name ?? ''].join(' ').toLowerCase();
      return names.includes(q) || (!!digits && (v.parent.phone ?? '').includes(digits));
    });
  });
  /** 依「要做的事」分章；沒有筆數的章不畫。章內維持時間序（新的在前） */
  protected readonly chapters = computed(() =>
    CHAPTERS.map((c) => ({
      ...c,
      items: this.shown().filter((i) => chapterOf(i) === c.key),
    })).filter((c) => c.items.length > 0),
  );
  /** 色面句要的兩個數：這個分頁有幾筆、家長 App 的試聽還有幾堂沒排 */
  protected readonly total = computed(() => this.items().length);
  protected readonly unscheduledTrials = computed(
    () => this.requests().filter((r) => r.kind === 'trial' && r.status === 'pending').length,
  );

  /** 待處理分頁的色面句：第一句、（有沒排的試聽才有的）第二句 */
  protected readonly headline = computed<[string, string | null]>(() => {
    const n = this.total();
    const m = this.unscheduledTrials();
    if (n === 0) return ['沒有待處理的申請。', null];
    return m > 0
      ? [`${n} 筆申請等你處理，`, `${m} 堂試聽還沒排時間。`]
      : [`${n} 筆申請等你處理。`, null];
  });

  /** 列動作選單：全頁一份，打開時依那一列重算（同家長頁） */
  private readonly rowMenu = viewChild.required<PopupMenuComponent>('rowMenu');
  private readonly menuFor = signal<Item | null>(null);
  protected readonly rowMenuItems = computed<MenuItem[]>(() => {
    const item = this.menuFor();
    if (!item) return [];
    if (item.source === 'public') {
      const a = item.value;
      return [
        ...STATUS_OPTIONS.filter((o) => o.value !== a.status).map((o) => ({
          label: `改成「${o.label}」`,
          command: () => this.setStatus(a, o.value),
        })),
        { separator: true },
        { label: '櫃檯備註', icon: 'pi pi-pencil', command: () => this.notingId.set(a.id) },
      ];
    }
    const r = item.value;
    const profile: MenuItem = {
      label: '查看學生檔案',
      icon: 'pi pi-user',
      command: () => void this.router.navigate(['/admin/students', r.student.id]),
    };
    if (r.kind === 'trial') {
      return [
        // 已排定只走「排時間／改時間」（要填日期，#1747）
        ...TRIAL_STATUS_OPTIONS.filter((o) => o.value !== r.status && o.value !== 'scheduled').map(
          (o) => ({ label: `改成「${o.label}」`, command: () => this.setTrialStatus(r, o.value) }),
        ),
        { separator: true },
        profile,
      ];
    }
    return [
      ...(this.canReject(r)
        ? [{ label: '拒絕…', icon: 'pi pi-times', command: () => this.startReject(r) }]
        : []),
      profile,
    ];
  });
  protected openRowMenu(event: Event, item: Item): void {
    this.menuFor.set(item);
    this.rowMenu().toggle(event);
  }

  /** 正在編輯櫃檯備註的那一筆（從「⋯」打開，#1874；原本一直攤在卡片上） */
  protected readonly notingId = signal<string | null>(null);

  /** 正在核准的那一筆（對話框開著） */
  protected readonly approving = signal<ParentRequest | null>(null);
  /** 正在填拒絕原因的那一筆 */
  protected readonly rejectingId = signal<string | null>(null);
  /** 正在填試聽日期的那一筆（#1747：轉已排定、改時間都走這裡） */
  protected readonly schedulingId = signal<string | null>(null);
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

  /**
   * 「⋯ → 櫃檯備註」按儲存：**存成功才收起**。失敗時編輯列留著、打的字還在，跳錯誤讓人重按
   * （二讀：原本送出就收起，失敗時字直接不見）。沒改就直接收起，不送
   */
  protected submitNote(app: PublicApplication, value: string): void {
    const note = value.trim() || null;
    if (note === (app.staffNote ?? null)) {
      this.notingId.set(null);
      return;
    }
    this.patch(app, { staffNote: note }, () => this.notingId.set(null));
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
    if (status === 'scheduled') {
      // 已排定要先填日期（#1747）：下拉先彈回原狀態，填完按確定才送
      this.replaceRequest({ ...r });
      this.schedulingId.set(r.id);
      return;
    }
    this.sendTrialStatus(r, status);
  }

  /** 日期必填（後端也擋）；時間選填，空字串不送 */
  protected submitSchedule(r: ParentRequest, date: string, start: string, end: string): void {
    if (!date) return;
    this.sendTrialStatus(r, 'scheduled', {
      scheduledDate: date,
      ...(start ? { scheduledStartTime: start } : {}),
      ...(end ? { scheduledEndTime: end } : {}),
    });
  }

  private sendTrialStatus(
    r: ParentRequest,
    status: TrialRequestStatus,
    schedule?: TrialSchedule,
  ): void {
    this.parentRequests.setTrialStatus(r.id, status, schedule).subscribe({
      next: (res) => {
        this.replaceRequest(res.data);
        this.schedulingId.set(null);
      },
      error: (err: { status?: number; error?: { error?: string } }) => {
        // 下拉已經在畫面上選了新值；換一個新物件讓它重畫回原本的狀態
        this.replaceRequest({ ...r });
        // 400＝日期或時間不合法（例：結束早於開始），把後端的原因說出來；表單留著讓人改
        const detail = err.status === 400 ? (err.error?.error ?? '日期或時間不合法') : '請稍後再試';
        this.messages.add({ severity: 'error', summary: '儲存失敗', detail });
      },
    });
  }

  /** `2026-11-04` → `11/4（三）`；本地時區解析，不會因 UTC 跨日 */
  protected mdw(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return `${m}/${d}（${'日一二三四五六'[new Date(y!, m! - 1, d).getDay()]}）`;
  }

  private replaceRequest(next: ParentRequest): void {
    this.requests.update((list) => list.map((r) => (r.id === next.id ? next : r)));
  }

  private patch(
    app: PublicApplication,
    patch: { status?: PublicApplicationStatus; staffNote?: string | null },
    onSaved?: () => void,
  ): void {
    this.service.update(app.id, patch).subscribe({
      next: (res) => {
        this.applications.update((list) => list.map((a) => (a.id === app.id ? res.data : a)));
        onSaved?.();
      },
      error: () =>
        this.messages.add({ severity: 'error', summary: '儲存失敗', detail: '請稍後再試' }),
    });
  }
}
