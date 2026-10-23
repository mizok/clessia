import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HeightFollowDirective } from '@shared/directives/height-follow.directive';
import { TextSwapDirective } from '@shared/directives/text-swap.directive';
import { catchError, forkJoin, of, type Observable } from 'rxjs';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentApplicationsService,
  type ParentCatalogClass,
} from '@core/parent-applications.service';
import { ParentAttendanceService } from '@core/parent-attendance.service';
import { ParentBillingService, type ParentInvoice } from '@core/parent-billing.service';
import { ParentGradesService, type ParentScoreRecord } from '@core/parent-grades.service';
import {
  ParentSessionsService,
  type ParentClassLog,
  type ParentSession,
} from '@core/parent-sessions.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import {
  SystemClockService,
  addDaysToDateString,
  taipeiDateString,
} from '@core/system-clock.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import { changeLabels, sessionPhase, taipeiMinutes } from '../schedule/schedule.util';
import {
  type Tag,
  arrivalLine,
  dayLabel,
  examRows,
  feeUnit,
  latestLogs,
  monthDay,
  payStrip,
  recommendations,
  shownSessions,
  slotsLabel,
  subLine,
  weekdayChar,
} from './dashboard.util';
import { PushPromptComponent } from './push-prompt/push-prompt.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

type Detail =
  | { kind: 'session'; session: ParentSession }
  | { kind: 'log'; log: ParentClassLog }
  | { kind: 'class'; cls: ParentCatalogClass };

/** 六支各自失敗：讀不到的那一節說讀不到，其他節照常 */
interface Loaded {
  sessions: ParentSession[] | null;
  checkins: { time: string | undefined; dailyCampusIds: ReadonlySet<string> } | null;
  invoices: { rows: ParentInvoice[]; totalDue: number } | null;
  scores: ParentScoreRecord[] | null;
  logs: ParentClassLog[] | null;
  catalog: ParentCatalogClass[] | null;
}

