import { TextSwapDirective } from '@shared/directives/text-swap.directive';
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
import { Subject, catchError, forkJoin, map, of, switchMap, tap, type Observable } from 'rxjs';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentSessionsService,
  type ParentClassLog,
  type ParentContactBookEntry,
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
  taipeiStamp,
  taipeiTimeOfDay,
  weekDates,
  weekdayIndex,
  type SessionPhase,
} from './schedule.util';
import {
  StepMotionDirective,
  stepMotion,
  type StepDir,
  type StepMotion,
} from '@shared/directives/step-motion.directive';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

const CHANGE_KIND_LABEL = { reschedule: '調課', substitute: '代課', cancellation: '停課' } as const;

/**
 * 家長端課表（A6 p-schedule.html，#1314）。資料全來自既有 `GET /api/me/sessions`（範圍、轉班防線、
 * 停課照回都在 API 端）與 `GET /api/me/class-logs`（這堂的作業）。
 *
 * A6 有、這裡沒有（缺家長端 API，列 #1314 後續項）：小考名稱、
 * 「這週還沒報名／還沒排出來」兩句（`Child` 沒有報名生效日，空週一律寫「這週沒有課」）。
 */
@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [
    TextSwapDirective,
    SkeletonComponent,
    RouterLink,
    PageOpenComponent,
    ChildSwitcherComponent,
    ChildScopeGateComponent,
    EmptyStateComponent,
    StepMotionDirective,
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
  private readonly messageService = inject(MessageService);

  protected readonly weekdayLabels = WEEKDAY_LABELS;
  protected readonly changeLabels = changeLabels;
  protected readonly changeText = changeText;
  protected readonly formatMd = formatMd;
  protected readonly hhmm = hhmm;
  protected readonly taipeiStamp = taipeiStamp;
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

  /**
   * 回來的資料都**帶著是哪個孩子、哪一週查的**，讀的時候跟現在的孩子／週比對 ——
   * 切孩子時舊孩子的資料不會被當成新孩子的 Hero（別週切孩子曾經殘留前一個孩子的「下一堂」）。
   */
  private readonly heroStore = signal<{ childId: string; data: ParentSession[] } | null>(null);
  private readonly weekStore = signal<{ childId: string; data: ParentSession[] } | null>(null);
  /** 開場用：本週＋下週（一次查；看本週時週曆直接用它，回到本週會重查一次拿新資料） */
  private readonly heroSessions = computed(() => {
    const store = this.heroStore();
    return store && store.childId === this.childScope.activeChildId() ? store.data : [];
  });
  private readonly otherWeekSessions = computed(() => {
    const store = this.weekStore();
    // 不比週別：週曆只畫 days() 裡的日期，別週的課自然畫不出來
    return store && store.childId === this.childScope.activeChildId() ? store.data : [];
  });
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

  /** 這個孩子的本週資料回來了嗎。沒回來（載入中、失敗）時 Hero 不下結論，免得把「還沒讀到」說成「沒有課」 */
  protected readonly heroReady = computed(
    () => this.heroStore()?.childId === this.childScope.activeChildId(),
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
  /** 作業／聯絡簿讀失敗：不能寫成「老師還沒有寫」，那是一句會騙人的話 */
  protected readonly homeworkFailed = signal(false);
  private readonly classLogs = signal<ParentClassLog[]>([]);
  /** 開聯絡簿的班（`usesContactBook`）看這個，不看 `classLogs`（#1100 #26） */
  private readonly contactBook = signal<ParentContactBookEntry[]>([]);
  protected readonly signing = signal(false);

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

  /** 這堂那天的聯絡簿。一則屬於學生不屬於班 —— 同一天上兩個班看到的是同一則 */
  protected readonly selectedEntry = computed(() => {
    const s = this.selected();
    if (!s) return null;
    return this.contactBook().find((e) => e.entryDate === s.date) ?? null;
  });

  /** 之前的聯絡簿：比這堂早的最近 10 則 */
  protected readonly entryHistory = computed(() => {
    const s = this.selected();
    if (!s) return [];
    return this.contactBook()
      .filter((e) => e.entryDate < s.date)
      .slice(0, 10); // API 已經新到舊
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

  /** 查課表的請求流：switchMap 讓快速切週、切孩子時舊回應不會蓋掉新回應 */
  private readonly request$ = new Subject<{
    childId: string;
    monday: string;
    thisMonday: string;
    needHero: boolean;
  }>();
  /** 看詳情時查作業（或聯絡簿）；連點不同堂時同樣只認最後一次 */
  private readonly homework$ = new Subject<{
    childId: string;
    date: string;
    usesContactBook: boolean;
  }>();

  constructor() {
    this.request$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
        }),
        switchMap((r) => this.fetch(r)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    this.homework$
      .pipe(
        switchMap(({ childId, date, usesContactBook }) => {
          const from = addDaysToDateString(date, -120);
          const read$: Observable<{ logs?: ParentClassLog[]; book?: ParentContactBookEntry[] }> =
            usesContactBook
              ? this.sessionsService
                  .contactBook(childId, from, date)
                  .pipe(map((res) => ({ book: res.data })))
              : this.sessionsService
                  .homework(childId, from, date)
                  .pipe(map((res) => ({ logs: res.data })));
          return read$.pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.classLogs.set(r?.logs ?? []);
        this.contactBook.set(r?.book ?? []);
        this.homeworkFailed.set(r === null);
        this.homeworkLoading.set(false);
      });

    effect(() => {
      const childId = this.childScope.activeChildId();
      const monday = this.monday();
      const thisMonday = this.thisMonday();
      if (!childId) return;
      untracked(() => this.requestWeek(childId, monday, thisMonday));
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  private requestWeek(childId: string, monday: string, thisMonday: string): void {
    // 本週視窗＝本週一到下週日（14 天）；看別週才多查那一週，Hero 沒有這個孩子的資料時才補查
    const needHero = monday === thisMonday || this.heroStore()?.childId !== childId;
    this.request$.next({ childId, monday, thisMonday, needHero });
  }

  private fetch(r: {
    childId: string;
    monday: string;
    thisMonday: string;
    needHero: boolean;
  }): Observable<unknown> {
    const hero$ = r.needHero
      ? this.sessionsService
          .list(r.childId, r.thisMonday, addDaysToDateString(r.thisMonday, 13))
          .pipe(map((res) => res.data))
      : of(null);
    const week$ =
      r.monday === r.thisMonday
        ? of(null)
        : this.sessionsService
            .list(r.childId, r.monday, addDaysToDateString(r.monday, 6))
            .pipe(map((res) => res.data));
    return forkJoin({ hero: hero$, week: week$ }).pipe(
      tap(({ hero, week }) => {
        if (hero) this.heroStore.set({ childId: r.childId, data: hero });
        if (week) this.weekStore.set({ childId: r.childId, data: week });
        this.loading.set(false);
        if (this.pendingStep) this.contentMotion.set(stepMotion(this.pendingStep));
        this.pendingStep = null;
      }),
      catchError(() => {
        this.pendingStep = null;
        this.failed.set(true);
        this.loading.set(false);
        return of(null);
      }),
    );
  }

  protected retry(): void {
    const childId = this.childScope.activeChildId();
    if (childId) this.requestWeek(childId, this.monday(), this.thisMonday());
  }

  /** 換週的方向淡入（#1641 項 3）：資料套上的那一刻才給，換孩子等其他重查沒有方向 */
  protected readonly contentMotion = signal<StepMotion | null>(null);
  private pendingStep: StepDir | null = null;

  protected shiftWeek(weeks: number): void {
    this.goToMonday(addDaysToDateString(this.monday(), weeks * 7));
  }

  protected goThisWeek(): void {
    this.goToMonday(null);
  }

  protected jumpTo(date: string): void {
    if (date) this.goToMonday(mondayOf(date));
  }

  /** `null` = 回本週。yyyy-MM-dd 字串比大小就是日期先後 */
  private goToMonday(picked: string | null): void {
    const target = picked ?? this.thisMonday();
    const current = this.monday();
    this.pendingStep = target === current ? null : target > current ? 'forward' : 'back';
    this.pickedMonday.set(picked);
  }

  protected open(s: ParentSession): void {
    this.selected.set(s);
    this.classLogs.set([]);
    this.contactBook.set([]);
    this.homeworkFailed.set(false);
    this.dialog()?.nativeElement.showModal();
    const childId = this.childScope.activeChildId();
    if (!childId || this.phase(s) === 'future' || this.phase(s) === 'off') return;
    this.homeworkLoading.set(true);
    this.homework$.next({ childId, date: s.date, usesContactBook: s.usesContactBook });
  }

  /** 已閱簽收（#1100 #26）。成功就地換成回來的那則（可能是另一位家長先簽了 —— 回的是現狀） */
  protected sign(entry: ParentContactBookEntry): void {
    if (this.signing()) return;
    this.signing.set(true);
    this.sessionsService
      .signContactBook(entry.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (signed) => {
          this.contactBook.update((list) => list.map((e) => (e.id === signed.id ? signed : e)));
          this.signing.set(false);
          this.messageService.add({
            severity: 'success',
            summary: `已簽收 ${formatMd(signed.entryDate)} 的聯絡簿`,
          });
        },
        error: () => {
          this.signing.set(false);
          this.messageService.add({ severity: 'error', summary: '簽收失敗，請稍後再試' });
        },
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
