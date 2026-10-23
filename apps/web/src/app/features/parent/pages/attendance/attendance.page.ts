import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { MessageService } from 'primeng/api';
import { type Subscription, catchError, forkJoin, map, of } from 'rxjs';
import { format, parseISO } from 'date-fns';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentAttendanceService,
  type ParentAttendanceDayRow,
} from '@core/parent-attendance.service';
import { SystemClockService, taipeiDateString, taipeiWallClock } from '@core/system-clock.service';
import { ParentSessionsService, type ParentSession } from '@core/parent-sessions.service';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LeaveFormDialogComponent } from '@shared/components/leave-form-dialog/leave-form-dialog.component';
import type { CreateLeaveInput } from '@core/leave.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import {
  ATTENDANCE_STATUS_LABELS,
  addDays,
  buildDays,
  heroLine,
  monthDay,
  rowStatus,
  sessionChipLabel,
} from './attendance.util';
import { injectViewTransition } from '@shared/utils/view-transition.util';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

type RangeMode = 'recent10' | 'recent30' | 'month';

const RANGE_OPTIONS: Array<{ label: string; value: RangeMode }> = [
  { label: '近 10 天', value: 'recent10' },
  { label: '近 30 天', value: 'recent30' },
  { label: '選月份', value: 'month' },
];