/**
 * 家長首頁（A6 p-dashboard）：色面（孩子今天到了嗎）→ 待繳 → 今天／接下來的課 → 考試與成績 →
 * 最新聯絡簿 → 可以加選的課。節的順序照「需要家長做事」排（稿的說明）。
 * 稿的「續課預告」條這次不做：沒有自動開單日，算不出 T-5～T-0 的出現窗口（計畫席 10-22 裁定）。
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    SkeletonComponent,
    DecimalPipe,
    NgTemplateOutlet,
    RouterLink,
    PushPromptComponent,
    PageOpenComponent,
    ChildSwitcherComponent,
    ChildScopeGateComponent,
    HeightFollowDirective,
    TextSwapDirective,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly sessionsService = inject(ParentSessionsService);
  private readonly attendanceService = inject(ParentAttendanceService);
  private readonly billingService = inject(ParentBillingService);
  private readonly gradesService = inject(ParentGradesService);
  private readonly applicationsService = inject(ParentApplicationsService);

  /** 進頁取一次（同出缺席頁）：開著跨過上課時間，「上課中」不會自己翻 */
  private readonly nowMs = inject(SystemClockService).nowEpochMs();
  protected readonly today = taipeiDateString(this.nowMs);
  private readonly nowMin = taipeiMinutes(this.nowMs);
  private readonly nowHHmm = `${String(Math.floor(this.nowMin / 60)).padStart(2, '0')}:${String(this.nowMin % 60).padStart(2, '0')}`;

  protected readonly data = signal<Loaded | null>(null);
  protected readonly detail = signal<Detail | null>(null);
  private readonly detailDialog = viewChild<ElementRef<HTMLDialogElement>>('detailDialog');

  protected readonly childName = computed(() => this.childScope.activeChild()?.name ?? null);
  /** 推薦那節的「國三適合」 */
  protected readonly gradeLabel = computed(() => {
    const grade = this.childScope.activeChild()?.grade;
    return grade ? (GRADE_LEVEL_LABELS[grade as GradeLevel] ?? null) : null;
  });

  protected readonly arrival = computed(() => {
    const d = this.data();
    if (!d?.sessions || !this.childName()) return null;
    const todays = d.sessions.filter((s) => s.date === this.today);
    return arrivalLine(
      todays,
      d.checkins?.time,
      d.checkins?.dailyCampusIds ?? new Set(),
      this.nowHHmm,
    );
  });
  protected readonly sub = computed(() => {
    const sessions = this.data()?.sessions;
    return sessions && this.childName() ? subLine(sessions, this.today) : '';
  });

  protected readonly pay = computed(() => {
    const inv = this.data()?.invoices;
    if (!inv) return null;
    const strip = payStrip(inv.rows, this.today);
    return strip && inv.totalDue > 0 ? { ...strip, amount: inv.totalDue } : null;
  });
  protected readonly lessons = computed(() => {
    const sessions = this.data()?.sessions;
    return sessions ? shownSessions(sessions, this.today) : null;
  });
  /**
   * 「今天的課／接下來的課」：換孩子載入中（data 回 null）沿用上一個孩子的標題，資料回來才換（#1983）——
   * 不先跳成「接下來的課」再跳回來，那樣每次換孩子都會多播一次換字。第一次載入時是「接下來的課」。
   */
  protected readonly lessonsTitle = linkedSignal<{ loading: boolean; today: boolean }, string>({
    source: () => ({ loading: this.data() === null, today: !!this.lessons()?.today }),
    computation: (s, prev) =>
      s.loading && prev ? prev.value : s.today ? '今天的課' : '接下來的課',
  });
  protected readonly exams = computed(() => {
    const d = this.data();
    return d?.scores && d.sessions ? examRows(d.scores, d.sessions, this.today) : null;
  });
  protected readonly logs = computed(() => {
    const logs = this.data()?.logs;
    return logs ? latestLogs(logs) : null;
  });
  protected readonly recs = computed(() => {
    const catalog = this.data()?.catalog;
    return catalog ? recommendations(catalog) : null;
  });

  protected readonly dayLabel = dayLabel;
  protected readonly monthDay = monthDay;
  protected readonly weekdayChar = weekdayChar;
  protected readonly slotsLabel = slotsLabel;
  protected readonly feeUnit = feeUnit;

  constructor() {
    effect(() => {
      const childId = this.childScope.activeChildId();
      if (!childId) return;
      untracked(() => this.load(childId));
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  protected hhmm(time: string | null): string {
    return time ? time.slice(0, 5) : '';
  }

  /** 列右邊的標籤：課務異動、有小考、上課中（A6 `tagsOf`） */
  protected sessionTags(s: ParentSession): Tag[] {
    const tags: Tag[] = changeLabels(s).map((label) => ({
      tone: label === '停課' ? 'warn' : 'quiet',
      label,
    }));
    if (s.examCount > 0) tags.push({ tone: 'quiet', label: '有小考' });
    if (this.phase(s) === 'live') tags.push({ tone: 'live', label: '上課中' });
    return tags;
  }

  /** 詳情對話框的「狀態」：同列上的標籤 */
  protected tagText(s: ParentSession): string {
    return this.sessionTags(s)
      .map((t) => t.label)
      .join('、');
  }

  protected phase(s: ParentSession) {
    return sessionPhase(s, this.today, this.nowMin);
  }

  /** 「王老師」／代課時「林老師代課」，再接分校 */
  protected sessionMeta(s: ParentSession): string {
    const who = s.teacherName
      ? s.isSubstitute
        ? `${s.teacherName} 老師代課`
        : `${s.teacherName} 老師`
      : null;
    return [who, s.campusName].filter(Boolean).join(' · ');
  }

  protected tagClass(tag: Tag): string {
    switch (tag.tone) {
      case 'error':
        return 'text-error-700';
      case 'warn':
        return 'bg-warning-50 px-2 text-warning-800 shadow-[inset_0_0_0_1px_var(--warning-200)]';
      case 'ok':
        return 'text-success-600';
      case 'live':
        return 'bg-zinc-900 px-2 text-white';
      default:
        return 'bg-zinc-100 px-2 text-zinc-700';
    }
  }

  protected open(detail: Detail): void {
    this.detail.set(detail);
    queueMicrotask(() => this.detailDialog()?.nativeElement.showModal());
  }

  protected closeDetail(): void {
    this.detailDialog()?.nativeElement.close();
  }

  protected onDialogClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeDetail();
  }

  private load(childId: string): void {
    const today = this.today;
    const safe = <T>(source: Observable<T>) => source.pipe(catchError(() => of(null)));
    this.data.set(null);
    forkJoin({
      sessions: safe(this.sessionsService.list(childId, today, addDaysToDateString(today, 14))),
      checkins: safe(this.attendanceService.checkins(childId, today, today)),
      invoices: safe(this.billingService.list({ childId, page: 1, pageSize: 50 })),
      scores: safe(
        this.gradesService.list({
          childId,
          dateFrom: addDaysToDateString(today, -7),
          dateTo: today,
          pageSize: 50,
        }),
      ),
      logs: safe(this.sessionsService.homework(childId, addDaysToDateString(today, -14), today)),
      catalog: safe(this.applicationsService.catalog(childId)),
    }).subscribe((r) => {
      // 換孩子很快時，舊孩子的回應不能蓋掉新的
      if (this.childScope.activeChildId() !== childId) return;
      this.data.set({
        sessions: r.sessions?.data ?? null,
        checkins: r.checkins
          ? {
              time: r.checkins.data.find((c) => c.date === today)?.time,
              dailyCampusIds: new Set(r.checkins.dailyCheckinCampusIds),
            }
          : null,
        invoices: r.invoices ? { rows: r.invoices.data, totalDue: r.invoices.meta.totalDue } : null,
        scores: r.scores?.data ?? null,
        logs: r.logs?.data ?? null,
        catalog: r.catalog?.data ?? null,
      });
    });
  }
}
