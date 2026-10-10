import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { endOfMonth, format, startOfMonth, subDays, subMonths } from 'date-fns';
import { SelectModule } from 'primeng/select';

import { Subject, catchError, map, of, skip, switchMap } from 'rxjs';
import { ClassesService, type Class } from '@core/classes.service';
import { BILLING_MODE_LABELS } from '@core/fee-templates.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { CampusContextService } from '@core/campus-context.service';
import { CampusScopeNoteComponent } from '@shared/components/campus-scope-note/campus-scope-note.component';
import {
  ENROLLMENT_STATUS_LABELS,
  EnrollmentsService,
  type Enrollment,
  type EnrollmentEventCounts,
  type EnrollmentEventKind,
  type EnrollmentListResponse,
  type EnrollmentStatus,
} from '@core/enrollments.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  GRADE_LEVEL_LABELS,
  StudentsService,
  type GradeLevel,
  type Student,
} from '@core/students.service';

import {
  EVENT_LABELS,
  leftNote,
  statusLabel,
  toEnrollmentEvent,
  type EnrollmentEvent,
} from './enrollment-event.util';
import { FilterToggleComponent } from '@shared/components/filter-toggle/filter-toggle.component';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

const PAGE_SIZE = LIST_PAGE_SIZE;
const MONTHS_BACK = 12;

/** 期間選項的「全部」—— 清空期間就退化成全部在籍的瀏覽 */
const ALL_MONTHS = '';
/** A6 的預設期間：月初那幾天整頁幾乎是空的，「近 30 天」才看得到動靜 */
const LAST_30 = 'last30';

interface EnrollmentRow {
  readonly enrollment: Enrollment;
  readonly event: EnrollmentEvent;
  /** 班名下面那行：「08/03–12/31 · 月繳」。沒有結束日寫「08/03 起」；計費模式沒填就不寫 */
  readonly periodText: string;
  /** 右欄第二行：新報名才有經手人（建立者）——暫停／退班是誰按的只在稽核裡，不編造 */
  readonly handlerText: string;
  /** 狀態欄：到期結束的 active 推導成「已結束」（#1314 EN Hero (c)） */
  readonly statusText: string;
  /** 「退班」pill 下的副行：辦理退班／到期結束；其他事件空字串 */
  readonly eventNote: string;
}

const EVENT_KINDS: readonly EnrollmentEventKind[] = ['joined', 'left', 'paused', 'voided'];

const monthDay = (date: string): string => date.slice(5).replace('-', '/');

