import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentSessionsService,
  type ParentClassLog,
  type ParentSession,
} from '@core/parent-sessions.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { SystemClockService, addDaysToDateString } from '@core/system-clock.service';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import {
  WEEKDAY_LABELS,
  changeLabels,
  changeText,
  formatMd,
  heroOf,
  hhmm,
  mondayOf,
  sessionPhase,
  sortSessions,
  taipeiMinutes,
  taipeiTimeOfDay,
  weekDates,
  weekdayIndex,
  type SessionPhase,
} from './schedule.util';

const CHANGE_KIND_LABEL = { reschedule: '調課', substitute: '代課', cancellation: '停課' } as const;

/**
 * 家長端課表（A6 p-schedule.html，#1314）。資料全來自既有 `GET /api/me/sessions`（範圍、轉班防線、
 * 停課照回都在 API 端）與 `GET /api/me/class-logs`（這堂的作業）。
 *
 * A6 有、這裡沒有（缺家長端 API，列 #1314 後續項）：聯絡簿與「已閱簽收」、小考名稱、
 * 「這週還沒報名／還沒排出來」兩句（`Child` 沒有報名生效日，空週一律寫「這週沒有課」）。
 */
@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [
    RouterLink,
    PageOpenComponent,
    ChildSwitcherComponent,
    ChildScopeGateComponent,
    EmptyStateComponent,
  ],
  templateUrl: './schedule.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly sessionsService = inject(ParentSessionsService);
  private readonly clock = inject(SystemClockService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly weekdayLabels = WEEKDAY_LABELS;
  protected readonly changeLabels = changeLabels;
  protected readonly changeText = changeText;
  protected readonly formatMd = formatMd;
  protected readonly hhmm = hhmm;
  protected readonly changeKindLabel = CHANGE_KIND_LABEL;
  protected weekdayOf(date: string): string {
    return WEEKDAY_LABELS[weekdayIndex(date)];
  }

  private readonly today = this.clock.todayTaipei;
  protected readonly todayDate = this.today;
  private readonly nowMin = computed(() => taipeiMinutes(this.clock.nowEpochMs()));
  private readonly thisMonday = computed(() => mondayOf(this.today()));

  /** 目前看的是哪一週（週一的日期）；null＝本週 */
  private readonly pickedMonday = signal<string | null>(null);
  protected readonly monday = computed(() => this.pickedMonday() ?? this.thisMonday());
  protected readonly isThisWeek = computed(() => this.monday() === this.thisMonday());
  protected readonly days = computed(() => weekDates(this.monday()));
  protected readonly weekLabel = computed(
    () => `${formatMd(this.monday())}～${formatMd(addDaysToDateString(this.monday(), 6))}`,
  );

  protected readonly childName = computed(() => this.childScope.activeChild()?.name ?? '');

  /** 開場用：本週＋下週（一次查；看本週時週曆直接用它，回到本週會重查一次拿新資料） */
  private readonly heroSessions = signal<ParentSession[]>([]);
  private readonly otherWeekSessions = signal<ParentSession[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  protected readonly weekSessions = computed(() =>
    sortSessions(this.isThisWeek() ? this.heroSessions() : this.otherWeekSessions()),
  );
  protected readonly weekEmpty = computed(
    () => !this.loading() && this.weekSessions().length === 0,
  );

  protected readonly sessionsByDate = computed(() => {
    const map = new Map<string, ParentSession[]>();
    for (const s of this.weekSessions()) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return map;
  });

  protected phase(s: ParentSession): SessionPhase {
    return sessionPhase(s, this.today(), this.nowMin());
  }

  /** 「本週 N 堂」：本週不含停課的堂 */
  private readonly thisWeekCount = computed(
    () =>
      this.heroSessions().filter(
        (s) =>
          s.date >= this.thisMonday() &&
          s.date < addDaysToDateString(this.thisMonday(), 7) &&
          this.phase(s) !== 'off',
      ).length,
  );

  protected readonly hero = computed(() =>
    heroOf(this.heroSessions(), this.today(), this.nowMin()),
  );

  protected readonly heroTitle = computed(() => {
    const name = this.childName();
    const h = this.hero();
    if (h.kind === 'live')
      return { head: `${name} 正在上`, tail: `${h.session.className ?? '這堂課'}。` };
    if (h.kind === 'next') {
      const day =
        h.session.date === this.today()
          ? '今天'
          : `${formatMd(h.session.date)}（${WEEKDAY_LABELS[weekdayIndex(h.session.date)].replace('週', '')}）`;
      return { head: `${name} 下一堂`, tail: `${day} ${hhmm(h.session.startTime)}。` };
    }
    return { head: `${name} 接下來兩週`, tail: '沒有課。' };
  });

  protected readonly heroSub = computed(() => {
    const h = this.hero();
    const lead =
      h.kind === 'live'
        ? `${hhmm(h.session.endTime)} 下課 · `
        : h.kind === 'next'
          ? `${h.session.className ?? ''} · `
          : '';
    return `${lead}本週 ${this.thisWeekCount()} 堂`;
  });

  // ── 詳情對話框 ──
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('detailDialog');
  protected readonly selected = signal<ParentSession | null>(null);
  protected readonly homeworkLoading = signal(false);
  private readonly classLogs = signal<ParentClassLog[]>([]);

  protected readonly selectedPhase = computed<SessionPhase | null>(() => {
    const s = this.selected();
    return s ? this.phase(s) : null;
  });

  protected readonly selectedHomework = computed(() => {
    const s = this.selected();
    if (!s) return null;
    return this.classLogs().find((l) => l.classId === s.classId && l.logDate === s.date) ?? null;
  });

  /** 之前的作業：同一個班、比這堂早的最近 10 篇 */
  protected readonly homeworkHistory = computed(() => {
    const s = this.selected();
    if (!s) return [];
    return this.classLogs()
      .filter((l) => l.classId === s.classId && l.logDate < s.date)
      .sort((a, b) => (a.logDate < b.logDate ? 1 : -1))
      .slice(0, 10);
  });

  protected readonly attendanceText = computed(() => {
    const s = this.selected();
    const phase = this.selectedPhase();
    if (!s || !phase) return '';
    if (phase === 'off') return '停課，不用到班';
    if (!s.attendance) return phase === 'future' ? '還沒上課' : '還沒點名';
    switch (s.attendance.status) {
      case 'present':
        return s.attendance.checkedInAt
          ? `到了 · ${taipeiTimeOfDay(s.attendance.checkedInAt)} 到班`
          : '到了';
      case 'absent':
        return '缺席';
      case 'on_leave':
        return '請假';
    }
  });

  constructor() {
    effect(() => {
      const childId = this.childScope.activeChildId();
      const monday = this.monday();
      const thisMonday = this.thisMonday();
      if (!childId) return;
      untracked(() => this.load(childId, monday, thisMonday));
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  private load(childId: string, monday: string, thisMonday: string): void {
    this.loading.set(true);
    this.failed.set(false);
    // 本週視窗＝本週一到下週日（14 天）；看別週才多查那一週
    const range =
      monday === thisMonday
        ? { from: thisMonday, to: addDaysToDateString(thisMonday, 13) }
        : { from: monday, to: addDaysToDateString(monday, 6) };
    this.sessionsService
      .list(childId, range.from, range.to)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          if (monday === thisMonday) this.heroSessions.set(data);
          else this.otherWeekSessions.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
    // 開場句要本週資料：看別週時本週那份還沒有就補查一次
    if (monday !== thisMonday && this.heroSessions().length === 0) {
      this.sessionsService
        .list(childId, thisMonday, addDaysToDateString(thisMonday, 13))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: ({ data }) => this.heroSessions.set(data), error: () => undefined });
    }
  }

  protected retry(): void {
    const childId = this.childScope.activeChildId();
    if (childId) this.load(childId, this.monday(), this.thisMonday());
  }

  protected shiftWeek(weeks: number): void {
    this.pickedMonday.set(addDaysToDateString(this.monday(), weeks * 7));
  }

  protected goThisWeek(): void {
    this.pickedMonday.set(null);
  }

  protected jumpTo(date: string): void {
    if (date) this.pickedMonday.set(mondayOf(date));
  }

  protected open(s: ParentSession): void {
    this.selected.set(s);
    this.classLogs.set([]);
    this.dialog()?.nativeElement.showModal();
    const childId = this.childScope.activeChildId();
    if (!childId || this.phase(s) === 'future' || this.phase(s) === 'off') return;
    this.homeworkLoading.set(true);
    this.sessionsService
      .homework(childId, addDaysToDateString(s.date, -120), s.date)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.classLogs.set(data);
          this.homeworkLoading.set(false);
        },
        error: () => this.homeworkLoading.set(false),
      });
  }

  protected closeDetail(): void {
    this.dialog()?.nativeElement.close();
  }

  protected onDialogClick(event: MouseEvent): void {
    // 點到 <dialog> 本身（＝backdrop）才關；點內容不關
    if (event.target === event.currentTarget) this.closeDetail();
  }
}