/** 近 30 天／選月份一次多畫幾天（A6 `st.shown += 14`）；近 10 天全畫 */
const DAYS_STEP = 14;

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    SkeletonComponent,
    PageOpenComponent,
    ChildSwitcherComponent,
    ChildScopeGateComponent,
    DataChipComponent,
    EmptyStateComponent,
    LeaveFormDialogComponent,
  ],
  templateUrl: './attendance.page.html',
})
export class AttendancePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly attendanceService = inject(ParentAttendanceService);
  private readonly sessionsService = inject(ParentSessionsService);
  private readonly messageService = inject(MessageService);
  /** 頁內模式切換的同文件 VT（#1641 項 4） */
  private readonly viewTransition = injectViewTransition();
  /**
   * 「今天」與「現在」只在建構時取一次，來自跟伺服器對過的時鐘、換成台北牆上時間（#1810）——
   * 原本是瀏覽器的 `new Date()`／`todayLocal()`，跨日或時區不同的機器會跟後端說不同的「今天」。
   * 頁面開著跨過上課時間，「還沒上」不會自己翻成「上課中」：同老師課表的知情取捨，換區間會重抓。
   */
  private readonly clock = inject(SystemClockService);
  private readonly now = taipeiWallClock(this.clock.nowEpochMs());
  private readonly today = taipeiDateString(this.clock.nowEpochMs());

  protected readonly rangeOptions = RANGE_OPTIONS;
  protected readonly rangeMode = signal<RangeMode>('recent10');
  /** `YYYY-MM`（A6 `<input type="month">`） */
  protected readonly selectedMonth = signal(this.today.slice(0, 7));
  protected readonly maxMonth = this.today.slice(0, 7);

  /** 窗內每一堂（#1810 起是課堂，不是出勤紀錄 —— 沒點名的堂也在） */
  protected readonly records = signal<ParentAttendanceDayRow[]>([]);
  /** 日期 → 台北 `HH:mm`（#1075 每日到班） */
  protected readonly checkins = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly dailyCampusIds = signal<ReadonlySet<string>>(new Set());
  /** 今天、沒停課的堂（色面句要知道今天有沒有課，出勤紀錄要點完名才有） */
  private readonly todaySessions = signal<ParentSession[] | null>(null);
  protected readonly shown = signal(DAYS_STEP);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly expandedId = signal<string | null>(null);

  /** 幫孩子請假（#1695，A6 p-attendance `forms.leave`）：學生固定是目前選中的孩子 */
  protected readonly activeChild = this.childScope.activeChild;
  protected readonly leaveOpen = signal(false);
  private readonly leaveDialog = viewChild<ElementRef<HTMLDialogElement>>('leaveDialog');
  /** 送出時記下填的開始日期，toast 要寫「已登記 {孩子} {M/D} 請假」 */
  private leaveStart: string | null = null;
  protected readonly createLeave = (body: CreateLeaveInput) => {
    this.leaveStart = body.startDate;
    return this.attendanceService.createLeave(body);
  };

  /**
   * 本月缺席次數（錨點）。`null` = 還沒有值，**不是 0**。
   *
   * 用 nullable 而不是 `signal(0)`，是因為「還沒載到」跟「本月真的沒缺席」
   * 都會讓畫面出現 0，而後者是好消息、前者什麼都不是。模板用 `!== null` 判斷，
   * 不能用 `@if (monthlyAbsent(); as n)` —— 0 是 falsy，那樣寫剛好把唯一的好消息藏起來。
   *
   * 數字的範圍是**本月自然月**，跟上面的區間篩選無關（後端固定用 `monthStart()` 算），
   * 所以模板必須把「本月」寫出來。
   */
  protected readonly monthlyAbsent = signal<number | null>(null);

  protected readonly childName = computed(() => this.activeChild()?.name ?? null);

  /** 色面第二行（設計稿 §3）；`null` = 標題退回「到班紀錄」 */
  protected readonly heroTail = computed(() => {
    const sessions = this.todaySessions();
    if (!this.childName() || sessions === null) return null;
    return heroLine(
      sessions,
      this.checkins().get(this.today),
      this.dailyCampusIds(),
      format(this.now, 'HH:mm'),
    );
  });

  /** 期間內每一天（A6 一天一章） */
  protected readonly days = computed(() => {
    const { dateFrom, dateTo } = this.dateRange();
    return buildDays(
      this.records(),
      this.checkins(),
      this.dailyCampusIds(),
      dateFrom,
      dateTo,
      this.today,
    );
  });
  protected readonly visibleDays = computed(() =>
    this.rangeMode() === 'recent10' ? this.days() : this.days().slice(0, this.shown()),
  );
  protected readonly countLine = computed(() => {
    const { dateFrom, dateTo } = this.dateRange();
    return `${monthDay(dateFrom)}–${monthDay(dateTo)}，共 ${this.days().length} 天`;
  });
  protected readonly statusLabels = ATTENDANCE_STATUS_LABELS;
  protected readonly sessionChipLabel = sessionChipLabel;
  /** 一堂的狀態字（設計稿 §4）：停課 ＞ 紀錄 ＞ 推導 ＞ 還沒上／上課中 ＞ 沒有紀錄 */
  protected status(row: ParentAttendanceDayRow) {
    return rowStatus(row, this.now);
  }
  /** A6 展開的「老師 · 教室」；缺哪個就不寫哪個 */
  protected teacherLine(row: ParentAttendanceDayRow): string {
    return [row.teacherName, row.classroomName].filter(Boolean).join(' · ');
  }

  /** A6 `range()`：近 N 天含今天；選月份到月底或今天（取早的） */
  private readonly dateRange = computed<{ dateFrom: string; dateTo: string }>(() => {
    const today = this.today;
    const mode = this.rangeMode();
    if (mode === 'recent10') return { dateFrom: addDays(today, -9), dateTo: today };
    if (mode === 'recent30') return { dateFrom: addDays(today, -29), dateTo: today };
    const first = `${this.selectedMonth()}-01`;
    const last = addDays(`${addDays(first, 32).slice(0, 7)}-01`, -1);
    return { dateFrom: first, dateTo: last < today ? last : today };
  });

  constructor() {
    // 孩子切換器換孩子、或篩選條件變了都要重新查——這三頁是切換器真正要驅動的東西，
    // 不像 02 片試點的 dashboard 只是擺著看
    effect(() => {
      const childId = this.childScope.activeChildId();
      this.dateRange();
      if (!childId) return;
      untracked(() => this.load(childId));
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  protected onRangeChange(mode: RangeMode): void {
    this.viewTransition(() => {
      this.rangeMode.set(mode);
      this.shown.set(DAYS_STEP);
      this.expandedId.set(null);
    });
  }

  protected onMonthChange(month: string): void {
    if (!month) return;
    this.selectedMonth.set(month);
    this.shown.set(DAYS_STEP);
    this.expandedId.set(null);
  }

  protected openLeave(): void {
    this.leaveOpen.set(true);
    // 等 @if 把表單畫進 dialog 再 showModal（焦點才落得到第一個欄位）
    queueMicrotask(() => this.leaveDialog()?.nativeElement.showModal());
  }

  protected closeLeave(): void {
    this.leaveDialog()?.nativeElement.close();
  }

  /** 點背景（dialog 本身，不是裡面的表單）關掉，同 A6 `form()` */
  protected onLeaveBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeLeave();
  }

  protected onLeaveClosed(result: unknown): void {
    this.closeLeave();
    const child = this.activeChild();
    if (!result || !child) return;
    const start = this.leaveStart ? format(parseISO(this.leaveStart), 'M/d') : '';
    this.messageService.add({ severity: 'success', summary: `已登記 ${child.name} ${start} 請假` });
    // 重抓目前期間：範圍內的課就地變「請假」
    this.load(child.id);
  }

  protected toggleExpanded(record: ParentAttendanceDayRow): void {
    this.expandedId.set(this.expandedId() === record.id ? null : record.id);
  }

  protected loadMore(): void {
    this.shown.update((n) => n + DAYS_STEP);
  }

  /**
   * 三支一起：期間的每一堂（#1810：一支查完整個窗，不分頁）、期間的到班時間、今天的堂。
   * 到班與今天的堂讀失敗不擋列表 —— 少的是到班行與色面句，課照樣看得到。
   * **查詢的窗就是畫天數的窗**（`dateRange()`）—— 兩邊各算一份，就是 fillMissingDays 那類陷阱。
   */
  /** 換孩子或換期間很快（A→B→A）時，上一個請求晚到不能蓋掉現在這個孩子的 —— 新的一發出就取消舊的（#1978） */
  private loadSub?: Subscription;

  private load(childId: string): void {
    this.loading.set(true);
    this.failed.set(false);
    const { dateFrom, dateTo } = this.dateRange();
    const today = this.today;
    const records$ = this.attendanceService
      .days(childId, dateFrom, dateTo)
      .pipe(map((res) => ({ data: res.data, monthlyAbsent: res.meta.monthlyAbsentCount })));
    // 色面句要今天的刷卡；期間不含今天（選了過去的月份）就多查今天一天，不把區間拉長（後端上限 366 天）
    const checkinsIn = (from: string, to: string) =>
      this.attendanceService.checkins(childId, from, to).pipe(catchError(() => of(null)));
    const checkins$ =
      dateTo === today
        ? checkinsIn(dateFrom, dateTo)
        : forkJoin([checkinsIn(dateFrom, dateTo), checkinsIn(today, today)]).pipe(
            map(([range, now]) =>
              range && now
                ? {
                    data: [...range.data, ...now.data],
                    dailyCheckinCampusIds: range.dailyCheckinCampusIds,
                  }
                : null,
            ),
          );
    const today$ = this.sessionsService
      .list(childId, today, today)
      .pipe(catchError(() => of(null)));

    this.loadSub?.unsubscribe();
    this.loadSub = forkJoin([records$, checkins$, today$]).subscribe({
      next: ([records, checkins, todays]) => {
        this.records.set(records.data);
        this.monthlyAbsent.set(records.monthlyAbsent);
        this.checkins.set(new Map((checkins?.data ?? []).map((k) => [k.date, k.time])));
        this.dailyCampusIds.set(new Set(checkins?.dailyCheckinCampusIds ?? []));
        this.todaySessions.set(todays ? todays.data.filter((x) => x.status !== 'cancelled') : null);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
        this.records.set([]);
        // 整批查失敗時把錨點收回去 —— 留著一個「0 次缺席」等於用失敗換來一則好消息
        this.monthlyAbsent.set(null);
      },
    });
  }
}