import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
@Component({
  selector: 'app-enrollments',
  imports: [
    CampusScopeNoteComponent,
    FilterToggleComponent,
    StudentAutocompleteComponent,
    PageOpenComponent,
    DatePipe,
    FormsModule,
    RouterLink,
    SelectModule,
  ],
  templateUrl: './enrollments.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollmentsPage {
  readonly page = input.required<RouteObj>();

  private readonly enrollmentsService = inject(EnrollmentsService);
  /** 分校跟頂欄走（#1138）：頁內分校下拉拿掉 */
  private readonly campusCtx = inject(CampusContextService);
  private readonly router = inject(Router);
  private readonly studentsService = inject(StudentsService);
  private readonly classesService = inject(ClassesService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly EVENT_LABELS = EVENT_LABELS;
  /** 事件 pill 只用字＋細框，不用底色塊（A6：新報名黑框、退班紅、暫停／作廢灰）。完整 class 字串，Tailwind 才掃得到 */
  protected readonly PILL_CLASS: Record<EnrollmentEvent['kind'], string> = {
    joined: 'text-zinc-900 ring-[1.5px] ring-zinc-900',
    left: 'text-error-700 ring-1 ring-error-200',
    paused: 'text-zinc-600 ring-1 ring-zinc-300',
    voided: 'text-zinc-600 ring-1 ring-zinc-300',
  };
  protected readonly STATUS_LABELS = ENROLLMENT_STATUS_LABELS;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly enrollments = signal<Enrollment[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);

  protected readonly month = signal(LAST_30);
  protected readonly status = signal<EnrollmentStatus | null>(null);
  /** 事件篩選（#1507）：期間內發生過這件事的列。跟「狀態」不同 —— 狀態是現在的狀態 */
  protected readonly event = signal<EnrollmentEventKind | null>(null);
  /** 期間內各事件的次數；null ＝載入中或失敗，Hero 不寫數字（#1524：載入中不能說成「沒有」） */
  protected readonly counts = signal<EnrollmentEventCounts | null>(null);
  /** 只讀一次：事件歸類與「已結束」都比今天，跟 API 的 left 截到今天同一個判準 */
  private readonly today = format(new Date(), 'yyyy-MM-dd');
  private readonly listReload$ = new Subject<void>();
  private readonly countsReload$ = new Subject<void>();
  /** 學生篩選＝選一個人（帶 studentId），不是文字搜尋：API 只收 id（#1314 EN3） */
  protected readonly studentValue = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);
  private readonly studentId = signal<string | null>(null);
  protected readonly classId = signal<string | null>(null);
  protected readonly classOptions = signal<{ label: string; value: string | null }[]>([
    { label: '全部班級', value: null },
  ]);
  protected readonly filtersOpen = signal(false);
  private readonly campusId = this.campusCtx.id;

  protected readonly monthOptions = [
    { label: '近 30 天', value: LAST_30 },
    ...Array.from({ length: MONTHS_BACK }, (_, i) => {
      const date = subMonths(new Date(), i);
      return { label: format(date, 'yyyy 年 M 月'), value: format(date, 'yyyy-MM') };
    }),
    { label: '不限期間', value: ALL_MONTHS },
  ];

  /**
   * 刻意不放「待繳費」：目前沒有任何流程會產生 pending_payment（invoices 表還不存在），
   * 放一個永遠是空的篩選只會讓人以為系統壞了。M3 做金流時再加。
   */
  protected readonly statusOptions = [
    { label: '全部狀態', value: null as EnrollmentStatus | null },
    ...(['active', 'suspended', 'withdrawal', 'void'] as const).map((value) => ({
      label: ENROLLMENT_STATUS_LABELS[value],
      value: value as EnrollmentStatus | null,
    })),
  ];

  protected readonly eventOptions = [
    { label: '全部事件', value: null as EnrollmentEventKind | null },
    ...EVENT_KINDS.map((value) => ({
      label: EVENT_LABELS[value],
      value: value as EnrollmentEventKind | null,
    })),
  ];

  /**
   * 照 A6：計數跟著所有篩選走，**包括事件** —— 選「退班」時新報名寫 0（計畫席 10-10 裁 (a)）。
   * 後端的計數不收 event（一筆報名可以同時是新報名又是退班，帶進去會變成交集），
   * 所以這裡把沒選到的事件歸零：A6 的列是事件，篩了退班，剩下的就全是退班。
   */
  protected readonly shownCounts = computed<EnrollmentEventCounts | null>(() => {
    const counts = this.counts();
    const event = this.event();
    if (!counts || !event) return counts;
    return { joined: 0, left: 0, paused: 0, voided: 0, [event]: counts[event] };
  });
  protected readonly EVENT_KINDS = EVENT_KINDS;

  /** Hero：「近 30 天新報名 N 筆，退班 M 筆。」；全是 0 寫「…沒有報名進出。」；沒有數字就是頁名 */
  protected readonly heroTitle = computed(() => {
    const counts = this.shownCounts();
    if (!counts) return null;
    const period = this.periodLabel();
    return EVENT_KINDS.every((kind) => counts[kind] === 0)
      ? { empty: `${period}沒有報名進出。` }
      : { joined: `${period}新報名 ${counts.joined} 筆，`, left: `退班 ${counts.left} 筆。` };
  });

  protected readonly rows = computed<EnrollmentRow[]>(() =>
    this.enrollments().map((enrollment) => {
      const event = toEnrollmentEvent(enrollment, this.today, this.event());
      const span = enrollment.effectiveTo
        ? `${monthDay(enrollment.effectiveFrom)}–${monthDay(enrollment.effectiveTo)}`
        : `${monthDay(enrollment.effectiveFrom)} 起`;
      const mode = enrollment.billingMode ? BILLING_MODE_LABELS[enrollment.billingMode] : null;
      const joined = event.kind === 'joined';
      return {
        enrollment,
        event,
        periodText: mode ? `${span} · ${mode}` : span,
        handlerText: joined && enrollment.createdByName ? enrollment.createdByName : '',
        statusText: statusLabel(enrollment, this.today),
        eventNote: event.kind === 'left' ? leftNote(enrollment) : '',
      };
    }),
  );

  protected readonly first = computed(() => (this.currentPage() - 1) * PAGE_SIZE);

  /** 分頁交給 app-responsive-table 內建的 paginator —— 表格與它的分頁不該被拆開 */
  protected readonly pagination = computed(() => ({
    first: this.first(),
    rows: PAGE_SIZE,
    totalRecords: this.total(),
  }));
  protected readonly hasPeriod = computed(() => this.month() !== ALL_MONTHS);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  /** 「篩選」鈕上的摘要：開了哪些（期間不算，它在工具列上看得到） */
  protected readonly filterSummary = computed(() => {
    const parts: string[] = [];
    const classId = this.classId();
    if (classId)
      parts.push(this.classOptions().find((o) => o.value === classId)?.label ?? '指定班級');
    const event = this.event();
    if (event) parts.push(EVENT_LABELS[event]);
    const status = this.status();
    if (status) parts.push(ENROLLMENT_STATUS_LABELS[status]);
    return parts.length > 0 ? parts.join(' · ') : '全部';
  });
  protected readonly hasFilter = computed(
    () =>
      this.studentId() !== null ||
      this.classId() !== null ||
      this.event() !== null ||
      this.status() !== null,
  );
  /** 空狀態與摘要用：「近 30 天」「10 月」「這段期間」 */
  protected readonly periodLabel = computed(() => {
    const month = this.month();
    if (month === LAST_30) return '近 30 天';
    if (month === ALL_MONTHS) return '這段期間';
    return `${Number(month.slice(5))} 月`;
  });

  constructor() {
    this.campusCtx.use();
    // 初次載入在下面；這裡只管之後頂欄換分校
    toObservable(this.campusId)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.resetToFirstPage());

    this.classesService
      .list({ pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) =>
          this.classOptions.set([
            { label: '全部班級', value: null },
            ...res.data.map((c: Class) => ({ label: c.name, value: c.id as string | null })),
          ]),
        // 班級清單掛了只是少一個篩選，不擋整頁
        error: () => undefined,
      });

    // 兩條都用 switchMap 收斂成最後一次的條件 —— 換得快時，先發的慢回應不能蓋掉後發的
    this.listReload$
      .pipe(
        switchMap(() =>
          this.enrollmentsService.list(this.listParams()).pipe(
            map((res): EnrollmentListResponse | null => res),
            catchError(() => of(null)),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.enrollments.set(res?.data ?? []);
        this.total.set(res?.meta.total ?? 0);
        this.loadError.set(res === null);
        this.loading.set(false);
      });
    this.countsReload$
      .pipe(
        switchMap(() =>
          this.enrollmentsService.getEventCounts(this.filterParams()).pipe(
            map((res): EnrollmentEventCounts | null => res.data),
            // 計數掛了 Hero 退回頁名、摘要不寫事件數，列表照常
            catchError(() => of(null)),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((counts) => this.counts.set(counts));

    this.resetToFirstPage();
  }

  protected onEventChange(value: EnrollmentEventKind | null): void {
    this.event.set(value);
    this.resetToFirstPage();
  }

  protected onMonthChange(value: string): void {
    this.month.set(value);
    this.resetToFirstPage();
  }

  protected onStatusChange(value: EnrollmentStatus | null): void {
    this.status.set(value);
    this.resetToFirstPage();
  }

  protected onStudentQuery(query: string): void {
    this.studentsService
      .list({ search: query, pageSize: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data),
        error: () => this.studentSuggestions.set([]),
      });
  }

  /** 選到人（物件）才帶 studentId；打字中或清空（字串／null）就退回不篩 */
  protected onStudentChange(value: Student | string | null): void {
    this.studentValue.set(value);
    const id = value !== null && typeof value === 'object' ? value.id : null;
    if (id === this.studentId()) return;
    this.studentId.set(id);
    this.resetToFirstPage();
  }

  protected onClassChange(value: string | null): void {
    this.classId.set(value);
    this.resetToFirstPage();
  }

  protected clearFilters(): void {
    this.studentValue.set(null);
    this.studentId.set(null);
    this.classId.set(null);
    this.event.set(null);
    this.status.set(null);
    this.resetToFirstPage();
  }

  /** 換頁不重查計數 —— 計數跟分頁無關 */
  protected onPageChange(page: number): void {
    this.currentPage.set(page);
    this.loadList();
  }

  /** 換篩選條件後停在第 3 頁沒有意義 —— 結果集已經不同了 */
  private resetToFirstPage(): void {
    this.currentPage.set(1);
    this.loadList();
    this.counts.set(null);
    this.countsReload$.next();
  }

  // J1/J2 沒轉成國一/國二——全站其他頁面都用中文年級（Tester #29）
  protected getGradeLabel(grade: string): string {
    return GRADE_LEVEL_LABELS[grade as GradeLevel] ?? grade;
  }

  /** 狀態變更的唯一入口是班級詳情頁，這裡只負責把人送過去 */
  protected studentRoute(id: string): string {
    return RoutesCatalog.ADMIN_STUDENT_DETAIL.absolutePath.replace(':id', id);
  }

  protected openClass(row: EnrollmentRow): void {
    this.router.navigate([
      '/admin/courses',
      row.enrollment.courseId,
      'classes',
      row.enrollment.classId,
    ]);
  }

  private loadList(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.listReload$.next();
  }

  /** 列表與計數共用的篩選；事件只給列表（計數的事件歸零在 shownCounts） */
  private filterParams() {
    return {
      ...this.periodParams(),
      status: this.status() ?? undefined,
      studentId: this.studentId() ?? undefined,
      classId: this.classId() ?? undefined,
      campusId: this.campusId() ?? undefined,
    };
  }

  private listParams() {
    return {
      ...this.filterParams(),
      event: this.event() ?? undefined,
      // 新報名的 updatedAt 是建立時間、退班的是退班時間 —— 兩種列的最後異動剛好等於事件日
      sort: 'updatedAt' as const,
      page: this.currentPage(),
      pageSize: PAGE_SIZE,
    };
  }

  private periodParams(): { from?: string; to?: string } {
    if (!this.hasPeriod()) return {};

    if (this.month() === LAST_30) {
      const today = new Date();
      return { from: format(subDays(today, 29), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
    }

    const [year, month] = this.month().split('-').map(Number);
    const base = new Date(year, month - 1, 1);

    return {
      from: format(startOfMonth(base), 'yyyy-MM-dd'),
      to: format(endOfMonth(base), 'yyyy-MM-dd'),
    };
  }
}
